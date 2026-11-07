# Remplacement d’empreinte — backend pour intégration

Base intégrée explicitement : `002de1a` (fusion `412e3b2`), sans doublon de la migration remboursement `20261107031755`. Une seule migration nouvelle, créée avec le CLI : `20261107141148_hold_reauthorization.sql` à la livraison du lot, enregistrée sur la base de test en `20261107144127_hold_reauthorization.sql`. Le brouillon non appliqué `20261107031354` a été remplacé ; ne pas appliquer les deux.

## Contrat réalisé

GET/POST `/api/bookings/settlement/reauthorization` : consentement sur snapshot opaque du total accepté, compte/site/organisation et documents financiers ; UUID stable, session et politique figées avant appels fournisseur. Reprise d’une création perdue avec la même clé avant 23 heures ; récupération GET paginée bornée après cette fenêtre, aucune nouvelle création aveugle. GET ne mute rien.

Nouvelle autorisation manuelle vérifiée indépendamment, libération de l’ancienne avec preuve complète puis adoption atomique. Capture distincte par le moteur existant. La réservation initiale n’est jamais réécrite. Un règlement processing ne peut être retiré après une invocation durable de capture ; génération active unique, historique et preuve de libération conservés. Une observation bancaire tardive sur une génération retirée est journalisée et bloque le remplacement pour examen, sans la réactiver ni déclarer le nouveau dossier payé.

Abort ferme seulement la session/nouvelle autorisation liée, jamais une empreinte adoptée. Une réponse tardive de création ne peut pas rouvrir une tentative annulée. Abort pendant libération ancienne non résolue est refusé ; après preuve de libération, il peut fermer la nouvelle empreinte sans ressusciter l’ancienne. Montants, taux et destinataires ne viennent pas du navigateur. Une commission historique qualifiée reste celle du ledger initial. Auth email confirmé ou téléphone confirmé, droits actuels et portée organisation restent nécessaires ; aucun rattachement par numéro seul.

## Preuves et limites

- 15 tests dédiés des vrais handlers/helpers avec fournisseur injecté : nominal, erreurs, Origin/auth/body, GET sans mutation, réponses perdues, expiration de clé, récupération bornée, révocation, preuves incohérentes et deux entrelacements concurrents déterministes.
- 37 régressions des modules empreinte/règlement/webhook/remboursement ; l’ancien mock `markReview` suit désormais la RPC contrôlée, assertion métier inchangée.
- 43 assertions PostgreSQL isolé, 42 migrations : droits, historique, snapshots, génération retirée/active, absence de double adoption et refus de capture en cours. Auth/Storage/cron explicitement simulés. Pas de preuve multi-connexion ni de fournisseur réel.
- TypeScript strict non incrémental et vérification du diff.

Aucun compte, secret, configuration, paiement, SMS ou migration cloud modifié. Aucun frontend écrit. Intégration UI, tests réels de concurrence SQL et recette sur le SHA déployé à réaliser par le pilote. Les listes fournisseur sont bornées à cinq pages de cent : une réponse partielle/ambiguë reste bloquée. Une preuve incomplète (notamment Charge absente) ne devient jamais un zéro capturé. L’application entière n’est pas déclarée livrée par ce lot.

Sources contrôlées : [Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create), [idempotence](https://docs.stripe.com/api/idempotent_requests), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). Changelog consulté : changements Flutter/CLI sans modification des dépendances du projet.
