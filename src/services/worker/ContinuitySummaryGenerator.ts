// SPDX-License-Identifier: Apache-2.0

import { readFileSync, existsSync } from 'fs';
import { logger } from '../../utils/logger.js';
import { loadClaudeMemEnv } from '../../shared/EnvManager.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { paths } from '../../shared/paths.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TRANSCRIPT_CHARS = 80_000;

export interface GeneratedContinuitySummary {
  stateSection: string;
  arcSection: string;
  nextSection: string;
}

function extractTranscriptText(transcriptPath: string): string {
  if (!existsSync(transcriptPath)) return '';
  const content = readFileSync(transcriptPath, 'utf-8').trim();
  if (!content) return '';

  const lines = content.split('\n');
  const messages: string[] = [];

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    let line: any;
    try { line = JSON.parse(rawLine); } catch { continue; }

    const role = line.type ?? line.role;
    if (role !== 'user' && role !== 'assistant') continue;

    const msgContent = line.message?.content;
    if (!msgContent) continue;

    let text = '';
    if (typeof msgContent === 'string') {
      text = msgContent;
    } else if (Array.isArray(msgContent)) {
      text = msgContent
        .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
        .map((c: any) => c.text)
        .join('\n');
    }

    text = text.trim();
    if (!text) continue;
    messages.push(`[${role.toUpperCase()}]\n${text}`);
  }

  const joined = messages.join('\n\n---\n\n');
  if (joined.length <= MAX_TRANSCRIPT_CHARS) return joined;
  return '...(earlier context omitted)...\n\n' + joined.slice(-MAX_TRANSCRIPT_CHARS);
}

function buildPrompt(transcriptText: string): string {
  return `You are generating a continuity summary for a Claude Code session. This summary will be injected at the start of the next session to restore context. Be precise and concise — every word costs context budget.

Produce exactly three sections using these exact headers:

## STATE
What is currently true. Include: decisions made and their reasoning, current implementation status, known blockers. Write as present-tense facts. 3–6 bullet points.

## ARC
What has been worked on and why. Include: the problem being solved, key constraints that shaped decisions, design choices and tradeoffs. Enough context that a reader understands the situation without reading the full session. 2–4 sentences.

## NEXT
What was about to happen when this session ended. List in priority order: immediate next steps, open questions that need resolution, anything that must be picked up first. 3–5 bullet points.

Omit: tool call details, exploratory dead ends, intermediate results visible in the code, anything recoverable by reading the current file state.

Session transcript:
${transcriptText}`;
}

function parseSections(text: string): GeneratedContinuitySummary {
  const stateMatch = text.match(/##\s*STATE\s*\n([\s\S]*?)(?=\n##\s*ARC|\n##\s*NEXT|$)/i);
  const arcMatch = text.match(/##\s*ARC\s*\n([\s\S]*?)(?=\n##\s*STATE|\n##\s*NEXT|$)/i);
  const nextMatch = text.match(/##\s*NEXT\s*\n([\s\S]*?)(?=\n##\s*STATE|\n##\s*ARC|$)/i);
  return {
    stateSection: stateMatch?.[1]?.trim() ?? '',
    arcSection: arcMatch?.[1]?.trim() ?? '',
    nextSection: nextMatch?.[1]?.trim() ?? '',
  };
}

export async function generateContinuitySummary(
  transcriptPath: string,
): Promise<GeneratedContinuitySummary | null> {
  const transcriptText = extractTranscriptText(transcriptPath);
  if (!transcriptText) {
    logger.debug('CONTINUITY', 'No transcript content — skipping generation');
    return null;
  }

  const env = loadClaudeMemEnv();
  const apiKey = env.ANTHROPIC_API_KEY;
  const authToken = env.ANTHROPIC_AUTH_TOKEN;

  if (!apiKey && !authToken) {
    logger.debug('CONTINUITY', 'No Anthropic credentials — skipping continuity summary generation');
    return null;
  }

  const settings = SettingsDefaultsManager.loadFromFile(paths.settings());
  const model = settings.CLAUDE_MEM_MODEL || 'claude-haiku-4-5-20251001';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const prompt = buildPrompt(transcriptText);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (err) {
    logger.warn('CONTINUITY', 'Network error during continuity summary generation', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.warn('CONTINUITY', 'Anthropic API error during continuity summary generation', {
      status: response.status,
      body: body.slice(0, 200),
    });
    return null;
  }

  const data = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const text = data.content?.find(c => c.type === 'text')?.text ?? '';

  if (!text) {
    logger.warn('CONTINUITY', 'Empty response from Anthropic for continuity summary');
    return null;
  }

  return parseSections(text);
}
