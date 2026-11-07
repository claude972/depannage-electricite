# Energy consolidation (ENT-09/15)

Read-only leaf for GET /api/organizations/[id]/energy. Claim: claude/energy-consolidation-ui.

CSV export (ROOT b404b4f, contract copied — the route change is not new-files-only): « Exporter en CSV »
re-sends exactly the displayed consolidation's filters plus `format=csv` (same-origin credentials,
no-store), accepts only 200 `text/csv` with a body, saves through a revoked object URL with the
sanitized server filename (`rapport-energie.csv`). Single flight; identity / consolidation change ⇒
dropped; 401/403/404/422/503 (+ Retry-After) explained with « Réessayer »; demo ⇒ note, no call.
