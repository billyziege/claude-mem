// SPDX-License-Identifier: Apache-2.0

import type { Database } from 'bun:sqlite';
import type { ContinuitySummary } from './types.js';

export function rowToSummary(row: Record<string, unknown>): ContinuitySummary {
  return {
    id: row.id as number,
    contentSessionId: row.content_session_id as string,
    project: row.project as string,
    status: row.status as ContinuitySummary['status'],
    trigger: row.trigger as ContinuitySummary['trigger'],
    stateSection: row.state_section as string | null,
    arcSection: row.arc_section as string | null,
    nextSection: row.next_section as string | null,
    transcriptFill: row.transcript_fill as number | null,
    generatedAtEpoch: row.generated_at_epoch as number,
    approvedAtEpoch: row.approved_at_epoch as number | null,
  };
}

export function getLatestContinuitySummary(
  db: Database,
  project: string,
  statusFilter: 'approved' | 'draft' | 'any' = 'approved',
): ContinuitySummary | null {
  const where = statusFilter === 'any' ? '' : `AND status = '${statusFilter}'`;
  const row = db.prepare(`
    SELECT * FROM continuity_summaries
    WHERE project = ? ${where}
    ORDER BY generated_at_epoch DESC
    LIMIT 1
  `).get(project) as any;
  return row ? rowToSummary(row) : null;
}

export function getPendingContinuitySummaries(
  db: Database,
  project: string,
): ContinuitySummary[] {
  const rows = db.prepare(`
    SELECT * FROM continuity_summaries
    WHERE project = ? AND status = 'draft'
    ORDER BY generated_at_epoch DESC
  `).all(project) as any[];
  return rows.map(rowToSummary);
}

export function getContinuitySummaryById(db: Database, id: number): ContinuitySummary | null {
  const row = db.prepare('SELECT * FROM continuity_summaries WHERE id = ?').get(id) as any;
  return row ? rowToSummary(row) : null;
}

export function hasDraftForSession(db: Database, contentSessionId: string): boolean {
  const row = db.prepare(`
    SELECT 1 FROM continuity_summaries
    WHERE content_session_id = ? AND status = 'draft'
    LIMIT 1
  `).get(contentSessionId);
  return row !== null;
}
