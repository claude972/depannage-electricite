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

## Checkpoint 2 — livré (SHA dans le journal)

- contenu : `PwaInstallControl` placé dans les profils des 4 rôles et l’aide publique via `components/app/install-panel.tsx` ; contrat 009 (accès par site) consommé dans Membres (portée par membre, éditeur owner, invitations avec portée, « Votre accès ») ; dossier artisan lisible par l’admin (`/api/artisan?user_id`) dans la fiche candidature ; revue des copies utilisateur CL-UI-005 sur les 5 espaces (aucun chemin API, RPC, fichier ou identifiant de bloqueur visible ; `blocker` conservé en attribut de données) ; suppression des doublons CSS locaux devenus globaux ; relecture du retour paiement par `GET /api/payments/status` (CL-003) ; guard d’identité (CL-UI-006) avec tests.
- contrôles : `npx tsc --noEmit` OK ; `tests/ui` 16/16 ; **`next build` non relancé pour ce checkpoint : volume plein (ENV-CL-001), 112 Mio libres** — le build du checkpoint 1 (685738c) reste la dernière preuve complète ; à relancer par le pilote sur l’intégration (CI) ou ici dès espace libéré.
- incident : l’écriture d’`admin-space.tsx` a échoué une fois (ENOSPC, fichier tronqué) ; reconstruit depuis HEAD + modifications prévues, vérifié par typecheck ; aucune autre modification perdue (diff relu).
- ce que Codex doit vérifier : Membres → « Accès aux sites » (owner) enregistre et relit la portée ; invitation avec portée « selected » ; non-owner voit « Votre accès » uniquement ; fiche admin d’un artisan lit le dossier et les pièces ; bouton d’installation présent dans Profil et Aide, silencieux quand l’installation n’est pas possible.

## Prochain livrable (checkpoint 3)

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

- **ENV-CL-001 (bloquant pour build/preview locaux)** : le volume `/Volumes/Stockage` est plein (≈100 Mio libres au 30/10 22:55 AST ; `df -h`). Les dossiers projet pèsent ~0,5 Go chacun ; le reste du volume est occupé hors mission. J’ai supprimé `.next` de mon checkout (99 Mo) ; `next build` et le serveur de développement risquent d’échouer tant que de l’espace n’est pas libéré par le propriétaire. Le cache npm (`~/.npm`) est sur le disque système et vide.

- Supabase dédié refusé (factures organisation en retard) : mode live indisponible sur preview ; tous les états live affichent le 503 serveur existant honnêtement, la démonstration reste explicite et isolée.
- Nouveaux contrats backend en implémentation : UI livrée avec états « indisponible » tant que la preview combinée ne les expose pas.

## Transfert de responsabilité (amendement A1)

Le propriétaire a indiqué qu’à 00:00 America/Martinique le 31 octobre 2026, tout le code (frontend, backend, PWA, tests) passe à Claude avec 1 à 10 agents ; Codex pilote, revoit, exécute les tests et intègre. Cette session reste la session lead unique. Web/PWA d’abord ; iOS + Android (backend partagé) après livraison web vérifiée, aucun scaffold natif avant. Les fichiers Codex ne seront modifiés qu’après la bascule enregistrée dans missions/web-pwa.

## Journal

- 2026-10-30 21:46 AST — lecture complète des sources de mission, claim écrit, npm ci effectué (exit 0), extraction des 20 images maîtresses. Début du checkpoint 1.
- 2026-10-30 22:05 AST — fusion du SHA Codex 6aaa1b3 ; fondation partagée (types, session, guard, ui, forms, demo) ; 5 lots d’espaces délégués à des agents internes à propriété de fichiers unique, puis relus.
- 2026-10-30 22:35 AST — corrections pilote appliquées : wording réseau incertain (api.ts), hash malformé (session.ts), CL-UI-005 copies utilisateur, CL-UI-006 guard d’identité avec tests différés, CL-003 relecture serveur des retours paiement. Contrats 006/007 consommés derrière détection d’indisponibilité. `npm run check` OK (28 tests), captures 360/1280 enregistrées.
- 2026-10-30 22:40 AST — checkpoint 1 poussé : 685738cb370b3616f6f87fc5a8f1c0623ffe0456. Limites : aucune preview en ligne de ce frontend vérifiée ; PwaInstallControl pas encore importé ; contrats 006/007 derrière détection d’indisponibilité ; copies utilisateur à relire sur les 5 espaces (checkpoint 2).
