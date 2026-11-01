# Lecture ponctuelle : backend livré pour revue indépendante

Mission WEB-DETAIL-READ-BACKEND-001, base `53d34a9b2058d885b3043d527b33730f4d6cf17f`, contrat accepté `690da9f`. Le claim `63e14e4` et la réservation du helper de tests `d479709` ont été poussés avant le code correspondant. Codex est auteur ; l’acceptation doit venir d’un autre reviewer, puis de ROOT.

## Changements

Le nouveau `GET /api/interventions/[id]` utilise exclusivement le client de session sous RLS. Il authentifie avant de valider l’UUID. UUID invalide, dossier absent et dossier invisible produisent le même404 JSON. Une erreur de base, de transport ou une réponse de dossier malformée produit503 avec `Retry-After: 2`. Les réponses200/401/404/503 portent `Cache-Control: private, no-store`.

Les lectures d’entités attendent un tableau borné : seul un vrai tableau vide prouve l’absence. JSON `null`, objet inattendu ou plusieurs lignes ne deviennent pas un faux404. Les projections fermées et les schémas Zod suivent l’annexe du contrat. Le site et l’organisation conservent les états `none`, `hidden`, `error`, sans recherche privilégiée. Les dépendances sont filtrées par le dossier ou ses devis, avec leurs plafonds et indicateurs de troncature.

Les paiements utilisent une lecture indépendante des identifiants des devis du dossier, plafonnée à200 avec un compte exact. Un paiement lié à un devis hors des20 affichés reste donc lisible. Plus de200 devis produit `incomplete: true` ; un scope inconnu produit `status: error`. Aucun chemin Storage ni identifiant de session Stripe n’est exposé.

Après les lectures liées, une seconde lecture du dossier sous RLS rejette une révocation ou une modification du client, artisan, site, statut ou `updated_at`. Elle évite de restituer un mélange observé de deux états ; elle ne constitue pas une transaction globale ni une garantie de révocation linéarisable après la dernière lecture.

Le workspace lit une ligne supplémentaire pour les quatre collections concernées, puis conserve les limites historiques :100 dossiers,200 devis,100 sites,50 organisations. `limited` signifie strictement N>L. Les offres artisan restent séparées du calcul et anonymisées. Le101e dossier ne contribue pas aux rendez-vous retournés. `Workspace.limits` reste optionnel ; les anciennes réponses restent compatibles.

## Interfaces livrées

`lib/features/workspace/detail-read.ts` exporte `DetailRead`, `detailReadSchema`, `WorkspaceLimits`, `workspaceLimitsSchema` et `DETAIL_PROJECTIONS`. Le hook, le cache, la génération côté interface et le raccordement des vues restent au lead. Le validateur historique du workspace n’a pas été modifié.

## Vérification

- **780 tests PASS, zéro échec, zéro SKIP**, sur le premier livrable `e0eeee4` : `QA_BUSINESS_4C_HTML=/tmp/depannage-public-4c-home-private.html npm test`. Ce chemin permet uniquement la lecture locale d’un ancien HTML public déjà capturé ; aucun HTML complet n’est commité. Log privé : `/tmp/depannage-detail-read-final-full-tests.log`.
- `npm run typecheck` strict : **PASS** ; `git diff --check` : **PASS**.
- Treize nouveaux tests utilisent les vraies routes, le vrai client Supabase et un fetch simulé : projections et filtres, utilisateur sans session, client propriétaire sans artisan, absence RLS simulée, erreurs/malformations, dépendances cachées, paiement hors20 et scope201, plafonds des documents/paiements, révocation/réaffectation retardée, limites du workspace et compatibilité des anciennes réponses.

La suite globale inclut les tests Chromium sur mini-apps locales existantes. Aucun compte réel, credential, Supabase cloud, SQL, policy, Edge ou déploiement n’a été utilisé ou modifié. Les faux clients ne prouvent pas les politiques RLS réelles : cette recette reste à ROOT après revue indépendante.

Une première passe globale avait un SKIP dû au chemin HTML non configuré. Une vérification séparée l’a passé, puis le correctif distinguant `null` malformé de l’absence RLS a justifié la passe finale780/780 ci-dessus.

Le lien temporaire `node_modules` créé vers le cache QA existant a été retiré après les vérifications, sans installation ni modification du cache. La branche historique QA reste préservée. Ce backend seul ne ferme pas le besoin fonctionnel cap100 avant raccordement front et recette réelle.


## Correctif P2 après revue Claude `d5c187b`

Les lignes du devis sont stockées verbatim par `send_quote`, dont la projection SQL ignore les clés supplémentaires. Le décodeur retire désormais ces clés sans les exposer et conserve la validation stricte des colonnes du devis. Une reproduction PostgreSQL isolée (PGlite, expression exacte de validation de001) confirme que `quantity: "2.0"` est accepté ; le nombre JSON2.0 est déjà le nombre JavaScript2 et passait le validateur précédent.

Les chaînes numériques des quantités et prix unitaires deviennent des nombres uniquement si leur valeur entière est exacte, sûre et dans les bornes SQL (quantité1–1000, prix0–10000000). Les fractions même très proches d’un entier, valeurs hors bornes, chaînes non numériques, null et booléens restent refusés. Les clés supplémentaires d’une ligne ne sont jamais renvoyées.

Vérification du correctif : **14/14 tests ciblés PASS, aucun SKIP**, `tsx --test tests/detail-read-backend.test.ts tests/workspace-limits.test.ts` ; **typecheck strict PASS**, **diff --check PASS**. Log : `/tmp/depannage-detail-read-p2-tests.log`. La suite globale780 a été exécutée au livrable précédent et n’a pas été relancée pour ce correctif ciblé. Aucune recette cloud/RLS réelle supplémentaire.
