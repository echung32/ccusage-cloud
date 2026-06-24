import { Hono } from 'hono';
import type { AppBindings } from './env';
import { deviceAuth } from './auth';

const app = new Hono<AppBindings>();

app.get('/health', (c) => c.json({ ok: true }));

app.get('/_whoami', deviceAuth, (c) => c.json(c.var.device));

export default app;
