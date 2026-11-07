# Enterprise on-screen report (ENT-15)

Leaf for `GET /api/reports[?site_id=]` (JSON; same parameters as the existing CSV call). Rows and
totals are parsed with `lib/features/professional-report/model.ts` (browser-safe, imported as is):
strict reply, same scope, unique sites, totals equal to the recomputed sum. In live mode the Rapports
table and totals come ONLY from this reply (no cache fallback); figures are presented as totals only
when `scope.complete` is true. Bound at render to identity + organization + site; late replies of
another scope dropped; 401/403 clear. Demo: unchanged, zero call. Used by `ReportsView` only.
