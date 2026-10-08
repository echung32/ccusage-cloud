# ccusage-cloud Deployment Runbook

This runbook is **owner-run** and touches the live Cloudflare account + DNS.
Each step is intentionally manual — no CI pipeline executes these commands.
Run them in order the first time you deploy to `ethanchung.dev`.

> **Note on resource IDs:** `worker/wrangler.jsonc` contains the configured D1
> and KV resource IDs. Reuse existing resources for subsequent deployments;
> only create new resources and replace their IDs when provisioning a new environment.

---

## Prerequisites

- `wrangler` authenticated: `wrangler login`
- `pnpm` installed (matches the version in `package.json`)
- DNS for `ethanchung.dev` managed via Cloudflare (zone must exist in your account)
- The shared auth gateway at `https://auth.ethanchung.dev` is operational and
  permits the intended users and dashboard redirect URL. Viewer login uses this
  gateway, not email magic links. The Worker verification configuration is in
  `worker/src/auth_config.ts` (JWKS URL, issuer, and `fleet` audience).

---

## Step 1 — Create the D1 database

```sh
wrangler d1 create ccusage-cloud
```

Copy the `database_id` from the output and update the ID in
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

## Step 2 — Create the rate-limit KV namespace

Run the command and paste the returned `id` into `worker/wrangler.jsonc`:

```sh
wrangler kv namespace create RATE_LIMITS
```

Update `kv_namespaces`:

```jsonc
"kv_namespaces": [
  { "binding": "RATE_LIMITS", "id": "<rate-limits-real-id>" }
]
```

---

## Step 3 — Build the dashboard

```sh
pnpm --filter ccusage-cloud build:bundle   # emits dashboard/public/cli.js
pnpm --filter dashboard build
```

This produces `dashboard/dist`, which the `assets` binding in `wrangler.jsonc`
serves as the static frontend. `build:bundle` first emits
`dashboard/public/cli.js`, which `astro build` folds into `dashboard/dist` so the
Worker also serves it at `/cli.js`; if you build the dashboard without running
`build:bundle` first, `/cli.js` won't be served. (The actual deploy happens in
Step 6.)

---

## Step 4 — Apply D1 migrations

```sh
wrangler d1 migrations apply ccusage-cloud --remote
```

This runs all SQL files under `worker/migrations/` against the production
database in the order they are numbered.

---

## Step 5 — Enable the custom domain

Add a `routes` entry in `worker/wrangler.jsonc` and set your desired pattern:

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

## Step 6 — Deploy

```sh
wrangler deploy
```

This bundles `worker/src/index.ts`, uploads the built `dashboard/dist` assets,
and publishes the Worker to the custom domain configured in Step 5.

---

## Step 7 — End-to-end verification

1. **Sign in and mint a device token** — open `https://ccusage.ethanchung.dev`
   (or your chosen domain), sign in through the auth gateway, then go to
   Settings → create a new device token. Copy the token value.
   The Worker automatically provisions the user record on first authenticated
   access; no local email allowlist or email-sending setup is required.

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
- [ ] An unauthenticated dashboard visit redirects to `auth.ethanchung.dev`;
  after signing in as an authorized user, the dashboard loads successfully.
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

No need to re-run resource provisioning (Steps 1–2) unless you are provisioning
a new Cloudflare account or replacing a resource. Apply Step 4 whenever new
migrations are added; repeat Step 5 only when changing the custom domain.
