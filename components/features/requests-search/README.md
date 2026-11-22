# Client requests server search (« Mes demandes »)

Leaf for ROOT's `POST /api/client/interventions/search` (`{filter, search, cursor}` in the JSON body,
never in the URL). `model.ts`: strict parser (exact keys, ≤ 50 items, `has_more ⇔ next_cursor`,
`total ≥` items shown), controller binding each read to identity (uid + generation), filter, trimmed
search and a sequence (stale replies dropped), ~300 ms debounce for the search, immediate filter
change, cursor pagination with dedupe, 401/403 ⇒ results cleared. `use-requests-search.ts`: React
hook, inactive in demo (zero call). Used only by `RequestsView` in `components/role/client-space.tsx`;
rows open through the existing `session.openIntervention` detail path. Results stay in memory only.
