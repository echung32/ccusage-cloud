# Personal workspace — video verification

These recordings exercise the real built dashboard in Chromium against a loopback-only **synthetic fixture API**. They do not prove production sign-in or a live Cloudflare deployment. Real Worker isolation and device behavior are covered separately by the Worker test suite. No real account data or usable secrets are shown.

Every video shows the experiment, numbered steps, typed input and actions in an on-screen log. All browser assertions passed; no uncaught browser errors.

## Experiment 1: Overview and date/source filters

[Watch/download video (01-overview-filters.mp4)](01-overview-filters.mp4) · [Screenshot](01-overview-filters.png)

1. Inspect headline metrics and both daily trend charts.
2. Select Source → cursor. Verify the URL and filtered metrics.
3. Press Clear. Type From = 2026-10-03 and To = 2026-10-05.
4. Press Clear, then click View chart data to inspect accessible daily values.
5. PASS — all assertions in this experiment succeeded.

## Experiment 2: Sources, models, devices, and project search

[Watch/download video (02-breakdowns-projects.mp4)](02-breakdowns-projects.mp4) · [Screenshot](02-breakdowns-projects.png)

1. Click Sources & Models in navigation; inspect cost bars and both tables.
2. Click Devices; compare machine contributions.
3. Click Projects. Click Tokens to sort numerically.
4. Click Find projects and type design-system. Verify only that project remains.
5. Press Control/Meta+A then Backspace to clear project search.
6. PASS — all assertions in this experiment succeeded.

## Experiment 3: Session pagination, search, and legacy group URLs

[Watch/download video (03-sessions.mp4)](03-sessions.mp4) · [Screenshot](03-sessions.png)

1. Click Sessions. Inspect the first 12 loaded sessions.
2. Click Load more. Verify that all 24 sessions remain distinct.
3. Type cursor in Find sessions; verify 8 matching rows.
4. Clear search. Click Cost twice to switch ascending then descending order.
5. Open /projects?scope=group. Verify personal projects still load and no Group switch exists.
6. PASS — all assertions in this experiment succeeded.

## Experiment 4: Device creation, rename, enrollment, and revoke

[Watch/download video (04-device-management.mp4)](04-device-management.mp4) · [Screenshot](04-device-management.png)

1. Click Settings. Verify the private-account message and no sharing controls.
2. Type Review laptop into New device, then click Add device.
3. Click Dismiss token. Click Rename beside Review laptop.
4. Replace the device name with Review workstation and press Enter.
5. Click Generate enroll command. Inspect macOS/Linux and PowerShell commands.
6. Click Dismiss commands. Click Revoke beside Review workstation and accept confirmation.
7. PASS — all assertions in this experiment succeeded.

## Experiment 5: Request failure, retry, empty data, and login

[Watch/download video (05-failure-empty-states.mp4)](05-failure-empty-states.mp4) · [Screenshot](05-failure-empty-states.png)

1. Simulate a summary API 500, then reload Overview.
2. Restore the API and click Try again. Verify metrics recover.
3. Set From to 2027-01-01; inspect the empty chart guidance.
4. Simulate an unauthorized account and open /login?returned=1.
5. PASS — all assertions in this experiment succeeded.

## Experiment 6: Mobile navigation and layout (390px)

[Watch/download video (06-mobile.mp4)](06-mobile.mp4) · [Screenshot](06-mobile.png)

1. Inspect mobile Overview. Verify the document fits the viewport.
2. Tap Sources & Models, then scroll to the model breakdown.
3. Tap Settings and scroll to device enrollment. Confirm there is no page overflow.
4. PASS — all assertions in this experiment succeeded.
