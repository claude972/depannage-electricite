# WEB-PWA-20261030 — Codex / PWA infrastructure

Status: local pilot/independent review passed; implementation checkpoint still awaits Claude cross-review, integration and online verification. Base: `3c1ca2ce978f354556c0c691d4ac0d3088308b36`. Branch: `codex/web-pwa-backend`. No production deployment or service configuration performed by this scoped agent.

## Delivered scope

- `app/manifest.ts`: French standalone manifest, stable app ID/root scope, PNG 192/512 and dedicated maskable icon. Existing provisional Courant name preserved.
- `public/icons/`: code-drawn lightning icon on navy; actual PNG dimensions 192, 512, 512 maskable and 180 Apple touch icon. No external/fabricated commercial imagery.
- `public/sw.js`: only the generic public offline HTML is stored in CacheStorage. Navigations use network with `cache: no-store`, never write network pages to cache, and receive the generic notice when offline. APIs, auth paths, data/RSC requests, mutations and external origins are not intercepted. No request queue, background sync, push subscription, offline account or offline write claim.
- `public/offline.html`: self-contained French network-failure notice, no account data, retry link and explanation that interrupted work must be checked on return.
- `components/pwa-registration.tsx`: browser registration, network status, explicit update/reload with save-before-reload copy, registration retry; listeners cleaned up. No automatic reload of an in-progress form.
- `PwaInstallControl` exported from the same file: optional placement by the frontend owner in profile/help/navigation; native browser install prompt when offered, Safari/iOS steps, fallback browser menu instructions, installed-state suppression. No install prompt asserted when the browser has not offered it.
- `app/layout.tsx`: manifest, Apple/icon metadata, registration mounted without changing frontend role views or global CSS; existing language/skiplink preserved.
- `next.config.ts`: no-cache worker with proper type/scope; isolated offline page CSP; private/no-store API/auth headers and prior security headers retained.

## UI integration contract

```tsx
import { PwaInstallControl } from "@/components/pwa-registration";
// Render inside a suitable profile/help/nav section.
<PwaInstallControl />
```

The root registration is already installed by layout. The control contains no account/session props, no storage of personal data and no mutation API. The frontend must continue resetting its own in-memory account state on logout/identity changes; the worker does not replace those permissions. No personal response is eligible for this worker’s CacheStorage.

## References read

AGENTS.md, DESIGN.md, CLAUDE.md, BLUEPRINT/DECISIONS and current plan; remote `missions/web-pwa` MISSIONS.md/CORRECTIONS.md fetched/read before the scoped assignment claim. Next.js official [PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps), manifest/registration patterns, reviewed against pinned Next 16.4.3. Existing CSS stack and package versions preserved, no new dependency.

## Checks performed

- `npx tsx --test tests/pwa.test.ts`: **14/14 passed** after protected-preview response validation and installation-lifecycle regression cases were added.
- `npm run typecheck`: passed at this checkpoint.
- Tests execute the actual worker source inside a VM with CacheStorage/network/event harness. They verify: declared icon PNG dimensions; offline-only same-origin static-asset install with marker/URL/redirect validation; private online navigation not cached; public offline fallback after private navigation; API/auth/RSC/mutation/external bypass; empty-cache generic 503; obsolete own-cache deletion only; user-initiated update; install failure rejection; explicit reload after another tab already activated or superseded the worker.
- This is complementary local verification, not proof of browser installation, worker lifecycle or offline behavior on Vercel. Full build reserved for backend/pilot to avoid `.next` races in shared checkout.

## Review correction

PWA-001: independent review identified that a waiting worker reference could become stale after another tab accepted its update, leaving a later update click waiting forever. The update handler now reloads directly on the user click if the referenced worker is no longer installed/waiting (or is already controller); only an installed waiting worker receives ACTIVATE_UPDATE. No background tab automatically reloads a form. The regression test simulates installed → activated/redundant and checks reload versus message effects. Typecheck and the nine initial tests passed after that correction; the later PWA-002 suite retains this regression and has fourteen passing cases.

## Still required before marking ready/done

1. Pilot and independent local review passed, including PWA-001 recheck; commit/push intended PWA paths only.
2. Combined `npm run check` and Vercel Preview. Check manifest MIME/HTML metadata, service worker cache headers, PNG routes and offline page CSP.
3. Browser online install prompt or documented browser-menu install; standalone launch; iOS add-to-home-screen on a supported device if available. Device/platform limitations recorded explicitly.
4. Browser DevTools offline navigation after loading an account shows only the public notice, CacheStorage contains only `/offline.html`, API/auth not served from worker/cache, no private snapshot after logout/change of account. Frontend identity-cache test remains separate.
5. Deploy worker revision on preview and verify pending-update copy/reload preserves user choice and does not silently reload unsaved work.
6. Claude cross-review at exact pushed revision plus pilot integration review. PWA installability does not mean push, offline editing or background sync delivered.

## PWA-002 — protected-preview installation and failed worker lifecycle

Browser QA observed a service worker registration without a usable offline cache: the offline asset request failed during installation, and the worker became redundant after register() had resolved without a visible registration error. Initial diagnostics included an automation configuration sending a cookie-setting protection header on every request. That combination with credentials omitted caused redirect loops; it is not evidence that automation headers cannot propagate to workers. QA is rechecking the ordinary authorized-cookie path with that cookie-setting header removed after bootstrap.

The real-code fix supports the authorized same-origin cookie path and refuses to cache any authentication response:

- Install fetch of `/offline.html` uses `credentials: "same-origin"`, `redirect: "error"`, cache reload. No bypass secret/token/header is embedded in application code, source or public assets.
- Response must be successful, nonredirected, HTML, with exact same-origin `/offline.html` URL and no query, plus `X-Courant-Public-Offline: 1`. The marker is set only for the static offline file by next.config.ts. An SSO/login/wrong-origin/unmarked response fails installation before opening the cache.
- Worker cache advances to `courant-pwa-public-v2`; only the validated static public notice is stored. Runtime user pages/API/auth/RSC/mutations remain uncached.
- Registration observes both current worker state and later state changes. An installing worker becoming redundant before reaching installed now displays the retryable installation error. A previously installed worker later becoming obsolete is not misreported as an initial installation failure. Very fast failure before observer attachment is handled.
- New behavioral cases execute the actual worker against redirects, wrong origins/paths/query URLs, missing/wrong marker, unsuccessful and non-HTML responses. EventTarget-based lifecycle tests exercise failure after registration resolution, fast redundant state, listener cleanup and successful install becoming obsolete. Existing multi-tab explicit-update regression retained.

Fresh local result: `npx tsx --test tests/pwa.test.ts` **14/14 pass**; `npm run typecheck` pass. Online installation/offline fallback and exact deployed headers must be rechecked on the patched preview before this finding becomes verified. No deployment protection was disabled and no secret is in this patch.
