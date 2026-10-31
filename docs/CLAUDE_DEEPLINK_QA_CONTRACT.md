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

1. clientA session (another context, Realtime blocked as in D1); seed `jobLate2` and read it back.
2. Browser route stub on `GET /api/workspace` ONLY, for exactly the next two requests:
   - #1 ⇒ `503` `{error}`;
   - #2 ⇒ `200` `{profile:{id:clientA, role:"client"}}` with no collections (A5 « profile only »).
   The stub then calls `unroute`, and the third request goes to the real server. The stub fabricates responses and does not mutate anything.
3. `goHash("detail/<jobLate2>")` ⇒ refresh #1 (503) ⇒ error state:
   - title « Dossier momentanément indisponible », `data-blocker="deeplink:error"`, button « Réessayer »;
   - « Intervention introuvable » never rendered;
   - no sign-out (§2);
   - data not cleared: the dossiers already seen before navigation stay listed after the window.
4. Click « Réessayer » ⇒ refresh #2 (malformed 200) ⇒ same error state. Nothing is applied: the earlier list stays. No « introuvable », no sign-out.
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
2. **Zero frames forwarded.** No `connectToServer` happens, so no frame is relayed to the server. The passive observer (`page.on("websocket")`) records zero `framesent` / `framereceived` events delivered by the server for that URL; the count only, never the content. The close that the page observes carries the applied code (4000).
3. **Verdict.** All of these must hold in each scenario that claims « Realtime blocked »:
   - handler call count ≥ 1 for that page, before the measured hash navigation;
   - close code 4000 applied;
   - zero frames forwarded;
   - badge « non connectée · Actualiser ».

   Otherwise ⇒ **BLOCKED** (« Realtime interception not proven: handler called N times »), never PASS. A handler that is never called is a BLOCKED, not a sign that Realtime is absent.
4. **Local control test in real Chromium** (`tests/qa-deeplink-realtime-route.test.ts`, offline):
   - a local WebSocket server (Node `http` upgrade, minimal frames) and a local page that opens `ws://127.0.0.1:<port>/realtime/v1/websocket?apikey=SECRET&vsn=1.0.0`;
   - **(a) without the handler**: the socket connects (server upgrade count = 1, at least one frame received by the page);
   - **(b) with the same `routeWebSocket(REALTIME_PATTERN, handler)` as the harness**: handler call count = 1, server upgrade count = 0, page-side close with code 4000, zero frames;
   - **(c)** the recorded summary contains neither `SECRET` nor `apikey=` nor any query value.
   - It is the same pattern object, imported from `scripts/qa-deeplink/lib/realtime-block.mjs`, so the test checks exactly what the harness installs.
5. **Distinct and OPEN.** This proves only that the deep-link fallback is tested WITHOUT Realtime. **Realtime effectiveness (LIVE-WORKSPACE-001)** stays OPEN and separate (§6). No scenario in this contract may conclude anything about it, either way.
