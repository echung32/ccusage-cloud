import { execFileSync } from 'node:child_process';
import * as v from 'valibot';
import { SessionFileSchema, type TaggedSession } from './types';

export type Runner = (bin: string, args: string[]) => string;

const defaultRunner: Runner = (bin, args) =>
  execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

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

  const parsed = v.safeParse(SessionFileSchema, json);
  if (!parsed.success) return [];

  return parsed.output.sessions
    .filter((s): s is typeof s & { sessionId: string } => s.sessionId !== null)
    .map(({ sessionId, ...rest }) => ({ ...rest, sessionId, source }));
}
