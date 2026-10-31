# Vérification Codex — WEB-PWA-ADMIN-DIRECTORIES-001

Branche codex/admin-directories, base d85da0657586f152ee9bba941d67345b4eead616. Contrat prépublié sur GitHub au7b1ea23 et vérifié lisible avant toute implémentation. Seuls nouvelle route, tests et ces deux documents ont été modifiés. Aucune migration, modification RLS, clé, commande financière, donnée distante ou frontend.

## Code livré

GET /api/admin/directory couvre artisans, clients/manager et organisations, plus détail UUID minimal hors fenêtre100. Session serveur vérifiée, rôle plateforme admin avant lecture. Même projection opérationnelle que admin_overview, avec timestamp de tri pour les artisans ; aucun email/Auth, SIRET, adresse ou compte Stripe. L’enrichissement société/statut est fait sur les seuls artisans de la page, sans exclure ceux sans dossier. Si le fournisseur tronque cet enrichissement, réponse503 plutôt que faux statut absent.

Pagination keyset created_at DESC,id DESC, microsecondes conservées, curseur strict versionné lié au kind/filtres. Filtres serveur et recherche littérale avant limite ; total exact avant curseur. Rôle client/manager et approbation/owner bornés au type correct. COUNT/page/enrichissement sont séparés, donc pas de snapshot transactionnel commun ; restrictions documentées au contrat. Auth/RLS restent l’autorisation à chaque lecture, le curseur n’est pas un jeton de droits.

## Contrôles réellement exécutés

| Contrôle | Résultat |
| --- | --- |
| TypeScript `tsc --noEmit --incremental false` | PASS |
| `npm test` |46/46 PASS, dont8 nouveaux groupes annuaires |
| Réexécution ciblée après amélioration des UUID de fixtures (lettres pour vérifier réellement la casse) |8/8 PASS |
| `git diff --check` |PASS |

Les8 groupes font tourner la vraie route transpilée en mémoire, avec le SDK Supabase installé vers un fournisseur HTTP synthétique :
- 237 entrées par kind, dates liées et microsecondes distinctes ; toutes les pages sans doublons et total global invariant ;
- approved/role/owner et recherche avant pagination, curseur lié aux filtres/type mais changement de taille accepté ;
- refus client/artisan/manager/owner/viewer et absence de session sans lecture d’annuaire ; erreurs no-store ;
- injections, wildcards, noms inconnus/doublons, curseurs malformés, valeurs incompatibles refusés422 ;
- détail ancien et UUID en majuscules exacts, noms avec accents/apostrophes, résultat vide ;
- projection sans informations supplémentaires ; profils artisans sans dossier conservés ;
- plafond fournisseur sans fausse fin de liste et enrichissement/count incomplets refusés503.

Un premier test de recherche avait une attente de fixture sensible à la casse alors que le fournisseur imite ILIKE ; attente corrigée en choisissant des termes explicitement discriminants, puis8/8 PASS. Les premières erreurs TypeScript de sélection dynamique du SDK ont été corrigées par un override de résultat borné au schéma connu aux seuls points de terminaison (sans changer requêtes ou droits). Aucun échec restant.

## Limites et suite

Pas de build complet ni `npm run check` : checkout backend sans tests/ui et volume presque plein ; aucun install de dépendances. Le node_modules partagé a servi en lecture via symlink local temporaire, jamais commité.

Le fournisseur synthétique n’est PAS PostgREST hébergé ni preuve Auth/RLS. Revue indépendante Claude, intégration, CI combinée et test en ligne nécessaires avant statut terminé. Recette recommandée : trois jeux QA >100, recherche+curseur, dossiers sans candidature, refus interrôles et nettoyage ; branchement frontend Claude séparé. Aucun nouveau preview produit par cette branche isolée.

Empreintes des sources vérifiées :

- route SHA256: 2acd2e7bcd98c12a815b4922895e854b8d9de8bddb51a6dad013bdfe9702e602
- tests SHA256: ddf86b0937c93f5f371128f75919940ae8a62d78d6103121f15e9f0bbec1fb4f
