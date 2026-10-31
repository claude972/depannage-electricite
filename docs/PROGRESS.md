# Progression

État du 30 octobre 2026. La présence de code ne signifie pas validation en production ; la revue détaillée et les limites sont consignées dans `docs/QA.md`.

## Réalisé et contrôlé
- Phase 0 : spécification finale et maquettes analysées ; blueprint à huit phases rédigé et contrôlé sans constat par le linter du skill.
- E00 : socle Next.js/React/TypeScript strict, configuration de secrets, CI GitHub et projet Vercel relié au dépôt. Premier lot serveur/infrastructure déjà versionné dans `1033b8d`.
- E01–E03 : interface responsive client/artisan/professionnel, formulaire de demande, estimation indicative, suivi, mission et devis ; démonstration locale explicitement séparée des comptes réels. API et règles SQL d'attribution/transition présentes.
- E04 : Stripe Checkout, onboarding Connect et webhook signé/idempotent implémentés ; aucun paiement bancaire présenté comme vérifié sans clés de test et intégration distante.
- E05 : comptes/profils, approbation artisan, photos/documents privés et notation implémentés ; droits contrôlés dans le code et le harnais PostgreSQL isolé.
- E06 : espaces par type d'activité, sites, budgets, messages et abonnement aux changements Supabase présents ; notifications multicanaux externes non implémentées. Gestion des demandes de garantie présente, activation commerciale désactivée par défaut.
- E07 : approbations configurables, contrats, registre de suivi et reporting consolidé présents ; conformité certifiée, diagnostic photo IA et plusieurs fonctions avancées restent hors validation/livraison, voir QA.

## Preuves avant le lot de livraison
- `npm run check` : TypeScript strict, 11 tests métier et build de production réussis, confirmé par l'agent principal avant autorisation de commit.
- Harnais PostgreSQL isolé : 13 groupes de contrôles réussis sur les deux migrations ; aucune connexion à un projet Supabase existant.
- Revue indépendante : contrats interface/API et contrôles SQL corrigés ; `git diff --check` réussi et scan de secrets sans constat avant commit.
- Déploiement Vercel : instantané figé en cours de déploiement au moment de ce commit ; résultat et vérification navigateur à reporter dans le prochain lot de documentation. Les essais échoués/interrompus précédents ne constituent pas une preview validée.

## Dépendances bloquantes et limites
- Base Supabase dédiée : création refusée par le fournisseur pour factures en retard dans les organisations du compte. Aucun projet existant modifié. Aucune vraie persistance, confirmation email, Storage ou RLS distante déclarée vérifiée.
- Stripe : clés test/live, secret webhook et comptes Connect indisponibles dans ce projet ; scénario bancaire non exécuté.
- Restent notamment : matching géolocalisé/intelligent, notifications email/SMS/push, archivage automatique, abonnements commerciaux, diagnostic IA, suivi énergétique, rapports d'AG et conformité réglementaire. Ces capacités ne sont pas déclarées terminées.
- Conditions commerciales, garantie, fiscalité, zone de service, coordonnées et marque finale à renseigner avant ouverture à de vrais clients.

## Suite
1. Consigner l'URL du déploiement final et le commit poussé après résultat vérifié.
2. Terminer la vérification navigateur de la preview et enregistrer ses limites dans QA.
3. Après résolution de la facturation Supabase et configuration Stripe via les canaux de secrets : appliquer les migrations à la seule base dédiée, vérifier les comptes/permissions distants et exécuter le paiement de test complet.
