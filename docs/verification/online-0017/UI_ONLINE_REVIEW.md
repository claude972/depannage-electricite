# Independent combined UI + PWA online review

Mission WEB-PWA-20261030. Reviewer: Codex verify_web_pwa. Read-only repository; tooling and evidence under task temp directory.

## Exact target and access

- Integration SHA: 0017b48a7a12d918d5c3c759f8da94d1971df727.
- Unique preview: https://depannage-electricite-1ng8kugh5-brafas-projects.vercel.app .
- Vercel deployment dpl_CFEeBHDk3z8vRaDHkjGX573vMWCA, metadata readyState READY, githubCommitSha exact match, githubCommitRef integration/web-pwa.
- Playwright1.64.1, isolated headless Chrome156.0.8078.4. Existing authorized Vercel credential used ONCE to bootstrap same-origin cookie, then browser headers cleared. No credential values or HAR captured; no deployment-protection change.
- Frontend login P0 UI-REV001 known to pilot and assigned Claude: not claimed closed by demo testing.

## Functional UI result

**41/41 checks PASS**, zero page errors, zero console errors, zero application API or Supabase requests across all four demo journeys. Public startup and all four demo startups clean.

| Scope | Actual browser actions/checks |
| --- | --- |
| Public | Main and title loaded HTTP200; screenshots/scrollWidth checks at360/1280 |
| Client demo | Overview360/1280; actual nav to requests, messages, profile; mobile bottom nav; no API traffic |
| Artisan demo | Overview360/1280; actual nav missions, quotes, profile, application; mobile drawer open/Escape close/focus restoration; no API traffic |
| Enterprise client demo | Overview360/1280; actual nav sites/contracts, approvals, members, reports; mobile drawer open/Escape close/focus restoration; no API traffic |
| Super Admin demo | Overview360/1280; actual nav artisans, interventions, quotes/finance, clients, reviews, messages, settings; mobile drawer open/Escape close/focus restoration; no API traffic |

Every measured page had document scrollWidth ≤ viewport width+1. Sidebar CSS resize transitions were allowed to settle before screenshots. Demo example data stayed local; no live account/user/request/payment created by these demo journeys. These are navigation/rendering/role-shell checks, not proof of all form mutations or full76-capability completion.

Evidence: 0017b48a7a12/ui/result.json and UI screenshots in same folder. First attempt had four harness errors caused by exact accessible-name selectors overlooking appended badge labels and dynamic menu aria-label; fixed runner and rerun yielded41/41. Original attempt retained as selector-diagnostics.json; those are not application findings.

## PWA regression

**13/13 browser checks PASS**, zero page errors, on exact same unique preview/SHA. Served manifest/icons and dimensions; static offline exact URL/publicmarker/no-store; real activated root-scope worker; CDP installability no errors; unauthenticated API401/private/no-store; only courant-pwa-public-v2/offline.html in CacheStorage; offline API/auth not replayed; private-looking navigation gets generic public fallback; online recovery200; public360/1440 overflow checks.

Evidence: 0017b48a7a12/result.json and public-mobile360.png/public-desktop1440.png/offline-fallback.png. Positive Auth and Storage are a separate cloudQA result, not inferred from this smoke. No Stripe charge tested.

## Visual comparison and open finding

Sources opened alongside actual screenshots: M35 (volume3 p4), M43 (volume3 p12), M66 (volume4 p19), rendered files /tmp/courant-audit/v3-4.png, v3-12.png and v4-19.png.

- M43: left navigation, four KPI and candidature/current-intervention columns are recognizably carried over; actual available data and honest unavailable states replace invented financial metrics. Not pixel identity and not complete Super Admin operations.
- M66: enterprise navy header, sidebar, active organization/site, filters and operational table are recognizable;360reflows into vertical cards without document overflow. New functional organization scope visible.
- M35: navy hero, mission rows, performance, blue CTA and five bottom tabs recognizable; **VIS-001 remains open**: excessive explanatory copy and vertical performance stacking at360 spread overview to roughly1610px, unlike compact reference/two-column performance. components/role/artisan-space.tsx:869 and934 plus artisan-360.png show technical provenance phrasing and no-history explanation occupying large space. Pilot acknowledged and sent compact-rows/performance + expandable detail correction to Claude. Preserve truthful amounts/missing hours; do not invent trends to match mockup examples.

No claim of full visual fidelity until VIS-001 corrected and rechecked. Screenshot fixed bottom nav across long full-page captures is normal fixed-position capture behavior; it does not imply nav is inserted mid-document.

## Limits and next checks

- UI-REV001 live login P0 and separately assigned UI-REV002 permissions/cache finding remain outside this checkpoint's closure.
- Demo navigation proves no network calls, not real cross-account authorization or stale-response behavior; coordinate actual browser Auth with pilot/cloudQA.
- Dedicated Supabase is now configured according to pilot; previous provider-blockage statement is historical. This verifier has not yet run positive live Auth/Storage in this phase.
- Stripe absent; no paid/live or payout claim. Many unavailable business capabilities remain explicit and are not marked complete by shell/navigation tests.
- Actual OS/mobile PWA install and real two-deployment multi-tab lifecycle remain unverified. CDP installability is not installation.
- No repository application file changed or committed by verifier.
