# saved-payment-methods (UI leaf, Claude)

Claim FIN-08 UI: saved payment methods in the client « Mon profil » (GET/POST /api/payments/methods; backend in parallel — injected api + strict schemas). Setup opens Stripe only after an explicit click; removal behind an inline confirmation; no payment and no card choice here. Stored commands: courant-private-payment-methods:.
