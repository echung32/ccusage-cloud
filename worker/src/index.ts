import { Hono } from 'hono';
import type { AppBindings } from './env';

const app = new Hono<AppBindings>();

app.get('/health', (c) => c.json({ ok: true }));

export default app;
