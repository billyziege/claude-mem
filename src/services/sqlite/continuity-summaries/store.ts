// SPDX-License-Identifier: Apache-2.0

import type { Database } from 'bun:sqlite';
import type { StoreContinuitySummaryInput, ContinuitySummary } from './types.js';
import { rowToSummary } from './get.js';

export function storeContinuitySummary(
  db: Database,
  input: StoreContinuitySummaryInput,
): ContinuitySummary {
  const now = Date.now();
  const status = input.status ?? 'draft';
  const stmt = db.prepare(`
    INSERT INTO continuity_summaries
      (content_session_id, project, status, trigger,
       state_section, arc_section, next_section,
       transcript_fill, generated_at_epoch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    input.contentSessionId,
    input.project,
    status,
    input.trigger,
    input.stateSection ?? null,
    input.arcSection ?? null,
    input.nextSection ?? null,
    input.transcriptFill ?? null,
    now,
  );
  return rowToSummary(db.prepare('SELECT * FROM continuity_summaries WHERE id = ?').get(Number(result.lastInsertRowid)) as any);
}

export function approveContinuitySummary(db: Database, id: number): ContinuitySummary | null {
  const now = Date.now();
  db.prepare(`UPDATE continuity_summaries SET status = 'approved', approved_at_epoch = ? WHERE id = ?`).run(now, id);
  const row = db.prepare('SELECT * FROM continuity_summaries WHERE id = ?').get(id) as any;
  return row ? rowToSummary(row) : null;
}
