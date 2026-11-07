# Enterprise intervention search + server CSV

Leaf for `POST /api/enterprise/interventions/search` (`lib/features/enterprise-interventions/contract.ts`,
imported as is — browser-safe zod; route invariants re-checked per request). `model.ts`: exact
bodies (`list` with `page`, `export` without), strict page parser (number, pages, item count, unique
ids, site/category/status scope), controller binding each read to identity + filters + page +
sequence, debounced search, immediate filter/page/scope change, 401/403 ⇒ cleared. CSV: Response blob
saved only if identity and filters are unchanged after the await (object URL revoked right after,
nothing persisted). `use-enterprise-search.ts`: hook, inactive in demo. Consumed only by
`useInterventionList` in `components/role/enterprise-space.tsx` (Overview + Interventions).
