import { execFileSync } from 'node:child_process';
import * as v from 'valibot';
import { synthesizeBreakdowns } from './model-breakdowns';
import { SessionRowSchema, type TaggedSession } from './types';

export type Runner = (bin: string, args: string[]) => string;

const defaultRunner: Runner = (bin, args) =>
  execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const FileShape = v.object({ sessions: v.array(v.unknown()) });

export function loadSessions(
  source: string,
  bin: string,
  run: Runner = defaultRunner,
): TaggedSession[] {
  let raw: string;
  try {
    raw = run(bin, [source, 'session', '--json']);
  } catch {
    return []; // source not installed / no data
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }

  const file = v.safeParse(FileShape, json);
  if (!file.success) return [];

  const out: TaggedSession[] = [];
  let dropped = 0;
  for (const row of file.output.sessions) {
    const parsed = v.safeParse(SessionRowSchema, row);
    if (!parsed.success) {
      dropped += 1;
      continue;
    }
    const { sessionId, costUSD, totalCost, models, ...rest } = parsed.output;
    if (sessionId === null) continue; // incomplete session — dropped silently, as before
    const resolvedCost = totalCost ?? costUSD ?? 0;
    // Synthesize modelBreakdowns from a `models` object (codex shape) only when the
    // row doesn't already carry one. Keeping modelBreakdowns inside `rest` preserves
    // its key order so sessions whose value is unchanged keep a stable sessionHash
    // (no spurious re-sync).
    if (rest.modelBreakdowns === undefined && models) {
      rest.modelBreakdowns = synthesizeBreakdowns(models, resolvedCost);
    }
    out.push({ ...rest, sessionId, source, totalCost: resolvedCost });
  }
  if (dropped > 0) {
    console.warn(`ccusage ${source}: skipped ${dropped} session(s) that failed validation`);
  }
  return out;
}
