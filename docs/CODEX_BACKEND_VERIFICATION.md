# WEB-PWA-20261030 — Codex backend checkpoint 1

Branch: codex/web-pwa-backend. Base: 3c1ca2ce978f354556c0c691d4ac0d3088308b36. Mission distante et CORRECTIONS.md lus avant démarrage ; seule affectation Codex revendiquée. PWA réalisé séparément dans cf52bcdbc46f28348024b8dcf61925ba5d2005e3, inclus dans ce checkout ; aucun fichier frontend Claude modifié.

## Livré dans le code

- Migration additive 003, applicable seulement à la base dédiée : propriété B2B fondée sur appartenance actuelle, y compris documents et mutations avis/garantie ; accès privé des particuliers inchangé.
- Dossier artisan (société/SIRET de 14 chiffres déclaré, compétences/codes postaux exacts), soumission et disponibilité ; pièces personnelles liées avec catégorie/échéance, sans certification automatique.
- Offres anonymisées filtrées par approbation/disponibilité/zone/compétence et refus individuel ; même éligibilité contrôlée atomiquement lors de l’acceptation. L’ancienne commande est privée derrière le wrapper de contrôle.
- Projection minimale des contacts après attribution ; refus du devis actif exact sans annuler la mission ; créneau de rendez-vous, étape terrain et rapport structuré, avec historique de versions append-only.
- Réaffectation administrateur uniquement avant accord du devis ; anciens devis rejetés et ancien artisan privé d’accès au dossier. Pas de substitution à un artisan ayant refusé cette offre.
- Dashboard serveur admin : agrégats entiers et listes récentes explicitement limitées à 100 ; montant des prestations payé distingué du revenu net plateforme inconnu.
- Trois routes nouvelles /api/artisan, /api/interventions/[id]/operations et /api/admin/overview ; GET workspace additif organization_members/artisan_profile. Contrats exacts : WEB_PWA_CONTRACTS.md.
- CI isolée PostgreSQL avec PGlite 0.5.13 installé hors dépendances de production, étiquetée Auth/Storage stubs. Aucun nouveau package applicatif.

## Vérifications exécutées

- `npm ci` : installation réussie, zéro vulnérabilité signalée à cet instant.
- `npm run check` : TypeScript, 20 tests (11 domaine et 9 PWA) et build Next.js réussis.
- `PGLITE_MODULE=/tmp/depannage-web-pwa-sql/node_modules/@electric-sql/pglite/dist/index.js node tests/sql-review.mjs` : **19 groupes PASS**, exécution des trois migrations ; isolation, rôles, acceptation séquentielle unique, paiement idempotent, approbations, rapports, refus individuel, exactitude de version, créneau/acteur, rapport/historique, suspension, dispatch, révocation B2B/documents et zone/pièces personnelles.
- `git diff --check` : propre. Les exemples métier n’ont pas été importés comme données réelles.

Le test pgTAP de la base est adapté à l’éligibilité explicite ; il n’a pas été exécuté sur Supabase. Les tests PGlite utilisent explicitement des stubs Auth/Storage et ne constituent ni une preuve cloud, ni une preuve de concurrence réelle à deux sessions.

## Politique technique initiale et limites

- Modifier la société/zone/compétences remet le dossier en draft, annule son approbation et sa disponibilité ; nouvelle soumission/examen requis. Les artisans anciennement approuvés sans dossier configuré n’obtiennent plus une liste globale d’offres.
- Suspension : nouvelles écritures terrain bloquées, lecture des preuves conservée. Réactivation opérateur n’active pas automatiquement la disponibilité. Les montants restant dus ne sont pas annulés ; le règlement des missions suspendues reste à cadrer avant ouverture commerciale.
- Dossier B2B : retirer un membre supprime son ancien droit autonome de créateur ; sa propriété historique n’est pas effacée. Le payeur délégué n’est pas inventé : Checkout conserve sa règle existante.
- Le créneau est une proposition enregistrée, pas un moteur calendrier ni une notification externe. Étapes terrain sans GPS/ETA calculé. Nom saisi sur rapport = attestation déclarative, pas signature certifiée.
- Les documents liés ne sont pas automatiquement vérifiés, ni rendus obligatoires sans règle métier. La date d’échéance n’est pas un moteur complet de suspension ou renouvellement.
- Pas encore factures/avoirs, remboursements/litiges/payouts Stripe, invitations, droits par site, SLA automatisés, archives complètes, pagination globale ou automatisations V3. Les capacités false du dashboard ne sont pas des fonctions livrées.
- Aucune migration distante, aucun compte réel ni paiement test exécuté : base dédiée toujours indisponible selon le contrôle du pilote ; aucun projet existant utilisé. Aucun service, secret, déploiement production ou donnée distante modifié par cet agent.

## Revue croisée attendue

Claude : connecter les contrats exacts, ne pas assimiler rejet d’approbation au rejet devis, reprendre les statuts de candidature et disponibilité ; garder les listes bornées honnêtes et la performance réelle distincte de la démo. Codex pilote : revue des fonctions SECURITY DEFINER/EXECUTE, retrait B2B, wrapper legacy, conditions de reassign et JSON rapport ; preview combinée avec PWA, retours Auth/Stripe, gardes frontend et confidentialité offline. Aucun statut done avant revue croisée et contrôles d’intégration applicables.

## Checkpoint 2 — tentatives et échecs Checkout

- Migration004 et handlers pour expired/async_payment_failed : référence session/devis/montant/devise contrôlée, signature brute préservée, traitement service-only idempotent. Aucun événement tardif ne rétrograde un paiement réglé ou la tentative courante remplacée. Deux succès distincts pour la même session ne dupliquent plus l’effet métier/audit.
- payment_attempts conserve les tentatives sous RLS ; GET /api/payments/status renvoie l’état et 50 tentatives maximum, avec indicateur de troncature, sans URL Checkout ni carte.
- Reprise : session ouverte réutilisée ; remplacement uniquement après lecture Stripe confirmant expired ; écriture conditionnelle et garde SQL empêchent de remplacer paid. Session complète non payée reste en attente ou en échec nécessitant contrôle, sans nouvelle charge automatique.
- Documentation officielle relue : https://docs.stripe.com/api/events/types et https://docs.stripe.com/api/checkout/sessions/object ; types Stripe 23.1.0 locaux cjs/resources/Events.d.ts et Checkout/Sessions.d.ts.
- Vérifié : npm run check réussi (23 tests, TypeScript, build) ; 21 groupes SQL isolés passent, dont échec/rejeu, mismatch rollback, événement ancien après nouvelle tentative, succès doublé, paiement payé non rétrogradable, historique et refus tiers.
- Pas de remboursement/litige/payout/fiscalité ajouté ni de Stripe distant testé. Les succès tardifs d’une ancienne session remplacée restent refusés pour référence différente et nécessitent rapprochement opérateur ; ils ne sont jamais affectés silencieusement à une nouvelle tentative.
