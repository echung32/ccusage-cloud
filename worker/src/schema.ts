import * as v from 'valibot';

export const SessionSchema = v.object({
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
  sessions: v.array(SessionSchema),
});

export type SessionPayload = v.InferOutput<typeof SessionSchema>;
