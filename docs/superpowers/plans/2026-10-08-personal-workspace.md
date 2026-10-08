# Personal Workspace Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans; no subagent tool is available. Track completion here.

**Goal:** Replace Cloudscape and remove group mode while preserving personal workflows.
**Architecture:** Native React UI primitives, shared analytics fetching, accessible SVG charts, existing Astro routes and viewer-scoped Worker queries.
**Tech Stack:** Astro 5, React 19, TypeScript, Vitest, pnpm via mise.
**Spec:** docs/superpowers/specs/2026-10-08-personal-workspace-design.md

## Global Constraints
- No approval pauses; user delegated design.
- Use mise exec pnpm@10 -- pnpm for package commands.
- Keep historical migrations compatible; never expose other users' data.
- No deployment or publishing. User subsequently requested a PR, authorizing a feature-branch commit and push.

## Review Focus
- Legacy scope=group must never expose another user's data.
- Empty, loading and failed requests must be distinguishable.
- Fast filter changes must not display stale responses.
- Zero-valued and single-day charts must stay finite and readable.
- Device mutation failures must preserve input and display errors.

## Tasks
- [x] 1. Personal-only API. Update worker/test/read-api-scope.test.ts and api.test.ts expectations first; run failing tests. Remove group queries and sharing handler in worker/src/{queries,read_api,api}.ts. Update dashboard types/API/filter contracts and tests. Verify worker suite.
- [x] 2. Workspace foundation. Test AppShell navigation and filter behavior before replacing dashboard/src/components/{AppShell,FilterBar}.tsx. Add dashboard/src/styles/global.css and focused UI/chart primitives, removing Cloudscape stylesheet. Verify component tests.
- [x] 3. Analytics. Replace Overview, BySourceModel, ByDevice, ByProject and SessionsTable with shared fetching and native sortable/searchable tables. Update tests first for removed group gates, loading/errors, dates and pagination. Verify dashboard suite.
- [x] 4. Settings and login. Test no sharing control and preserved device workflows. Replace SettingsDevices and LoginGate with native UI, pending and failure states. Remove Cloudscape dependencies. Verify tests and build.
- [x] 5. Final verification and self-review. Run all workspace tests, dashboard build and TypeScript checks; inspect diff for group runtime references and accessibility risks. Update README with private-only behavior.

## Execution ledger
- Design self-review: no placeholders; existing routes preserved; historical schema retained intentionally.
- Ruling: execute on a new local branch in the provided checkout, not a separate worktree, so user sees changes at the requested path. No commits or external side effects.
- Ruling: use in-file checklist as ledger; no subagent tools, so final review is self-review.
- Task 1: complete. Four updated assertions failed before implementation; Worker suite now 85/85. Unknown API routes needed an explicit JSON 404 rather than asset fallback (removed sharing route originally reached ASSETS and produced 500).
- Task 2: complete. Foundation assertions failed against Cloudscape; native navigation, filters, table sorting/search and single-day chart tests pass.
- Task 3: complete. Error-state/search assertions failed first; analytics and session tests pass. Cancellation guards ignore obsolete responses.
- Task 4: complete. Sharing-removal and mutation-failure tests failed first; settings tests pass. Cloudscape dependencies and configuration removed. Explicit dashboard Vite 5 dev dependency resolves the existing Vitest/plugin Vite type mismatch.
- Task 5: complete. Dashboard 50/50, Worker 85/85, CLI 54/54; separate login-overview integration test 1/1; dashboard and Worker TypeScript checks pass; eight-route production build passes. Six recorded Chromium experiments pass with zero uncaught browser errors.
- Ruling: browser videos use a loopback-only synthetic fixture server, not production auth or Cloudflare. This keeps recordings deterministic and avoids exposing user data; production login remains an unverified boundary.
- Ruling: user requested a PR after the initial plan, so commit/push/PR are now authorized. Do not merge or deploy.
- Final review: self-review (no subagent tool). Reviewed private API behavior, obsolete sharing runtime references, error/pending states, stale filter responses, table keys, chart edge cases and desktop/mobile screenshots. No critical or important outstanding findings. Historical schema retained; no destructive migration.
- Final: minor (deferred): external gateway sign-in and production deployment are not exercised in local synthetic videos; explicitly disclosed in evidence and PR.
