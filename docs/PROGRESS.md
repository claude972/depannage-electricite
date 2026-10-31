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


## Audit complet après les écarts signalés par le propriétaire

- Revue documentaire des cinq PDF disponibles : 71 pages, 66 occurrences de maquettes, 59 images distinctes. Sept images du volume 5 sont des doublons exacts, trois écrans sont nouveaux (fiche bureaux, dashboard bureaux, approbation syndic).
- Audit de tous les écrans et routes, du composant, du CSS, du backend, des migrations, RLS et fichiers de tests. Matrice consolidée de 74 points de couverture ; annexes par rôle et par capacité serveur.
- La référence Super Admin M43 et les vrais back-offices artisan/entreprise sont explicites dans les sources ; l’interface commune actuelle ne les couvre pas complètement.
- 38 domaines de spécification à préciser, 16 contradictions/variantes et dix précisions supplémentaires du volume 5 consignés. L’absence initiale de maquettes bureaux est résolue par le nouveau volume ; les numéros 19–32 restent non identifiés.
- Nouveaux risques/écarts statiques à traiter avant activation : cache professionnel à la déconnexion et garde des vues, retours Auth/Stripe ignorés, accès aux contacts après attribution, règles de payeur/départ de membre d’organisation, historiques bornés et finance incomplète. Ce sont des constats de code, pas des incidents distants démontrés.
- Contrôles fournisseur en lecture seule : aucune variable applicative Vercel et aucun projet Supabase dédié identifié. Le refus de création pour facturation reste le constat historique, sans nouvelle tentative pendant cet audit.
- Aucun nouveau test d’intégration ou paiement n’est prétendu. Les 11 tests et 13 groupes SQL décrits plus haut sont des preuves antérieures, pas une preuve que les manques inventoriés sont résolus.
- Documents de référence : `AUDIT_COMPLET_SPECIFICATIONS.md`, `SPECIFICATIONS_A_COMPLETER.md`, `PLAN_REPRISE.md` et les annexes `audit/`. Aucun code applicatif, service, secret ou déploiement modifié pendant cette revue.
