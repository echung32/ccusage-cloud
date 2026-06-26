# Vendored: auth-verify

This is a **vendored copy** of the `auth-verify` package from the public repo
[`echung32/auth-gateway`](https://github.com/echung32/auth-gateway), subdirectory
`packages/auth-verify`.

- **Source commit:** `9985dde2bdf761e549bfa5e4a052040812031901` (master).
- **Why vendored:** there is no standalone `echung32/auth-verify` repo and the
  package is not published to a registry, so it cannot be `pnpm add`-ed directly.
  The integration doc's `pnpm add github:echung32/auth-verify#v1` spec does not
  resolve. Vendoring keeps the worker buildable without git/registry auth.
- **Contents:** `src/index.ts` is the verbatim upstream source at that commit.
  `dist/index.js` + `dist/index.d.ts` are the committed ESM build output (upstream
  builds with `tsup src/index.ts --format esm --dts`).
- **Deviation from upstream:** upstream declares `jose` as a `peerDependency`
  (it expects the publishing consumer to provide it). Here the package is consumed
  as a workspace dependency and bundled by wrangler/esbuild, which resolves
  `import "jose"` relative to `dist/index.js` — so `jose` is also declared as a
  direct `dependency` of this package, ensuring it is installed in
  `packages/auth-verify/node_modules` and the worker's `wrangler deploy` build can
  resolve it. Without this, the build fails with `Could not resolve "jose"`.

## Updating

To refresh against upstream:

1. Fetch the latest source:
   `gh api repos/echung32/auth-gateway/contents/packages/auth-verify/src/index.ts --jq '.content' | base64 -d > src/index.ts`
2. Rebuild the dist (matches upstream's tsup config):
   `pnpm dlx tsup src/index.ts --format esm --dts --out-dir dist`
3. Update the source commit SHA in this file and in `dist/index.js`'s header.

If/when upstream publishes `auth-verify` to a registry or a standalone repo,
replace this vendored package with a real dependency in `worker/package.json`.
