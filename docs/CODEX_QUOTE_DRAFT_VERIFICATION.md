# WEB-PWA-QUOTE-DRAFT-001 — rapport Codex

Branche : codex/web-pwa-backend. Base applicative : d85da0657586f152ee9bba941d67345b4eead616. Mission/corrections distantes lues ; seule affectation brouillons revendiquée. Plan court et contrat publiés **avant code** dans de6091d, présence distante relue. Aucun frontend, paiement ou ancien fichier de migration modifié. Le seul ajout partagé est une étape isolée CI dédiée à ce harness.

## Livré dans le code

- Migration010 additive : quote_drafts, un couple dossier/artisan, contenu privé, version optimiste monotone, état draft/discarded/sent et tombstone après abandon/envoi. Le contenu abandonné/consommé est effacé ; la version ne revient pas à0.
- Manage RPC unique et route GET/POST /api/interventions/[id]/quote-draft : load/save/discard/send, schémas stricts et réponses/erreurs privées/no-store. Ni acteur, ni total navigateur admis. Pas de service-role dans ce parcours.
- Seul artisan actuellement affecté, approuvé/dossier approved, stade assigned/quoted : ni client/manager/owner/admin/autre artisan ne lit le brouillon, y compris directement sous RLS. Suspendu ou état accepté et ultérieur : accès/gestion refusés, aucun devis accepté modifié.
- Verrous organisation → intervention → profil → dossier artisan → brouillon ; la suspension/édition de candidature garde son ordre profils/dossier, et les changements de périmètre entreprise leur ordre organisation/dossier.
- Jeton calculé sur les événements d’attribution applicatifs ; réaffectation ferme les droits et l’ancien onglet reste obsolète même si l’artisan initial revient. Le jeton n’est pas une permission. RLS filtre aussi le jeton courant, pas seulement le handler ; index partiel des événements d’attribution pour cette recherche, sans scan global imposé.
- base_quote_id exact au save et au send : une proposition publiée entre-temps par un autre canal provoque409 plutôt qu’un écrasement silencieux.
- Brouillon incomplet possible, valeurs numériques strictes ; publication via intervention_action send_quote existante, montants recalculés et règles/approbations B2B conservées. quote_id renvoyé est celui du devis effectivement créé. Consommation du brouillon et publication dans la même transaction ; échec laisse le brouillon/version et le devis précédent intacts.
- Sauvegardes privées absentes de l’audit partagé client ; seul l’envoi réel passe par l’historique existant. Aucun revenu ou métrique de devis calculé à partir du brouillon.

## Vérifications fraîches

- TypeScript : `npm run typecheck` passe.
- Tests Node : `npm test` **43 réussis**, zéro échec ; dont **5 tests HTTP ciblés** sur la route réelle transpilée en mémoire, validateur partagé réel, session/RPC explicitement remplacés pour isolation.
- Harness SQL dédié : **9 groupes PASS**, exécution des dix migrations avec stubs Auth/Storage déclarés. Couverture : privé/RLS/tiers/admin/anonymous, montants/extra champs, versions obsolètes et ABA discard/send, consommation et quote_id exact, rollback induit après rejet de l’ancien devis puis insertion empêchée, changement de devis externe, accepté immuable, suspension et réactivation, réaffectation aller/retour, approbation entreprise requise, anciens helpers privés et ordre des verrous.
- Régressions SQL après010 : principal **29 groupes PASS**, performance **6**, accès par site **8**. Toutes migrations réexécutées dans chaque base locale isolée.
- `git diff --check` propre. Pas de dépendance installée, nouveau build volumineux ou nouvelle règle fiscale/commerciale.

Commandes SQL : `PGLITE_MODULE=/tmp/depannage-web-pwa-sql/node_modules/@electric-sql/pglite/dist/index.js node tests/sql-quote-draft-review.mjs`, ainsi que les trois scripts existants. CI installe déjà PGlite0.5.13 hors application ; seule une étape d’exécution du nouveau script est ajoutée.

## Limites et revue attendue

- Tests PostgreSQL isolés avec Auth/Storage stubs, **pas** une preuve cloud ni de concurrence réelle multi-session. Aucun apply distant effectué par cet agent. Le pilote/Claude doivent relire le SHA exact, puis seulement appliquer010 à la base dédiée et faire une recette QA réelle.
- Les tests HTTP couvrent parse/contrats/propagation/refus, pas une authentification Supabase réelle. Les droits métier et rollback sont exercés par le harness SQL distinct.
- **npm run check complet/build/tests UI non revendiqués** : le checkout backend n’a pas les nouveaux tests frontend attendus par test:ui, et le volume est presque plein. La CI/preview intégrée doit exécuter l’ensemble après fusion du lot UI.
- Pas d’autosave, résolution automatique de conflit, PDF, validité calendaire, signature ou tarif nouveau. Le frontend Claude doit charger enveloppe/version/token/base_quote_id, traiter409 avec rechargement et distinguer sauvegarder/envoyer. Après envoi : sélectionner quote_id exact et rafraîchir workspace.
- Le jeton se fonde sur les commandes d’attribution auditées ; des modifications manuelles du service hors ces commandes ne constituent pas un parcours applicatif couvert. Pas de migration automatique d’un éditeur local existant en cours : une sauvegarde explicite doit être présentée.

Le lot reste prêt pour revue, pas terminé avant revue croisée et vérification intégrée applicable.
