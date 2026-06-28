# ccusage-cloud Deployment Runbook

This runbook is **owner-run** and touches the live Cloudflare account + DNS.
Each step is intentionally manual — no CI pipeline executes these commands.
Run them in order the first time you deploy to `ethanchung.dev`.

> **Note on placeholders in `wrangler.jsonc`:** The file intentionally contains
> `*-local-placeholder` values for the D1 and KV resource IDs. Real IDs are never
> committed. After each `wrangler` command below you will paste the real ID
> back into `wrangler.jsonc` locally.

---

## Prerequisites

- `wrangler` authenticated: `wrangler login`
- `pnpm` installed (matches the version in `package.json`)
- DNS for `ethanchung.dev` managed via Cloudflare (zone must exist in your account)

---

## Step 1 — Create the D1 database

```sh
wrangler d1 create ccusage-cloud
```

Copy the `database_id` from the output and replace `"local-dev-placeholder"` in
`worker/wrangler.jsonc` under `d1_databases`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "ccusage-cloud",
    "database_id": "<paste-real-id-here>",
    "migrations_dir": "migrations"
  }
]
```

---

## Step 2 — Create KV namespaces

Run each command separately and paste the returned `id` into `worker/wrangler.jsonc`:

```sh
wrangler kv namespace create LOGIN_TOKENS
wrangler kv namespace create VIEWER_SESSIONS
wrangler kv namespace create RATE_LIMITS
```

Replace the three `*-local-placeholder` values in `kv_namespaces`:

```jsonc
"kv_namespaces": [
  { "binding": "LOGIN_TOKENS",    "id": "<login-tokens-real-id>" },
  { "binding": "VIEWER_SESSIONS", "id": "<viewer-sessions-real-id>" },
  { "binding": "RATE_LIMITS",     "id": "<rate-limits-real-id>" }
]
```

---

## Step 3 — Build the dashboard

```sh
pnpm --filter ccusage-cloud build:bundle   # emits dashboard/public/cli.js
pnpm --filter dashboard build
wrangler deploy
```

`build:bundle` emits `dashboard/public/cli.js`, which `astro build` then bundles
into `dashboard/dist` so the Worker serves it at `/cli.js`. If you build the
dashboard without first running `build:bundle`, `/cli.js` won't be served.

---

## Step 4 — Apply D1 migrations

```sh
wrangler d1 migrations apply ccusage-cloud --remote
```

This runs all SQL files under `worker/migrations/` against the production
database in the order they are numbered.

---

## Step 5 — Seed the allow-list

Insert each email address that should be allowed to sign in. Repeat for every
invited user:

```sh
wrangler d1 execute ccusage-cloud --remote --command \
  "INSERT INTO allowed_emails (email, added_at) VALUES ('you@example.com', unixepoch()*1000)"
```

- `added_at` is stored as a millisecond-epoch INTEGER (matches the schema in
  `worker/migrations/0001_init.sql`).
- Run the command once per email address; substituting `you@example.com` each
  time.

---

## Step 6 — Configure email sending

Enable email sending for the domain:

```sh
wrangler email sending enable ethanchung.dev
```

After running this command, Cloudflare will display the DNS records you must add
to the `ethanchung.dev` zone. Add all three record types:

**SPF** — authorizes Cloudflare to send on behalf of your domain:

```
Type: TXT
Name: @  (or ethanchung.dev)
Value: v=spf1 include:_spf.mx.cloudflare.net ~all
```

**DKIM** — cryptographic sender signature. Cloudflare generates the key pair;
copy the TXT record name and value from the `wrangler email sending enable`
output and add it to DNS.

**DMARC** — policy for unauthenticated mail (start with `p=none` while
monitoring, tighten to `p=quarantine` or `p=reject` once delivery is confirmed):

```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=none; rua=mailto:dmarc@ethanchung.dev
```

The sender used by the Worker is `noreply@ethanchung.dev`. Verify the `send_email`
binding in `worker/wrangler.jsonc` is present (`"name": "EMAIL"`) — it already
is by default.

> Allow 15–30 minutes for DNS propagation before testing email delivery.

---

## Step 7 — Enable the custom domain

Uncomment the `routes` template in `worker/wrangler.jsonc` (see the comment
block immediately after the `assets` section) and set your desired pattern:

```jsonc
"routes": [{ "pattern": "ccusage.ethanchung.dev", "custom_domain": true }],
```

Or to serve from the apex domain:

```jsonc
"routes": [{ "pattern": "ethanchung.dev", "custom_domain": true }],
```

`workers_dev` and `preview_urls` remain `false` — do not change them.

The Cloudflare zone for `ethanchung.dev` must already exist in your account.
Cloudflare will automatically provision an SSL certificate for the custom domain
on first deploy.

---

## Step 8 — Deploy

```sh
wrangler deploy
```

This bundles `worker/src/index.ts`, uploads the built `dashboard/dist` assets,
and publishes the Worker to the custom domain configured in Step 7.

---

## Step 9 — End-to-end verification

1. **Mint a device token** — open `https://ccusage.ethanchung.dev` (or your
   chosen domain) → Settings → create a new device token. Copy the token value.

2. **Log in from a device:**

   ```sh
   ccusage-cloud login --server https://ccusage.ethanchung.dev --token <token>
   ```

3. **Run a sync:**

   ```sh
   ccusage-cloud sync
   ```

4. **Check the verification checklist below.**

---

## Verification Checklist

- [ ] Health endpoint returns `{"ok":true}`:
  ```sh
  curl https://ccusage.ethanchung.dev/health
  ```
- [ ] Login email arrives in the inbox for an allowed email address (magic-link
  flow) within a few minutes of requesting it.
- [ ] After `ccusage-cloud sync`, the dashboard at
  `https://ccusage.ethanchung.dev` shows at least one session row.

---

## Re-deploying / updating

For subsequent deploys (code changes only, resources already provisioned):

```sh
pnpm --filter ccusage-cloud build:bundle   # emits dashboard/public/cli.js
pnpm --filter dashboard build
wrangler deploy
```

No need to re-run Steps 1–6 unless you are provisioning a new Cloudflare
account or replacing a resource.
