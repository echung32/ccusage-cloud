import * as v from 'valibot';

export const SessionRowSchema = v.object({
  sessionId: v.nullable(v.string()),
  inputTokens: v.number(),
  outputTokens: v.number(),
  cacheCreationTokens: v.number(),
  cacheReadTokens: v.number(),
  totalTokens: v.number(),
  totalCost: v.optional(v.number()),
  costUSD: v.optional(v.number()),
  credits: v.optional(v.number()),
  firstActivity: v.nullish(v.string()),
  lastActivity: v.nullish(v.string()),
  modelsUsed: v.optional(v.array(v.string()), []),
  modelBreakdowns: v.optional(v.unknown()),
  models: v.optional(
    v.record(
      v.string(),
      v.object({
        inputTokens: v.number(),
        outputTokens: v.number(),
        cacheCreationTokens: v.number(),
        cacheReadTokens: v.number(),
        totalTokens: v.number(),
      }),
    ),
  ),
  projectPath: v.nullish(v.string()),
});

export const SessionFileSchema = v.object({
  sessions: v.array(SessionRowSchema),
});

export type SessionRow = v.InferOutput<typeof SessionRowSchema>;

export type TaggedSession = Omit<SessionRow, 'sessionId' | 'totalCost' | 'costUSD' | 'models'> & {
  source: string;
  sessionId: string;
  totalCost: number;
};
