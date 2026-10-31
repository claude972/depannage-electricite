# LIVE-WORKSPACE-001 — product finding (lead, read-only analysis; no app change)

Status: finding + proposed functional contract. Read-only analysis of the source at integration `5eb0f85`. No cloud mutation, no app change. Distinct from the QA ordering fix (tracking A9): the QA fix does NOT close this finding.

## Observed (root, T6 diagnostic, same identity)

A client session opened BEFORE an intervention was created for it (external creation, here the QA seed) never got that dossier into its React workspace, although the client space showed the live badge « En direct » (`client-space.tsx` ~385: shown when `session.connection === "SUBSCRIBED"`). Opening `#detail/<id>` then showed « Intervention introuvable ».

## How live refresh is built today (source)

- `components/courant-app.tsx` ~490–520: one channel `workspace-<profileId>` on `postgres_changes` `event: "*"`, schema `public`, tables `interventions`, `quotes`, `messages`, `payments`; any event ⇒ debounced (350 ms) `refresh()` of the whole workspace. `connection` = the channel status string.
- Browser client: `@supabase/ssr` `createBrowserClient` (singleton), supabase-js 2.118.0.
- Publication: `supabase/migrations/202610310002_professional.sql` adds `interventions`, `quotes`, `messages` to `supabase_realtime` **only if the publication already exists**; **`payments` is never added**.
- RLS: `interventions_read … using (public.can_access_intervention(id))` (`202610310001_initial.sql:157`). Realtime `postgres_changes` deliveries are filtered by the SUBSCRIBER's RLS.
- Hash navigation (`courant-app.tsx` ~464) does not refresh; revalidation otherwise only on focus/visibility (≥ 15 s).

## Candidate causes (ranked; none proven yet)

1. **The live project's publication does not contain `public.interventions`** (the migration's `if exists(publication)` guard may have skipped it, or it was altered later) ⇒ channel SUBSCRIBED, no event ever. Cheap to check.
2. **The realtime socket evaluates RLS as `anon`** (token not attached at join) ⇒ SUBSCRIBED, every row filtered out. Check the realtime join/claims in logs.
3. **RLS evaluation of `can_access_intervention(id)` inside Realtime's check** fails or returns false for the new row (function grants, search_path, or tables it reads under RLS) ⇒ event dropped for that subscriber.
4. **The seed's write path**: if the row becomes visible to the client only through a later write on a table NOT in the channel (participants, assignments…), the only visible-row event is never emitted to the client. Check the fixture's exact writes.
5. Independently of the cause: **the « En direct » badge over-claims** — it only reflects the socket status, not that changes actually arrive.

## Read-only checks proposed for root (no mutation)

- `select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1,2;`
- Realtime logs (dashboard / log explorer) for the channel `workspace-<client profile id>` around the seed time: join role/claims (authenticated vs anon), any RLS/`apply_rls` error, events emitted for `interventions`.
- The fixture's write sequence for one intervention (tables and order), from the QA source.
- `select has_function_privilege('authenticated', 'public.can_access_intervention(uuid)', 'execute');`

## Proposed functional contract (after root's checks; code only after root GO)

- **A. Defence that does not depend on realtime (lead, shells):** deep-link refresh — `docs/CLAUDE_DEEPLINK_REFRESH_CONTRACT.md` (`cd2b8d3`): an id absent from the cached workspace triggers one bounded `refresh()` before « introuvable ». Required regardless of the realtime cause.
- **B. Honest live badge (lead, shells):** « En direct » only while the channel is SUBSCRIBED **and** the subscription is known to be effective; otherwise « Actualiser » (existing label). Minimal honest version: keep the socket status but rename to « Connecté » and keep the manual refresh visible; or mark « En direct » only after a successful realtime-triggered refresh in this session. Wording to choose with root/owner; no invented guarantee.
- **C. Channel/table consistency:** subscribe only to tables actually published, or have Codex add `payments` (and any table that makes a dossier visible) to the publication by a reviewed migration — owner of migrations decides; the lead does not edit SQL.
- **D. If cause 2 or 3 is confirmed:** a targeted fix by the owner of that layer (token attachment in the shell, or policy/function grants by Codex), with a test that a second session receives an INSERT for a row it can see.
- QA: a dedicated scenario « session opened before an external creation receives the dossier without reload » stays as the acceptance proof for this finding (separate from T6's normal precondition).

## Update — source-only narrowing (lead)

- **Cause 4 excluded (source):** the QA fixture (`scripts/qa/lib/fixtures.mjs` `createIntervention`, ~l.219–241) creates the dossier with ONE insert into `public.interventions` with `client_id` already set — a single INSERT event on a published table, visible to the client by `can_access_intervention` (`i.client_id = auth.uid()`).
- **Cause 3, grant part excluded (source):** `can_access_intervention(uuid)` is `security definer`, `search_path=''`, granted to `authenticated` (`202610310001_initial.sql:317`); later `create or replace` (0003, 0009) keep privileges; no later blanket revoke. Remaining part of cause 3 (Realtime's own RLS evaluation of that function) can only be observed live.
- **Remaining live candidates:** (1) `public.interventions` absent from the live `supabase_realtime` publication; (2) the realtime join evaluated without the user's JWT (role anon) — then every row is filtered although the channel is `SUBSCRIBED`; (3b) Realtime RLS evaluation error for that policy.
- Also noted: the channel listens to `payments`, which no migration adds to the publication (harmless or not depending on the Realtime version — to be observed).

## Precise bounded reads requested from root (read-only, no mutation, no cohort)

1. `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1;` — expected to contain `interventions`, `quotes`, `messages`.
2. Realtime logs (dashboard log explorer, realtime source) for ONE channel join of a QA client during the next normal run: the join's role/claims (`authenticated` vs `anon`) and any `apply_rls` / policy error; no message payloads needed.
3. Optional, only if 1 and 2 are clean: the Realtime project setting « Postgres changes » / RLS enforcement status as shown in the dashboard.

The defensive deep-link refresh (contract `cd2b8d3`) is independent of the result and stays proposed.
