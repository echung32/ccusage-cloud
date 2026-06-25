import { Hono } from 'hono';
import * as v from 'valibot';
import type { AppBindings } from './env';
import { requireUser } from './viewer';
import { summaryQuery, sessionsPage, groupSummaryQuery, clampLimit, type SummaryFilters } from './queries';

export const readApiRoutes = new Hono<AppBindings>();

readApiRoutes.use('/api/*', requireUser);

const FiltersSchema = v.object({
  from: v.optional(v.string()),
  to: v.optional(v.string()),
  source: v.optional(v.string()),
  device: v.optional(v.string()),
});

function parseScope(c: { req: { query: () => Record<string, string> } }): 'me' | 'group' {
  return c.req.query().scope === 'group' ? 'group' : 'me';
}

function parseFilters(c: { req: { query: () => Record<string, string> } }): SummaryFilters {
  const raw = c.req.query();
  const parsed = v.safeParse(FiltersSchema, {
    from: raw.from || undefined,
    to: raw.to || undefined,
    source: raw.source || undefined,
    device: raw.device || undefined,
  });
  return parsed.success ? parsed.output : {};
}

readApiRoutes.get('/api/summary', async (c) => {
  const filters = parseFilters(c);
  const scope = parseScope(c);
  const summary = scope === 'group'
    ? await groupSummaryQuery(c.env.DB, filters)
    : await summaryQuery(c.env.DB, c.var.viewer.userId, filters);
  return c.json(summary);
});

readApiRoutes.get('/api/sessions', async (c) => {
  const { userId } = c.var.viewer;
  const filters = parseFilters(c);
  const raw = c.req.query();
  const limit = clampLimit(raw.limit ? Number(raw.limit) : undefined);
  const cursor = raw.cursor || null;
  const page = await sessionsPage(c.env.DB, userId, filters, cursor, limit);
  return c.json(page);
});
