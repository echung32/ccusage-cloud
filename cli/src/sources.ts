// The ccusage agent adapters (one `ccusage <source> session --json` each).
// Mirrors rust/crates/ccusage/src/adapter/* (excluding the aggregate `all`).
// Sources that error or return empty are skipped by loadSessions, so an
// occasional stale entry here is harmless.
export const ALL_SOURCES = [
  'amp',
  'claude',
  'codebuff',
  'codex',
  'copilot',
  'droid',
  'gemini',
  'goose',
  'hermes',
  'kilo',
  'kimi',
  'openclaw',
  'opencode',
  'pi',
  'qwen',
] as const;
