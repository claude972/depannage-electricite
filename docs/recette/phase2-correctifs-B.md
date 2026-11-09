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
| E02 | Majeur | B | CORRIGÉ | issue du dépôt conservée hors montage, reprise sans second dépôt | 687270d | phase2-lot-b-e02-photo-thread-switch | components/app/forms.tsx | rouge : brouillon bloqué « uploading » (retour après et avant le reçu) ; vert : reçu repris, 1 dépôt, 1 envoi sur A, jamais sur B ; identité changée ⇒ rien (vert avant/après) |
| E04 | Majeur | B | CORRIGÉ | égalité profonde de la commande stockée (P7) | 03239bd | phase2-lot-b-e04-reminder-storage | payment-reminders/model.ts, payment-reminder-control.tsx | rouge : « stockage indisponible », 0 POST ; vert : programmer puis annuler, 1 POST chacun |
| E07 | Majeur | A | CONTRAT A | verrou site archivé SQL | | | supabase, app/api | UI déjà lecture seule |
| E08 | Majeur | B | CORRIGÉ | 409 ⇒ relecture dans le formulaire (P1/P2) | e739cb1 | phase2-lot-b-e08-budget-conflict | budget-panel.tsx (+ relecture c91f30d) | rouge : note v1 renvoyée, note concurrente écrasée ; vert : note v2 rechargée, montant conservé, conflit, renvoi v2 |
| E11 | Majeur | B | CORRIGÉ | suggestions périmées annulées à la saisie | 9e97064 | phase2-lot-b-e11-address-stale-option | address-field.tsx | rouge : Entrée immédiate applique l’ancienne rue ; vert : saisie conservée, aucun champ remplacé |
| E15 | Majeur | B + A | CORRIGÉ (dépend de A 258f44e) | expected_version du créneau (P2) | c1b5ddf | phase2-lot-b-e15-appointment-version | types.ts, client-space.tsx, artisan-space.tsx, enterprise-space.tsx | rouge : expected_version absent (client et artisan) ; vert : version lue (0 en création), refus ⇒ relecture 13 h, saisie conservée, conflit signalé, renvoi v2 |
| E16 | Majeur | B | CORRIGÉ | Actualiser relit créneau + rappel (P1/P6) | 8fad5b5 | phase2-lot-b-e16-refresh-dependencies | client-space.tsx | rouge : 0 relecture opérations/rappel, ancien horaire ; vert : relecture des deux, nouvel horaire. Clé existante du rappel conservée (fragment clé) |
| E17 | Majeur | B | CORRIGÉ | garde monotone sur la dernière lecture appliquée | 24f20de, eb9e2fa | phase2-lot-b-e17-tracking-late-reply | tracking-card.tsx | rouge : réponse ancienne réaffiche « Suivi actif » ; contre-revue Codex : garde sur le dernier GET lancé ⇒ rien affiché si latence > sondage, arrêt ignoré derrière un GET pendant (rouges reproduits) ; vert : 3 cas |
| E20 | Majeur | B | CORRIGÉ | 404 ⇒ relecture, lecture refusée purge (P1) | 1508558 | phase2-lot-b-e20-approval-revoked | advanced-approvals/model.ts, approvals.tsx | rouge : 0 relecture, historique et actions conservés ; vert : relecture, purge, 1 POST |
| E21 | Majeur | A (schéma partagé) | VÉRIFIÉ À L’INTÉGRATION, aucun code B | faits constatés non futurs (P4) | — | contrôle privé `phase3-lot-b-private/e21-e24-with-a-schema.mts` | — | les formulaires B importent `slaCasePayload` : B seul 1 commande envoyée (rouge), avec le schéma A 0 commande et message immédiat. Non compté comme correctif B |
| E24 | Majeur | A (schéma partagé) | VÉRIFIÉ À L’INTÉGRATION, aucun code B | levée ≥ contrôle, non future (P4) | — | même contrôle privé | — | `erpChecklistPayload` partagé : B seul 1 commande (rouge), avec A 0 commande et message immédiat. Non compté comme correctif B |
| E25 | Majeur | A | CONTRAT A | date d’effet des grilles (P4) | | | supabase | côté B : affichage si contrat change |
| E26 | Majeur | B | CORRIGÉ | 403 ⇒ relecture du rapport (P1) | c91f30d | phase2-lot-b-e06-e22-e26-e27-site-operations | site-operations-view.tsx | rouge : 0 GET, tarifs/note/Publier conservés ; vert : relecture, retirés, 1 POST |
| E29 | Majeur | B + A | CORRIGÉ (dépend de A 2b3b44e) | updated_at exact en version (P2) | 47f3fdc | phase2-lot-b-e29-warranty-version | types.ts, forms.tsx | rouge : expected_version absent ; vert : chaîne exacte envoyée, 409 ⇒ relecture, décision de A affichée, brouillon de B conservé |
| E30 | Majeur | B | CORRIGÉ | 403 ⇒ relire /me + liste, lecture refusée purge (P1) | 747a94f | phase2-lot-b-e30-e31-operators | platform-operations/shared.tsx, platform-operators-view.tsx | rouge : 0 GET /me après 403 ; vert : relecture, nom/note/boutons purgés, 1 POST |
| E32 | Majeur | B | CORRIGÉ | vue journal pour la capacité audit | b552cac | phase2-lot-b-e32-audit-journal | platform-audit-view.tsx (nouveau), features.ts, anchors.ts, platform-anchor.tsx, session.ts, types.ts, espaces | rouge : aucune entrée ni lecture ; vert : entrée « Journal d’audit » sur capacité serveur, lecture paginée, rien sans capacité |
| E34 | Majeur | B + A | CORRIGÉ (dépend de A e17c0e5) | approbation ≠ réactivation + version (P2) | 43ee0b9 | phase2-lot-b-e34-e35-e36-artisan-decisions | forms.tsx | rouge : corps {approved:true} ; vert : action approve + version 1 ⇒ 409, Suspendu relu |
| E35 | Majeur | B | CORRIGÉ | action « Demander des corrections » | 43ee0b9 | phase2-lot-b-e34-e35-e36-artisan-decisions | forms.tsx | rouge : seule action « Approuver » ; vert : request_changes envoyé, statut changes_requested |
| E37 | Majeur | A | HORS LOT B (validé par A) | prédicat d’offre et congés | Codex | — | supabase | validé côté A selon Codex |
| E38 | Majeur | B | CORRIGÉ | 403/404 → relire/purger (P1) | bd77186 | phase2-lot-b-e38-credential-review-revoked | credential-reviews-model.ts | rouge : 0 GET après 403 ; vert : 1 POST, relecture, purge motifs et formulaire |
| E39 | Majeur | B | CORRIGÉ | 401 ⇒ purge du fil (P1) | 241cbc2 | phase2-lot-b-e39-message-session-expired | forms.tsx | rouge : 5 messages et saisie conservés ; vert : purge, reconnexion. Test existant message-history 4b (qui figeait ce défaut) mis à jour vers la purge |
| E40 | Majeur | B | CORRIGÉ | réouverture du contact ⇒ relecture (P1) | 38541ef | phase2-lot-b-e40-contact-reread | forms.tsx | rouge : contact réaffiché sans lecture (contre-épreuve sans correctif refaite) ; vert : relecture, rien sans droit |
| E42 | Majeur | B | CORRIGÉ | fil retiré du workspace relu ⇒ historique relu (P1) | 3c80bdf | phase2-lot-b-e42-thread-rights-reread | forms.tsx | rouge : 0 GET, anciennes pages et saisie ; vert : relecture, saisie retenue jusqu’à la lecture, 404 purge |
| E44 | Majeur | B | CORRIGÉ | 404 pagination → purge (P1) | ca0f8a3 | phase2-lot-b-e44-e45-invoices-pagination | invoices-model.ts, customer-invoices-panel.tsx | rouge : 25 lignes et PDF après 404 ; vert : purge + refus |
| E48 | Majeur | B | CORRIGÉ | 403 pagination → purge (P1) | d5b1a3b | phase2-lot-b-e48-e49-saved-methods-pagination | saved-payment-methods/model.ts | rouge : 20 cartes après 403 ; vert : purge immédiate, 0 POST |
| E50 | Majeur | B | CORRIGÉ | 403 → relire droit (P1) | aa2f826 | phase2-lot-b-e50-refund-revoked | refund-execution-model.ts | rouge : 0 GET après 403, « Émettre » actif ; vert : 1 POST, relecture, action retirée |
| E51 | Majeur | B | CORRIGÉ | GET de rattrapage à la reconnexion (P6) | 533750e | phase2-lot-b-e51-realtime-catchup | realtime.ts, courant-app.tsx | rouge : aucune décision de rattrapage ; vert : vrai canal realtime-js coupé puis rejoint ⇒ 1 rattrapage. Contre-recette Codex sur CourantApp entier, Chromium, vrai SDK et WebSocket loopback : base 0 GET et ancienne description ; A c92b47f + B 99516ac ⇒ 1 GET auto, description à jour, 2 joins, 0 erreur (journal phase3-E51-shell-after.log, ledger A) |
| E52 | Majeur | B | CORRIGÉ | 404 → relire/purger liste (P1) | f273048 | phase2-lot-b-e52-site-attachments-revoked | site-attachments-panel.tsx | rouge : 0 GET liste après 404 ; vert : relecture, purge, 1 signature |
| E54 | Majeur | B | CORRIGÉ | 503 de commande ne masque pas le centre | 48a79ff | phase2-lot-b-e54-e55-e56-notifications | features.ts, notification-center.tsx | rouge : centre et saisie disparus ; vert : centre, formulaire et case décochée conservés, erreur en ligne |
| E56 | Majeur | B | CORRIGÉ | 401 en pagination ⇒ purge (P1) | 48a79ff | phase2-lot-b-e54-e55-e56-notifications | notification-center.tsx | rouge : 25 lignes conservées ; vert : purge, plus de bouton |
| E59 | Majeur | Décision | DÉCISION | photos avant/après | — | — | — | fiche ci-dessous |
| E60 | Majeur | Décision | DÉCISION | accusé de remise client | — | — | — | fiche ci-dessous |
| E61 | Majeur | A + B | CORRIGÉ (A fa9d690) | rapport paginé, Suivant/Précédent avec relecture | 8eedc26, 4895f8e | phase2-lot-b-e61-report-pages | enterprise-reports/model.ts, use-enterprise-report.ts, enterprise-space.tsx | rouge : réponse paginée refusée par le parseur ⇒ erreur ; vert : page acceptée (ordre, curseur, jamais complète), navigation relue, sommes de page libellées comme telles, CSV sans after ; contre-revue Codex : page finale vide et erreur de page > 1 gardent « Page précédente » (test phase2-lot-b-e61-empty-tail) |
| E63 | Majeur | B | CORRIGÉ | 404 → relire/purger (P1) | fcf1abd | phase2-lot-b-e62-e63-energy | energy-model.ts | rouge : 0 GET après 404 ; vert : 1 POST, relecture, purge |
| E64 | Majeur | B | CORRIGÉ | 403 → relire/purger (P1) | 3698ea6 | phase2-lot-b-e64-coownership-revoked | coownership-model.ts | rouge : 0 GET après 403 ; vert : relecture, purge |
| E67 | Majeur | Décision | DÉCISION | justificatif de levée | — | — | — | fiche ci-dessous |
| E70 | Majeur | A | HORS LOT B (partiel A) | erreur Connect | Codex | — | app/api/payments | partiel côté A, configuration externe |
| E72 | Majeur | A + B | CORRIGÉ côté B (A : feeConnectedReference) | ch_ ou py_ pour la charge connectée | 976e6e3 | phase2-lot-b-e72-fee-connected-reference | finance-proofs/model.ts | rouge : preuve py_ illisible ; vert : py_/ch_ acceptés, charge plateforme ch_ seule, autres préfixes et liaisons refusés. Copie locale de la regex A à remplacer par l’import après intégration |
| E75 | Majeur | A + Décision | DÉCISION | capacité artisan, null = illimité | — | — | — | aucun plafond choisi |
| E76 | Majeur | A | CONTRAT A | plafond global rappel | | | lib, supabase | |
| E78 | Majeur | A | HORS LOT B (corrigé par A) | reprise remboursement | Codex | — | supabase, lib | A confirmé et poussé ; aucun fichier B requis : le formulaire reprend déjà execution_id |
| E80 | Majeur | A + B | CORRIGÉ (A f58df31) | état du litige artisan, libellé neutre | ec7d6f1, 8fa9749 | phase2-lot-b-e80-artisan-dispute | types.ts, artisan-space.tsx | rouge : aucune lecture ni mention ; vert : litige neutre (enregistré / examiné par la plateforme) à côté de « Réglé » inchangé, clé identité+génération+devis, relu à chaque actualisation ; none/absent/inconnu ⇒ rien |
| E03 | Mineur | B | CORRIGÉ | 409 ⇒ relecture en place, motif conservé (P1) | 4800320 | phase2-lot-b-e03-moderation-conflict | platform-operations/shared.tsx, platform-moderation-view.tsx | rouge : renvoi version 1 ; vert : relecture, renvoi version 2 |
| E05 | Mineur | B | CORRIGÉ | borne d’effectif locale = serveur | 4ac4825 | phase2-lot-b-e05-employee-bound | artisan-space.tsx | rouge (contre-épreuve sans correctif) : save_profile envoyé ; vert : message français près du champ, 0 commande |
| E06 | Mineur | B | CORRIGÉ | formulaire ouvert sans droit ⇒ aucun POST (P1) | c91f30d | phase2-lot-b-e06-e22-e26-e27-site-operations | site-operations/shared.tsx | rouge : 1 POST après passage en lecture seule ; vert : 0 POST, message lecture seule. Mécanisme partagé useSubmit (équipement/maintenance/délais) |
| E09 | Mineur | B | CORRIGÉ | même règle de nom que le serveur (P3) | c791b1c | phase2-lot-b-e09-upload-name | components/app/uploads.ts | rouge : 0 candidat pour un nom vide ; vert : « document » du même dossier proposé, via lib/shared/document-policy (pas de copie) |
| E10 | Mineur | B | CORRIGÉ | rejeu réussi ⇒ édition (P3) | cb0d678 | phase2-lot-b-e10-area-replay | site-areas-panel.tsx | rouge : expected_version null renvoyé ⇒ 409 ; vert : édition v1 |
| E12 | Mineur | B | CORRIGÉ | 409 ⇒ relecture dans le formulaire (P1/P2) | b238a1c | phase2-lot-b-e12-address-conflict | client-addresses-panel.tsx | rouge : ville v1 et version 1 renvoyées ; vert : ville v2 rechargée, libellé conservé, renvoi v2 |
| E13 | Mineur | B | CORRIGÉ | devis expiré : action seulement sur validité confirmée | 369d259, 7f9fad9 | phase2-lot-b-e13-expired-quote | client-space.tsx | rouge : bouton actif (expiré, lecture retenue, lecture refusée) ; vert : action seulement après lecture réussie valide/non renseignée, états vérification/refus distincts + Réessayer, démo inchangée. Faux client de recipient-quotes.test.ts complété (assertions inchangées) |
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
| E43 | Mineur | B | CORRIGÉ | envoi propre incertain ≠ autre canal (P3) | 6b4104c | phase2-lot-b-e43-own-publication | artisan-quote-draft.tsx | rouge : « publié par un autre canal » ; vert : message d’issue incertaine de son envoi, rechargement pour vérifier |
| E45 | Mineur | B | CORRIGÉ | erreur de page suivante expliquée | ca0f8a3 | phase2-lot-b-e44-e45-invoices-pagination | invoices-model.ts, customer-invoices-panel.tsx | rouge : 503 silencieux ; vert : alerte, reprise 26 pièces, alerte retirée |
| E46 | Mineur | B | CORRIGÉ | avis conservé après la navigation | 37fa4b3 | phase2-lot-b-e46-return-notice | courant-app.tsx | rouge : avis absent sur la connexion ; vert : avis affiché, 0 POST |
| E47 | Mineur | B | CORRIGÉ | vérification unique après la première connexion | 5b1d5d7, 7d8c078, 765cdc2 | phase2-lot-b-e47-return-after-signin | courant-app.tsx | rouge : 0 POST ; vert : propriétaire 1 POST, tiers 0. Contre-revue : garde génération + mode live, effacement dans clearSessionState, assignation après nettoyage ; cas « même UID tardif » vert avant et après (non reproduit rouge). 7d8c078 avait rompu card-return.test.ts (ligne figée), rétabli par 765cdc2. Vérifié par Codex avec routes et SQL réels |
| E49 | Mineur | B | CORRIGÉ | alerte de pagination retirée | d5b1a3b | phase2-lot-b-e48-e49-saved-methods-pagination | saved-payment-methods/model.ts | rouge : alerte conservée ; vert : retirée après la 21e carte |
| E53 | Mineur | A + B | CORRIGÉ (dépend de A b414386) | command_id du dépôt de site (P3) | fc06c26 | phase2-lot-b-e53-site-upload-command-id | site-attachments-panel.tsx | rouge : command_id absent ; vert : même clé au renvoi, un seul document |
| E55 | Mineur | B | CORRIGÉ | lecture confirmée ⇒ résumé de cloche relu (P1/P6) | 48a79ff | phase2-lot-b-e54-e55-e56-notifications | notification-center.tsx, notifications-anchor.tsx | rouge : 0 GET résumé ; vert : résumé relu |
| E57 | Mineur | B | CORRIGÉ | confirmation persistante après rejeu (P3) | 3e4c3c1 | phase2-lot-b-e57-site-replay-confirmation | site-direct.tsx | rouge : panneau démonté, confirmation perdue ; vert : fiche conservée pendant la relecture, « Paramètres enregistrés. » visible |
| E58 | Mineur | B | CORRIGÉ | profil relu à chaque navigation interne (P6) | f1271fc | phase2-lot-b-e58-e79-public-profile | use-published-profile.ts, public-site.tsx | rouge : 0 GET, ancien exploitant affiché ; vert : relecture, ancien exploitant absent |
| E62 | Mineur | B | CORRIGÉ | rejeu réussi → édition (P3) | fcf1abd | phase2-lot-b-e62-e63-energy | site-energy-panel.tsx | rouge : formulaire en création, expected_version null ; vert : édition v1 |
| E65 | Mineur | B | CORRIGÉ | présélection Artisan à l’inscription | 7e2d98f | phase2-lot-b-e65-artisan-signup | forms.tsx, public-site.tsx | rouge : « Particulier » présélectionné ; vert : Artisan électricien + explication d’approbation, aucun envoi |
| E66 | Mineur | B | CORRIGÉ | lecture automatique du dossier entreprise masqué par la fenêtre de sites | 2abbdb8, 8fda19e | phase2-lot-b-e66-detail-out-of-cache-site | use-detail-presence.ts, enterprise-space.tsx (suivi 15bbfb5 : site absent du cache) | rouge : 0 GET avant « Ouvrir quand même » ; vert : GET auto + détail exact, tiers 404. Contre-revue : déclencheur restreint à l’option siteWindowMayHide (aucun GET superflu ailleurs). Vérifié par Codex sur le vrai 101e site (version large) |
| E68 | Mineur | A | HORS LOT B (partiel A) | public/offline-request.js | Codex | — | public/ | partiel côté A jusqu’au changement de cache hors périmètre |
| E69 | Mineur | A | CONTRAT A | session_not_found → 401 | | | app/api/profile/sessions | |
| E71 | Mineur | B | CORRIGÉ | opted_in=true + browser=none = retrait (P7) | ab303ea | phase2-lot-b-e71-push-remove | web-push-panel.tsx | rouge : échec affiché, pas d’unsubscribe ; vert : retrait, unsubscribe, aucune alerte |
| E77 | Mineur | A | CONTRAT A | délai annoncé par numéro | | | lib, supabase | UI affiche la valeur serveur |
| E79 | Mineur | B | CORRIGÉ | panne distincte de « À renseigner » | f1271fc | phase2-lot-b-e58-e79-public-profile | use-published-profile.ts, public-site.tsx | rouge : même texte, aucune reprise ; vert : alerte + Réessayer, reprise affiche le publié |
| E81 | Mineur | B | CORRIGÉ | total accepté avec avenants + montant réglé | 10c6008 | phase2-lot-b-e81-artisan-paid-amount | artisan-space.tsx | rouge : seul « 60,00 € » ; vert : 90,00 € accepté et réglé, déclarations historiques non présentées comme confirmées |
| H01 | Env. | — | HORS LOT B | preview Vercel/Supabase | — | — | — | hors mission |

Sous-cas externes avec condition ouverte (PUB-10.1, CLI-05.2, CLI-08.1, ADM-01.1, FIN-06.1, SYS-08.2) : hors mission B.

## Synthèse par état

Mise à jour à chaque commit d’item.

- CORRIGÉ (59 IDs, rouge→vert sur tests ciblés, suite globale non qualifiée verte) : E02, E03, E04, E05, E06, E08, E09, E10, E11, E12, E13, E14, E15, E16, E17, E18, E20, E22, E26, E27, E29, E30, E31, E32, E34, E35, E36, E38, E39, E40, E41, E42, E43, E44, E45, E46, E47, E48, E49, E50, E51, E52, E53, E54, E55, E56, E57, E58, E61, E62, E63, E64, E65, E66, E71, E72, E79, E80, E81. E15/E18/E29/E34/E36/E41/E53/E72/E80 exigent les contrats A à l’intégration (E80 : A f58df31).
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
- E80 · LIVRÉ PAR A f58df31 : `artisan_dispute` optionnel = none|open|under_review|resolved|closed sur GET /api/payments/status, seulement pour l’artisan affecté auteur du devis accepté, indépendant de payment.status, aucun détail finance. Câblé en B (ec7d6f1).
- E61 · LIVRÉ PAR A fa9d690, câblé en B (8eedc26) : GET /api/reports `after=<UUID>`, pages de 1000 sites triées par site_id, `page {limit:1000,has_more,next_after}` optionnel, `scope.complete=false` sur page d’un périmètre découpé ; CSV complet sans after. 
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

Exécution intermédiaire de la suite complète sur B (03239bd, `tsx --test` sans filtre, donc `.mjs` inclus) : 2302 réussis, 13 échecs = les 12 échecs ci-dessus à l’identique + `tests/restore-drill.test.mjs` (hors du glob `npm test` qui ne prend que `*.test.ts`, non attribué à B). Aucune autre régression observée. La suite n’est pas qualifiée verte.

## Journal

- Prise en charge : ledger créé avant tout code, sur la branche B.
- Harnais `tests/ui/phase2-lot-b-harness.ts` : esbuild + vrais composants + vrai CSS, Chromium headless (chemins QA_*), API simulée en page, aucune requête `/api/`.
- Reproductions rouges : E38, E44, E45, E48, E49, E50, E52, E62, E63, E64 (assertion rouge citée dans chaque commit).
- Signal `phase3-bloquants-livres.md` reçu (A sur 6f2d89c), corrections B ensuite, une par ID ou mécanisme.
- Checkpoint A : les 12 mêmes échecs préexistants sur HEAD, deux builds OK. La suite globale n’est pas qualifiée verte.
- Contrats A E15 et E29 publiés dans le signal (voir Attendu de l’autre lot).
- Règles P1 communes livrées (961e24d) : `components/app/refusal.ts` (401 purge immédiate, 403/404 relecture avant tout POST, refus de lecture = purge, 409 conflit, invalide, transitoire) ; chaque panneau fournit seulement son adaptateur de relecture. Test `phase2-lot-b-refusal-rules`.
- Test existant modifié (P1 exigé, E39) : `tests/ui/message-history.test.ts` cas 4b, « messages conservés après 401 » (le défaut lui-même) remplacé par purge + saisie absente.
- Test existant modifié (P1 exigé) : `tests/ui/erp-command-transient.test.ts`, l’assertion 401/403 interdisait toute relecture ; remplacée par « exactement une relecture des droits », classification et formulaire inchangés.
- Test existant modifié (contrat changé par A, pas d’affaiblissement) : `tests/ui/artisan-admin-status.test.ts`, deux assertions figeaient `{ user_id, approved }` et une seule action pour « soumis ». Remplacées par le nouveau corps exact et les deux actions (E35), même rigueur.
