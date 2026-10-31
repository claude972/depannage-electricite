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
- implementation revision: not yet implemented
- preview: not yet deployed
- blockers: backend services and proposed contracts pending verification; commercial decisions recorded, not fabricated

## Codex assignment
- agent: codex
- status: in_progress
- branch: codex/web-pwa-backend
- deliverables: auth/data/RLS/session contracts, domain commands per plan, backend gaps, reliable Stripe test state handling, PWA infrastructure and private-cache protection, integration/negative/concurrency tests; provision dedicated services only when possible; coordinate and review Claude
- owned files: backend/PWA paths above only
- acceptance criteria: preserve atomic claim/server amounts/webhook integrity; actor/org/site boundaries, no private PWA cache, installable manifest/icons/offline public page, typecheck/tests/build, SQL and remote service limitations recorded; preview checked; mandatory review by Claude before done
- verification report: CORRECTIONS.md, WEB-PWA-20261030 / codex
- implementation revision: not yet implemented
- preview: not yet deployed
- blockers: Supabase/Stripe credentials and commercial rules require recheck; no live payments authorized

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
