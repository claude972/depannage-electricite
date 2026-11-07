# Finance proofs (FIN-06)

Read-only display of the recorded proofs with their exact scope, plus an explicit, confirmed
qualification for finance writers. Contracts: `docs/CHECKOUT_CHARGE_PROOF_BACKEND.md`,
`docs/AUTOMATIC_PAYOUT_PROOF_BACKEND.md`. Charge and Fee parsers are strict browser copies of
`lib/features/charge-proof/*` (server-only); the payout parser imports
`lib/features/payout-proof/contract.ts` (browser-safe) and its `coherent` check. GET never contacts
Stripe; POST `{command_id}` (provider reads only) is sent only after a click + confirmation, command
fenced under `courant-private-finance-proofs:<uid>:<gen>:<kind>:<target>`, same UUID on lost reply /
503 (gates OFF by default ⇒ « désactivée ou indisponible »), 409 re-read without replay, 401/403
cleared. A capture proof is never a balance or a remaining net; a payout proof is never a bank
receipt. Mounts: « Preuves » tab of the platform finance screen; payout proof in the provider
observation detail (payout family). Demo: note, zero calls.
