# Personal usage workspace

## Intent
Replace the enterprise Cloudscape interface with a cohesive, lightweight personal AI usage dashboard. Remove group mode end-to-end. Preserve existing personal analytics, URL filters, session pagination, authentication, device rename/revoke/create and enrollment commands. User delegates design and explicitly requests no approval pauses.

## Approach
Use native HTML and focused React components rather than adopting another large component library. Alternative: a headless component suite (more dependencies); alternative: cosmetic Cloudscape overrides (does not satisfy removal). Keep Astro routes and React islands.

## Visual design
Warm off-white canvas, white panels, deep forest sidebar, green accent, restrained amber highlights. Compact section labels, large tabular metrics, readable tables, generous space. Responsive sidebar becomes a wrapping navigation bar on small screens. Visible keyboard focus, semantic headings, labeled controls, reduced-motion support.

## Architecture
AppShell owns navigation; UI primitives own panels, empty/loading/error states and sortable tables; Charts owns accessible SVG trend charts and cost breakdown bars. Shared analytics hook owns cancel-safe fetching and filters. Pages compose these units. Settings manages mutations with pending/error feedback and secret display. Login retains gateway behavior but surfaces non-auth failures rather than spinning indefinitely.

## Group removal
Remove scope and publicToGroup from frontend contracts, sharing controls and PATCH /api/me. Remove cross-user aggregation functions. Summary always queries the authenticated viewer, including requests with legacy scope=group. Retain the historical database column and migrations for deployment compatibility; it becomes unused by runtime code. Historical design documents remain historical.

## Verification
Test personal isolation for legacy group URLs, removed sharing route, navigation, filters, sortable/searchable tables, analytics states and device mutations. Run dashboard and worker suites, CLI regression suite, TypeScript and production build via mise exec pnpm@10. No deployment. A later explicit user request authorizes committing and pushing a feature branch to create a PR with recorded verification.
