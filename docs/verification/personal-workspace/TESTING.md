# Verification log

All package commands use `mise exec pnpm@10 -- pnpm`.

## Automated experiments

1. **Remove cross-account group access:** updated API assertions first. Observed four failures: sharing still returned 200/400 instead of 404, profile still exposed `publicToGroup`, and legacy group summary returned another account's tokens. Removed sharing route, profile field and group aggregation. Added explicit unknown-API 404 fallback after observing an ASSETS fallback 500. Worker suite passed **85/85**.
2. **Replace workspace controls:** native navigation/filter assertions failed against the old interface. Implemented personal navigation, native selects/date controls, sortable tables and SVG charts. Foundation tests passed.
3. **Analytics behavior:** error-state and immediate session-search assertions failed against the old pages. Implemented explicit loading/error/empty states, retry, client-side search, sorting, pagination, and stale-request guards. Verified a late response cannot replace newer source-filter results.
4. **Device management:** sharing-removal and failed-create feedback assertions failed first. Implemented pending/error feedback, label preservation, rename, revoke confirmation, one-time token display and enrollment commands. Settings tests passed.
5. **Type checking:** fixed the new table test's inferred key type and pinned dashboard Vite 5 to align the existing Vitest/plugin types. Dashboard and Worker `tsc --noEmit` passed.
6. **Login-to-overview integration:** initially failed because chart data tables legitimately repeat headline values. Updated assertions to handle those duplicated values. Separate integration test passed **1/1**. This uses mocked network responses, not a live gateway login.
7. **Full regression:** `pnpm -r test` passed: dashboard **50**, Worker **85**, CLI **54** = **189 tests**. CLI coverage includes real local Worker/D1 ingestion.
8. **Production build:** `pnpm --filter dashboard build` passed, generating all **8 routes**. `git diff --check` passed.

## Real browser experiments

`pnpm --filter dashboard verify:video` ran the built app in Chromium against the separate localhost synthetic fixture API. All **6 experiments** passed, with **zero uncaught browser errors**. During the first recording attempt, exact source-label selection exposed an ambiguous native select label; explicit Source/Device accessible labels fixed it. The complete recording run then passed.

See [the video index and exact numbered action logs](README.md). Recordings contain on-screen experiment names and step descriptions, actual typed input, UI transitions, and final assertion status. Each experiment is a separate H.264 MP4.

## Local servers

- <http://127.0.0.1:4321> — actual Astro production preview (requires normal backend/auth to use real account data).
- <http://127.0.0.1:4322/overview> — populated review workspace, synthetic fixture API, loopback-only.

The demo server is a verification utility, not a production auth bypass. No production deployment, real-account walkthrough, or external-model API spend was performed. Final code review was a separate self-review; no independent reviewer tool was available.
