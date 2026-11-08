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
| E08 | Majeur | B | À REPRODUIRE | 409 → recharger le formulaire (P1/P2) | | | site-operations/budget-panel.tsx | |
| E11 | Majeur | B | À REPRODUIRE | option active périmée après saisie | | | components/app/address-field.tsx | |
| E15 | Majeur | B + A | À REPRODUIRE | expected_version du créneau (P2) | | | role/client-space.tsx | route sans version : contrat A |
| E16 | Majeur | B | À REPRODUIRE | Actualiser recharge opérations + rappel (P1/P6) | | | role/client-space.tsx, appointment-reminders | |
| E17 | Majeur | B | À REPRODUIRE | réponse GET ancienne après arrêt | | | features/tracking/tracking-card.tsx | |
| E20 | Majeur | B | À REPRODUIRE | 404 → relire/purger (P1) | | | advanced-approvals | |
| E21 | Majeur | B + A | À REPRODUIRE | faits constatés futurs/ordre (P4) | | | site-operations/sla-panel.tsx | validation serveur : contrat A |
| E24 | Majeur | B + A | À REPRODUIRE | levée antérieure/future (P4) | | | site-operations/erp-panel.tsx | contrat A |
| E25 | Majeur | A | CONTRAT A | date d’effet des grilles (P4) | | | supabase | côté B : affichage si contrat change |
| E26 | Majeur | B | À REPRODUIRE | 403 → relire/purger (P1) | | | site-operations-view.tsx, grids-panel.tsx | |
| E29 | Majeur | B + A | À REPRODUIRE | version attendue garantie (P2) | | | components/app/forms.tsx | route sans version : contrat A |
| E30 | Majeur | B | À REPRODUIRE | 403 → relire /me + purger (P1) | | | platform-operators-view.tsx | |
| E32 | Majeur | B | À REPRODUIRE | vue journal audit_read | | | anchors.ts, features.ts, platform-anchor.tsx | |
| E34 | Majeur | B + A | À REPRODUIRE | approbation ≠ réactivation (P2) | | | components/app/forms.tsx | contrat A |
| E35 | Majeur | B | À REPRODUIRE | action « demander des corrections » | | | components/app/forms.tsx | POST approved:false existant |
| E37 | Majeur | A | CONTRAT A | prédicat d’offre et congés | | | supabase | |
| E38 | Majeur | B | À REPRODUIRE | 403/404 → purger (P1) | | | credential-reviews | |
| E39 | Majeur | B | À REPRODUIRE | 401 → purge fil (P1) | | | message-history.ts, forms.tsx | |
| E40 | Majeur | B | À REPRODUIRE | relire contact à la réouverture (P1) | | | forms.tsx ConversationContact | |
| E42 | Majeur | B | À REPRODUIRE | workspace sans dossier → purge fil (P1) | | | artisan-space.tsx, forms.tsx | |
| E44 | Majeur | B | À REPRODUIRE | 404 pagination → purge (P1) | | | customer-invoices | |
| E48 | Majeur | B | À REPRODUIRE | 403 pagination → purge (P1) | | | saved-payment-methods | |
| E50 | Majeur | B | À REPRODUIRE | 403 → relire droit (P1) | | | refund-execution | |
| E51 | Majeur | B | À REPRODUIRE | GET de rattrapage à reconnexion (P6) | | | courant-app.tsx | |
| E52 | Majeur | B | À REPRODUIRE | 404 → purge liste (P1) | | | site-attachments | |
| E54 | Majeur | B | À REPRODUIRE | 503 sauvegarde ne masque pas le centre | | | features.ts, notifications | |
| E56 | Majeur | B | À REPRODUIRE | 401 pagination → purge (P1) | | | notification-center.tsx | |
| E59 | Majeur | Décision | DÉCISION | photos avant/après | — | — | — | fiche ci-dessous |
| E60 | Majeur | Décision | DÉCISION | accusé de remise client | — | — | — | fiche ci-dessous |
| E61 | Majeur | A | CONTRAT A | rapport > 1 000 sites | | | app/api/reports | |
| E63 | Majeur | B | À REPRODUIRE | 404 → purge (P1) | | | energy | |
| E64 | Majeur | B | À REPRODUIRE | 403 → relire/purger (P1) | | | co-ownership | |
| E67 | Majeur | Décision | DÉCISION | justificatif de levée | — | — | — | fiche ci-dessous |
| E70 | Majeur | A | HORS LOT B | erreur Connect | | | app/api/payments | externe Stripe |
| E72 | Majeur | A | HORS LOT B | ApplicationFee py_ | | | lib | externe Stripe |
| E75 | Majeur | A + Décision | DÉCISION | capacité artisan, null = illimité | — | — | — | aucun plafond choisi |
| E76 | Majeur | A | CONTRAT A | plafond global rappel | | | lib, supabase | |
| E78 | Majeur | A | CONTRAT A | reprise remboursement | | | supabase, lib | |
| E80 | Majeur | A + B | CONTRAT A | litige non projeté côté artisan | | | app/api/payments/status | B affichera le champ quand projeté |
| E03 | Mineur | B | À REPRODUIRE | 409 → relire + garder motif (P1) | | | platform-moderation-view.tsx | |
| E05 | Mineur | B | À REPRODUIRE | validation locale effectif ≤ 100000 | | | role/artisan-space.tsx | |
| E06 | Mineur | B | À REPRODUIRE | formulaire ouvert après perte d’écriture (P1) | | | site-operations shared/equipment/maintenance | |
| E09 | Mineur | B | À REPRODUIRE | nom de secours « document » | | | components/app/uploads.ts | |
| E10 | Mineur | B | À REPRODUIRE | rejeu réussi → édition (P3) | | | site-areas-panel.tsx | |
| E12 | Mineur | B | À REPRODUIRE | 409 → recharger le formulaire (P1/P2) | | | client-addresses-panel.tsx | |
| E13 | Mineur | B | À REPRODUIRE | devis expiré : bouton inactif | | | client-space.tsx, quote-documents-panel.tsx | |
| E14 | Mineur | B | À REPRODUIRE | 403 offre perdue → retirer (P1) | | | available-missions | |
| E18 | Mineur | A + B | CONTRAT A | command_id rapport (P3) | | | route operations sans command_id | |
| E19 | Mineur | A | CONTRAT A | nom vide accepté par la route | | | app/api | formulaire déjà conforme |
| E22 | Mineur | B | À REPRODUIRE | verrou synchrone useSubmit (P5) | | | site-operations/shared.tsx | |
| E23 | Mineur | A | CONTRAT A | classement SLA divergent | | | lib | |
| E27 | Mineur | B | À REPRODUIRE | 409 → relire la grille (P1) | | | grids-panel.tsx | |
| E31 | Mineur | B | À REPRODUIRE | `account_role` lu comme `role` | | | features.ts, platform-operators-view.tsx | |
| E33 | Mineur | A | CONTRAT A | normalisation NFC annuaire | | | app/api, supabase | |
| E36 | Mineur | A + B | CONTRAT A | suspension sans command_id (P3) | | | app/api/admin/artisans | |
| E41 | Mineur | A + B | CONTRAT A | message texte sans id stable (P3) | | | app/api/messages | |
| E43 | Mineur | B | À REPRODUIRE | publication propre prise pour « autre canal » (P3) | | | artisan-quote-draft.tsx | |
| E45 | Mineur | B | À REPRODUIRE | erreur de page suivante silencieuse | | | customer-invoices | |
| E46 | Mineur | B | À REPRODUIRE | avis effacé par la navigation | | | courant-app.tsx | |
| E47 | Mineur | B | À REPRODUIRE | vérification de retour après SIGNED_IN | | | courant-app.tsx | |
| E49 | Mineur | B | À REPRODUIRE | alerte de pagination conservée | | | saved-payment-methods | |
| E53 | Mineur | A + B | CONTRAT A | dépôt de site sans clé (P3) | | | app/api/sites/[id]/documents | |
| E55 | Mineur | B | À REPRODUIRE | cloche non relue après lecture (P1/P6) | | | notification-center, courant-app | |
| E57 | Mineur | B | À REPRODUIRE | confirmation perdue au remount (P3) | | | site-lifecycle | |
| E58 | Mineur | B | À REPRODUIRE | profil public relu en navigation (P6) | | | public-operator-profile, public-site | |
| E62 | Mineur | B | À REPRODUIRE | rejeu réussi → édition (P3) | | | energy | |
| E65 | Mineur | B | À REPRODUIRE | présélection Artisan | | | public-site.tsx, forms.tsx | |
| E66 | Mineur | B | À REPRODUIRE | détail hors cache sans GET | | | use-detail-presence.ts, enterprise-space | |
| E68 | Mineur | A | HORS LOT B | public/offline-request.js | | | public/ | interdit en B |
| E69 | Mineur | A | CONTRAT A | session_not_found → 401 | | | app/api/profile/sessions | |
| E71 | Mineur | B | À REPRODUIRE | opted_in=true + browser=none = retrait (P7) | | | web-push-panel.tsx | |
| E77 | Mineur | A | CONTRAT A | délai annoncé par numéro | | | lib, supabase | UI affiche la valeur serveur |
| E79 | Mineur | B | À REPRODUIRE | panne ≠ politique absente | | | public-operator-profile, public-site | |
| E81 | Mineur | B | À REPRODUIRE | montant encaissé (avenant) | | | role/artisan-space.tsx | |
| H01 | Env. | — | HORS LOT B | preview Vercel/Supabase | — | — | — | hors mission |

Sous-cas externes avec condition ouverte (PUB-10.1, CLI-05.2, CLI-08.1, ADM-01.1, FIN-06.1, SYS-08.2) : hors mission B.

## Synthèse par état

Mise à jour à chaque commit d’item.

- CORRIGÉ : aucun.
- ROUGE : aucun.
- À REPRODUIRE : voir tableau.
- NON REPRODUIT : aucun.
- REVERTÉ : aucun.

## Attendu de l’autre lot (A)

Contrats requis côté serveur, sans duplication en B.

- E15 · `app/api/interventions/[id]/operations/route.ts:7,47` et `supabase/migrations/202610310003_web_operations.sql:189–198` : la commande de rendez-vous doit accepter `expected_version` (version du rendez-vous lue) et répondre 409 en cas d’écart. B enverra la version lue dès que le schéma l’accepte ; aujourd’hui un champ inconnu serait refusé.
- E29 · `app/api/warranty/route.ts:20–25,48–52` : décision de garantie avec `expected_version` (ou état attendu) et 409 en conflit.
- E34 · `app/api/admin/artisans/route.ts:4,36–42`, `202610310008_suspension_governance.sql:38–66` : distinguer `approve` (depuis `submitted`/`changes_requested`) et `reactivate` (depuis `suspended`), avec état attendu ; une approbation depuis `suspended` doit répondre 409.
- E36 · même route : `command_id` d’intention stable et rejeu sans second audit.
- E18 · `app/api/interventions/[id]/operations/route.ts:10,49` : `command_id` pour l’enregistrement du rapport et rejeu idempotent sans second instantané.
- E41 · `app/api/messages/route.ts:24–38` : `id` client stable pour l’envoi texte (même contrat que `/api/messages/photo`).
- E53 · `app/api/sites/[id]/documents/route.ts:163–186` : clé d’idempotence de dépôt.
- E21/E24 · validation serveur des faits constatés (non futurs, ordre chronologique) et de la date de levée (≥ date du contrôle, non future). B ajoute la même validation à la saisie.
- E80 · `app/api/payments/status/route.ts:6–24` : projeter l’état de litige pour l’artisan affecté.
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
