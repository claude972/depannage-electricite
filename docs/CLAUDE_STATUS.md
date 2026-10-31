# Statut Claude — WEB-PWA-20261030

Fichier de coordination émis par l’agent Claude pour le pilote (Codex). Le pilote publie les mises à jour sur `missions/web-pwa` ; ce fichier reste la source des claims, statuts, questions et rapports de Claude.

## Acceptation et claim

- mission: WEB-PWA-20261030
- agent: claude
- session: b4b555f0 (`depannage-web-pwa-ui`, background, acceptEdits, sans bypass)
- branch: claude/web-pwa-ui, base 3c1ca2ce978f354556c0c691d4ac0d3088308b36
- worktree: /Volumes/Stockage/Projets/depannage-web-pwa-claude
- status: **accepted / in_progress** — seul l’assignment Claude est revendiqué ; les entrées Codex et pilote sont préservées telles quelles
- lectures effectuées: origin/missions/web-pwa MISSIONS.md + CORRECTIONS.md ; origin/codex/web-pwa-backend docs/WEB_PWA_CONTRACTS.md (08c10c5) ; AGENTS.md, DESIGN.md, CLAUDE.md, docs/PLAN_REPRISE.md, audit/REAUDIT_CONSOLIDE.md, REAUDIT_FRONTEND.md, CATALOGUE_MAQUETTES.md, ARCHIVES_CODE.md, COUVERTURE_PLAN.csv, DECISIONS.md ; components/courant-app.tsx (5275 lignes), app/globals.css, app/page.tsx, app/layout.tsx, lib/domain.ts, lib/supabase/*, toutes les routes app/api lues, migrations SQL ; images maîtresses extraites des PDF (M35 V3p4, M34, M36, M43 V3p12, M44, M14, M4, M7, M61, M65, M66 V4p19, M67, V5-C01/C05/C08, V8-C06/C07, M50, M56, M13)
- périmètre de fichiers: components/courant-app.tsx, nouveaux composants/styles de rôle, app/globals.css, app/page.tsx, public/design, tests/ui, docs/CLAUDE_STATUS.md, docs/CLAUDE_VERIFICATION.md. Aucun fichier Codex/partagé ne sera modifié sans demande ici.

## Checkpoint 1 — livré : **685738cb370b3616f6f87fc5a8f1c0623ffe0456** (claude/web-pwa-ui, poussé)

- status: **ready_for_review** (checkpoint 1 frontend) — assignment global toujours in_progress
- contenu : contrôleur de session P0 (identité/cache/gardes, guard de génération CL-UI-006, retours Stripe relus CL-003, acceptation sur version exacte API-QUOTE-001), 5 espaces dédiés (public, particulier, artisan M35, entreprise M66/V5-C08, Super Admin M43), primitives partagées, démo isolée, états chargement/erreur/vide/indisponible, tests `tests/ui`.
- fusion : SHA Codex 6aaa1b36b99e64de4e0544780c8234c508cc1fd5 intégré dans claude/web-pwa-ui (merge 0f5891f) sans modification de fichiers Codex.
- contrôles : `npm run check` → typecheck OK, 28 tests OK (dont 15 `tests/ui`, lancés à part via `npx tsx --test tests/ui/*.test.ts`), `next build` OK. Captures 360 px et 1280 px : `docs/verification/ui/`. Rapport : `docs/CLAUDE_VERIFICATION.md`.
- carte source → écran : voir tableau « Correspondance captures / références » du rapport.
- ce que Codex doit vérifier : (1) hash direct `#admin` / `#sites` / `#missions` avec un rôle non autorisé → écran « ne fait pas partie de votre espace » sans requête de données ; (2) A → déconnexion → B : aucun avis/dossier/filtre de A, `busy` libre ; (3) acceptation de devis envoie `quote_id` exact (visible dans la requête) ; (4) retour `?payment=pending` sans statut payé côté serveur n’affiche jamais « réglé » ; (5) contrats non intégrés → état indisponible sans simulation ; (6) démo : aucun appel réseau vers /api.

### Demandes au pilote (fichiers Codex / partagés)
- **CL-REQ-001 (package.json)** : ajouter `"test:ui": "tsx --test tests/ui/*.test.ts"` et l’inclure dans `check` ; CI identique.
- **CL-REQ-002 (next.config.ts)** : `next dev`/`next build` de Next 16 réécrit `AGENTS.md` à la racine (« Generated AGENTS.md for AI agents ») ; j’ai dû restaurer le fichier projet deux fois. Ajouter `agentRules: false` dans la config Next.
- **CL-REQ-003 (components/pwa-registration.tsx)** : emplacement d’import de `PwaInstallControl` prévu dans Profil (tous rôles) et Aide publique au checkpoint 2 ; confirmer que le composant est autonome (aucune prop) et ne rend rien quand l’installation n’est pas possible.

### Revue croisée Claude → Codex (lecture du code 6aaa1b3 + c1e80a2/409a082, pas de base distante)
- **CL-BE-001 (moyen, politique)** `save_artisan_profile` met `artisan_approved=false` immédiatement à toute modification du dossier ; comme `send_quote/start/complete` exigent l’approbation, un artisan qui corrige son adresse pendant une mission en cours ne peut plus la terminer ni rédiger son compte rendu. Proposition : autoriser les actes terrain des missions déjà attribuées malgré le repassage en examen, ou bloquer la modification tant qu’une mission est active, avec message. L’UI avertit déjà avant enregistrement.
- **CL-BE-002 (faible)** `available_missions` expose `left(postal_code,3)||'**'` : cohérent avec l’anonymisation ; l’UI affiche « 972•• » et « adresse complète après acceptation ». Aucun changement demandé.
- **CL-BE-003 (faible)** `reject_intervention_quote` et `reassign_intervention` écrivent le motif dans `messages` (partagé) : conforme au contrat ; l’UI prévient l’auteur que le motif est visible par les participants.
- **CL-BE-004 (info)** `GET /api/workspace` : `payments` limité à 100 sans indicateur de troncature contrairement à `appointments_limited` ; l’UI mentionne « sur les dossiers chargés ». Suggestion additive : `payments_limited`.
- **PWA (cf52bcd/6aaa1b3)** : `sw.js` n’intercepte que les navigations GET même origine hors /api et /auth, pas de cache privé, fallback public uniquement ; conforme à la mission. Pas de finding bloquant ; vérification navigateur multi-onglets reste celle du pilote.
- **CL-BE-005 (info, 70337dc)** webhook : `checkout.session.expired` / `async_payment_failed` passent par `record_stripe_payment_failure` après contrôle quote_id/client_reference_id/devise/montant ; l’UI relit `GET /api/payments/status` au retour et affiche payé/échec/expiré/en attente selon le serveur uniquement (CL-003).
- **CL-BE-006 (info, 008)** `guard_artisan_self_edit` : un dossier suspendu ne peut plus modifier société/disponibilité ; l’UI artisan affiche le statut « suspendu » avec consigne de contacter l’opérateur et désactive ces formulaires (à vérifier au checkpoint 2).
- **009 (c04b752 / contrat a10bb3d)** consommé par l’UI : `GET/POST /api/organizations/site-access` via `session.loadSiteAccess` / `setSiteAccess`, `create_invitation` avec `site_scope`/`site_grants` ; forme réelle `{organization_id, can_manage, members[{user_id, role, scope, grants}]}` (lue dans la migration, différente du texte du contrat qui ne la précisait pas).
- Pas de revue des migrations SQL au-delà de la lecture des contrats utilisés par l’UI (003/004/005/006/007 lues pour les formes de données) ; la recette SQL isolée reste Codex.

## Checkpoint 2 — livré : **a5c4faa8bd853ff97c7c5c562dd9dd56687f53fd** (claude/web-pwa-ui, poussé)

- contenu : `PwaInstallControl` placé dans les profils des 4 rôles et l’aide publique via `components/app/install-panel.tsx` ; contrat 009 (accès par site) consommé dans Membres (portée par membre, éditeur owner, invitations avec portée, « Votre accès ») ; dossier artisan lisible par l’admin (`/api/artisan?user_id`) dans la fiche candidature ; revue des copies utilisateur CL-UI-005 sur les 5 espaces (aucun chemin API, RPC, fichier ou identifiant de bloqueur visible ; `blocker` conservé en attribut de données) ; suppression des doublons CSS locaux devenus globaux ; relecture du retour paiement par `GET /api/payments/status` (CL-003) ; guard d’identité (CL-UI-006) avec tests.
- contrôles : `npx tsc --noEmit` OK ; `tests/ui` 16/16 ; **`next build` non relancé pour ce checkpoint : volume plein (ENV-CL-001), 112 Mio libres** — le build du checkpoint 1 (685738c) reste la dernière preuve complète ; à relancer par le pilote sur l’intégration (CI) ou ici dès espace libéré.
- incident : l’écriture d’`admin-space.tsx` a échoué une fois (ENOSPC, fichier tronqué) ; reconstruit depuis HEAD + modifications prévues, vérifié par typecheck ; aucune autre modification perdue (diff relu).
- ce que Codex doit vérifier : Membres → « Accès aux sites » (owner) enregistre et relit la portée ; invitation avec portée « selected » ; non-owner voit « Votre accès » uniquement ; fiche admin d’un artisan lit le dossier et les pièces ; bouton d’installation présent dans Profil et Aide, silencieux quand l’installation n’est pas possible.

## Table des findings → commits de correction (pour clôture par le pilote)

| Finding | Fix commit(s) | Test / preuve |
| --- | --- | --- |
| CL-UI-001 résultat réseau ambigu | 685738c (api.ts) ; 4f41fff | `tests/ui/api.test.ts` (panne réseau sur mutation) |
| CL-UI-002 hash malformé | 685738c (session.ts) | `tests/ui/session.test.ts` (hash parsing) |
| CL-UI-003 retour URL ≠ paiement | 4f41fff, c4333e0 | `tests/ui/api.test.ts` (paymentReturnMessage) |
| CL-UI-004 200 invalide | 4f41fff | `tests/ui/api.test.ts` (malformed 200 / non-2xx) |
| CL-UI-005 copies utilisateur | a5c4faa | relecture des 5 espaces |
| CL-UI-006 / UI-REV-001 guard d’identité + connexion | 685738c, 75feaab, a472fc6, 2e3dcf1, 823b021 | `tests/ui/guard.test.ts`, `tests/ui/identity.test.ts` |
| UI-REV-002/003 revalidation, 403, refreshedAt | 88562367, 6962be6 | `tests/ui/session.test.ts` (validateContext) |
| CL-UI-009 validité d’invitation 14 j | 6962be6 | — |
| PHOTO-REV-001/002/003 | fcc7f6b | `tests/ui/uploads.test.ts` |
| VIS-001 densité artisan | 529fe0f | capture preview à refaire par le pilote |

## Corrections de revue pilote appliquées (checkpoint 2b)

- **CL-UI-001** api.ts : échec réseau sur mutation = résultat incertain, consigne de relecture avant nouvel essai.
- **CL-UI-002** session.ts : `parseHash` tolère l’encodage malformé et n’accepte que des identifiants ; test.
- **CL-UI-003** : le retour `?payment=` relit d’abord `GET /api/payments/status` ; libellés par `paymentReturnMessage(urlState, serverStatus)` : un URL « annulé » avec statut serveur payé affiche la confirmation ; échec = « n’a pas abouti », sans promesse bancaire ni relance automatique ; état indéterminé explicite ; Connect = « retour enregistré, compte non vérifié par cette interface ». Tests `tests/ui/api.test.ts`.
- **CL-UI-004** : `parseApiBody` rejette toute réponse 2xx dont le corps n’est pas un objet JSON (page HTML, corps vide, troncature) avec consigne de relecture ; non-2xx = message serveur ou défaut sûr. Tests succès / 200 malformé / non-2xx / réseau.
- **CL-UI-005** : copies utilisateur revues sur les 5 espaces (checkpoint 2).
- **CL-UI-006** : guard de génération d’identité (`components/app/guard.ts`) utilisé par le contrôleur ; tests différés A→B.

## Checkpoint 3 — en cours (commits poussés au fil de l’eau)

- **Guard de connexion** (UI-REV-001 / CL-UI-006) : `components/app/identity.ts` — adoption d’identité réconciliée avec l’utilisateur SDK vérifié et l’état déjà chargé par l’écouteur d’auth ; re-contrôle de propriété après chaque await ; tentative remplacée = aucune réinitialisation de la session plus récente ; déconnexion pendant la vérification (réponse périmée incluse) = tentative abandonnée. Tests `tests/ui/identity.test.ts` : événement avant promesse, promesse avant événement, A périmé après B, SIGNED_IN B pendant la vérification de A, déconnexion pendant vérification (réponse nulle et réponse périmée A), déconnexion pendant le chargement, chaîne de mutation périmée, brouillon conservé. Commits 75feaab → a472fc6 → 2e3dcf1 → 823b021.
- **Revalidation** (UI-REV-002/003) : relecture workspace + données professionnelles au retour de focus/visibilité (live, 15 s) ; contexte organisation/site invalidé si absent du workspace rechargé ; 403/404 des lecteurs organisation, accès par site, professionnel, opérations et vue d’ensemble admin invalident le contexte ou le dossier ouvert ; `session.refreshedAt` consommé par Membres et accès par site (88562367, puis ce checkpoint).
- **Photos de la demande (CLI-02)** : sélection dans le formulaire (JPEG/PNG/WebP, 4 Mo, 6 max, validation côté client identique au serveur) ; envoi **après** la création réussie du dossier, fichier par fichier, via le point d’entrée documents privés existant ; échec partiel conservé dans une file avec « Réessayer » sans recréer la demande ; panneau d’état dans le détail (particulier et entreprise) ; aucun envoi anonyme (brouillon public : photos non conservées, dit explicitement) ; démonstration : aucun envoi, dit explicitement.
- **Accessibilité** (audit interne) : menus hors écran rendus `inert` quand fermés, arrière-plan `inert` quand ouverts, retour de focus (Échap, fermeture d’aide), suppression des liens d’évitement doublons, compteurs avec texte lecteur d’écran, cibles ≥ 44 px, libellés de cases « écriture » par site, zones `role="status"`.
- **Entreprise** : validité d’invitation bornée 1–14 jours (serveur).
- **Artisan — densité M35 (VIS-001)** livrée en 529fe0f : lignes de mission compactes (titre, adresse + statut en ligne, horaire ou « Horaire à fixer » en libellé discret), performance à libellés courts, formules et réserves repliées dans « Base de calcul » (élément `details` natif), aucune métrique ni horaire inventé.
- **En cours (agents internes, fichiers distincts)** : Super Admin — liste serveur paginée/recherche et détail d’ancien dossier selon `WEB_PWA_ADMIN_LISTS_CONTRACT.md` (d910eec ; backend d85da06 en revue) derrière détection d’indisponibilité ; artisan — éditeur de brouillon de devis (ART-07) selon `WEB_PWA_QUOTE_DRAFT_CONTRACT.md` avec repli sur l’envoi direct tant que la route n’est pas active.
- **Revue photos (rapport indépendant sur 6962be6) corrigée en fcc7f6b** : PHOTO-REV-001 résultat incertain (réseau 0 / réponse inexploitable 502) distingué d’un refus, libellé honnête, rapprochement avec les documents du dossier avant tout renvoi, renvoi des incertaines uniquement sur confirmation explicite (risque de doublon annoncé) ; PHOTO-REV-002 files d’envoi conservées par dossier, jamais écrasées par une nouvelle demande ; PHOTO-REV-003 suppression du brouillon `sessionStorage` liée à la génération d’identité de la chaîne. Tests `tests/ui/uploads.test.ts` (classification, rapprochement, renvoi par défaut vs confirmé, coexistence des files).
- **Contrat brouillon de devis (WEB-PWA-QUOTE-DRAFT-001, de6091d)** lu ; lot ART-07 planifié après pagination admin et densité artisan : charger l’enveloppe, conserver version/assignment_token/base_quote_id, 409 = conflit avec rechargement et conservation de la saisie, sauvegarde ≠ envoi, sélection du `quote_id` renvoyé.
- Contrôles : typecheck OK, `tests/ui` 37/37 ; build complet confié au CI (disque local plein).

## Prochain livrable (checkpoint 3 bis)

Checkpoints 1 et 2 terminés. Checkpoint 3 : captures 360/1280 des vues Membres/accès par site et fiche admin artisan (dès espace disque), relecture accessibilité clavier des menus off-canvas, build complet, puis vérification de la preview combinée publiée par le pilote et revue croisée du SHA Codex intégré.

Plan initial (conservé pour trace) :

1. Réinitialisation complète à logout / changement d’identité / expiration : `data`, `professional`, `selected`, filtres, brouillon de réponse en vol (jeton de requête, réponse tardive A ignorée après connexion B), `onAuthStateChange` branché, caches de démonstration jamais lus en mode live.
2. Garde de rôle sur chaque vue rendue (hash direct `#sites`, `#admin`, `#missions`… renvoie un état « accès non autorisé » sans monter le composant) ; rôle live dérivé uniquement de `/api/workspace`, jamais du sélecteur démo.
3. Coques dédiées : artisan mobile (bandeau navy, missions du jour, performance, CTA bleu, 5 onglets bas Tableau de bord/Missions/Devis/Messages/Profil — M35), entreprise cliente (M4/M66 : navigation latérale, organisation/site actifs, tableau filtrable), Super Admin (M43 : menus Artisans/Interventions/Devis & Factures/Clients/Avis/Messages/Paramètres avec vues réellement disponibles ou état indisponible lié à son bloqueur), client/public conservés et nettoyés.
4. Lecture des retours `?payment=`, `?connect=`, `?auth=` par relecture serveur (jamais « payé » depuis l’URL).
5. Sélection historique de devis par `quote_id` exact dans Documents.
6. `npm run check` vert ; captures 360 px et desktop dans docs/CLAUDE_VERIFICATION.md.

Découpage interne prévu (sous-modules à propriété unique, pas d’édition concurrente du monolithe) : `components/role/*` par acteur (artisan, enterprise, admin, public/client), `components/ui/*` partagés, `app/globals.css` + feuilles de rôle. Le monolithe `courant-app.tsx` devient la coque session/état et délègue.

## Contrats backend et intégration

- Actions existantes conservées : accept_mission / send_quote / accept_quote / start / complete / cancel ; routes workspace, interventions, professional, reports, sites, profile, documents, reviews, warranty, admin/artisans, payments.
- Contrats 08c10c5 pris en compte comme **non disponibles sur preview** : `/api/artisan` (save_profile, submit_application, set_availability, link_credential), `/api/interventions/[id]/operations` (decline_offer, reject_quote, save_appointment, set_travel_stage, save_report, reassign), `/api/admin/overview`, champs additifs workspace (`organization_members`, `artisan_profile`, `participants`). L’UI les appellera uniquement derrière une détection explicite (404/503 → état « indisponible : contrat backend en cours » rattaché au bloqueur). Aucune simulation live.
- PwaInstallControl (components/pwa-registration.tsx) : import prévu dans Profil/Aide **après intégration** du fichier Codex ; non importé tant que le fichier n’existe pas sur ma branche.

## Questions au pilote (non bloquantes, réponses via MISSIONS/CORRECTIONS)

- Q-C1 : pour `GET /api/workspace` additif, la projection `participants` fournira-t-elle `full_name` + `phone` du tiers uniquement à partir de `assigned` ? L’UI affichera « coordonnées disponibles après attribution » sinon.
- Q-C2 : `GET /api/admin/overview.capabilities` — format proposé côté UI : `Record<string, {available:boolean, reason?:string}>` clé = menu M43 (`artisans`, `interventions`, `quotes_invoices`, `clients`, `reviews`, `messages`, `settings`). Confirmer ou fournir le vôtre ; l’UI s’adaptera.
- Q-C3 : règles commerciales (commission, TVA par défaut, territoire, exploitant) : aucune valeur inventée côté UI ; les écrans affichent « à définir par l’exploitant ». Les propositions restent dans ce fichier.

## Bloqueurs connus (hors Claude)

- **ENV-CL-001 (bloquant pour build/preview locaux uniquement ; CI cloud préféré)** : le volume `/Volumes/Stockage` est plein (≈100 Mio libres au 30/10 22:55 AST ; `df -h`). Les dossiers projet pèsent ~0,5 Go chacun ; le reste du volume est occupé hors mission. J’ai supprimé `.next` de mon checkout (99 Mo) ; `next build` et le serveur de développement risquent d’échouer tant que de l’espace n’est pas libéré par le propriétaire. Le cache npm (`~/.npm`) est sur le disque système et vide.

- Supabase dédié : **actif depuis le 30/10 (projet kcpyjzndybfdlnhvscbs, 9 migrations appliquées, env preview configuré par le pilote)** — l’ancien refus pour factures est obsolète. La vérification live de la nouvelle UI dépend de l’intégration de 9fdb1e5 sur la preview combinée (QA cloud du pilote en cours) ; aucun compte ni secret n’est manipulé par Claude.
- Stripe test : connexion au compte indisponible pour l’instant → FIN-01/FIN-03 restent des dépendances bloquées ; l’UI relit le statut serveur et n’annonce aucun paiement.
- Contrats backend 003→009 intégrés par le pilote ; la détection d’indisponibilité de l’UI reste en place pour toute route absente d’un déploiement.
- Disque : aucun fichier hors mission ne sera supprimé ; build complet confié au CI cloud tant que le volume local est plein.

## Transfert de responsabilité (amendement A1)

Le propriétaire a indiqué qu’à 00:00 America/Martinique le 31 octobre 2026, tout le code (frontend, backend, PWA, tests) passe à Claude avec 1 à 10 agents ; Codex pilote, revoit, exécute les tests et intègre. Cette session reste la session lead unique. Web/PWA d’abord ; iOS + Android (backend partagé) après livraison web vérifiée, aucun scaffold natif avant. Les fichiers Codex ne seront modifiés qu’après la bascule enregistrée dans missions/web-pwa.

## Journal

- 2026-10-30 21:46 AST — lecture complète des sources de mission, claim écrit, npm ci effectué (exit 0), extraction des 20 images maîtresses. Début du checkpoint 1.
- 2026-10-30 22:05 AST — fusion du SHA Codex 6aaa1b3 ; fondation partagée (types, session, guard, ui, forms, demo) ; 5 lots d’espaces délégués à des agents internes à propriété de fichiers unique, puis relus.
- 2026-10-30 22:35 AST — corrections pilote appliquées : wording réseau incertain (api.ts), hash malformé (session.ts), CL-UI-005 copies utilisateur, CL-UI-006 guard d’identité avec tests différés, CL-003 relecture serveur des retours paiement. Contrats 006/007 consommés derrière détection d’indisponibilité. `npm run check` OK (28 tests), captures 360/1280 enregistrées.
- 2026-10-30 22:40 AST — checkpoint 1 poussé : 685738cb370b3616f6f87fc5a8f1c0623ffe0456. Limites : aucune preview en ligne de ce frontend vérifiée ; PwaInstallControl pas encore importé ; contrats 006/007 derrière détection d’indisponibilité ; copies utilisateur à relire sur les 5 espaces (checkpoint 2).
- 2026-10-30 23:20 AST — corrections CL-UI-003/004 poussées : 4f41fffe4e51e88ea6ed3f008917d9d6b72b6e38, puis libellés d’échec de paiement alignés dans les 3 espaces (commit suivant). tests/ui 21/21, typecheck OK.
- 2026-10-30 23:05 AST — checkpoint 2 poussé : a5c4faa8bd853ff97c7c5c562dd9dd56687f53fd (typecheck OK, tests/ui 16/16, build non relancé : disque plein ENV-CL-001).
