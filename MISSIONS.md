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

## ENT-08 / ENT-05 — étages/zones/parties communes, claim Codex backend

Base 4e2ce34 ; branche codex/site-areas, ownership lib/features/site-areas/**, app/api/sites/[id]/areas/route.ts, nouvelle migration/tests. Hiérarchie indépendante, aucun remap équipements/dossiers. Type floor|zone|common_area ; label est le nom affiché, référence interne facultative et notes bornées. Label actif unique sans casse parmi frères (tous types), référence non vide unique sans casse dans le site ; conflits409 explicites. Parent facultatif même site actif, aucune boucle, profondeur1..4 et déplacement vérifiant tout sous-arbre ; archive parent refusée tant qu’enfant actif. Quota1000 actifs/site sous verrou org/site, droits actuels manage-site revalidés, versions optimistes+command UUID durable/audit SHA256/rejeu exact. Lecture RLS can_access_site, page100 UUID/count exact et profondeur calculée côté serveur ; listes incomplètes signalées, aucun arbre exhaustif déduit d’une page. Aucun RESTwrite/servicewrite, API archive sansDELETE, aucune règle ERP/quorum/certification inventée. Contrat DTO avant câblage, tests handlers/SQL réellement exécuté PGlite (Auth/Storage/cron simulés), tsc puis contre-revue ROOT ; pas cloud/UI/credentials.
