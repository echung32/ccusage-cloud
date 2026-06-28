import * as v from 'valibot';

export const SessionSchema = v.object({
  // M1 restricts sources to 'claude' on the CLI side (M1_SOURCES). The worker
  // accepts any string here; a server-side source allow-list (v.picklist) is
  // deferred to M2, which broadens the supported source set.
  source: v.string(),
  sessionId: v.string(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  cacheCreationTokens: v.number(),
  cacheReadTokens: v.number(),
  totalTokens: v.number(),
  totalCost: v.number(),
  credits: v.optional(v.number()),
  firstActivity: v.nullish(v.string()),
  lastActivity: v.nullish(v.string()),
  modelsUsed: v.optional(v.array(v.string()), []),
  modelBreakdowns: v.optional(v.unknown()),
  projectPath: v.nullish(v.string()),
});

export const IngestSchema = v.object({
  sessions: v.pipe(v.array(SessionSchema), v.maxLength(1000)),
});

export type SessionPayload = v.InferOutput<typeof SessionSchema>;

export const DailyRowSchema = v.object({
  source: v.string(),
  day: v.string(),
  totalTokens: v.number(),
  totalCost: v.number(),
});

export const IngestDailySchema = v.object({
  days: v.pipe(v.array(DailyRowSchema), v.maxLength(1000)),
});

export type DailyPayload = v.InferOutput<typeof DailyRowSchema>;
