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

## ENT-16 / FIN-05 — lecture privée des factures existantes, claim Codex backend

Base bd5bdcc ; branche codex/customer-invoices, ownership lib/features/customer-invoices/**, GET app/api/invoices/**, migration lecture seule et tests. Réutiliser registre immuable platform_invoices et invoiceDocumentInput/renderInvoicePdf en lecture seule, sans émission/remboursement ou modification routes opérateur/RLS du registre. RPC étroites SECURITY DEFINER nécessaires car registre réservé finance : JWT auth.uid obligatoire, autorisation explicite sur identités IMMUTABLES issuer/recipient ; organisation uniquement destinataire société + can_access_site actuel sur le site du dossier dans cette organisation. Artisan émetteur historique conserve facture de prestation ; commission uniquement artisan destinataire, jamais client/organisation. Aucun accès attribué sur simple nouvelle affectation artisan ou nom/téléphone. Liste paginée/caps/count exact atomiques, filtres site/org/intervention/kind/basis et curseur liés à identité/filtres ; détail/PDF privés à version SHA256 de l’instantané, avoir parent cohérent et autorisé. Requête étrangère404, erreurs fournisseur503 ; aucun service client, aucun secret, pas de fausse facture/paid. Contrat DTO avant câblage Claude ; tests vrais handlers/PDF et SQL PGlite puis tsc et revue ROOT avant cloud/UI.

## ENT-15 — rapport financier exact, claim Codex backend

Base fe4f24c ; codex/professional-report. Corriger professional_report et GET /api/reports JSON/CSV, nouvelle migration/tests, aucune TVA/cloud/UI. Devis acceptés base+avenants par dossier sans produit cartésien ; encaissements depuis payments (method stripe/status paid/paid_at renseigné) et anciens reçus on_site_declared séparés, jamais depuis statut dossier. Paiement Stripe enregistré au serveur n’est pas un contrôle bancaire temps réel. Remboursements uniquement requêtes settled corroborées par écriture immutable refund_settled liée à événement/session/montant ; pas approved ni avoir considéré remboursement. Net=encaissements enregistrés moins remboursements, dépenses client et non revenu artisan/commission/versement. Reste engagé actif diminue des règlements bruts enregistrés sans réouvrir dette automatiquement après remboursement ; encaissement non prouvé signalé séparément/incomplete. Agrégat étroit sous auth.uid/can_access_site, nécessaire pour remboursements privés finance sans élargir RLS ; filtres org/site stricts/count exact et CSV même DTO. Contrat /tmp/depannage-professional-report-contract.json avant code ; tests handlers et SQL avenants/paiements/refunds/RLS puis tsc et revue ROOT.
