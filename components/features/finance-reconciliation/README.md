# Finance reconciliation observer (FIN-06)

Leaf for `/api/platform-operations/stripe-observations` (ROOT dca415c; contract copied strictly in
`contract.ts` — the commit also edits the payment webhook route, so it is not cherry-picked). Private
observer: list (≤ 50, `after` cursor, state filter), detail + review history, operator review (note +
automatic re-association by our server; no manual link). An observation is never shown as a payment,
payout or refund. Review command fenced under `courant-private-reconciliation:<uid>:<gen>:<event_id>`.
Mounted as the « Observations fournisseur » tab of the platform finance screen; demo: note, zero calls.
