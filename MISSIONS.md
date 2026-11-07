# Fastsplit — finition intégrale de l’application

Base reprise : 6c02157 sur integration/web-pwa. Objectif propriétaire : application complète et utilisable ; seules liaisons Stripe et SMS différées. Aucun cron, production, main, stores, achat, promotion d’un compte non identifié ou donnée fictive présentée comme réelle. Conserver WIP et preuves historiques.

## Répartition immédiate

- ROOT Codex : coordination, contre-revue, intégration, tests bout en bout, preview GitSource et bilan honnête. Seul opérateur cloud. Inventaire des 76 capacités actualisé depuis le code ; aucun statut ancien hérité sans preuve.
- Codex backend (un seul worker, deux Codex ROOT inclus) : parcours paiement uniquement plateforme ; owns lib/features/guest/payment-options.ts, bookings.ts, onsite-settlement.ts, app/api/bookings/settlement/onsite/route.ts, migration nouvelle sous supabase/migrations, tests ciblés dédiés. Pas components, pas mutation cloud, pas credentials. Fermer aussi la RPC de déclaration directe, préserver l’historique et l’idempotence des réservations. Contrat HTTP court livré avant branche frontend consommatrice, tests réels des fonctions et refus intercomptes.
- Claude lead réutilisé b4b555f0-67e3-4f63-9671-fc3c14f9e67c : UI/design/frontend, ownership components/** (sauf components/app/types.ts si non nécessaire), app/globals.css/layout.tsx si nécessaire, tests UI associés. Première tranche livrable : thème B sans nom de marque, choix paiement plateforme uniquement, suppression action de déclaration directe, conserver devis et paiements antérieurs honnêtes. Une seule branche writer ; worker existants réutilisables avec fichiers disjoints, pas duplication de lead ni toucher sessions CRM. Pas backend/API/migration ni cloud. Lire fastsplit, AGENTS, DESIGN courants et preuves récentes.

## Suite, sans exclusion de modules

Parcours client complet ; artisan complet ; organisation et verticales B2B ; administration/support/finance ; documents/notifications/permissions ; options avancées du catalogue, puis mobile/web cohérents. Chaque capacité a sa fiche de preuve ou reste ouverte ; pas de faux « terminé ». Aucun compte admin substitut : identité propriétaire toujours à confirmer avant activation réelle.

## Vérification par tranche

Nominal et erreurs principales, loading/error/empty, thème clair/sombre, mobile/desktop, formulaires et reprises sans doublon, droits serveur/RLS sur données privées. Commit/push cohérent ; preview en ligne vérifiée. Paiement/OTP injectés explicitement en test, jamais exposés comme mode de production ni comme succès bancaire réel.

## ENT-09 — suivi énergie, ROOT Codex auteur

Module indépendant à implémenter : consommations réelles saisies par période et compteur/source, aucune mesure inventée et aucun fournisseur énergétique requis. ROOT seul lib/features/energy/**, app/api/sites/[id]/energy/route.ts, nouvelle migration site_energy_periods et tests associés. RLS lecture site / écriture manage-site, sources et unités explicites, dates valides, versions optimistes, rejeu sans doublon, archivage au lieu de suppression, journal des modifications ; aucune dépendance aux fichiers paiement du worker. API sous JWT du demandeur, pas de service key. Frontend à confier à Claude après contrat backend stable. Contre-revue backend indépendante avant merge/cloud.

## ADM-07 — réponse administrateur auditée, ROOT Codex auteur

Ajouter POST /api/admin/messages avec UUID de message stable, intervention et texte ; RPC étroite admin_send_message sous JWT, vérification admin actuelle, verrou du dossier, rejet interrôle, rejeu exact même acteur/dossier/texte, audit sans copie du contenu. Pas de droit d’écriture REST ni élargissement des lecteurs. Vérifier nominal/refus/rejeu/conflit/erreurs serveur et SQL isolé avant câblage Claude ; ROOT seul cloud.

## ADM-04 — dossiers d’un client, ROOT Codex auteur

Compléter le filtre serveur client_id de l’annuaire interventions administrateur ; UUID strict, empreinte curseur incluant le client, comptage et pagination existants conservés, aucune projection privée ajoutée ni droits élargis. Le point de lecture profil existe déjà via /api/admin/directory?kind=clients&id=UUID. Claude raccorde la fiche client à ces deux routes après tests.

## CLI-09 — adresses enregistrées, claim Codex backend

Base 21cd76d ; branche codex/client-addresses, worker unique. Propriété lib/features/client-addresses/**, app/api/profile/addresses/route.ts, migration nouvelle/tests dédiés. Liste privée sous JWT et RLS user_id=auth.uid(), count exact et plafond SQL 50 adresses actives ; aucune prétendue exhaustivité sur réponse tronquée. Nom/prénom contact, libellé et adresse complète/code postal/ville/pays saisis ; géopoint facultatif paire latitude/longitude et provenance explicite, aucune coordonnée inférée. Préférée unique/user avec conflit409 explicite ; versions optimistes, command UUID durable, rejeu exact sous droits actuels, archive et audit sans PII recopiée. Verrou du profil pour sérialiser quota/préférence ; pas de modification du profil/auth, invitation, fournisseur, cloud ou UI. HTTP nominal/refus/rejeu/erreurs, SQL réel PGlite (Auth/Storage/cron simulés), tsc strict puis revue ROOT.
