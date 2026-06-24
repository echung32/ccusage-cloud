import { createHash } from 'node:crypto';
import type { TaggedSession } from './types';

export function redactProjects(sessions: TaggedSession[]): TaggedSession[] {
  return sessions.map((s) => {
    if (s.projectPath == null) return { ...s };
    const hash = createHash('sha256').update(s.projectPath).digest('hex');
    return { ...s, projectPath: hash };
  });
}
