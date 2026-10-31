# Vérification009 — droits par site

Base `1d93445` ; contrat publié séparément avant code : `a10bb3d`. Implémentation additive dans009 et API `organizations/site-access`, extension compatible de `create_invitation`. Aucune ancienne migration, interface, PWA ou règle financière modifiée.

## Résultat actuel
- Migration001–009 exécutée en PostgreSQL isolé avec Auth/Storage explicitement simulés.
- `npm run check` : TypeScript, 30 tests et build Next réussis.
- `tests/sql-review.mjs` : 29 groupes réussis sans modification des fixtures.
- `tests/sql-performance-review.mjs` : 6 groupes réussis.
- `tests/sql-site-access-review.mjs` : 8 groupes réussis ; étape CI explicite « not live Supabase » ajoutée.
- Revue indépendante read-only : aucun nouveau contournement bloquant identifié ; site8/main29/performance6 réexécutés sur copie figée, tous réussis. Migration009 SHA256 `a05b0820e5c7a281d89c7afe6580ce8e4e2e79b2ac00c2809132568dc986644f`, API site-access `b9c081b2f763055944ff34ac750fd5d1c2104b574659a065df18fb4acfb772f5`, harness `3deaad37332fce67d52aa865a44f5a9b819f300d0dff927b0bb8334525906ead`. Ce verdict ne constitue pas une recette distante.

## Couverture
Deux organisations et deux sites chacune ; owner, manager global, manager restreint écriture/lecture, viewer, extérieur, artisan assigné et plateforme admin. Restrictions strictes, IDs inter-organisations et doublons refusés ; droits du viewer bornés par le rôle courant même si une ancienne attribution porte can_write=true. Owner canonique non restreignable et toujours all après transfert.

Les helpers RLS utilisent le site réel : dossiers, devis, paiements, documents et objets Storage, messages, rendez-vous, rapports d'intervention, règles, approbations, conformité et rapport professionnel. Le créateur d'un dossier B2B exclu ne conserve pas d'exception de lecture. Les contrats et le journal professionnel restent organisationnels et invisibles aux membres selected. Les annuaires d'appartenance006 restent une donnée d'organisation, sans détails de sites.

Écriture : read-only/viewer refusés sur création de dossier, budget, conformité, approbation, acceptation/refus de devis et rendez-vous. Les membres selected ne créent pas de site dans l'organisation et ne modifient pas de contrat organisationnel. Les signatures publiques restent compatibles ; 17 fonctions internes/anciens chemins sont sans EXECUTE authenticated. Mutations directes des tables refusées.

Invitations selected : hash et email vérifié006 conservés ; portée appliquée dans la transaction d'acceptation. Rejeu refusé. Si un site invité a été supprimé, l'acceptation échoue entièrement et ne crée ni appartenance ni accès all. Les invitations historiques sans portée restent all. Le retrait d'un membre supprime les attributions par cascade. Les changements de rôle ne permettent pas à un viewer d'utiliser une ancienne attribution d'écriture. Une portée selected vide retire tous les sites.

## Lecture des API existantes
`workspace`, intervention detail, participants, documents et Storage, professional et exports consomment les tables sous RLS ou les helpers corrigés. Les contrôles de mutation des RPC de site et de dossier sont précédés du verrou organisation. Les opérations admin et les actions de l'artisan assigné conservent leur autorité métier ; aucun nouveau pouvoir d'administration délégué.

Le chat garde sa règle antérieure d'écriture via owns_intervention/artisan/admin ; il n'est pas nouvellement ouvert aux lecteurs. Avis et garantie restent des contributions du créateur sous condition de lecture actuelle. Checkout conserve son contrôle exact du créateur, distinct du droit opérationnel ; aucun nouveau payeur, taux, remboursement ni payout introduit.

## Limites
La base Supabase dédiée reste bloquée par le fournisseur ; aucune migration distante appliquée et aucun essai Auth/Storage réels, Stripe ou concurrence multi-connexion revendiqué. Aucun écran de gestion de ces droits n'est ajouté par ce checkpoint. Le frontend doit consommer `organization_member_overview.site_access` ou GET `/api/organizations/site-access`, rafraîchir après mutation/403 et purger les données de site exclu. Les URL Storage signées avant retrait restent valides jusqu'à leur TTL existant (60 s via l'API) et les copies déjà vues ne sont pas effaçables. L'accès live et l'interface nécessitent encore une recette cloud distincte ; ENT02 reste partiel.

Limite d’intégration préexistante confirmée en revue : un upload de document déjà autorisé peut terminer son écriture via service_role après une révocation concurrente (contrôle avant traitement du fichier, upload puis insertion). Les lectures suivantes restent refusées par RLS. Le verrou des RPC009 ne doit pas être annoncé comme une révocation atomique de toute requête HTTP en vol ; Checkout traverse également des opérations externes hors de ce verrou.
