# Missions

## Mission: Livraison Web et PWA fidèle aux références

Mission ID: WEB-PWA-20261030
Coordination branch: missions/web-pwa
Base revision: 3c1ca2ce978f354556c0c691d4ac0d3088308b36
Corrections: CORRECTIONS.md (repository root)

## Objective
Livrer la version Web responsive et PWA installable selon docs/PLAN_REPRISE.md, les neuf PDF et cinq archives, sans style IA générique. Les 76 capacités restent tracées ; signaler les règles commerciales et fournisseurs bloquants plutôt que fabriquer une réussite. Le propriétaire autorise implémentation autonome, délégation à Claude, commits/push et previews ; pas de production ni paiement réel. Codex pilote, Claude réalise UI avec ses sous-agents nécessaires.

## Shared contracts and dependencies
- Read AGENTS.md, DESIGN.md, CLAUDE.md, docs/PLAN_REPRISE.md, audit/REAUDIT_CONSOLIDE.md, COUVERTURE_PLAN.csv and source pages before implementing. Current plan's preparation-only status is superseded by owner's explicit Web/PWA implementation authorization.
- Claude worktree: /Volumes/Stockage/Projets/depannage-web-pwa-claude ; Codex worktree: /Volumes/Stockage/Projets/depannage-web-pwa-codex. Pilot coordination worktree: /Volumes/Stockage/Projets/depannage-web-pwa-coordination. Do not switch another agent checkout or edit its owned paths.
- Claude owns components/courant-app.tsx, new role components/styles, app/globals.css, app/page.tsx, public UI-only artwork under public/design, UI tests under tests/ui. Codex owns app/api, app/auth, lib, supabase, domain/server tests, next.config.ts, app/layout.tsx, app/manifest.ts, public/sw.js, public/offline.html, PWA icons, components/pwa-registration.tsx and shared infrastructure configs/package files. Ask pilot before shared-file changes. docs implementation reports belong to their agent; pilot owns audit/plan progress and coordination.
- Existing GET /api/workspace response and POST interventions/actions contracts preserved additively. Existing actions: accept_mission/send_quote/accept_quote/start/complete/cancel. Existing professional/reports/sites/profile/documents/reviews/warranty/payments routes kept. Never assume proposed refusal/RDV/dispatch/member endpoints exist until published contract. Codex publishes new contracts in docs/WEB_PWA_CONTRACTS.md on its branch and sends them to Claude.
- Frontend P0: clear all account/professional state and pending-response context on identity change/logout/expiry; role guard actual rendered views and contextual selection; no trusting demo roles in live mode.
- PWA: manifest + standalone + icons + HTTPS service worker with offline public fallback. Never cache /api, auth, private pages, Stripe or authenticated data. No pretending offline mutation sync exists. Show network failure/retry honestly.
- UI masters: artisan M35/M36/M34/M65/M67, Super Admin M43, enterprise M4/M66 + V5-C01/C05/C08. Reference visuals in PDF, not the minimal source JSX. Screenshot comparison mandatory 360px and desktop.
- Data/finance: dedicated Supabase only; preserve existing site électricité; Stripe test only; no actual fees/taxes/commission/identity/territory invented. No secret in source/logs. Absent services remain explicit blockers. Default retain existing stack and CSS without introducing Tailwind blindly.
- Integration: both branches from common base; separate checkpoints then pilot integration branch integration/web-pwa. Each work checkpoint committed/pushed only after targeted verification. npm run check, SQL/RLS tests, cross-role negative tests, PWA installed/offline/logout privacy, UI accessibility + visual preview and Stripe integration test where secrets available.
- Remote coordination files must be fetched/read before starting. Confirm and claim only own assignment; report exact session/branch/checkpoint. Preserve other entries. Pilot serializes coordination updates; send status payloads to pilot, do not force-push.

## Claude assignment
- agent: claude
- status: in_progress
- branch: claude/web-pwa-ui
- deliverables: full dedicated public/client/artisan/enterprise/SuperAdmin frontend matching source composition; responsive navigation; all loading/error/empty/validation states; live integration with available/provided contracts; P0 account/cache guards; visual evidence and UI/accessibility tests. Delegate coherent sublots internally with isolated ownership.
- owned files: frontend paths above only
- acceptance criteria: each of 76 capabilities tracked, no unsupported action silently simulated live; M35 recognizable with mission rows/performance/bottom nav; M43 menus and actual available views; enterprise active org/site and accurate filtering; no cross-session cached data; online preview checked; implementation report and exact revision pushed; mandatory review of Codex before done
- verification report: CORRECTIONS.md, WEB-PWA-20261030 / claude
- implementation revision: 6962be6ccfae615551d2575edb8ca05420aef635 (checkpoint UI en revue ; trois corrections photo ouvertes, mission globale in_progress)
- preview: https://depannage-electricite-1ng8kugh5-brafas-projects.vercel.app (0017b48 vérifié UI/PWA/Auth SSR ; checkpoints suivants intégrés pour recette, photos6962 pas encore acceptées)
- blockers: Stripe test non connecté ; corrections/reviews UI et fonctions du plan restantes. Supabase dédié maintenant actif et testé ; aucune donnée commerciale inventée.

## Codex assignment
- agent: codex
- status: in_progress
- branch: codex/web-pwa-backend
- deliverables: auth/data/RLS/session contracts, domain commands per plan, backend gaps, reliable Stripe test state handling, PWA infrastructure and private-cache protection, integration/negative/concurrency tests; provision dedicated services only when possible; coordinate and review Claude
- owned files: backend/PWA paths above only
- acceptance criteria: preserve atomic claim/server amounts/webhook integrity; actor/org/site boundaries, no private PWA cache, installable manifest/icons/offline public page, typecheck/tests/build, SQL and remote service limitations recorded; preview checked; mandatory review by Claude before done
- verification report: CORRECTIONS.md, WEB-PWA-20261030 / codex
- implementation revision: d85da0657586f152ee9bba941d67345b4eead616 (admin pagination en revue), contrat quote drafts de6091d publié avant code010 en cours
- preview: https://depannage-electricite-git-integration-web-pwa-brafas-projects.vercel.app ; preuve liée à chaque SHA dans CORRECTIONS.md
- blockers: Stripe test non connecté et décisions commerciales réelles ; Supabase dédié provisionné neuf migrations et tests cloud ciblés réussis. Aucun paiement réel autorisé.

## Cross-verification
Claude reviews exact pushed Codex revision; Codex reviews exact pushed Claude revision. Findings with IDs, owner, reviewed SHA, evidence, correction, fix SHA and recheck in CORRECTIONS.md. ready_for_review is not done. Combined result must be verified on Vercel Preview before completion. Failed or unavailable tests remain open.

## Amendment WEB-PWA-20261030-A1 — propriétaire, relais de minuit et mobile

Instruction explicite reçue : continuer le codage autonome ; à partir du **31 octobre 2026 00:00 America/Martinique**, Claude prend **tout le codage**, avec **1 à 10 agents Claude selon besoin** ; Codex conserve pilotage, revues, exécution des tests, intégration, rapports et coordination. Respecter la capacité effective du CLI, ne pas prétendre dix agents actifs s’ils ne le sont pas. Ne pas lancer de sessions doublons ; le lead actuel est b4b555f0.

Avant minuit, les affectations split en cours restent valables. Après minuit, transférer les prochains lots backend/PWA/front et le code de tests à Claude sur des branches/checkouts isolés. Garder les checkpoints déjà vérifiés et les corrections en cours, sans toucher aux sessions étrangères. Codex peut lancer les tests et formuler les corrections ; Claude produit le code.

Après la livraison Web/PWA vérifiée, réaliser les applications **iOS et Android** : lot mobile désormais demandé, plus simple option conditionnelle. Préserver le backend partagé et les références client/artisan ; définir le périmètre exact des comptes mobiles et auth/retours natifs. Proposition technique à confirmer par découverte : Expo/React Native avec builds de test EAS, skills expo-overview puis structure/router/UI/data/auth/build appropriés. Aucun scaffold mobile avant le checkpoint Web/PWA de livraison. Pas de publication stores/production/débit réel implicite.

Relais unique créé dans le chat courant : automation `relais-claude-minuit-d-pannage-web-pwa-puis-mobile`, active, minuit prochain, une occurrence. Le relais lit ces fichiers et l’inventaire réel des sessions avant toute attribution.

## Mission: Revue croisée Claude du backend et de la PWA
Mission ID: WEB-PWA-REVIEW-001
Coordination branch: missions/web-pwa
Base revision: 6aaa1b36b99e64de4e0544780c8234c508cc1fd5
Corrections: CORRECTIONS.md
Objective: revue indépendante Claude du code Codex exact (003/004/005, API, droits, paiements, consentement devis et PWA). Aucun doublon de l’implémentation frontend ; aucun code modifié par le reviewer.
Shared contracts/dependencies: lire mission WEB-PWA-20261030 et rapports ; verdict borné au SHA exact, findings sourcés et tests effectivement exécutés ; Supabase/Stripe distants non disponibles, ne pas les déclarer passés.
### Claude review assignment
- agent: claude
- status: ready_for_review
- branch: claude/web-pwa-review
- worktree: /Volumes/Stockage/Projets/depannage-web-pwa-review
- deliverables: rapport de revue exactSHA, problèmes concrets ou absence de finding dans périmètre, résultats des contrôles et limites
- owned files: aucun code ; rapport final CLI transmis au pilote pour CORRECTIONS.md
- acceptance criteria: lire migrations/droits/routes et PWA ; vérifier refus accès, idempotence, consentement exact, protection cache et installation ; signaler critères non testables ; ne pas confondre revue avec recette cloud
- verification report: CORRECTIONS.md / WEB-PWA-REVIEW-001 / claude, attendu après revue
- implementation revision: 6aaa1b36b99e64de4e0544780c8234c508cc1fd5, cible de revue seulement
- preview: https://depannage-electricite-hloqx4c89-brafas-projects.vercel.app (intégration b0fa1df, nouvelle UI pas encore intégrée)
- blockers: pas de services Supabase/Stripe réels, pas d’accès secrets donné au reviewer
### Codex coordination assignment
- agent: codex
- status: in_progress
- branch: missions/web-pwa
- deliverables: publier rapport, traiter findings avec propriétaire et vérifier corrections/intégration
- owned files: MISSIONS.md/CORRECTIONS.md uniquement pour cette sous-mission
- acceptance criteria: rapport réellement reçu et appliqué au SHA exact, aucun statut done sans revue croisée/preview requise
Cross-verification: Codex examine les preuves de Claude et fait corriger les findings ; le rapport fait partie de la revue obligatoire de l’affectation principale, sans supprimer les limites d’intégration.


## Mission WEB-PWA-ADMIN-LISTS-001 — dossiers admin paginés
- agent: codex
- status: done
- branch: codex/web-pwa-backend
- base revision: f132f6a (intégration de référence8cdf5af)
- objective: permettre au Super Admin de retrouver les anciens dossiers au-delà des fenêtres100 sans élargir les projections ou autorisations.
- owned files: nouvelle route app/api/admin/interventions/route.ts et, seulement si nécessaire, migration010 additive dédiée à cette lecture ; tests API/SQL ciblés, docs/WEB_PWA_ADMIN_LISTS_CONTRACT.md et docs/CODEX_ADMIN_LISTS_VERIFICATION.md. Aucun fichier frontend ou paiement, aucune modification des anciennes migrations.
- deliverables: contrat strict publié avant code, liste admin paginée stable et recherche/filtres documentés, détail via API existante si elle couvre le besoin ; projections minimales et anti-énumération interrôles.
- acceptance: admin seulement côté serveur/RLS, pagination sans doublons sur jeu déterministe supérieur100, filtres appliqués avant pagination, curseur et limites invalides refusés, tri documenté, aucun total extrapolé des seules lignes, no-store, tests négatifs et rapport exactSHA. Bornage liste existante conservé pour dashboard. Frontend Claude consommera le contrat séparément.
- dependencies: API server helpers et schéma actuel, Supabase dédié prêt ; pas de Stripe nécessaire. Relais à Claude à00h si lot non terminé.
- verification report: CORRECTIONS.md / WEB-PWA-ADMIN-LISTS-001, rapport complémentaire docs/CODEX_ADMIN_LISTS_VERIFICATION.md
- preview: integration/web-pwa après revue, pas de production



- implementation revision: d85da0657586f152ee9bba941d67345b4eead616, revue Claude sans finding et recette Auth/PostgREST réelle fe4, rapports publiés CORRECTIONS.md. Fermeture du lot serveur uniquement ; UI admin reste à intégrer/tester.
## Mission WEB-PWA-QUOTE-DRAFT-001 — brouillons privés de devis
- agent: codex
- status: in_progress
- branch: codex/web-pwa-backend
- base revision: d85da0657586f152ee9bba941d67345b4eead616
- objective: conserver un brouillon de devis par artisan/dossier, sans publier ni remplacer le devis envoyé avant une action explicite.
- owned files: migration010 additive quote drafts (aucune modification001–009), nouvelle route app/api/interventions/[id]/quote-draft/route.ts, tests ciblés SQL/API, docs/WEB_PWA_QUOTE_DRAFT_CONTRACT.md et docs/CODEX_QUOTE_DRAFT_VERIFICATION.md ; ajout ciblé d’étape CI si nécessaire coordonné avec pilote. Aucun frontend/paiement/modification des anciennes routes.
- deliverables: plan court et contrat strict publiés avant code ; save/load/discard/send avec version optimiste et erreurs409 explicites ; publication transactionnelle par règles existantes et consommation atomique du brouillon. Aucune nouvelle règle de TVA, validité, signature ou document légal inventée.
- acceptance: seul artisan actuellement attribué, autorisé et non suspendu peut gérer son brouillon ; envoi exige toutes les autorisations métier actuelles. Réaffectation, lecture autre artisan/client/admin directes, conflit de révision, send rollback, montants invalides et devis accepté inchangé couverts. Brouillon jamais compté envoyé/accepté ni visible client. Verrouillage cohérent organisation puis dossier, et refus des anciens chemins internes. La publication retourne quote_id exact du devis créé ; échec ne détruit pas le brouillon. No-store, aucun service-role navigateur.
- dependencies: règles003/005/008/009 et intervention_action actuelles, coordination UI Claude nécessaire avant branchement ; pas de Stripe ni données d’exploitant requis. Relais à Claude à00h si inachevé.
- verification report: CORRECTIONS.md / WEB-PWA-QUOTE-DRAFT-001, rapport exactSHA complémentaire.
- preview: intégration après revue obligatoire, pas de production.


## Mission WEB-PWA-ADMIN-DIRECTORIES-001 — annuaires admin complets
- agent: codex
- status: in_progress
- branch: codex/admin-directories
- base revision: d85da0657586f152ee9bba941d67345b4eead616
- worktree: /Volumes/Stockage/Projets/depannage-web-pwa-admin-directories
- objective: rechercher et paginer artisans, clients et organisations au-delà des100 entrées du dashboard, sans inventer des commandes de finance/support.
- owned files: nouvelle route app/api/admin/directory/route.ts, nouveau helper lib/supabase/admin-directory.ts si nécessaire, tests/admin-directory.test.ts, docs/WEB_PWA_ADMIN_DIRECTORY_CONTRACT.md et docs/CODEX_ADMIN_DIRECTORY_VERIFICATION.md. Aucune modification des anciennes routes, migrations, frontend, package ou droits RLS.
- deliverables: contrat strict prépublié avant code ; type artisans/clients/organizations, projections minimales reprises de l’overview autorisé, pagination stable timestamp/id, recherche serveur sûre et total exact avant curseur ; détail UUID seulement si nécessaire à l’ancien dossier et projection explicitement définie. Ne pas exposer Auth/email/coordonnées supplémentaires.
- acceptance: session vérifiée admin, refus des autres rôles et paramètres invalides ; curseurs liés au type/filtres, >100 éléments par type sans doublons sur jeu fixe, recherche avant limite, données privées/no-store ; conservation des règles de dossier artisan existantes ; tests ciblés de route réelle avec SDK/provider synthétique, puis revue et recette cloud en intégration.
- dependencies: pagination interventions déjà revue d85, backend Supabase dédié actif ; UI Claude branchera après contrat vérifié. Relais à Claude à00h si lot inachevé.
- verification report: CORRECTIONS.md / WEB-PWA-ADMIN-DIRECTORIES-001 et rapport complémentaire exactSHA.
- preview: intégration après revue, pas de production.


## Mission WEB-PWA-SUPPORT-001 — assistance privée persistante
- agent: codex
- status: in_progress
- branch: codex/web-pwa-backend
- base revision: 254d497e92b2e6e6286dbb59254660dc39aa27f3
- objective: remplacer l’absence de circuit d’assistance par des demandes privées suivies, sans lecture supplémentaire des conversations personnelles ni promesse de rappel/SLA.
- owned files: migration011 additive support tickets, nouvelles routes app/api/support/route.ts et app/api/support/[id]/route.ts si utile, tests ciblés et étape CI SQL isolée coordonnée, docs/WEB_PWA_SUPPORT_CONTRACT.md et docs/CODEX_SUPPORT_VERIFICATION.md. Aucun frontend/ancienne migration/paiement.
- deliverables: plan/contrat prépubliés avant code ; utilisateur authentifié crée/lit/répond à ses tickets, administration plateforme lit/répond/traite avec historique append-only ; listes serveur paginées et détail ; états/transition/limites stricts documentés. Notifications uniquement dans l’app, aucun e-mail/SMS/appel envoyé, aucun délai inventé.
- privacy: ticket visible uniquement créateur et admin ; si rattaché à un dossier, lecture/écriture utilisateur exigent encore l’accès courant au dossier (retrait/portée site respectés). Aucun autre membre/artisan ne gagne de lecture par simple appartenance, aucun ticket anonyme ni élargissement messages. Le lien à un dossier ne donne aucun droit d’action sur ce dossier.
- acceptance: autorité côté serveur/RLS, enums/transitions validées, avis internes admin jamais renvoyés au client si retenus (préférer premier lot sans notes internes), auteur serveur et historique immuable, filtres/curseur/total cohérents, bornes de texte/pagination/rate limit, refus intercomptes/orgs/retrait, aucun statut succès simulé. Tests SQL/API ciblés plus revue Claude et recette preview après application autorisée.
- dependencies: helpers009, projet dédié ; frontend Claude branchera le contrat après publication. Ce lot ne remplit pas seul contact/rappel public, chat/SLA ou séparation des opérateurs finance/support. Relais à Claude à00h si inachevé.
- verification report: CORRECTIONS.md / WEB-PWA-SUPPORT-001 et rapport exactSHA complémentaire.
- preview: intégration après revue, pas de production.
