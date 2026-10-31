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

## Amendment A3 (root review of 8a21544) — single-flight with freshness barrier; exact files

### Freshness rule
`refresh()` is also called AFTER mutations. A caller that JOINS a read started BEFORE its write (or before a deep link arrived) cannot use that read as proof: an old workspace without the id proves nothing about the state after the write/navigation.

- The coordinator keeps a monotone **checkpoint** counter. A **barrier** (post-write refresh, deep-link arrival for an absent id, explicit user retry) takes `need = ++checkpoint`. Every read records `startedAt = checkpoint value when the request was sent` and its `contextKey` (identity generation + role + active org + site).
- A caller waiting with barrier `need` and context `C` is satisfied only by a read with `startedAt ≥ need` AND `contextKey === C`.
- **At most one read in flight + at most ONE trailing read**, coalesced: if the current flight started before `need` (or for another context), one trailing read is scheduled to start right after the current flight settles; any number of later barriers/contexts join that same trailing read (it takes the latest checkpoint and the CURRENT context when it starts). Never two concurrent `/api/workspace` calls, never an unbounded queue.
- Callers without a barrier (focus scheduler, realtime debounce, manual « Actualiser » that does not need proof) may join the current flight.
- A result whose `contextKey` differs from the waiter's current context ⇒ `superseded` for that waiter: it consumes no attempt, yields no « introuvable », and the waiter progresses to the trailing read for its new context (no livelock waiting on a superseded flight).
- A trailing read failing ⇒ `failed` (error state + explicit bounded retry), never `not_found`.

### Deferred-promise tests (required)
1. read A started; a mutation (or a deep link for a new id) arrives during A; A resolves with the OLD workspace ⇒ waiter not satisfied; exactly ONE trailing read B launched; B returns the new data ⇒ `show`.
2. focus + realtime + deep link at the same checkpoint ⇒ exactly ONE read.
3. context changes during A ⇒ A's data never applied to the new context's waiter (`superseded`); B for the new context ⇒ correct decision.
4. B fails (503 / transport) ⇒ `failed` with retry, never `not_found`.
5. many barriers during A ⇒ still one trailing read (coalesced), no third concurrent call.
6. identity change ⇒ waiters resolved `superseded`, per-id memory reset.

### Exact files (lead ownership; no worker; no prototype worker)
- NEW `components/app/workspace-refresh.ts` — pure coordinator (checkpoint, single flight + one trailing, context keys, outcomes `loaded|superseded|failed|signed_out`), no React.
- NEW `components/app/detail-resolution.ts` — pure decision `show|refresh|loading|not_found|error` + bounded LRU per-id attempt memory keyed by context.
- NEW `components/role/use-detail-presence.ts` — thin hook used by the three detail views (calls the session method, renders states).
- EDIT `components/courant-app.tsx` — wire the coordinator under the existing `refresh()` (signature unchanged), post-mutation refreshes take a barrier, expose `session.ensureFresh(...)`/outcome; keep `seq`/401/identity behaviour.
- EDIT `components/app/session-types.ts` — the new Session method type.
- EDIT `components/role/client-space.tsx` (DetailView + badge « Connecté »/« Actualiser »), `components/role/artisan-space.tsx` (mission detail), `components/role/enterprise-space.tsx` (DossierView) — use the hook before rendering « introuvable »; badge string in any other shell where « En direct » appears.
- NEW tests `tests/ui/workspace-refresh.test.ts` (scenarios 1–6) and `tests/ui/detail-resolution.test.ts` (decision branches, LRU bound, context reset).
No API, backend, SQL, dependency or tracking-leaf change.

## Amendment A4 (root GO for A3, corrections f383a90) — causal freshness for ALL triggers

- `Session.refresh()` keeps its signature (no argument) but **takes a freshness barrier BY DEFAULT**: post-write refreshes, manual « Actualiser », realtime events and focus/visibility revalidation are all causes that a read started BEFORE them cannot satisfy (an event committed during read A is not « handled » by A's older snapshot).
- Only passive reads (render-time and the first bootstrap) may join the current flight without a barrier.
- Causes registered before the API call actually starts are batched into that call (the start is deferred to a microtask so same-tick causes share one checkpoint); a cause arriving after the call started ⇒ ONE pending trailing read (coalesced); never two concurrent requests, never an unbounded queue.
- Tests add: read A returns old data, then a post-write / realtime event / manual need registered during A ⇒ trailing B returns new data; an old context is never applied; B failure ⇒ error, never not_found.
- No Realtime code change, no RLS/migration here; LIVE-WORKSPACE-001 effectiveness stays OPEN; badge « Connecté » + « Actualiser » permitted (A2).
- Files and ownership exactly as A3 (lead only; prototype worker 003 isolated).

## Amendment A5 (root peer review of e37e2a9: P2 + P3) — before the fix

**P2 — a workspace reply is validated BEFORE it is applied.** Today `readWorkspace` merges the reply into `EMPTY_WORKSPACE`: a `200 { profile }` without collections is applied as empty lists ⇒ `loaded` ⇒ false « introuvable »; a `200 {}` is treated as `signed_out` and clears the session. Required:
- Canonical shape of `GET /api/workspace` (from `app/api/workspace/route.ts`, the runtime contract): `profile` object with string `id` and a known `role`; arrays `interventions`, `quotes`, `sites`, `organizations`, `messages`, `documents`, `reviews`, `payments`, `organization_members`, `appointments`; `artisan_profile` object or `null`. Essential records: every intervention has string `id` and `status`; every quote string `id` and `intervention_id`; every site / organization / message string `id`. Optional fields are NOT validated (absent optional fields are legitimate); `appointments_limit` / `appointments_limited` optional.
- Outcomes: valid ⇒ applied ⇒ `loaded`. Invalid 2xx (`{}`, profile only, invalid profile, invalid collection or record, non-JSON — already a 502 from `parseApiBody`) ⇒ `failed` with reason `invalid_response`: **nothing applied, no sign-out, never « introuvable »**, the existing error banner. Only a real **401** or a **foreign identity** (profile id ≠ the loaded user) handles the session (`clearSessionState`, public mode). **403** / 5xx / transport ⇒ `failed`, session kept.
- The reader moves to a NEW testable module `components/app/workspace-reader.ts` (`validateWorkspace` + `createWorkspaceReader({ api, ... setters })`) that the shell actually calls; `courant-app.tsx` keeps only the wiring.
- Real-reader tests (`tests/ui/workspace-reader.test.ts`) with an injected `api` and observed setters: 200 valid ⇒ setData + loaded; 200 `{}` ⇒ failed, no setData, no clearSessionState; profile only ⇒ failed; invalid JSON (502) ⇒ failed; invalid profile ⇒ failed; invalid collection / record ⇒ failed; 401 ⇒ signed_out + clearSessionState; 403 ⇒ failed, no clear; 503 and transport (0) ⇒ failed; foreign identity ⇒ signed_out + clear; superseded sequence ⇒ superseded, nothing applied. Plus coordinator + real reader together: a deep link after a 200 `{ profile }` reply ⇒ `failed`, never `loaded`.

**P3 — « Actualiser » visible.** Under `SUBSCRIBED` the badge button showed only « Connecté » (« Actualiser » was only the `title`). The visible label becomes « Connexion temps réel : Connecté · Actualiser » (or « … : non connectée · Actualiser »), « Actualiser » rendered as visible text in every state.

Files added to A3's list: `components/app/workspace-reader.ts`, `tests/ui/workspace-reader.test.ts`. Owner: lead only. No merge before root's counter-review.
