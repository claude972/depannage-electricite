# WEB-DEEPLINK-QA-001 — QA validation of the deep-link defence (contract before code)

Status: **contract only**. No code before the ROOT GO, and none before A10 of the tracking harness (`claude/web-qa-tracking`) is settled. Base: integration 7b05d3f, which contains 28b9b79 (defence 47423b7, CI 41245014262 SUCCESS).

Product contracts read:
- `docs/CLAUDE_DEEPLINK_REFRESH_CONTRACT.md` (A1–A6);
- `docs/CLAUDE_LIVE_WORKSPACE_001.md`;
- the source of `components/role/use-detail-presence.ts`, `components/app/workspace-refresh.ts`, `components/app/workspace-reader.ts`, and the detail views in `client-space.tsx` (~910–935), `artisan-space.tsx` (~1173–1192) and `enterprise-space.tsx` (~1456–1491);
- the badge in `client-space.tsx` (~385).

Executed by ROOT only. I run nothing against the cloud and read no credentials. No product, backend, SQL or migration change, and no cloud agent.

## 1. Ownership (exclusive, NEW files only)

| Owned (new) | Use |
| --- | --- |
| `scripts/qa-deeplink/**` (`run.mjs`, `scenarios.mjs`, `lib/*.mjs`) | harness |
| `tests/qa-deeplink*.test.ts` | offline tests (pure, plus real local Chromium) |
| `docs/CLAUDE_DEEPLINK_QA_CONTRACT.md` | this contract and its amendments |

**Read-only imports, never modified or copied:**
- `scripts/qa/lib/*`: lifecycle and stop gate, `Fixtures` (lazy durable manifest 5fa7f82), cleanup, report, redact, browser (`newPage`, `login`, `goHash`, `openHash`, `waitForWorkspace`, `expectVisible`), config;
- `scripts/qa/lib/deployment-proof.mjs` (REMOTE provenance);
- `scripts/qa-business/lib/preflight.mjs` (`servedBuildIdentity`, strict LOCAL check);
- from `scripts/qa-tracking/lib/`: `intents.mjs`, `durable.mjs`, `auth-admin.mjs` (legacy-only Auth 404), `ownership.mjs`, `guard.mjs` (`act`, `gatedWait`, mutation barrier), `finalize.mjs`, `diagnostics.mjs` (`captureDiagnostics`), `preflight.mjs` (`checkBuildProvenance`).

The tracking harness is not changed by this lot. If an import turns out to be too tracking-specific, its generalisation is proposed as a tracking amendment, never edited from here.

## 2. Common rules

- **Build provenance**: same rules and CLI flags as tracking A7.
  - `--mode remote|local`.
  - REMOTE takes the ROOT receipt plus the Flight build id through `checkBuildProvenance`.
  - LOCAL uses the strict parser.
  - Any refusal ⇒ BLOCKED before any fixture, intent or write; exit 2.
- **Identity and document**:
  - Each session belongs to one QA user, with no relogin and no `reload` inside a measurement.
  - Before each measured navigation, the harness sets a random in-page marker `window.__qaDocMarker` (QA-only, no app effect). It must be unchanged afterwards (same document).
  - Hash navigation uses `goHash` (`location.hash`), never `goto` or `reload`.
  - Sign-in is checked by `waitForWorkspace(page, user.id)` only OUTSIDE the counting windows, because that helper itself calls `/api/workspace`.
  - Sign-out is detected passively. Any of these ⇒ FAIL:
    - a `POST /auth/v1/logout` request;
    - a `token?grant_type=password` request inside a window;
    - the public screen (login form) appearing.
- **Passive network observer** (`scripts/qa-deeplink/lib/observe.mjs`, same rules as tracking A8 §1/§8):
  - It watches `GET /api/workspace`, `/api/interventions/<id>/**`, `/auth/v1/*` (path only) and the Realtime WebSocket (`/realtime/v1/websocket`, open/close/frame COUNT only).
  - It records method, path without query, status, ISO time, and the source (UI, or harness tagged `x-qa-harness`).
  - It never records headers, tokens or bodies, and never issues a request.
  - One exception, to look for a leak (§D3): a canary search in the page's own `/api/workspace` responses. The result is boolean; the body is never stored.
- **Badge**: the visible text « Connexion temps réel : Connecté · Actualiser » or « … : non connectée · Actualiser ». « Actualiser » must be VISIBLE text, not only a `title`.
- **Diagnostics**: `captureDiagnostics` (tracking A8, closed `reason` set, gate re-checked), on the scenario's pages at the first failure, with this harness's observer.
  - Caps: ≤ 3 pages, 5 s per operation, 20 s in total.
  - Files in `--out/diagnostics/<scenario>/`, 0700/0600.
- **Outputs**: `--out` outside Git; folders 0700, files 0600; redactor plus positions masked; no secret, token or body in the logs.

## 3. Fixtures and precondition per scenario

The seed uses the service key (shared `Fixtures` plus durable intents), with run-unique e-mails and the run's canonical domain.

| Item | Purpose |
| --- | --- |
| `clientA` | sessions D1, D2, D4 |
| `clientB` | owner of a foreign dossier, D3 |
| `artisanA`, `artisanB` | D3b |
| one organisation with two sites S1/S2 and a `viewer` limited to S1 | D3c |
| dossiers | `jobLate1` (D1), `jobLate2` (D2) and `jobLate3` (D4) for clientA, all created AFTER clientA's session is open; `jobForeign` for clientB (description containing the canary `QA-DL-CANARY-<run_id>`); `jobB` assigned to artisanB; `jobS2` on site S2 |

| Scenario | Session opened | Dossier created |
| --- | --- | --- |
| D1, D2, D4 | clientA, BEFORE its dossiers (explicit LIVE-WORKSPACE-001 precondition, the legitimate case the defence covers) | `jobLateN` AFTER the session, by the service key; creation proven by readback (`count = 1`) BEFORE navigation |
| D3a/b/c | AFTER the full seed (normal T6 precondition, A9), so that the only cause of « introuvable » is the lack of rights | already present |

The preflight (authenticated 404 on an unknown UUID) runs in a dedicated context closed in `try/finally`, as in tracking A9.

## 4. Scenarios

### D1 — external creation after login, Realtime blocked: the fallback alone shows the dossier

1. Before clientA logs in, `context.routeWebSocket(/\/realtime\/v1\/websocket/, ws => ws.close())` is installed (Playwright ≥ 1.48; 1.64.1 is installed here). This isolates the defence from any Realtime event.
   - Proof that Realtime is blocked: the observer counts no Realtime frame received; the badge reads « non connectée · Actualiser ».
   - If the blocking cannot be installed or proven, D1 is BLOCKED, never PASS.
2. Seed `jobLate1` and read it back.
3. Install the in-page marker and a read-only in-page `MutationObserver` that records whether « Recherche du dossier… » and/or « Intervention introuvable » were EVER rendered. It never acts.
4. Open the counting window, then `goHash("detail/<jobLate1>")`.
5. Expected:
   - « Recherche du dossier… » observed, or at least the `/api/workspace` request started after the hash change and before the dossier appears;
   - then the dossier view (its heading or description, the tracking card « Suivi de l’artisan » if present), within ≤ 10 s. That is below the ≥ 15 s focus/visibility revalidation, and headless Chromium emits no focus change;
   - « Intervention introuvable » NEVER rendered;
   - marker unchanged; no sign-out or sign-in.
6. Count: exactly ONE UI-sourced `GET /api/workspace` in the window.

### D2 — 503, then malformed 200, then recovery on retry

1. BEFORE the clientA session opens (A3b): seed a NON-EMPTY witness `jobWitnessD2` (own dossier of clientA) and read it back. Then open the clientA session (another context, Realtime blocked as in D1) and seed `jobLate2` with its readback.
   - **Witness before the stub:** a real UI `GET /api/workspace` (bootstrap, drained) is observed with `jobWitnessD2` present (boolean id check on the page's own reply, body not kept), and the witness is VISIBLE in the requests list.
   - Without that proof ⇒ **BLOCKED** (an empty workspace proves nothing about « nothing cleared »).
2. Browser route stub on `GET /api/workspace` ONLY, for exactly the next two requests:
   - #1 ⇒ `503` `{error}`;
   - #2 ⇒ `200` `{profile:{id:clientA, role:"client"}}` with no collections (A5 « profile only »).
   The stub then calls `unroute`, and the third request goes to the real server. The stub fabricates responses and does not mutate anything.
3. `goHash("detail/<jobLate2>")` ⇒ refresh #1 (503) ⇒ error state:
   - title « Dossier momentanément indisponible », `data-blocker="deeplink:error"`, button « Réessayer »;
   - « Intervention introuvable » never rendered;
   - no sign-out (§2);
   - data not cleared: `jobWitnessD2` is still present after the 503 (list or DOM check; no extra request inside the window).
4. Click « Réessayer » ⇒ refresh #2 (malformed 200) ⇒ same error state. Nothing is applied: `jobWitnessD2` is still present after the invalid reply. No « introuvable », no sign-out. Witness missing after #1 or #2 ⇒ **FAIL** (data cleared); witness never proven before the stub ⇒ **BLOCKED**.
5. Click « Réessayer » ⇒ refresh #3 (real) ⇒ dossier shown, marker unchanged, same identity.
6. Count: exactly one `GET /api/workspace` per click and per cause (1 + 1 + 1). The button is disabled while in flight: a double click during the flight adds no request.
7. If the real reply #3 is itself 5xx or transport ⇒ environment unavailable ⇒ BLOCKED (not FAIL, not PASS).

### D3 — unauthorised id: « introuvable » after one refresh, no leak

1. Sessions opened after the seed.
2. Variants:
   - **D3a**: clientA, `goHash("detail/<jobForeign>")`.
   - **D3b**: artisanA, `goHash("mission/<jobB>")`.
   - **D3c**: viewer limited to S1, `goHash("detail/<jobS2>")` in the enterprise space.
3. Expected: one refresh, then the existing wording.
   - D3a: « Intervention introuvable » + « Ce dossier n’existe pas dans votre espace ou son lien n’est plus valide. ».
   - D3b: « Dossier introuvable ».
   - D3c: « Dossier introuvable sur ce périmètre ».
4. No leak, checked as booleans only:
   - the canary is absent from the visible DOM text and from the `data-*` and `aria-*` attributes;
   - the canary is absent from every `/api/workspace` response of the page, and every `GET /api/interventions/<foreign>/**` answers 404;
   - neither the foreign dossier id nor its status appears in the DOM, apart from the URL hash the harness set itself.
5. Count: one `GET /api/workspace` per variant; a second hash change to the same id in the same context adds 0.

### D4 — bounded: one read per cause, no storm, badge visible

1. clientA (Realtime blocked).
2. Counting windows:
   - (a) hash to an absent id (`jobLate3`, seeded after the session) ⇒ 1;
   - (b) back to the list and then to the same id, same context ⇒ 0 more;
   - (c) click « Actualiser » on the badge ⇒ exactly 1;
   - (d) 10 s quiet window with no action ⇒ 0.
3. In every state, the badge shows « Actualiser » as visible text.
4. Without Realtime blocking (one control session), the badge may read « Connecté » only when the channel is SUBSCRIBED. Realtime effectiveness is NOT asserted (§6).

## 5. Verdicts, intents, cleanup

| Verdict | Cases |
| --- | --- |
| **FAIL** (app defect) | « introuvable » rendered before the dossier (D1) or after a failure (D2); sign-out or data cleared after a 503 or a malformed 200 (D2); dossier not shown after the real refresh (D1 within 10 s, D2 #3); wrong wording, or a leak (canary, foreign field or id) (D3); more than one `/api/workspace` per cause, a request in the quiet window, a retry not disabled during its flight, or « Actualiser » not visible (D4); marker changed (reload) |
| **BLOCKED** | refused build provenance; seed refused or not read back; Realtime blocking not installed or not proven (D1, D2, D4); real 5xx, transport or provider unavailability where a real reply is expected; a session revoked by a global logout (no relogin) |
| **UNKNOWN** | a write whose outcome is unknown (seed or cleanup); its intent stays open ⇒ cleanup INCOMPLETE, exit 3; an Auth readback that is neither found nor the exact legacy 404 |
| **ANOMALY** | a harness timeout that cannot be attributed (diagnostics attached) |

- Intents: the tracking protocol unchanged. Durable atomic intents and manifest, lazy `init()`, readback before closing, and absence never closes an intent.
- Cleanup in foreign-key order: dossiers, then org members, scopes, sites and organisations, then profiles and Auth users.
- Ownership is proven by canonical e-mail plus run_id before any deletion, and deletion happens only after the drain.
- The route stubs and the Realtime blocking live in each page's context, which is closed at finalize; they leave no remote state.

## 6. What stays OPEN

- **LIVE-WORKSPACE-001: Realtime effectiveness.** D1, D2 and D4 block Realtime on purpose. A PASS proves only the fallback defence. Still UNKNOWN, owned by the lead and root: the socket role (anon or authenticated) and Realtime's RLS evaluation. A separate acceptance scenario (session open before creation, Realtime NOT blocked, dossier received without navigation) would come in a later amendment, after root's passive join metadata.
- **More than 100 dossiers (A6, DEEPLINK-TRUNCATION).** `/api/workspace` returns at most 100 interventions. Older dossiers are not covered here and their absence is not proven. Not tested; stays open.
- Admin views are out of scope, and so is demo mode (A1.5, unchanged).

## 7. CLI and tests (planned)

- `node scripts/qa-deeplink/run.mjs --mode remote|local --base-url … --sha … --build-id … --project … --credentials … --playwright … [REMOTE flags as tracking A7] [--only D1,D2,D3,D4] [--dry-run] [--out …]`
- Exit codes: 0 no FAIL; 1 FAIL or FATAL; 2 preflight refusal; 3 cleanup incomplete or unknown outcome; 130 interrupted.
- Offline tests (`tests/qa-deeplink*.test.ts`, no cloud):
  - pure: request counting per window, verdict mapping, the stub that answers exactly two requests and then lets requests through;
  - real local Chromium against a local server that reproduces the markup and behaviour of the views:
    - Realtime blocking proven (no frame);
    - 503 / malformed / real sequence ⇒ the expected states;
    - « introuvable » detected by the observer;
    - canary detected in the DOM and in a response (boolean, body not kept);
    - one request per cause and a quiet window;
    - marker unchanged on hash navigation and changed on `reload` (negative check).
- Then the usual checks: `tsc --noEmit`, all suites, `node --check`, `--dry-run`.

## Amendment A1 (first ROOT observation on 6fb13ad) — proof that the Realtime interception is EFFECTIVE

Zero frames plus a « non connectée » badge do not prove that the route blocks the socket: the app might never have opened one, or might have used another URL. For D1, D2 and D4 (and any scenario that claims « Realtime blocked »), the proof becomes:

1. **The handler is called.** `context.routeWebSocket(REALTIME_PATTERN, handler)` is installed before login. `REALTIME_PATTERN` matches the path `/realtime/v1/websocket` on the project's Supabase origin, whatever the query. The handler increments a call counter and records only scalars:
   - ISO time;
   - origin and path, WITHOUT the query (the query carries the `apikey` and `vsn` values, which are never recorded);
   - the close code and reason it applied: `ws.close({ code: 4000, reason: "qa-realtime-blocked" })`, a constant chosen by the harness.

   Never a message payload, token or header. The handler never calls `ws.connectToServer()`, so nothing reaches the server.
2. **Zero frames forwarded.** No `connectToServer` happens, so no frame is relayed to the server. The passive observer (`page.on("websocket")`) records zero `framesent` / `framereceived` events delivered by the server for that URL; the count only, never the content. No close code is ever asserted on the page side (A3b): the code 4000 is proven only by the native local client of the control test.
3. **Verdict.** All of these must hold in each scenario that claims « Realtime blocked »:
   - handler call count ≥ 1 for that page, before the measured hash navigation;
   - `await ws.close(...)` resolved by the handler (A3b: no page-side code);
   - zero frames forwarded;
   - badge « non connectée · Actualiser ».

   Otherwise ⇒ **BLOCKED** (« Realtime interception not proven: handler called N times »), never PASS. A handler that is never called is a BLOCKED, not a sign that Realtime is absent.
4. **Local control test in real Chromium** (`tests/qa-deeplink-realtime-route.test.ts`, offline):
   - a local WebSocket server (Node `http` upgrade, minimal frames) and a local page that opens `ws://127.0.0.1:<port>/realtime/v1/websocket?apikey=SECRET&vsn=1.0.0`;
   - **(a) without the handler**: the socket connects (server upgrade count = 1, at least one frame received by the page);
   - **(b) with the same `routeWebSocket(REALTIME_PATTERN, handler)` as the harness**: handler call count = 1, server upgrade count = 0, the NATIVE local client receives close 4000, zero frames;
   - **(c)** the recorded summary contains neither `SECRET` nor `apikey=` nor any query value.
   - It is the same pattern object, imported from `scripts/qa-deeplink/lib/realtime-block.mjs`, so the test checks exactly what the harness installs.
5. **Distinct and OPEN.** This proves only that the deep-link fallback is tested WITHOUT Realtime. **Realtime effectiveness (LIVE-WORKSPACE-001)** stays OPEN and separate (§6). No scenario in this contract may conclude anything about it, either way.

## Amendment A2 (independent review of 6fb13ad + 8a402ff, 4 P2) — before any GO

A10 is settled (ROOT run 6a6: setup + T9 + T14 PASS, cleanup 29, drain 0, open intents 0). This amendment replaces the parts of §2, §4 and A1 that conflict with it.

### P2-1 — Realtime interception: installed before login, exact path, close resolved

- `context.routeWebSocket(...)` is installed and AWAITED on the session's CONTEXT BEFORE `login()`, so before the app can open any socket. The session pool installs it as soon as the context is created (deps injectable), before `trackFn` and `loginFn`.
- **Match.** The handler receives every WebSocket of the context. It applies the block only when `new URL(ws.url())` has the exact path `/realtime/v1/websocket` and the Supabase origin of the run's credentials.
  - The block counts one hit (`realtime_hits`) and stores scalars only: ISO time, origin, path (no query, so never `apikey` or `vsn`).
  - Any other socket ⇒ `ws.connectToServer()` (left alone) and counted as `other_sockets`. Only the path is noted.
- **Close resolved.** The handler `await`s `ws.close({ code: 4000, reason: "qa-realtime-blocked" })`.
  - The hit counts only once that `close()` promise has RESOLVED (A3b; no page-side close is required or asserted).
- `connectToServer()` is NEVER called for the Realtime path.
- **BLOCKED (never PASS, never FAIL)** in any of these cases:
  - 0 hits before the measured navigation;
  - a hit on another path or origin (wrong pattern);
  - a handler error;
  - `close()` not resolved;
  - ≥ 1 server frame (if a page event exists).
- « 0 frames + non connectée badge » alone is NEVER enough. The badge stays a secondary check.
- The local control test of A1 §4 adds:
  - a socket opened BEFORE the handler is installed (negative check: not intercepted ⇒ the scenario would be BLOCKED);
  - a socket on another path (left alone, `other_sockets = 1`, no Realtime hit);
  - an error thrown inside the handler ⇒ BLOCKED verdict.

### P2-2 — counting windows: only THIS cause, after a drain; focus pollution ⇒ BLOCKED

- **Drain before opening.** A window opens only after:
  - every `GET /api/workspace` already in flight has settled (the observer tracks request ⇒ response/requestfailed);
  - then 1 s of network quiet on `/api/workspace` (bounded to 10 s; past that ⇒ BLOCKED « bootstrap not drained »).
  - Bootstrap, the harness's identity check (`waitForWorkspace`, outside windows) and UI-driver requests are therefore excluded by construction. Harness requests carry `x-qa-harness: 1` and are never counted.
- **Attribution to the cause.** Only UI-sourced `GET /api/workspace` STARTED after the action (hash change, click) and before the window closes are counted.
- **Passive revalidation is detected, not assumed absent.** An in-page passive listener (marker installed with the doc marker, removed afterwards) records `focus`, `blur` and `visibilitychange` (type and time only) and `document.visibilityState`.
  - If a focus/visibility event lands in a window, the count is not attributable ⇒ **BLOCKED** (« passive revalidation in window »), never a false FAIL.
  - The 15 s cooldown is NOT a proof that the first focus never happens; only the listener counts.
  - The scenarios keep the page visible and focused (`page.bringToFront()` before the window, no other tab).
- **Double click with a REAL in-flight barrier (D2).**
  - The stub for request #2 is DEFERRED: the route stays pending until the harness releases it.
  - The second click happens while #2 is provably in flight (the observer saw the request start, with no response). It must add 0 requests. The button is `disabled` / `aria-busy`, a read-only attribute check.
  - Then the release: malformed 200 ⇒ error state.
  - No real request #3 is sent before the explicit retry.

### P2-3 — D4: proof of the attempt memory for ABSENCE

Window (b) of D4 only proves the positive cache. Added:
- **(e)** hash to a UUID NEVER seeded (`randomUUID()`, run-unique). That gives exactly 1 refresh, a complete loaded 200 (real reply), then « Intervention introuvable ».
- **(f)** back to the list, then the same UUID again, same context ⇒ **0** requests, « introuvable » rendered directly with no « Recherche du dossier… ».
- **(g)** control: a context change (another identity, in another page or session) does not reuse that memory. One refresh in the new context; the absence memory is keyed by context.

### P2-4 — Auth orphan recovery: exact adapter contract (no blind duplication)

**Proposal (recommended): sequential generalisation of the tracking modules, owner Claude, A10 frozen.**
1. **Step B1, on `claude/web-qa-tracking`, separate lot with ROOT review.** `cleanupWithProof` is extracted from `scripts/qa-tracking/run.mjs` into `scripts/qa-tracking/lib/cleanup-proof.mjs`, unchanged.
   - It takes the cleanup function as a parameter: `runCleanupFn(db, proven, log)` (tracking: `runTrackingCleanup`), plus a hook `settleSideEffects(intents, steps)` (tracking: provider lease intents, otherwise a no-op).
   - Tracking behaviour stays identical: `run.mjs` re-exports `cleanupWithProof` with the tracking parameters, and the 57 tracking tests pass unchanged, plus one adapter test.
   - No change to A7, A8, A9 or A10.
2. **Step B2, here.** `scripts/qa-deeplink/lib/cleanup.mjs` imports `cleanupWithProof` READ-ONLY. It passes `runCleanupFn` = the shared `runCleanup` with the deep-link steps:
   - interventions (with `intervention_tracking` pre-steps imported from `TRACKING_PRE_STEPS`, in case the app created a row lazily);
   - then site scopes and members, sites, organisations, profiles, Auth users.
   - `settleSideEffects` = no-op.
3. **Fixtures.** `TrackingFixtures` (`scripts/qa-tracking/scenarios.mjs`) is imported READ-ONLY for `createUser`, `createOrganization`, `addMember`, `createSite`, `setSiteScope` and `createIntervention`. Their intent protocol is exactly the required one. Nothing is copied.

Fallback option A, if ROOT refuses B: `scripts/qa-deeplink/lib/cleanup.mjs` composes the same read-only primitives (`IntentLog`, `createAuthAdmin`, `readOwnership` / `proveOwnership`, `atomicWriteJsonSync`) with no copy of `cleanupWithProof`. It is tested against the same repro cases as the tracking ones.

**Required semantics (both options, tested here):**
- **Before `createAuth`**: a durable intent (`createAuthUser`, key = the run's canonical e-mail, validated by `assertCanonicalEmail` before any lookup), written atomically to disk BEFORE the emission.
- **Discovery** by that exact canonical e-mail only (`searchByEmail`: exhaustive pagination, end proof, spaced repeats). Another e-mail or domain is never accepted.
- **The found id is persisted** (`manifest.recovered` + `created.auth_users`, atomic write) BEFORE any DELETE. Ownership is proven by `readUser` (exact schema) plus canonical e-mail plus run_id.
- **Unknown or malformed** (Auth schema not recognised, non-legacy 404, 5xx, transport) ⇒ intent OPEN, cleanup INCOMPLETE, exit 3.
- **An absence never closes an intent**, not even an exhaustive one.

Repro tests (offline, injected Auth/DB):
- creation lost after commit ⇒ UID found then persisted before the DELETE;
- malformed Auth ⇒ INCOMPLETE, exit 3;
- non-legacy 404 ⇒ unknown;
- exhaustive absence ⇒ intent open, exit 3;
- interruption between recovery and DELETE ⇒ UID on disk, resumed by `--cleanup-manifest`.

Code only after ROOT GO on A2. If B is chosen, B1 (tracking extraction) comes first, as a separate SHA reviewed before any deep-link code.

## Amendment A3 (ROOT counter-review of 914cfae) — WS proof, passive focus gate, option B chosen

### P2 WS — proof on the handler side; the page-side close is optional

ROOT's local fact (Playwright 1.64): for a routed socket that never reaches the server, the handler sees `hits 1` and `closePromise` resolved, with `upgrades 0`, native close 4000 and 0 frames. But the page receives NO `websocket` event (`pageWebSockets 0`, `pageCloses 0`). A2 §P2-1 is corrected as follows.
- **Required proof, per page claiming « Realtime blocked »:**
  1. `realtime_hits ≥ 1` on the exact path and origin, before the measured navigation;
  2. `await ws.close({ code: 4000, reason: "qa-realtime-blocked" })` RESOLVED (`close_resolved` count = hits);
  3. `connectToServer()` NEVER called for that path (`connect_calls_realtime = 0`, counted by the handler itself);
  4. no handler error.
- **Page-side observation is OPTIONAL.** If the API emits a page `websocket` event for that URL, only its frame count (must be 0) and the fact that it closed are recorded; no close code is asserted (A3b). Its absence is NOT a failure and is never required. No close code is asserted on the page side when no event exists.
- **Native proof of code 4000 and 0 upgrades:** only by the LOCAL control test against a real local WS server.
  - Without the handler: 1 upgrade, frames received.
  - With the same `REALTIME_PATTERN` and handler: 1 hit, close resolved, 0 upgrades, the client receives close 4000, 0 frames.
  - Plus the negative cases: socket opened before installation, other path left alone, handler error ⇒ BLOCKED.
- **BLOCKED** (never PASS or FAIL): 0 hits, wrong path or origin, close not resolved, `connectToServer` called on the Realtime path, handler error, or a server frame observed (if visible).

### P2 focus — passive gate ≥ 15 s since the last focus/visibility event

The 1 s quiet of A2 is not enough. Repro: last request ends at t0, a focus at t7, the 15 s revalidation timer fires at t15, and a window t8..t18 gets a stray request. Replaced by a **bounded passive gate** before each window. The window opens only when ALL of these hold at the same instant:
- (a) no `GET /api/workspace` in flight;
- (b) ≥ 1 s of quiet on `/api/workspace`;
- (c) ≥ `REVALIDATE_GUARD_MS = 15 000 + 1 000` ms since the LAST `focus`, `blur` or `visibilitychange` event recorded by the passive in-page listener (installed with the doc marker, BEFORE login). If no such event happened since the page was created, the reference point is page creation.

Rules:
- Gate timeout: 45 s ⇒ **BLOCKED** (« revalidation gate not reached »).
- After the window: if a focus/visibility event, or a `/api/workspace` request not attributed to the action, appears in the window, the window is **BLOCKED**. No assertion is made on an unknown attribution, neither FAIL nor PASS.
- The scenarios do not bring the page to the foreground during a window and use only one tab per context. `bringToFront` happens only BEFORE the gate, and so restarts it.
- No test clock is instrumented in the app (not needed; the option is set aside). The offline tests reproduce ROOT's case with a local server and a deterministic page timer: last request at t0, focus at t7, timer at t15. The window opened by the gate does not start before t23, and the case where the stray request lands in a window is BLOCKED.

### Option B CHOSEN by ROOT — B1 ownership and limits

- **B1, separate SHA, reviewed BEFORE any B2 or deep-link code.** Owner: Claude, the tracking worker; A10 is frozen. Branch `claude/web-qa-tracking`. **Reserved files, and ONLY these:**
  - `scripts/qa-tracking/run.mjs`: removal of the `cleanupWithProof` body and import/re-export from the new module, with the tracking parameters;
  - NEW `scripts/qa-tracking/lib/cleanup-proof.mjs`: `cleanupWithProof({ db, auth, manifest, intents, runId, log, persist, runCleanupFn, settleSideEffects })`, with the same body as today. `runCleanupFn` is required (no default). `settleSideEffects` defaults to a no-op; tracking passes its provider-lease settlement;
  - the cleanup tests: `tests/qa-tracking-auth.test.ts` and `tests/qa-tracking.test.ts` for the cleanup parts, plus a new `tests/qa-tracking-cleanup-proof.test.ts` (adapter);
  - `docs/CLAUDE_TRACKING_QA_CONTRACT.md`: a « B1 — extraction of cleanupWithProof » note.
- **No other shared file** is touched: not `scripts/qa/**`, not the other `scripts/qa-tracking/**` files, not `scripts/qa-business/**`.
- **Behavioural invariance:** same order (reconcileOpen ⇒ persist ⇒ recovery by canonical e-mail ⇒ persist ⇒ ownership proof ⇒ `cleanup_attempt` persisted BEFORE DELETE ⇒ cleanup ⇒ side-effect settlement ⇒ result persisted). Same manifest fields, same verdicts and exit codes.
- **B1 proofs:** the existing tracking tests (57) pass unchanged in their assertions, and the adapter test checks:
  - `runCleanupFn` is required;
  - `settleSideEffects` is called only after the lease check;
  - a no-op hook leaves the provider intents open;
  - persist happens before the first DELETE in both modes (normal and `--cleanup-manifest`).
- **Start of B1:** only after ROOT's mission entry.
- **B2**, on `claude/web-qa-deeplink` after review of B1, imports `cleanupWithProof` and `TrackingFixtures` READ-ONLY, as in A2 §P2-4.

Still no global code GO: B1 waits for ROOT's mission entry, and the deep-link code waits for the GO on A3 and the review of B1.

## Amendment A3b (ROOT counter-review of f4021ac) — page close code removed, D2 witness, wss origin

B1 is maintained and separate. This amendment applies the two precisions in place in §4/D2, A1 and A2, and records them here.

1. **No page-side close-code assertion, anywhere.** Even when Playwright emits a page `websocket` event, the page does not receive the code applied by the handler. Every page-side code assertion has therefore been removed: A1 §2–4, A2 §P2-1 and A3 « page-side observation » were edited in place.
   - The page event stays optional. If it exists, only « closed » and its frame count (0) are recorded.
   - Code 4000 is asserted ONLY by the native local client of the control test, against a real local WS server.
   - The harness proof stays: hit on the exact path and origin, `await ws.close(...)` resolved, `connectToServer` never called on the Realtime path, no handler error.
2. **Origin normalisation in the handler proof.** The handler compares `new URL(ws.url())` after normalising the scheme: `wss:` ⇔ `https:`, `ws:` ⇔ `http:`, hostname in lowercase, default port removed. It compares against the Supabase origin `https://<ref>.supabase.co` of the run's credentials, or the explicit local origin in tests. Another host, or the same host on another path ⇒ not a Realtime hit (`other_sockets`). If the Realtime socket was not hit ⇒ BLOCKED.
3. **16 s gate (A3).** Unchanged: `REVALIDATE_GUARD_MS = 16 000` since the last focus/blur/visibility event (or page creation), plus no workspace GET in flight, plus 1 s of quiet. The gate's timeout is 45 s ⇒ BLOCKED.
4. **D2 non-empty witness.** `jobWitnessD2` is created and read back BEFORE the clientA session of D2, so it is in the bootstrap.
   - Its presence is proven by a real GET observed BEFORE the stub is installed. It is proven again AFTER the 503 and AFTER the invalid 200, by the DOM or the list, with no extra request in the window.
   - Witness not proven before the stub ⇒ **BLOCKED**. Witness gone after #1 or #2 ⇒ **FAIL** (data cleared).
   - `--only D2` creates its witness itself; it never depends on another scenario.

No B2 or deep-link code before the ROOT GO.
