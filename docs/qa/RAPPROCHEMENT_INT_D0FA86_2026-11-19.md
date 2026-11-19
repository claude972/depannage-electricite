# Rapprochement du paiement iOS INT-D0FA86 — 19 novembre 2026

Recette Stripe TEST uniquement, effectuée via les API déployées avec le compte opérateur synthétique existant et ses droits finance. Pas de modification des droits ni de clé privilégiée côté client. Ce contrôle API ne revendique pas une nouvelle recette visuelle du bouton admin.

Paiement `a7a69f49-95a8-419d-bbec-e639d93aa3c1`, devis `7f41966c-bb4e-453f-ad3e-9985829513e3` : 108,50 EUR, payé le 19 novembre à 15:41:57 UTC après reprise de la carte TEST refusée.

- Avant : une commission de 1 845 centimes existait déjà, créée par le webhook à 15:42:00 UTC avec `live=false`. Le registre signalait un seul règlement sans écriture.
- Rattachement serveur à Stripe, puis rejeu : `linked`, `commission=existing`, aucune anomalie à examiner. Commission inchangée.
- Rapprochement : une écriture `payment_settled` crédit de 10 850 centimes, créée à 16:26:50 UTC (12:26:50 en Martinique). Aucun montant ni taux envoyé par le client.
- Rejeu : zéro écriture ajoutée. Les deux écritures exactes du paiement sont inchangées : commission 1 845 centimes et règlement 10 850 centimes.
- Registre global : 4 règlements, 45 570 centimes ; zéro règlement manquant et zéro écart de montant. Commission totale inchangée à 5 903 centimes ; aucune commission estimée.

Aucun remboursement, versement bancaire ni paiement LIVE. La commission du Checkout de test ne constitue pas une décision de tarification commerciale. Aucun net bancaire n'est déduit de ces deux écritures.

Preuve externe : `preuves/finance-d0fa86-reconciliation-20261119.json`, produite par `tools/recette/reconcile-d0fa86.py`. Les références fournisseur restent hors de ce rapport Git.

Contrôle complémentaire : client, artisan et entreprise reçoivent chacun 403 sur la lecture finance, le rapprochement et le rattachement fournisseur (9 refus). Preuve : `finance-roles-refused-20261119.json`.
