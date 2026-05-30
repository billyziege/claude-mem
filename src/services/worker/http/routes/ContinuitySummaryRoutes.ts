// SPDX-License-Identifier: Apache-2.0

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../../../../utils/logger.js';
import { paths } from '../../../../shared/paths.js';
import { SettingsDefaultsManager } from '../../../../shared/SettingsDefaultsManager.js';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { validateBody } from '../middleware/validateBody.js';
import { DatabaseManager } from '../../DatabaseManager.js';
import { generateContinuitySummary } from '../../ContinuitySummaryGenerator.js';
import { findTranscriptPath } from '../../../../shared/transcript-context-fill.js';
import {
  storeContinuitySummary,
  approveContinuitySummary,
  getLatestContinuitySummary,
  getPendingContinuitySummaries,
  getContinuitySummaryById,
  hasDraftForSession,
} from '../../../sqlite/continuity-summaries/index.js';

const generateSchema = z.object({
  contentSessionId: z.string().min(1),
  project: z.string().min(1),
  trigger: z.enum(['threshold', 'stop', 'manual']),
  transcriptPath: z.string().optional(),
  transcriptFill: z.number().optional(),
});

const approveSchema = z.object({ id: z.number().int().positive() });

export class ContinuitySummaryRoutes extends BaseRouteHandler {
  constructor(private readonly dbManager: DatabaseManager) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.post('/api/continuity-summary/generate', validateBody(generateSchema), this.handleGenerate.bind(this));
    app.post('/api/continuity-summary/approve', validateBody(approveSchema), this.handleApprove.bind(this));
    app.get('/api/continuity-summary/pending', this.handlePending.bind(this));
    app.get('/api/continuity-summary/latest', this.handleLatest.bind(this));
  }

  private handleGenerate = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof generateSchema>;
    const db = this.dbManager.getConnection();

    if (body.trigger === 'threshold' && hasDraftForSession(db, body.contentSessionId)) {
      res.json({ skipped: true, reason: 'draft_exists' });
      return;
    }

    const transcriptPath = body.transcriptPath ?? findTranscriptPath(body.contentSessionId);
    if (!transcriptPath) {
      res.status(404).json({ error: 'Transcript not found' });
      return;
    }

    res.json({ queued: true });

    // Generate asynchronously — hook doesn't wait for the result
    setImmediate(async () => {
      try {
        const generated = await generateContinuitySummary(transcriptPath);
        if (!generated) {
          logger.debug('CONTINUITY', 'Generation returned null — no summary stored', { sessionId: body.contentSessionId });
          return;
        }

        const settings = SettingsDefaultsManager.loadFromFile(paths.settings());
        const autoApprove = String(settings.SESSION_SUMMARY_AUTO_APPROVE ?? 'false').toLowerCase() === 'true';

        const summary = storeContinuitySummary(db, {
          contentSessionId: body.contentSessionId,
          project: body.project,
          trigger: body.trigger,
          stateSection: generated.stateSection,
          arcSection: generated.arcSection,
          nextSection: generated.nextSection,
          transcriptFill: body.transcriptFill,
          status: autoApprove ? 'approved' : 'draft',
        });

        logger.info('CONTINUITY', `Summary stored as ${summary.status}`, {
          id: summary.id,
          sessionId: body.contentSessionId,
          trigger: body.trigger,
        });
      } catch (err) {
        logger.error('CONTINUITY', 'Failed to generate or store continuity summary', {
          sessionId: body.contentSessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  });

  private handleApprove = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.body as z.infer<typeof approveSchema>;
    const db = this.dbManager.getConnection();
    const existing = getContinuitySummaryById(db, id);
    if (!existing) {
      res.status(404).json({ error: 'Summary not found' });
      return;
    }
    const approved = approveContinuitySummary(db, id);
    res.json({ summary: approved });
  });

  private handlePending = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const project = String(req.query.project ?? '');
    if (!project) {
      this.badRequest(res, 'project query parameter is required');
      return;
    }
    const db = this.dbManager.getConnection();
    const summaries = getPendingContinuitySummaries(db, project);
    res.json({ summaries });
  });

  private handleLatest = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const project = String(req.query.project ?? '');
    const statusFilter = String(req.query.status ?? 'approved') as 'approved' | 'draft' | 'any';
    if (!project) {
      this.badRequest(res, 'project query parameter is required');
      return;
    }
    const db = this.dbManager.getConnection();
    const summary = getLatestContinuitySummary(db, project, statusFilter);
    res.json({ summary });
  });
}
