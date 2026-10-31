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
- Déploiement Vercel : application accessible sur https://depannage-electricite-seven.vercel.app . `999b355`, `706d380` et `1db2a0d` contrôlés `READY` ; ce dernier contient les formulaires remplaçant les dialogues natifs. Les essais échoués ou bloqués précédents ne constituent pas une preview validée.
- Navigateur CUA : cycle complet client/artisan/devis (150 € HT, 180 € TTC)/règlement simulé/avis réussi sur `999b355`. Mobile 360 × 800 sans débordement horizontal, menu fonctionnel ; création de contrat desktop 1440 px réussie. Sur `1db2a0d`, approbation via note intégrée, budget de 5 000 € à 5 500 € et réclamation de garantie fictive résolue par l’administrateur de démonstration ont réussi. La demande et le contrat persistent après rechargement puis retour en démonstration ; les références des dossiers sont distinctes.
- CI GitHub : contrôles réussis sur `e5d4577`, `999b355`, `706d380` et `1db2a0d` ; dernier run `41151552077` terminé avec succès (installation propre, types, 11 tests et build).
- Blocage initial de déploiement résolu par attribution des nouveaux commits à l’identité GitHub vérifiée ; aucune réécriture d’historique ni modification des protections Vercel.

## Dépendances bloquantes et limites
- Base Supabase dédiée : création refusée par le fournisseur pour factures en retard dans les organisations du compte. Aucun projet existant modifié. Aucune vraie persistance, confirmation email, Storage ou RLS distante déclarée vérifiée.
- Stripe : clés test/live, secret webhook et comptes Connect indisponibles dans ce projet ; scénario bancaire non exécuté.
- Restent notamment : matching géolocalisé/intelligent, notifications email/SMS/push, archivage automatique, abonnements commerciaux, diagnostic IA, suivi énergétique, rapports d'AG et conformité réglementaire. Ces capacités ne sont pas déclarées terminées.
- Conditions commerciales, garantie, fiscalité, zone de service, coordonnées et marque finale à renseigner avant ouverture à de vrais clients.

## Suite
1. Après résolution de la facturation Supabase, créer la base dédiée et appliquer uniquement à celle-ci les deux migrations versionnées.
2. Configurer les accès Stripe par les canaux de secrets, vérifier les comptes et permissions distants, puis exécuter le paiement de test complet et les reprises webhook.
3. Compléter les conditions commerciales et les fonctions encore non livrées avant toute ouverture à de vrais clients. Les preuves de démonstration ne valent pas une mise en exploitation commerciale.
