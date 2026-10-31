# Cross-review VISUAL-FIDELITY-001 — e7aaef7

Reviewed exact `e7aaef7bddb8559a8442ecd918c3f6d160b8520c`, claude/web-pwa-design. Internal checkout HEAD matched this revision and was clean before/after tests. No source/test edits, deployment or cloud mutation. Application coding remains Claude-owned.

## Actionable findings — assign Claude

### VIS-REV-001 — P2 false absence of alerts
`components/role/enterprise-space.tsx:1965–1978,2028–2034` calculates site alerts from loaded approvals/compliance, then displays unconditional “Aucune” for zero results. A site's row exists even while professional metadata is unknown/unavailable or its lists are bounded. Empty loaded arrays do not establish no alert.

Fix: render unavailable/notverified when relevant professional data is not available; otherwise qualify absence/counts as among loaded data unless complete coverage is guaranteed. Preserve actual approval/compliance status, do not infer statutory safety/SLA conformity. Test or manually exercise professional loading/failure, successful empty data and genuine pending/overdue records. This was already noted before implementation and remains unresolved at this SHA.

### VIS-REV-002 — P2 hidden stale site filter after changing global context
`useInterventionList`806–827 retains local filters.site across org/site context changes. ContextBar785 updates global activeSite; `InterventionFiltersCard`868 hides the local site selector whenever a global site is active. No hook reset invalidates the prior local site filter.

Sequence to reproduce in Claude's existing UI: global All sites → choose SiteA in local filtercard → choose SiteB in global contextbar. scope.interventions now containsB, while filterInterventions still demandsA. Table falsely empties and export disables; offending filter is hidden. Similar stale local id can persist after switching organizations.

Fix: reset/invalidate local site filter and pagination on the relevant global org/site context transition, or derive an effective site predicate that never intersects incompatible contexts. Keep permission scope unchanged. Verify returning to All sites and switching organization, as well as export/list agreement. Existing pure filter tests do not test this hook/context interaction. No server authorization bypass alleged.

### VIS-REV-003 — P2 budget percentage hides actual overrun
`siteFigures`236 clamps ratio to100. New site table uses that same value for aria percentage2014 and visible2018. A committed150/budget100 therefore renders100%, albeit red/with “budget dépassé” in aria. The amount column remains correct, but the quantitative percentage is false. Underlying helper pre-existed; this is an existing issue in a newly emphasized display, not claimed a new backend regression.

Fix: separate raw committed/budget percentage from the visual progress width; clamp only width to100, show/announce150% for this example. Budgetmissing must remain explicitly unspecified, as current2021 does. Verify under80,80+,100,over100 andzero/missingbudget without inventing money or an automated SLA alert.

### VIS-REV-004 — P2 mobile target-size guarantee removed
`enterprise.module.css:1876–1879` sets rowOpen min-height0 under760px, overriding the44px default674+. The second dossier action is hidden at1873–1874, leaving the site/name control as the only opening action. A short name plus one-line address can produce a target below44px, contrary to DESIGN.md and the contract. Current long demo labels do not prove short data safe.

Fix: retain at least44px interaction area for rowOpen on mobile while keeping dense layout; check short and multiline labels. This is source-level missing guarantee, not a measured failure in the worker's current demo screenshots.

## Verified bounded source behavior

- Enterprise role/site authority remains wired to canCreateRequest, canWriteSite and canWriteOrganization. Site requests2041 and creation2128 use these guards. Unknown scope still flows to existing failclosed helper, canonical owner exception preserved. No new frontend authority widening found in the reviewed diff.
- New local filtering operates on authorized scope.interventions only. Export uses the same filtered rows (all local result pages, not just the visible page). CSV escaping/formula guard remains inherited. Export/list should agree once hidden-filter issue is fixed.
- Counts use generic “N interventions”, including completed states, rather than false “in progress” heading. Footer still declares100-loaded-record scope. Numbered pagination is local within that scope, not full server pagination; no contrary global count claim found.
- Date sort explicitly says creation, with actual created_at date/time. No artisan names, site-active status, preventive/curative categories, GPS/SLA metrics invented.
- Read-only support/profile access is not hidden by new organization write guards. Dossier opening remains read navigation, site opening is distinct in SitesView.

## Fidelity / responsive observations

All four committed before/after boards inspected, alongside actual M4/M13/M66 reference images already examined. Clear concrete progress: M13 cardgrid replaced by dense sites table + recent interventions; M4 separate filter card and header export; M66 icon/name/address rows; royalblue header, slimmer scopebar and sidebarhelp; mobile no longer stacks every column as label/value.

This verifies improvement in composition, not global fidelity. Known declared deviations remain: missing artisan name data, no period filter, no site status model, singlelinebrand; M13 content intentionally uses shared M4/M66 shell. Do not fabricate those fields just to copy reference pixels.

Remaining checks: real keyboard/focus/menu behavior, short/long labels, empty/error/loading, viewer/scopedreadonly/owner, intermediate760–1024 widths and page overflow. The desktop table uses overflowhidden panel; intermediate widths have not been measured here, so clipping is a verification question rather than an asserted defect. No live or Vercel layout verification performed.

## Actual execution

`npm run test:ui` executed on clean exacte7aaef7: **49/49PASS**, exit0, including6 new enterprise-list tests. Those verify pure combined filtering/sort, nonmutation, isFiltered, pagewindow, alert counting and budgettones; they do not cover hook context changes or rendered targetdimensions/unavailable-alert wording.

No redundant full build. Worker's stated93 backendtests/build success remains its report, not independently rerun here. No new test scripts authored by Codex.

Verdict: **changes required** for four bounded findings before accepting this visual checkpoint. No broad aesthetics/security/cloud completion claim, and no additional V2/V3 gate introduced.
