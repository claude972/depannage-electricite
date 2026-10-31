# WEB-DEEPLINK-REFRESH-001 — contract before code (lead, shells)

Status: contract only. No code before root reads this document.

## Evidence (root run, targeted T6 diagnostic)

- Run directory `/tmp/depannage-tracking-1225-4c-t6-diagnostic` (root-private; not in Git). Diagnostic `diagnostics/T6/client.json` + PNG at 21:01:44.387 UTC, captured under the same identity, with no relogin, reload or navigation.
- URL `#detail/<job>` correct; `blockers: []`; client tracking card absent; only heading « Intervention introuvable »; the page's only API request was the preflight `404` on a random UUID at 20:58:51. **No `GET /api/interventions/<job>/tracking` at all.**
- Conclusion: the client's workspace was loaded at login, BEFORE the seed created the dossier. `#detail/<id>` is resolved only against that cached workspace (`DetailView`: `rows.find(id)`), and the workspace revalidates only on `focus` / `visibilitychange` (scheduler, ≥ 15 s). With no such event, the view states « Ce dossier n’existe pas dans votre espace ou son lien n’est plus valide » although it exists and is visible to that client. The tracking capability was never involved: the lead's earlier « unknown capability » hypothesis is **refuted**.

## Attribution

- **App defect (P2, lead shells).** A real user hits it when opening a deep link (notification, e-mail, shared link, another tab) to a dossier created, assigned or shared after the tab loaded its workspace: a false « introuvable » until a focus change or reload. The harness reproduced it faithfully by opening the client session before the seed; that order is a legitimate scenario and stays.
- Same pattern exists in the artisan space (`Dossier introuvable`, `#mission/<id>`) and the enterprise space (`Dossier introuvable sur ce périmètre`, `#detail/<id>`). Admin views read by id from the server and are out of scope unless the same cache pattern is found.
- The historic T6 FAIL (run 4e8bc1a68a89) stays recorded. T6's assertion is NOT weakened.

## Required behaviour

1. When a detail view (client `detail`, artisan `mission`, enterprise `detail`) receives an id that is absent from the cached workspace, in **live** mode, it triggers **one** workspace refresh (`session.refresh()`) for that id under the current identity, and shows a loading state « Recherche du dossier… » meanwhile — not « introuvable ».
2. Bounded: at most one refresh per (identity generation, view, id). No loop, no timer, no retry storm. A refresh already in flight is reused, not duplicated.
3. After the refresh settles: if the id is now present ⇒ normal view (tracking card, quote, etc. as usual); if still absent ⇒ the existing « introuvable » empty state, unchanged wording; if the refresh failed (network/5xx) ⇒ the existing error/unavailable handling with a retry button, never « introuvable » (absence is not proven).
4. Identity safety: a refresh result landing after an identity change is ignored (existing guard); the per-id memory is reset on identity change.
5. Demo mode: unchanged (no refresh; demo data only).
6. No new API, no backend change, no new dependency; uses the existing `refresh()`.

## Tests (planned, offline)

- Pure decision function (e.g. `detailResolution({ present, live, attempted, refreshing, refreshFailed })` ⇒ `show | refresh | loading | not_found | error`) unit-tested for every branch, including « attempted once and still absent ⇒ not_found » and « refresh failed ⇒ error, not not_found ».
- Bound test: the same id rendered repeatedly triggers exactly one refresh; a new id triggers one more; an identity change resets.
- Existing UI test suites stay green; `tsc --noEmit --incremental false` clean.

## Out of scope

- Changing the revalidation scheduler, realtime subscriptions, or the T6 harness order.
- Any tracking leaf change (the card renders correctly once the dossier is present — T19 with a fresh client PASSED).

## Amendment A1 (root review of cd2b8d3) — required before code

Source fact: `refresh()` (`components/courant-app.tsx` ~220) is `Promise<void>`; a non-401 failure is swallowed into the shell error banner, a superseded call (`seq`) returns silently, a 401 resets the session. A caller therefore CANNOT infer « loaded and still absent » from a resolved `void`. Consequences below.

1. **Explicit outcome, never `not_found` after a failure.** Add a controller method (e.g. `refreshWorkspace(): Promise<RefreshOutcome>`) returning
   `{ kind: "loaded", generation, contextKey, at }` | `{ kind: "superseded" }` | `{ kind: "failed", status }` (503/5xx/0 transport/invalid body) | `{ kind: "signed_out" }`.
   The existing `refresh()` keeps its signature and behaviour (wraps the new method). The detail view shows « introuvable » ONLY after a `loaded` outcome for the CURRENT generation and context in which the id is still absent within the visible perimeter. `failed` ⇒ bounded error state with an explicit retry; `superseded` ⇒ wait for the current flight; `signed_out` ⇒ existing session handling.
2. **Keyed by identity AND active context.** The per-id memory (attempted / in-flight) is keyed by (identity generation, role, active organisation, active site, view, id). It is reset on identity change, on active org/site change and on access revocation (`validateContext` dropping the context). A result whose generation or context key differs from the current one is ignored (never applied, never counted as an attempt).
3. **True single-flight + bounded memory.** One workspace refresh in flight at a time for the whole shell: concurrent callers (deep link, realtime debounce, focus scheduler, manual « Actualiser ») share the SAME promise (a ref holding the in-flight promise, cleared in `finally`) — never two `/api/workspace` calls because a view re-rendered. The per-id attempt memory is a bounded Map (e.g. 32 entries, LRU eviction) so arbitrary ids cannot grow it without limit.
4. **Presence = visible perimeter of the role, same as `DetailView`.** « Present » uses exactly the list the view renders from (client: own interventions; artisan: missions in its workspace; enterprise: dossiers of the active organisation/site perimeter). The refresh never widens rights and never reads a dossier outside that perimeter; an id present in the workspace but outside the active perimeter stays « introuvable sur ce périmètre » (existing enterprise wording).
5. **Tests beyond the pure decision function:**
   - controller-level integration with injected `api` and deferred promises: concurrency (deep link + realtime + focus at once ⇒ exactly one `/api/workspace` call), 503 ⇒ `failed` (never not_found), transport 0 ⇒ `failed`, 401 ⇒ `signed_out`, superseded call ⇒ no decision from it;
   - identity/context change during the flight ⇒ result ignored and memory reset;
   - per-id bound: re-renders of the same id ⇒ one refresh; Map bounded with eviction;
   - explicit retry after `failed` is user-triggered, bounded (one call per click, disabled while in flight), no automatic storm or timer.
   If no React renderer is available, the hook's logic lives in a pure/controller module that the views actually call, tested through the same sequences.

## Amendment A2 — honest live badge (root authorised, no owner question)

- While Realtime effectiveness is not proven, the client badge reads **« Connecté »** when the channel status is `SUBSCRIBED` (instead of « En direct »), and the manual **« Actualiser »** action stays visible in every state. No other status claim. Applies to every shell that shows the badge (client today; check artisan/enterprise/admin for the same string).
- No SQL, no migration, no RLS change from the lead for LIVE-WORKSPACE-001 without a confirmed cause.

Code only after root's GO on this amendment. Owner of the code: lead (shells/session/shared); no worker.
