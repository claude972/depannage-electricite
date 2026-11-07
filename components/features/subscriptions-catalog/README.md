# Subscription catalog (FIN-07, operator)

Leaf for ROOT's `GET|POST /api/subscriptions/offers` (mode `test|live`). Lists offers with read-only
amounts (as read back; the server derives them from the Stripe Price), creates / edits label, role,
active and price_id only when the server says `can_write` AND the shown mode is `configured_mode`.
No amount input, no activation button, no default offer. `catalog_enabled:false` ⇒ « Offres non
publiées tant que le service est désactivé ». Command fenced under
`courant-private-subscriptions-catalog:<uid>:<gen>`. Mounted as the « Abonnements » tab of the
platform finance screen (finance_read or super admin); demo: note, zero calls.
