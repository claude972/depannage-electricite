# Independent online PWA review — patched checkpoint

Mission WEB-PWA-20261030. Reviewer: Codex verification agent verify_web_pwa.

- Exact integration revision: b0fa1df5476550c32f3eaefc8477fdbb150d0913.
- PWA correction revision: 6aaa1b36b99e64de4e0544780c8234c508cc1fd5.
- Verified preview: https://depannage-electricite-hloqx4c89-brafas-projects.vercel.app .
- Browser: isolated cached headless Chrome156.0.8078.4, Playwright1.64.1 installed only in task temp directory.
- Access: existing authorized Vercel automation credential used once to set same-origin bypass cookie. All automation headers then cleared for browser/worker requests, matching ordinary authorized-cookie access. External browser requests blocked; no HAR, token/header/cookie values in reports or screenshots. Protection unchanged; no CDP worker-header injection.

## Result

13 browser/network checks passed; zero failures; zero page errors. Evidence: b0fa1df54765/result.json. Runner: preview-smoke.mjs.

1. Real application document HTTP200 on exact preview origin, main present.
2. Mobile360 viewport, scrollWidth360, screenshot captured.
3. Served manifest standalone/root scope/start URL; decoded local regular192/512 and maskable512 PNGs match dimensions.
4. Static offline response HTTP200, exact same-origin URL, no redirect, explicit public marker1 and no-store.
5. Worker really activated at root scope; served sw.js is JavaScript with no-cache/no-store/must-revalidate.
6. Chromium CDP reports no manifest/installability errors.
7. Unauthenticated workspace503 because service unavailable, with private/no-store; never a simulated success.
8. CacheStorage after API attempts contains ONLY courant-pwa-public-v2 → /offline.html.
9. Desktop1440 viewport, scrollWidth1440, screenshot captured.
10. Offline API fetch rejects, no replay.
11. Offline private-looking navigation shows ONLY generic public notice, no fields/query data; CacheStorage still only public offline notice.
12. Auth navigation offline fails instead of replaying a private/auth page.
13. Online recovery returns real app HTTP200.

Screenshots were visually opened: public-mobile360.png, public-desktop1440.png, offline-fallback.png. Offline notice is legible and contains only generic reconnect guidance. Mobile public page has no registration-error banner or horizontal overflow. This checkpoint still uses the old frontend; no claim of new artisan/enterprise/SuperAdmin fidelity.

## Findings and fixes

PWA-001 multi-tab update stale worker: independently reviewed cf52 code fix and targeted behavioral regression. Explicit click reloads when referenced worker already activated/redundant; no unsolicited form reload. Status verified within code/test scope; actual two-tab browser lifecycle remains separate.

PWA-002 protected-preview initial worker install and missing lifecycle failure status: reproduced on 1638e765a44347d71b32968180e8e6781a7a7da7 with ordinary authorized cookie and no automation headers. Worker omitted cookie, failed install; no controller/cache and no notice after register resolved. Fix6aaa adds same-origin credentials for one known static endpoint with redirect:error + exactURL + marker validation, cachev2, and redundant-state error handling. Independent14/14 behavioral tests passed on exact matching source. Patched preview now activates and offline public fallback works on cookie-only browser path: VERIFIED for this integration scope. No actionable unresolved finding in reviewed PWA paths.

## Explicit limitations

- CDP installability is NOT an actual OS/iOS/Android home-screen installation; device installation and standalone launch remain unverified.
- Private Supabase integration is still blocked; no real login/logout/change-account/RLS/Storage or Stripe payment verified here. API503 is an honest blocker, not a completion proof.
- No actual worker deployment replacement/two-tab browser lifecycle yet; behavioral regression covers PWA-001 but does not replace that test.
- Frontend/backend business modules outside PWA are not declared clean or complete by this review. Mandatory Claude↔Codex cross-review remains the pilot workflow.
- No application file edited or committed by this verifier; all tooling/proofs in /tmp/depannage-web-pwa-qa.
