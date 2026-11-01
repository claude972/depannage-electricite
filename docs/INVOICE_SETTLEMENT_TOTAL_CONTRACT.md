# Facture de prestation et règlement cumulé — migration026

La facture de prestation reprend les lignes du devis accepté, puis celles des avenants acceptés par version/identifiant. Les avenants proposés, refusés ou retirés sont exclus. HT, TVA et TTC sont additionnés sans réécriture des lignes ; le TTC doit correspondre exactement au paiement. Exemple : devis 12000 + avenant 3000 = facture 15000 centimes.

Pour les règlements024/025, les identifiants, versions et montants des avenants sont comparés au snapshot financier figé, avec le devis, les acteurs, le montant et la référence de règlement. Les paiements Stripe historiques sans réservation restent compatibles, sous réserve du montant exact. Une déclaration sur place reste déclarative : cette correction ne la transforme pas en preuve bancaire.

Le modèle PDF actuel ne représente qu’un taux de TVA et 30 lignes au maximum. Aucun taux, arrondi ou montant correctif n’est inventé. Les cas non représentables renvoient `ready:false`, bloquant l’émission :

- `payment_total_mismatch` : montant du paiement différent du cumul accepté.
- `amendment_snapshot_mismatch` : snapshot financier absent ou différent du cumul courant.
- `invoice_mixed_tax_rates` : plusieurs taux ; le taux de prévisualisation est nul.
- `invoice_lines_limit` : plus de 30 lignes, conservées intégralement dans la prévisualisation.
- `invoice_tax_rounding_mismatch` : TVA cumulée différente de l’arrondi global que sait représenter le PDF.
- `amendment_invalid` : structure, lignes, arithmétique ou montants non représentables.

026 remplace uniquement `platform_invoice_readiness`, sans ancien helper parallèle. Les ACL, contrôles d’émetteur/destinataire, factures déjà émises, émission, numérotation, idempotence et branche commission restent conservés. Aucune modification des migrations001–025 ni application cloud dans ce lot.

Vérification : `PGLITE_MODULE=<module PGlite existant> node tests/sql-invoice-settlement-total-review.mjs`. Migrations réelles001–026, runtime isolé 0.5.4 ; Auth, Storage et installation pg_cron simulés explicitement. Les preuves Stripe injectées vérifient les RPC, sans valider un fournisseur, un transfert bancaire ou la concurrence PostgreSQL distante.
