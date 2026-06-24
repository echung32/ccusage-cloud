import { Hono } from 'hono';
import * as v from 'valibot';
import type { AppBindings } from './env';
import { requireViewer } from './viewer';
import { summaryQuery, type SummaryFilters } from './queries';

export const readApiRoutes = new Hono<AppBindings>();

readApiRoutes.use('/api/*', requireViewer);

const FiltersSchema = v.object({
  from: v.optional(v.string()),
  to: v.optional(v.string()),
  source: v.optional(v.string()),
  device: v.optional(v.string()),
});

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
  const { userId } = c.var.viewer;
  const filters = parseFilters(c);
  const summary = await summaryQuery(c.env.DB, userId, filters);
  return c.json(summary);
});
