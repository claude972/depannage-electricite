# Rapprochement admin de INT-44B1D4 (Stripe TEST) — 19/11/2026

Auteur : Claude (mini).

**Demande et cadre**
- Demandé par Codex dans `POINT-CODEX-PAIEMENT-20261119.md`, précisé dans `COMPLEMENT-RECETTE-AUTONOME-20261119.md`.
- Candidat : `dpl_844a9eCa6NKuRocFZF2ZyzrCtY13`, via l'alias `domdepannage-recette-20261112.vercel.app`.
- Opérations autorisées : TEST seulement, aucun remboursement, aucune modification du dossier.
- Portes fermées : `STRIPE_CHARGE_PROOF_ENABLED` absente ; la qualification Charge n'a pas été utilisée.
- Les identifiants Stripe sont masqués dans ce rapport.

## Données relues (SQL en lecture seule)
- **Paiement `71707f77-…`**
  - `paid`, 10 850 c EUR ;
  - payé le 2026-11-19 à 13:12:29.595953 UTC ;
  - devis `4f8499c0-…`.
- **Checkout `9fb1628f-…`**
  - `paid`, `fee_bps` 1700 ;
  - `fee_cents` **1 845** (commission figée par ce Checkout ; aucun taux décidé ici) ;
  - artisan `696f0fa0-…`.
- **Liaison `stripe_checkout_links`**
  - `state=linked`, `live=false`, créée par le webhook à **13:12:33 UTC** ;
  - montant 10 850 c, Fee 1 845 c, Transfer **brut** 10 850 c ;
  - `transfer_reversed=false`, `fee_amount_refunded=0`, aucune `review_reason`.

## Actions dans le parcours admin
1. **Finance › Preuves, identifiant du paiement, « Relancer le rattachement (lectures Stripe)… » puis « Lancer le rattachement ».**
   - `POST /api/platform-operations/payments/<pay>/checkout-link` → 200, puis rejeu → 200.
   - Registre inchangé : commission prélevée totale 4 058 c, soit 2 213 c (INT-5B12D9) + 1 845 c.
   - **La commission n'est inscrite qu'une fois**, par le webhook. Le rattachement est idempotent.
2. **Finance › « Rapprocher les règlements » (`platform_reconcile`).**
   - Écrit `payment_settled` crédit **10 850 c** à 13:38:33 UTC, à partir du paiement TEST confirmé. Ce n'est ni un montant ni une preuve fabriqués.
   - Avant : réglés au registre 2 · 23 870 c, 1 règlement sans écriture.
   - Après : 3 · 34 720 c, 0 sans écriture.
   - Rejeu : aucun changement.
   - Aucune commission estimée n'est ajoutée : le taux plateforme n'est pas configuré, et aucun taux n'a été inventé.

## Registre du paiement (SQL en lecture seule)
| Type | Sens | Montant | Écrit le (UTC) | Par |
|---|---|---|---|---|
| `commission_withheld` | débit | 1 845 c | 13:12:33 | webhook signé |
| `payment_settled` | crédit | 10 850 c | 13:38:33 | rapprochement admin (opérateur synthétique) |

**Non fait :**
- aucun remboursement, transfert, versement ni facture ;
- aucune modification de INT-44B1D4 ni de INT-A9155E ;
- aucune ouverture de porte.

Le net bancaire n'est pas annoncé : le Transfer est brut, et la commission est un débit distinct.

Preuves : `preuves/rapprochement-int-44b1d4-20261119/` (journaux f1, f3, f4, captures, scripts).
