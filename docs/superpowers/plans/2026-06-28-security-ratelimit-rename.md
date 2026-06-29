# Security headers, read-API rate limits, device rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add security headers to all Worker responses, rate-limit the authenticated read APIs, and let users rename a device.

**Architecture:** Worker-side changes use Hono middleware (`hono/secure-headers` for headers; a new `viewerRateLimit` middleware reusing the existing KV token-bucket `rateLimit()`). The rename feature adds one `PATCH /api/devices/:id` route plus a `renameDevice` client call and a Cloudscape inline-edit cell. No D1 migration.

**Tech Stack:** TypeScript, Hono 4.12, Valibot, Cloudflare Workers + D1 + KV, `@cloudflare/vitest-pool-workers`; Astro + React 19 + Cloudscape Design, Vitest + Testing Library (jsdom).

## Global Constraints

- pnpm monorepo. Worker tests: `pnpm --filter worker test [file]`. Dashboard tests: `pnpm --filter dashboard test [file]`.
- Worker tests run inside `workerd` via `cloudflare:test`; `env` and `SELF` share the same bindings/isolate.
- All `/api/*` routes require a viewer JWT (mocked in tests via `installJwks()` / `mintToken({ sub })`).
- Read-API rate limit: **300 requests / 60s per user**, key `viewer:${userId}`.
- Device label validation: non-empty string, max length 100.
- CSP is explicitly OUT of scope (Cloudscape needs a tuned policy). Do not add `Content-Security-Policy`.
- Reuse the existing `rateLimit()` in `worker/src/ratelimit.ts` unchanged.

---

### Task 1: Security headers (Worker)

**Files:**
- Modify: `worker/src/index.ts` (add middleware after `const app = new Hono...`)
- Test: `worker/test/security-headers.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: every response from the Worker carries `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.

- [ ] **Step 1: Write the failing test**

Create `worker/test/security-headers.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('security headers', () => {
  it('sets hardening headers on responses', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test test/security-headers.test.ts`
Expected: FAIL (headers are `null`).

- [ ] **Step 3: Add the middleware**

In `worker/src/index.ts`, add the import near the other Hono imports:

```ts
import { secureHeaders } from 'hono/secure-headers';
```

Immediately after `const app = new Hono<AppBindings>();`, insert:

```ts
// Security headers on every response (API + dashboard assets). Registered first
// so it also wraps the asset fallback below.
// NOTE: Content-Security-Policy is intentionally omitted — Cloudscape + Astro/React
// islands need a tuned policy (inline styles / nonces); a strict CSP shipped blind
// breaks the dashboard. Tracked as separate future work.
app.use('*', secureHeaders({
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  xContentTypeOptions: 'nosniff',
  xFrameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test test/security-headers.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full worker suite (no regressions)**

Run: `pnpm --filter worker test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add worker/src/index.ts worker/test/security-headers.test.ts
git commit -m "feat(worker): add security response headers"
```

---

### Task 2: Read-API rate limit middleware (Worker)

**Files:**
- Create: `worker/src/viewer_ratelimit.ts`
- Modify: `worker/src/env.ts` (add `rlChecked` to `Variables`)
- Modify: `worker/src/api.ts` (register middleware)
- Modify: `worker/src/read_api.ts` (register middleware)
- Test: `worker/test/read-ratelimit.test.ts` (create)

**Interfaces:**
- Consumes: `rateLimit(kv, key, limit, windowSec)` from `./ratelimit`; `c.var.viewer.userId` set by `requireUser`.
- Produces: `viewerRateLimit` (Hono middleware), and exported constants `READ_RATE_LIMIT = 300`, `READ_RATE_WINDOW = 60`. Adds request-scoped `rlChecked?: boolean` to the Hono `Variables`.

- [ ] **Step 1: Write the failing test**

Create `worker/test/read-ratelimit.test.ts`:

```ts
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { installJwks, mintToken } from './auth-fixture';
import { seedUser } from './seed';
import { READ_RATE_LIMIT, READ_RATE_WINDOW } from '../src/viewer_ratelimit';

beforeAll(() => installJwks());

async function asViewer(userId: string, path: string) {
  const token = await mintToken({ sub: userId });
  return SELF.fetch(`https://example.com${path}`, { headers: { authorization: `Bearer ${token}` } });
}

describe('read API rate limiting', () => {
  it('allows requests under the limit', async () => {
    const { userId } = await seedUser(env);
    expect((await asViewer(userId, '/api/me')).status).toBe(200);
    expect((await asViewer(userId, '/api/me')).status).toBe(200);
  });

  it('429s once the per-user window budget is spent', async () => {
    const { userId } = await seedUser(env);
    const bucket = Math.floor(Math.floor(Date.now() / 1000) / READ_RATE_WINDOW);
    await env.RATE_LIMITS.put(`rl:viewer:${userId}:${bucket}`, String(READ_RATE_LIMIT), {
      expirationTtl: READ_RATE_WINDOW + 60,
    });
    const res = await asViewer(userId, '/api/me');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate limited' });
  });

  it('counts a read endpoint once even though two routers match /api/*', async () => {
    // /api/summary is served by readApiRoutes but apiRoutes also has /api/* middleware.
    // Pre-seed the bucket to limit-1; a single request must tip it to the limit, not over.
    const { userId } = await seedUser(env);
    const bucket = Math.floor(Math.floor(Date.now() / 1000) / READ_RATE_WINDOW);
    const key = `rl:viewer:${userId}:${bucket}`;
    await env.RATE_LIMITS.put(key, String(READ_RATE_LIMIT - 1), { expirationTtl: READ_RATE_WINDOW + 60 });
    expect((await asViewer(userId, '/api/summary')).status).toBe(200);
    expect(Number(await env.RATE_LIMITS.get(key))).toBe(READ_RATE_LIMIT); // +1, not +2
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test test/read-ratelimit.test.ts`
Expected: FAIL (cannot import `../src/viewer_ratelimit`).

- [ ] **Step 3: Add `rlChecked` to the Hono Variables**

In `worker/src/env.ts`, change the `Variables` line to:

```ts
export type AppBindings = {
  Bindings: Env;
  Variables: { device: DeviceContext; viewer: ViewerContext; rlChecked?: boolean };
};
```

- [ ] **Step 4: Create the middleware**

Create `worker/src/viewer_ratelimit.ts`:

```ts
import { createMiddleware } from 'hono/factory';
import type { AppBindings } from './env';
import { rateLimit } from './ratelimit';

export const READ_RATE_LIMIT = 300;
export const READ_RATE_WINDOW = 60;

// Per-user rate limit for authenticated read APIs. Runs after requireUser so the
// key is the verified user. Both /api/* sub-routers (apiRoutes + readApiRoutes)
// match read endpoints, so guard with a request-scoped flag to count each
// request exactly once.
export const viewerRateLimit = createMiddleware<AppBindings>(async (c, next) => {
  if (c.get('rlChecked')) return next();
  c.set('rlChecked', true);
  const { userId } = c.var.viewer;
  const rl = await rateLimit(c.env.RATE_LIMITS, `viewer:${userId}`, READ_RATE_LIMIT, READ_RATE_WINDOW);
  if (!rl.ok) return c.json({ error: 'rate limited' }, 429);
  return next();
});
```

- [ ] **Step 5: Register the middleware in both routers**

In `worker/src/api.ts`, add the import:

```ts
import { viewerRateLimit } from './viewer_ratelimit';
```

and add a line right after the existing `apiRoutes.use('/api/*', requireUser);`:

```ts
apiRoutes.use('/api/*', viewerRateLimit);
```

In `worker/src/read_api.ts`, add the import:

```ts
import { viewerRateLimit } from './viewer_ratelimit';
```

and add a line right after the existing `readApiRoutes.use('/api/*', requireUser);`:

```ts
readApiRoutes.use('/api/*', viewerRateLimit);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter worker test test/read-ratelimit.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 7: Run the full worker suite (existing tests stay green)**

Run: `pnpm --filter worker test`
Expected: all pass. (Existing API/read tests issue only a handful of requests per fresh user, well under 300.)

- [ ] **Step 8: Commit**

```bash
git add worker/src/viewer_ratelimit.ts worker/src/env.ts worker/src/api.ts worker/src/read_api.ts worker/test/read-ratelimit.test.ts
git commit -m "feat(worker): rate-limit authenticated read APIs per user"
```

---

### Task 3: Device rename endpoint (Worker)

**Files:**
- Modify: `worker/src/api.ts` (extract shared label schema; add `PATCH /api/devices/:id`)
- Test: `worker/test/api.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `requireUser` viewer context; D1 `devices` table.
- Produces: `PATCH /api/devices/:id` accepting `{ label: string }` → `200 { ok: true }`, `400 { error: 'invalid label' }`, `404 { error: 'not found' }`.

- [ ] **Step 1: Write the failing tests**

In `worker/test/api.test.ts`, append this describe block at the end of the file (the file already defines `asViewer` and `beforeAll(installJwks)`):

```ts
describe('PATCH /api/devices/:id (rename)', () => {
  async function mint(userId: string, label: string): Promise<string> {
    const res = await asViewer(userId, '/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    return ((await res.json()) as { id: string }).id;
  }

  it('renames a device the viewer owns', async () => {
    const { userId } = await seedUser(env);
    const id = await mint(userId, 'old-name');
    const res = await asViewer(userId, `/api/devices/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'new-name' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = await env.DB.prepare('SELECT label FROM devices WHERE id = ?').bind(id).first<{ label: string }>();
    expect(row?.label).toBe('new-name');
  });

  it('404s renaming a device the viewer does not own', async () => {
    const { userId } = await seedUser(env);
    const id = await mint(userId, 'mine');
    const { userId: other } = await seedUser(env);
    const res = await asViewer(other, `/api/devices/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'hijack' }),
    });
    expect(res.status).toBe(404);
  });

  it('404s an unknown device id', async () => {
    const { userId } = await seedUser(env);
    const res = await asViewer(userId, '/api/devices/dev_does_not_exist', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'whatever' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects an empty label', async () => {
    const { userId } = await seedUser(env);
    const id = await mint(userId, 'real');
    const res = await asViewer(userId, `/api/devices/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: '' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter worker test test/api.test.ts`
Expected: the four new cases FAIL (PATCH currently falls through to the asset handler / 404 for the owned case).

- [ ] **Step 3: Add the route + shared schema**

In `worker/src/api.ts`, replace the existing line:

```ts
const NewDeviceSchema = v.object({ label: v.pipe(v.string(), v.minLength(1), v.maxLength(100)) });
```

with:

```ts
const LabelSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(100));
const NewDeviceSchema = v.object({ label: LabelSchema });
const RenameDeviceSchema = v.object({ label: LabelSchema });
```

Then add this route immediately after the existing `apiRoutes.delete('/api/devices/:id', ...)` handler:

```ts
apiRoutes.patch('/api/devices/:id', async (c) => {
  const { userId } = c.var.viewer;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(RenameDeviceSchema, body);
  if (!parsed.success) return c.json({ error: 'invalid label' }, 400);
  const result = await c.env.DB.prepare(
    'UPDATE devices SET label = ? WHERE id = ? AND user_id = ?',
  )
    .bind(parsed.output.label, id, userId)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter worker test test/api.test.ts`
Expected: PASS (all device tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add worker/src/api.ts worker/test/api.test.ts
git commit -m "feat(worker): add PATCH /api/devices/:id to rename a device"
```

---

### Task 4: Rename client + inline-edit UI (Dashboard)

**Files:**
- Modify: `dashboard/src/lib/api.ts` (add `renameDevice`)
- Modify: `dashboard/src/lib/__tests__/api.test.ts` (add a case)
- Modify: `dashboard/src/components/SettingsDevices.tsx` (inline-edit the Device column)
- Modify: `dashboard/src/components/__tests__/settingsdevices.test.tsx` (add a case)

**Interfaces:**
- Consumes: `PATCH /api/devices/:id` from Task 3.
- Produces: `renameDevice(id: string, label: string): Promise<{ ok: true }>`.

- [ ] **Step 1: Write the failing client test**

In `dashboard/src/lib/__tests__/api.test.ts`, add `renameDevice` to the import on line 2, then add this case inside the `describe('api client', ...)` block:

```ts
  it('renameDevice PATCHes the new label by id', async () => {
    const f = mockFetch({ ok: true });
    vi.stubGlobal('fetch', f);
    await renameDevice('dev1', 'new-name');
    expect(f).toHaveBeenCalledWith(
      '/api/devices/dev1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ label: 'new-name' }) }),
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter dashboard test src/lib/__tests__/api.test.ts`
Expected: FAIL (`renameDevice` is not exported).

- [ ] **Step 3: Add the client function**

In `dashboard/src/lib/api.ts`, add after `deleteDevice`:

```ts
export async function renameDevice(id: string, label: string): Promise<{ ok: true }> {
  return json(await fetch(`/api/devices/${id}`, { ...base, method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ label }) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter dashboard test src/lib/__tests__/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing component test**

In `dashboard/src/components/__tests__/settingsdevices.test.tsx`, add this case inside the `describe('SettingsDevices', ...)` block:

```ts
  it('renames a device inline', async () => {
    const f = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/devices/d1' && init?.method === 'PATCH') return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify(me), { status: 200 }));
    });
    vi.stubGlobal('fetch', f);
    render(<SettingsDevices />);
    await waitFor(() => expect(screen.getByText('laptop')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /edit device name/i }));
    const input = await screen.findByLabelText('device name input');
    await userEvent.clear(input);
    await userEvent.type(input, 'workstation{Enter}');
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/devices/d1', expect.objectContaining({ method: 'PATCH' })));
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter dashboard test src/components/__tests__/settingsdevices.test.tsx`
Expected: FAIL (no editable button; column is plain text).

- [ ] **Step 7: Make the Device column inline-editable**

In `dashboard/src/components/SettingsDevices.tsx`:

(a) Add `renameDevice` to the existing `@/lib/api` import:

```ts
import { getMe, patchMe, createDevice, deleteDevice, logout, createEnrollLink, renameDevice } from '@/lib/api';
```

(b) Replace the `<Table ... />` element with this version (adds `submitEdit` and an `editConfig` on the `label` column; the `actions` column is unchanged):

```tsx
              <Table variant="embedded" items={devices} trackBy="id"
                submitEdit={async (item: DeviceInfo, _column, newValue) => {
                  const label = String(newValue).trim();
                  if (label) await renameDevice(item.id, label);
                  refresh();
                }}
                empty={<Box textAlign="center" color="inherit">No devices</Box>}
                columnDefinitions={[
                  {
                    id: 'label',
                    header: 'Device',
                    cell: (d: DeviceInfo) => (d.revokedAt ? `${d.label} (revoked)` : d.label),
                    editConfig: {
                      ariaLabel: 'Edit device name',
                      editIconAriaLabel: 'editable',
                      editingCell: (d: DeviceInfo, ctx: { currentValue: string | undefined; setValue: (v: string) => void }) => (
                        <Input autoFocus ariaLabel="device name input" value={ctx.currentValue ?? d.label}
                          onChange={({ detail }) => ctx.setValue(detail.value)} />
                      ),
                    },
                  },
                  { id: 'actions', header: '', cell: (d: DeviceInfo) => (d.revokedAt ? '—' : <Button onClick={() => revoke(d.id)}>Revoke</Button>) },
                ]} />
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter dashboard test src/components/__tests__/settingsdevices.test.tsx`
Expected: PASS.

If the edit-trigger button is not found by `name: /edit device name/i`, run with the rendered DOM dumped (`screen.debug()` after the `getByText('laptop')` assertion) and update the selector to the actual accessible name Cloudscape produces for the editable cell; the `editConfig.ariaLabel` is the intended source. Submitting via `{Enter}` inside the edit input is the stable Cloudscape interaction — keep it.

- [ ] **Step 9: Type-check and run the full dashboard suite**

Run: `pnpm --filter dashboard check && pnpm --filter dashboard test`
Expected: no type errors; all tests pass.

- [ ] **Step 10: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/src/lib/__tests__/api.test.ts dashboard/src/components/SettingsDevices.tsx dashboard/src/components/__tests__/settingsdevices.test.tsx
git commit -m "feat(dashboard): rename devices inline from settings"
```

---

## Final verification

- [ ] Run both suites end-to-end:

Run: `pnpm --filter worker test && pnpm --filter dashboard test`
Expected: all green.

- [ ] Confirm the three deliverables manually map to commits: security headers (Task 1), read-API rate limit (Task 2), device rename worker (Task 3) + UI (Task 4).

---

## Notes / out of scope (do not implement here)

- Content-Security-Policy.
- IP-based limits for read APIs.
- Audit logging, retention/purge, read-query time-range clamping.
