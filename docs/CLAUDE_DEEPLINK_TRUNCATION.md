# DEEPLINK-TRUNCATION-001 — finding (lead, proposal only; no API change)

## Fact (source)
`app/api/workspace/route.ts` reads `interventions` with `order(created_at desc).limit(100)` (plus at most 100 artisan offers). The client detail views resolve `#detail/<id>` / `#mission/<id>` against that list. After WEB-DEEPLINK-REFRESH-001, an absent id triggers one causal refresh; if the dossier is older than the 100 most recent visible ones, it is still absent after a `loaded` read and the view says « introuvable » although the dossier exists and is readable by RLS.

## Impact
Users with more than 100 visible dossiers (enterprise managers, active artisans) opening an old link (e-mail, notification, bookmark) get a false « introuvable ». The new-id incident (T6) is not affected.

## Options (to decide before any code; API changes are Codex/backend-owned)
1. **Truncation signal (minimal):** the route adds `interventions_limited: boolean` (like `appointments_limited`); the reader exposes it; when the snapshot is limited and the id is absent, the view says « Ce dossier n’est pas parmi les 100 plus récents chargés » with a way to open it, instead of « introuvable ».
2. **Point read by id under RLS:** a dedicated `GET /api/interventions/<id>` (or a select by id) used only when the id is absent from a limited snapshot; 404 ⇒ truly absent/not visible, 200 ⇒ show (validated record). One bounded call per id.
3. Keep as is and document the limit (not recommended for enterprise).

## Recommendation
Option 1 first (honest wording, tiny API field), then option 2 if owner wants old deep links to open. Both need a contract, root review, and Codex for the route; the lead wires the UI.
