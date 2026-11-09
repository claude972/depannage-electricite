# Phase 2 · Correctifs lot B (interface) — ledger Claude Code

Base exacte `93e5a5dcf76caa528c121248a1c22f52433fb84e`, branche `fix/phase2-lot-B-claude-code`, worktree fourni par Codex (`phase3-lot-b-baseline-ready.md`). Registre source : `phase2-registre-consolide-provisoire.md` (non versionné, lecture seule). Lot A (serveur) et intégration : Codex.

Périmètre d’édition B : `components/**`, tests `tests/ui/phase2-lot-b-*`, ce ledger. Interdits : `lib/`, `app/api/`, `public/`, `supabase/`, autres ledgers, secrets, identifiants réels, appels réels Stripe/Vonage/Resend/pg_net, comptes hébergés.

Ordre imposé : aucun changement applicatif B avant `phase3-bloquants-livres.md` (signal Codex). Avant ce signal : ledger, classement, tests rouges, contrats.

États employés : `À REPRODUIRE` (classé B, pas encore exécuté), `ROUGE` (reproduit par test monté, non corrigé), `CORRIGÉ` (rouge→vert sur la branche, commit indiqué), `NON REPRODUIT` (jamais compté corrigé), `REVERTÉ`, `BLOQUÉ` (environnement/accès), `CONTRAT A` (cause côté serveur, attendu consigné), `DÉCISION` (fiche de décision, pas de code), `HORS LOT B`.

## Inventaire complet du registre et affectation

Colonnes : ID · gravité · lot · état · mécanisme · commit · test · fichiers · note.

| ID | Gravité | Lot | État | Mécanisme | Commit | Test | Fichiers | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E01 | Bloquant | A | HORS LOT B | audit target_kind SQL | Codex | — | supabase | rouge→vert chez Codex (signal utilisateur) |
| E28 | Bloquant | A | HORS LOT B | Zod version ≥0 | Codex | — | lib, app/api | en cours chez Codex |
| E73 | Bloquant | A | HORS LOT B | regex PostgreSQL | Codex | — | supabase | en cours chez Codex |
| E74 | Bloquant | A | HORS LOT B | corps pg_net vide | Codex | — | supabase, lib | en cours chez Codex |
| E02 | Majeur | B | À REPRODUIRE | état photo par fil | | | components/app/forms.tsx | isolé |
| E04 | Majeur | B | À REPRODUIRE | égalité profonde sessionStorage (P7) | | | components/features/payment-reminders | |
| E07 | Majeur | A | CONTRAT A | verrou site archivé SQL | | | supabase, app/api | UI déjà lecture seule |
| E08 | Majeur | B | CORRIGÉ | 409 ⇒ relecture dans le formulaire (P1/P2) | e739cb1 | phase2-lot-b-e08-budget-conflict | budget-panel.tsx (+ relecture c91f30d) | rouge : note v1 renvoyée, note concurrente écrasée ; vert : note v2 rechargée, montant conservé, conflit, renvoi v2 |
| E11 | Majeur | B | À REPRODUIRE | option active périmée après saisie | | | components/app/address-field.tsx | |
| E15 | Majeur | B + A | CORRIGÉ (dépend de A 258f44e) | expected_version du créneau (P2) | c1b5ddf | phase2-lot-b-e15-appointment-version | types.ts, client-space.tsx, artisan-space.tsx, enterprise-space.tsx | rouge : expected_version absent (client et artisan) ; vert : version lue (0 en création), refus ⇒ relecture 13 h, saisie conservée, conflit signalé, renvoi v2 |
| E16 | Majeur | B | À REPRODUIRE | Actualiser recharge opérations + rappel (P1/P6) | | | role/client-space.tsx, appointment-reminders | |
| E17 | Majeur | B | À REPRODUIRE | réponse GET ancienne après arrêt | | | features/tracking/tracking-card.tsx | |
| E20 | Majeur | B | À REPRODUIRE | 404 → relire/purger (P1) | | | advanced-approvals | |
| E21 | Majeur | A (schéma partagé) | VÉRIFIÉ À L’INTÉGRATION, aucun code B | faits constatés non futurs (P4) | — | contrôle privé `phase3-lot-b-private/e21-e24-with-a-schema.mts` | — | les formulaires B importent `slaCasePayload` : B seul 1 commande envoyée (rouge), avec le schéma A 0 commande et message immédiat. Non compté comme correctif B |
| E24 | Majeur | A (schéma partagé) | VÉRIFIÉ À L’INTÉGRATION, aucun code B | levée ≥ contrôle, non future (P4) | — | même contrôle privé | — | `erpChecklistPayload` partagé : B seul 1 commande (rouge), avec A 0 commande et message immédiat. Non compté comme correctif B |
| E25 | Majeur | A | CONTRAT A | date d’effet des grilles (P4) | | | supabase | côté B : affichage si contrat change |
| E26 | Majeur | B | CORRIGÉ | 403 ⇒ relecture du rapport (P1) | c91f30d | phase2-lot-b-e06-e22-e26-e27-site-operations | site-operations-view.tsx | rouge : 0 GET, tarifs/note/Publier conservés ; vert : relecture, retirés, 1 POST |
| E29 | Majeur | B + A | CORRIGÉ (dépend de A 2b3b44e) | updated_at exact en version (P2) | 47f3fdc | phase2-lot-b-e29-warranty-version | types.ts, forms.tsx | rouge : expected_version absent ; vert : chaîne exacte envoyée, 409 ⇒ relecture, décision de A affichée, brouillon de B conservé |
| E30 | Majeur | B | CORRIGÉ | 403 ⇒ relire /me + liste, lecture refusée purge (P1) | 747a94f | phase2-lot-b-e30-e31-operators | platform-operations/shared.tsx, platform-operators-view.tsx | rouge : 0 GET /me après 403 ; vert : relecture, nom/note/boutons purgés, 1 POST |
| E32 | Majeur | B | À REPRODUIRE | vue journal audit_read | | | anchors.ts, features.ts, platform-anchor.tsx | |
| E34 | Majeur | B + A | CORRIGÉ (dépend de A e17c0e5) | approbation ≠ réactivation + version (P2) | 43ee0b9 | phase2-lot-b-e34-e35-e36-artisan-decisions | forms.tsx | rouge : corps {approved:true} ; vert : action approve + version 1 ⇒ 409, Suspendu relu |
| E35 | Majeur | B | CORRIGÉ | action « Demander des corrections » | 43ee0b9 | phase2-lot-b-e34-e35-e36-artisan-decisions | forms.tsx | rouge : seule action « Approuver » ; vert : request_changes envoyé, statut changes_requested |
| E37 | Majeur | A | HORS LOT B (validé par A) | prédicat d’offre et congés | Codex | — | supabase | validé côté A selon Codex |
| E38 | Majeur | B | CORRIGÉ | 403/404 → relire/purger (P1) | bd77186 | phase2-lot-b-e38-credential-review-revoked | credential-reviews-model.ts | rouge : 0 GET après 403 ; vert : 1 POST, relecture, purge motifs et formulaire |
| E39 | Majeur | B | À REPRODUIRE | 401 → purge fil (P1) | | | message-history.ts, forms.tsx | |
| E40 | Majeur | B | À REPRODUIRE | relire contact à la réouverture (P1) | | | forms.tsx ConversationContact | |
| E42 | Majeur | B | À REPRODUIRE | workspace sans dossier → purge fil (P1) | | | artisan-space.tsx, forms.tsx | |
| E44 | Majeur | B | CORRIGÉ | 404 pagination → purge (P1) | ca0f8a3 | phase2-lot-b-e44-e45-invoices-pagination | invoices-model.ts, customer-invoices-panel.tsx | rouge : 25 lignes et PDF après 404 ; vert : purge + refus |
| E48 | Majeur | B | CORRIGÉ | 403 pagination → purge (P1) | d5b1a3b | phase2-lot-b-e48-e49-saved-methods-pagination | saved-payment-methods/model.ts | rouge : 20 cartes après 403 ; vert : purge immédiate, 0 POST |
| E50 | Majeur | B | CORRIGÉ | 403 → relire droit (P1) | aa2f826 | phase2-lot-b-e50-refund-revoked | refund-execution-model.ts | rouge : 0 GET après 403, « Émettre » actif ; vert : 1 POST, relecture, action retirée |
| E51 | Majeur | B | À REPRODUIRE | GET de rattrapage à reconnexion (P6) | | | courant-app.tsx | |
| E52 | Majeur | B | CORRIGÉ | 404 → relire/purger liste (P1) | f273048 | phase2-lot-b-e52-site-attachments-revoked | site-attachments-panel.tsx | rouge : 0 GET liste après 404 ; vert : relecture, purge, 1 signature |
| E54 | Majeur | B | CORRIGÉ | 503 de commande ne masque pas le centre | 48a79ff | phase2-lot-b-e54-e55-e56-notifications | features.ts, notification-center.tsx | rouge : centre et saisie disparus ; vert : centre, formulaire et case décochée conservés, erreur en ligne |
| E56 | Majeur | B | CORRIGÉ | 401 en pagination ⇒ purge (P1) | 48a79ff | phase2-lot-b-e54-e55-e56-notifications | notification-center.tsx | rouge : 25 lignes conservées ; vert : purge, plus de bouton |
| E59 | Majeur | Décision | DÉCISION | photos avant/après | — | — | — | fiche ci-dessous |
| E60 | Majeur | Décision | DÉCISION | accusé de remise client | — | — | — | fiche ci-dessous |
| E61 | Majeur | A | CONTRAT A | rapport > 1 000 sites | | | app/api/reports | |
| E63 | Majeur | B | CORRIGÉ | 404 → relire/purger (P1) | fcf1abd | phase2-lot-b-e62-e63-energy | energy-model.ts | rouge : 0 GET après 404 ; vert : 1 POST, relecture, purge |
| E64 | Majeur | B | CORRIGÉ | 403 → relire/purger (P1) | 3698ea6 | phase2-lot-b-e64-coownership-revoked | coownership-model.ts | rouge : 0 GET après 403 ; vert : relecture, purge |
| E67 | Majeur | Décision | DÉCISION | justificatif de levée | — | — | — | fiche ci-dessous |
| E70 | Majeur | A | HORS LOT B (partiel A) | erreur Connect | Codex | — | app/api/payments | partiel côté A, configuration externe |
| E72 | Majeur | A + B | CORRIGÉ côté B (A : feeConnectedReference) | ch_ ou py_ pour la charge connectée | 976e6e3 | phase2-lot-b-e72-fee-connected-reference | finance-proofs/model.ts | rouge : preuve py_ illisible ; vert : py_/ch_ acceptés, charge plateforme ch_ seule, autres préfixes et liaisons refusés. Copie locale de la regex A à remplacer par l’import après intégration |
| E75 | Majeur | A + Décision | DÉCISION | capacité artisan, null = illimité | — | — | — | aucun plafond choisi |
| E76 | Majeur | A | CONTRAT A | plafond global rappel | | | lib, supabase | |
| E78 | Majeur | A | CONTRAT A | reprise remboursement | | | supabase, lib | |
| E80 | Majeur | A + B | CORRIGÉ côté B (dépend du SHA backend A à venir) | état du litige artisan | ec7d6f1 | phase2-lot-b-e80-artisan-dispute | types.ts, artisan-space.tsx | contrat annoncé : `artisan_dispute` optionnel (none/open/under_review/resolved/closed) sur GET /api/payments/status ; rouge : aucune lecture ni mention ; vert : litige affiché à côté de « Réglé » inchangé ; absent/none/inconnu ⇒ rien. SHA A à consigner à l’intégration |
| E03 | Mineur | B | CORRIGÉ | 409 ⇒ relecture en place, motif conservé (P1) | 4800320 | phase2-lot-b-e03-moderation-conflict | platform-operations/shared.tsx, platform-moderation-view.tsx | rouge : renvoi version 1 ; vert : relecture, renvoi version 2 |
| E05 | Mineur | B | À REPRODUIRE | validation locale effectif ≤ 100000 | | | role/artisan-space.tsx | |
| E06 | Mineur | B | CORRIGÉ | formulaire ouvert sans droit ⇒ aucun POST (P1) | c91f30d | phase2-lot-b-e06-e22-e26-e27-site-operations | site-operations/shared.tsx | rouge : 1 POST après passage en lecture seule ; vert : 0 POST, message lecture seule. Mécanisme partagé useSubmit (équipement/maintenance/délais) |
| E09 | Mineur | B | À REPRODUIRE | nom de secours « document » | | | components/app/uploads.ts | |
| E10 | Mineur | B | À REPRODUIRE | rejeu réussi → édition (P3) | | | site-areas-panel.tsx | |
| E12 | Mineur | B | CORRIGÉ | 409 ⇒ relecture dans le formulaire (P1/P2) | b238a1c | phase2-lot-b-e12-address-conflict | client-addresses-panel.tsx | rouge : ville v1 et version 1 renvoyées ; vert : ville v2 rechargée, libellé conservé, renvoi v2 |
| E13 | Mineur | B | À REPRODUIRE | devis expiré : bouton inactif | | | client-space.tsx, quote-documents-panel.tsx | |
| E14 | Mineur | B | CORRIGÉ | refus d’acceptation ⇒ relecture ponctuelle (P1) | e8bfd00 | phase2-lot-b-e14-lost-offer | available-missions-model.ts | rouge : 0 relecture, bouton actif ; vert : 1 POST, relecture 404, offre retirée |
| E18 | Mineur | A + B | CORRIGÉ (dépend de A 7de6d11) | command_id du rapport (P3) | 4049d5d | phase2-lot-b-e18-report-command-id | types.ts, artisan-space.tsx | rouge : aucune clé ; vert : même clé et saisie après réponse perdue, nouvelle clé après succès |
| E19 | Mineur | A | CONTRAT A | nom vide accepté par la route | | | app/api | formulaire déjà conforme |
| E22 | Mineur | B | CORRIGÉ | verrou synchrone useSubmit (P5) | c91f30d | phase2-lot-b-e06-e22-e26-e27-site-operations | site-operations/shared.tsx, site-operations-view.tsx | rouge : 2 POST dans la même boucle ; vert : 1 POST |
| E23 | Mineur | A | HORS LOT B (validé par A) | classement SLA | Codex | — | lib | validé côté A selon Codex |
| E27 | Mineur | B | CORRIGÉ | 409 ⇒ relecture de la grille (P1) | c91f30d | phase2-lot-b-e06-e22-e26-e27-site-operations | site-operations-view.tsx | rouge : 0 GET, « Brouillon » conservé ; vert : relecture, Publiée, bouton retiré |
| E31 | Mineur | B | CORRIGÉ | `account_role` lu | 747a94f | phase2-lot-b-e30-e31-operators | platform-operators-view.tsx | rouge : aucun lien ; vert : lien fiche client |
| E33 | Mineur | A | CONTRAT A | normalisation NFC annuaire | | | app/api, supabase | |
| E36 | Mineur | A + B | CORRIGÉ (dépend de A 523878c) | command_id stable par intention (P3) | 43ee0b9 | phase2-lot-b-e34-e35-e36-artisan-decisions | forms.tsx | rouge : aucune clé ; vert : même command_id jusqu’à confirmation, écran relu |
| E41 | Mineur | A + B | CORRIGÉ (dépend de A 0127c6d) | command_id du message texte (P3) | 03936b5 | phase2-lot-b-e41-message-command-id | forms.tsx, session-types.ts, courant-app.tsx, client/artisan-space | rouge : aucune clé ; vert : même clé au renvoi, nouvelle clé au message suivant |
| E43 | Mineur | B | À REPRODUIRE | publication propre prise pour « autre canal » (P3) | | | artisan-quote-draft.tsx | |
| E45 | Mineur | B | CORRIGÉ | erreur de page suivante expliquée | ca0f8a3 | phase2-lot-b-e44-e45-invoices-pagination | invoices-model.ts, customer-invoices-panel.tsx | rouge : 503 silencieux ; vert : alerte, reprise 26 pièces, alerte retirée |
| E46 | Mineur | B | À REPRODUIRE | avis effacé par la navigation | | | courant-app.tsx | |
| E47 | Mineur | B | À REPRODUIRE | vérification de retour après SIGNED_IN | | | courant-app.tsx | |
| E49 | Mineur | B | CORRIGÉ | alerte de pagination retirée | d5b1a3b | phase2-lot-b-e48-e49-saved-methods-pagination | saved-payment-methods/model.ts | rouge : alerte conservée ; vert : retirée après la 21e carte |
| E53 | Mineur | A + B | CORRIGÉ (dépend de A b414386) | command_id du dépôt de site (P3) | fc06c26 | phase2-lot-b-e53-site-upload-command-id | site-attachments-panel.tsx | rouge : command_id absent ; vert : même clé au renvoi, un seul document |
| E55 | Mineur | B | CORRIGÉ | lecture confirmée ⇒ résumé de cloche relu (P1/P6) | 48a79ff | phase2-lot-b-e54-e55-e56-notifications | notification-center.tsx, notifications-anchor.tsx | rouge : 0 GET résumé ; vert : résumé relu |
| E57 | Mineur | B | À REPRODUIRE | confirmation perdue au remount (P3) | | | site-lifecycle | |
| E58 | Mineur | B | À REPRODUIRE | profil public relu en navigation (P6) | | | public-operator-profile, public-site | |
| E62 | Mineur | B | CORRIGÉ | rejeu réussi → édition (P3) | fcf1abd | phase2-lot-b-e62-e63-energy | site-energy-panel.tsx | rouge : formulaire en création, expected_version null ; vert : édition v1 |
| E65 | Mineur | B | À REPRODUIRE | présélection Artisan | | | public-site.tsx, forms.tsx | |
| E66 | Mineur | B | À REPRODUIRE | détail hors cache sans GET | | | use-detail-presence.ts, enterprise-space | |
| E68 | Mineur | A | HORS LOT B (partiel A) | public/offline-request.js | Codex | — | public/ | partiel côté A jusqu’au changement de cache hors périmètre |
| E69 | Mineur | A | CONTRAT A | session_not_found → 401 | | | app/api/profile/sessions | |
| E71 | Mineur | B | À REPRODUIRE | opted_in=true + browser=none = retrait (P7) | | | web-push-panel.tsx | |
| E77 | Mineur | A | CONTRAT A | délai annoncé par numéro | | | lib, supabase | UI affiche la valeur serveur |
| E79 | Mineur | B | À REPRODUIRE | panne ≠ politique absente | | | public-operator-profile, public-site | |
| E81 | Mineur | B | CORRIGÉ | total accepté avec avenants + montant réglé | 10c6008 | phase2-lot-b-e81-artisan-paid-amount | artisan-space.tsx | rouge : seul « 60,00 € » ; vert : 90,00 € accepté et réglé, déclarations historiques non présentées comme confirmées |
| H01 | Env. | — | HORS LOT B | preview Vercel/Supabase | — | — | — | hors mission |

Sous-cas externes avec condition ouverte (PUB-10.1, CLI-05.2, CLI-08.1, ADM-01.1, FIN-06.1, SYS-08.2) : hors mission B.

## Synthèse par état

Mise à jour à chaque commit d’item.

- CORRIGÉ (34 IDs, rouge→vert sur tests ciblés, suite globale non qualifiée verte) : E03, E06, E08, E12, E14, E15, E18, E22, E26, E27, E29, E30, E31, E34, E35, E36, E38, E41, E44, E45, E48, E49, E50, E52, E53, E54, E55, E56, E62, E63, E64, E72, E80, E81. E15/E18/E29/E34/E36/E41/E53/E72/E80 exigent les contrats A à l’intégration (E80 : SHA backend à venir).
- VÉRIFIÉ À L’INTÉGRATION sans code B : E21, E24.
- ROUGE : aucun.
- À REPRODUIRE : voir tableau.
- NON REPRODUIT : aucun.
- REVERTÉ : aucun.

## Attendu de l’autre lot (A)

Contrats requis côté serveur, sans duplication en B.

- E15 · LIVRÉ PAR A (signal) : `save_appointment` exige `expected_version` entier = `appointment.reminder_version` lu (0 sans créneau) ; ancien RPC sans version refusé. B : envoyer dans les éditeurs client et artisan, recharger et conserver la saisie sur 409. Origine : `app/api/interventions/[id]/operations/route.ts:7,47` et `supabase/migrations/202610310003_web_operations.sql:189–198` : la commande de rendez-vous doit accepter `expected_version` (version du rendez-vous lue) et répondre 409 en cas d’écart. B enverra la version lue dès que le schéma l’accepte ; aujourd’hui un champ inconnu serait refusé.
- E29 · LIVRÉ PAR A (signal) : `POST /api/warranty` action `resolve` exige `expected_version` = `case.updated_at` ISO exacte telle que lue (chaîne conservée, microsecondes comprises) ; 409 ⇒ relire, brouillon conservé en conflit.
- E34 · LIVRÉ PAR A (e17c0e5) puis E36 (523878c) : `{ user_id, command_id, action approve|request_changes|suspend|reinstate, expected_version = application_version }` ; câblé en B (43ee0b9). Origine : `app/api/admin/artisans/route.ts:4,36–42`, `202610310008_suspension_governance.sql:38–66` : distinguer `approve` (depuis `submitted`/`changes_requested`) et `reactivate` (depuis `suspended`), avec état attendu ; une approbation depuis `suspended` doit répondre 409.
- E36 · même route : `command_id` d’intention stable et rejeu sans second audit.
- E18 · `app/api/interventions/[id]/operations/route.ts:10,49` : `command_id` pour l’enregistrement du rapport et rejeu idempotent sans second instantané.
- E41 · `app/api/messages/route.ts:24–38` : `id` client stable pour l’envoi texte (même contrat que `/api/messages/photo`).
- E53 · `app/api/sites/[id]/documents/route.ts:163–186` : clé d’idempotence de dépôt.
- E21/E24 · validation serveur des faits constatés (non futurs, ordre chronologique) et de la date de levée (≥ date du contrôle, non future). B ajoute la même validation à la saisie.
- E80 · CONTRAT ANNONCÉ PAR A (SHA à venir) : `artisan_dispute` optionnel = none|open|under_review|resolved|closed sur GET /api/payments/status, seulement pour l’artisan affecté auteur du devis accepté, indépendant de payment.status, aucun détail finance. Câblé en B (ec7d6f1).
- E61 · CONTRAT ANNONCÉ PAR A : GET /api/reports `after=<UUID>`, pages de 1000 sites triées par site_id, `page {limit:1000,has_more,next_after}` optionnel, `scope.complete=false` sur page d’un périmètre découpé ; CSV complet sans after. Câblage B en cours.
- E19, E23, E25, E33, E37, E61, E69, E76, E77, E78, E07 : cause entièrement serveur (voir registre).

## Fiches de décision

### E59 · photos avant/après du compte rendu
- Options : (a) phase `before|after` sur les pièces liées au rapport et à sa version ; (b) pièces génériques du dossier sans phase (état actuel) ; (c) reporter ART-09 photos.
- Impact : (a) migration, route et éditeur ; preuve client lisible. (b) aucune preuve rattachée au rapport.
- Recommandation : (a), décision propriétaire requise sur nombre/format/obligation. Aucun champ ajouté par B sans contrat serveur.

### E60 · accusé de remise client
- Options : (a) accusé client horodaté lié à une version de rapport, action du client authentifié ; (b) nom déclaré par l’artisan (actuel) ; (c) signature avancée.
- Impact : (a) commande client + projection ; (c) fournisseur de signature.
- Recommandation : (a), niveau de signature et caractère obligatoire à fixer (`docs/SPECIFICATIONS_A_COMPLETER.md`).

### E67 · justificatif de levée de réserve ERP
- Options : (a) référence document ↔ réserve/version ; (b) pièce de site générique (actuel) ; (c) champ texte de référence.
- Recommandation : (a), format et obligation à préciser.

### E75 · capacité artisan
- Aucun plafond choisi. `null` = illimité, coordonné avec A ; pas de réglage UI inventé.

## Prérequis externes

H01 (preview hébergée), E70/E72 (Stripe Connect), sous-cas mobiles/SMS/versement : hors mission B.

## Échecs préexistants (baseline Codex `phase3-baseline-check.log`)

2141 tests, 2127 pass, 12 fail, 2 skipped, sur 93e5a5d avant toute modification B :
1. document signing uses the authenticated metadata…
2. Chromium : téléchargement complet paginé… (collecte données client)
3. URLs exactes : section explicite…
4. téléchargement : toutes les sections…
5. changement d’identité pendant la collecte…
6. erreur 503 + Retry-After sur une page…
7–9. fiche de site réelle à 360 / 390 / 1280 px…
10. fiche de site directe (Chromium, SiteSheet réelle hors cache)…
11. site archivé ouvert directement…
12. montages : profil client après les moyens de paiement…

Ces échecs ne sont ni affaiblis ni supprimés par B.

## Journal

- Prise en charge : ledger créé avant tout code, sur la branche B.
- Harnais `tests/ui/phase2-lot-b-harness.ts` : esbuild + vrais composants + vrai CSS, Chromium headless (chemins QA_*), API simulée en page, aucune requête `/api/`.
- Reproductions rouges : E38, E44, E45, E48, E49, E50, E52, E62, E63, E64 (assertion rouge citée dans chaque commit).
- Signal `phase3-bloquants-livres.md` reçu (A sur 6f2d89c), corrections B ensuite, une par ID ou mécanisme.
- Checkpoint A : les 12 mêmes échecs préexistants sur HEAD, deux builds OK. La suite globale n’est pas qualifiée verte.
- Contrats A E15 et E29 publiés dans le signal (voir Attendu de l’autre lot).
- Règles P1 communes livrées (961e24d) : `components/app/refusal.ts` (401 purge immédiate, 403/404 relecture avant tout POST, refus de lecture = purge, 409 conflit, invalide, transitoire) ; chaque panneau fournit seulement son adaptateur de relecture. Test `phase2-lot-b-refusal-rules`.
- Test existant modifié (P1 exigé) : `tests/ui/erp-command-transient.test.ts`, l’assertion 401/403 interdisait toute relecture ; remplacée par « exactement une relecture des droits », classification et formulaire inchangés.
- Test existant modifié (contrat changé par A, pas d’affaiblissement) : `tests/ui/artisan-admin-status.test.ts`, deux assertions figeaient `{ user_id, approved }` et une seule action pour « soumis ». Remplacées par le nouveau corps exact et les deux actions (E35), même rigueur.
