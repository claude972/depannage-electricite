# DETAIL-READ front consumer — plan (lead, DOCS ONLY)

Status: plan only. No front code before (1) root acceptance of the backend `e0eeee4` (`codex/detail-read`) after independent reviews and (2) a short front contract published before code. Base for this plan: integration `721853a` (deep-link refresh `47423b7` already integrated). Backend contract: `docs/DETAIL_READ_CONTRACT.md` @ `690da9f`.

## Backend interfaces consumed (read-only, Codex-owned)

- `GET /api/interventions/:id` ⇒ 200 `DetailRead` (validated by `detailReadSchema`), 401, 404 (non-UUID / absent / not visible — identical), 503 + `Retry-After` (+ `private, no-store` on all).
- `DetailRead`: `intervention` entity; `site` / `organization` as `ok | none | hidden | error`; lists `{ status: "ok", items, limited } | { status: "error" }` (quotes ≤ 20, messages ≤ 200, documents/appointments ≤ 50); `payments` adds `incomplete`.
- `Workspace.limits?: WorkspaceLimits` (`interventions` 100, `quotes` 200, `sites` 100, `organizations` 50; `limited` = N > L). Optional: old replies without it stay valid.
- Types imported from `lib/features/workspace/detail-read.ts` and `components/app/types.ts` (read-only for Claude workers).

## Ownership (lead only; no worker)

- NEW `components/app/detail-read-client.ts` — identity-bound fetch of one dossier (`bound()` pattern from `features.ts`), runtime validation with `detailReadSchema`, outcome `loaded | not_found | failed(status, retryAfterS) | signed_out | superseded`.
- NEW `components/app/detail-cache.ts` — pure bounded cache: ≤ 20 entries, LRU (read promotes), TTL 60 s, key = full context (`refreshContextKey` = identity generation + role + org + site) + id, request generation per id; purge on any context/rights change; never merged into the 100-list.
- NEW `components/role/use-detail-read.ts` — hook used by the three detail views.
- EDIT `components/role/use-detail-presence.ts` + `components/app/detail-resolution.ts` — decision extended (below).
- EDIT `components/app/workspace-reader.ts` — accept and expose the OPTIONAL `limits` (validated with `workspaceLimitsSchema`; malformed ⇒ the whole reply invalid, as today for other fields).
- EDIT `components/app/session-types.ts` / `components/courant-app.tsx` — expose `session.workspaceLimits` and the bound detail client; no other shell change.
- EDIT the three detail views (`client-space` DetailView, `artisan-space` MissionView, `enterprise-space` DossierView) only to render the detail result when the dossier is outside the list.
- Tests: `tests/ui/detail-cache.test.ts`, `tests/ui/detail-read-client.test.ts`, `tests/ui/detail-resolution.test.ts` (extended), `tests/ui/workspace-reader.test.ts` (limits).

## Decision (extends the deep-link resolution)

1. Present in the cached workspace ⇒ show (unchanged).
2. Absent ⇒ one causal refresh (unchanged, A1–A6).
3. Still absent after a `loaded` refresh:
   - `limits.interventions.limited === true` ⇒ ONE point read `GET /api/interventions/:id` (single flight per key):
     - 200 ⇒ show the detail view from `DetailRead` (read-only presentation of what was returned; linked items `hidden` ⇒ « non accessible », `error` ⇒ local error with retry, `none` ⇒ absent; list `limited` / `incomplete` shown as « liste partielle »);
     - 404 ⇒ « introuvable » (now proven);
     - 503 / transport ⇒ error with retry honouring `Retry-After`, never « introuvable »;
     - 401 ⇒ session handling.
   - `limits` absent (old backend) or `limited === false` ⇒ current wording, plus an explicit « Ouvrir quand même » action that performs the point read on demand (contract: never « introuvable » claimed beyond what was read).
4. The detail result is cached by full context; a workspace refresh does not erase it; a realtime event for that id, focus revalidation (independent of Realtime) or an explicit refresh revalidate it; any context or rights change purges it.

## Perimeters

- Client: own dossiers (RLS). Artisan: assigned missions only — unassigned offers are never point-read. Enterprise: the ACTIVE organisation/site perimeter — a dossier returned by RLS but outside the active site is shown as « hors du périmètre actif » with a switch hint, never silently displayed in the wrong context. Admin views unchanged.
- No rights widening, no service role, no new API beyond Codex's route.

## Tests (planned)

Cache (LRU promotion, TTL expiry with injected clock, bound 20, purge on context change, generation drops stale replies), client (200 valid / malformed ⇒ failed, 404, 503 Retry-After, transport, 401, identity change mid-flight ⇒ superseded with no request sent by a stale bundle), resolution (each branch above incl. `limits` absent, `limited` false + « Ouvrir quand même »), reader (`limits` optional, malformed ⇒ invalid), view-level SSR of the three states, real Chromium deep-link scenario with a stubbed `/api/workspace` limited reply and a stubbed detail route.

## Out of scope

Realtime effectiveness (LIVE-WORKSPACE-001), quotes/sites/organizations limits beyond display of `limited`, any backend or SQL change, role re-theming.
