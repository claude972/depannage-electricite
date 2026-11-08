# Exact enterprise quote decision context (ENT-12)

Leaf for `GET /api/quotes/<id>/decision-context?organization_id=…[&site_id=…]` (contract
`docs/ENTERPRISE_QUOTE_DECISION_BACKEND.md`, codex/enterprise-quote-decision), mirrored strictly.
`EnterpriseQuoteView` combines it with the exact quote point read (current version, « sent », dossier
« quoted ») and the existing advanced approval read through `acceptanceDecision`; the existing
accept / refuse commands stay the only mutations. `null` rule / approval = absence proven; errors and
refusals are never read as absence. Bound at render to identity + organization + site + quote.
