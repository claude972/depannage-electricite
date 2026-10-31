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
- status: blocked
- blocker: réponse réelle du lead à08h01 : limite hebdomadaire Claude, reset annoncé23h Martinique. Brouillons préservés ; reprendre le même propriétaire après réponse fournisseur valide, sans doublon.
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
- status: done
- branch: codex/web-pwa-backend
- base revision: d85da0657586f152ee9bba941d67345b4eead616
- objective: conserver un brouillon de devis par artisan/dossier, sans publier ni remplacer le devis envoyé avant une action explicite.
- owned files: migration010 additive quote drafts (aucune modification001–009), nouvelle route app/api/interventions/[id]/quote-draft/route.ts, tests ciblés SQL/API, docs/WEB_PWA_QUOTE_DRAFT_CONTRACT.md et docs/CODEX_QUOTE_DRAFT_VERIFICATION.md ; ajout ciblé d’étape CI si nécessaire coordonné avec pilote. Aucun frontend/paiement/modification des anciennes routes.
- deliverables: plan court et contrat strict publiés avant code ; save/load/discard/send avec version optimiste et erreurs409 explicites ; publication transactionnelle par règles existantes et consommation atomique du brouillon. Aucune nouvelle règle de TVA, validité, signature ou document légal inventée.
- acceptance: seul artisan actuellement attribué, autorisé et non suspendu peut gérer son brouillon ; envoi exige toutes les autorisations métier actuelles. Réaffectation, lecture autre artisan/client/admin directes, conflit de révision, send rollback, montants invalides et devis accepté inchangé couverts. Brouillon jamais compté envoyé/accepté ni visible client. Verrouillage cohérent organisation puis dossier, et refus des anciens chemins internes. La publication retourne quote_id exact du devis créé ; échec ne détruit pas le brouillon. No-store, aucun service-role navigateur.
- dependencies: règles003/005/008/009 et intervention_action actuelles, coordination UI Claude nécessaire avant branchement ; pas de Stripe ni données d’exploitant requis. Relais à Claude à00h si inachevé.
- verification report: CORRECTIONS.md / WEB-PWA-QUOTE-DRAFT-001, rapport exactSHA complémentaire.
- preview: intégration après revue obligatoire, pas de production.



- closure scope: lot serveur revu par Claude sur1be8f00 et testé sur Supabase/Next hébergés ; rapports complets dans CORRECTIONS.md. Interface utilisateur correspondante reste dans mission Claude globale in_progress ; aucune phase entière clôturée.
## Mission WEB-PWA-ADMIN-DIRECTORIES-001 — annuaires admin complets
- agent: codex
- status: done
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



- closure scope: lot serveur revu par Claude sur1be8f00 et testé sur Supabase/Next hébergés ; rapports complets dans CORRECTIONS.md. Interface utilisateur correspondante reste dans mission Claude globale in_progress ; aucune phase entière clôturée.
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


## Correction CL-BE-001 — dossier artisan et missions actives
- agent: codex
- status: in_progress
- branch: codex/web-pwa-backend
- base revision: fface1af11d62b19522cc5266b6f2b6b536209c0
- objective: empêcher qu’une modification du dossier professionnel révoque l’approbation de l’artisan et bloque ses missions déjà attribuées (finding Claude précédent).
- decision technique: refuser la modification self-service du dossier quand des missions sont assigned/quoted/accepted/in_progress/completed (non réglée) ; conserver la possibilité de gérer la disponibilité et le profil de contact séparément, sans relâcher l’approbation ni la suspension explicite admin. Une fois obligations réglées (paid) ou annulées (cancelled), le dossier peut être modifié et repasse normalement en examen.
- owned files: migration012 additive uniquement, tests SQL/API ciblés et étape CI si utile, docs/CODEX_ARTISAN_ACTIVE_GUARD_CONTRACT.md et docs/CODEX_ARTISAN_ACTIVE_GUARD_VERIFICATION.md. Pas de frontend, paiement ni modification001–011.
- deliverables: contrat/plan prépubliés avant code ; garde serveur et message de conflit ; sérialisation des attributions accept_mission ET admin reassign avec l’édition du profil, pour ne pas laisser la course recréer un artisan non approuvé avec mission active. Conserver toutes les vérifications d’éligibilité/role/montants existantes et rendre privés les anciens helpers.
- acceptance: édition refusée conserve dossier/approbation ; édition après règlement/annulation autorisée, completed non payé refusé ; suspension toujours prioritaire ; refus interrôles ; concurrence claim/édition examinée sous ordre org→dossier→profil→dossierartisan, sans verrouiller les interventions depuis la garde profil (éviter cycle). Les opérations courantes ne gagnent pas d’exception d’approbation. Tests et revue exacte puis QA réelle bornée sur base dédiée après application autorisée. Aucun compteur de tests isolé ne prouve la concurrence réseau.
- dependencies: règles003/008/009/010 ; RPCs existantes permettent la recette sur la preview déjà prête, sans attendre un nouvel HTTP déployé. Relais à Claude à00h si lot inachevé.
- verification report: CORRECTIONS.md / CL-BE-001 et rapport complémentaire exactSHA.


## Amendment A2 — objectif08h, services différés et reprise de nuit
Le propriétaire demande le résultat le31octobre2026 à08h America/Martinique et autorise explicitement Vercel/Stripe à attendre. Continuer le reste sans bloquer le code/tests. La preuve locale/backend réel peut établir le checkpoint fonctionnel préalable au natif hors ces services différés ; aucune nouvelle preview ni paiement réel ne sera prétendu. Lire docs/NIGHT_DELIVERY_8H.md et les derniers findings CORRECTIONS avant action. Dès00h tout code, y compris code des tests, appartient à Claude ; Codex conserve pilotage/revues/exécution/intégration. Reprises actives00–07 et bilan distinct08, pas de doublon à créer.


## Relais effectif00h — propriété du code
Depuis le31octobre00h America/Martinique, l’affectation Codex devient pilotage/revue/exécution/intégration uniquement. Aucun agent Codex ne doit produire ou modifier de source applicative ou de code de test ; les rapports et coordination restent autorisés. Les branches codex/* demeurent comme preuves pré-relais, ne pas y reprendre du développement. Claude lead b4b555f0 conserve la direction du code et délègue au besoin dans la limite1–10 agents réels.

## Mission NATIVE-DOCUMENT-GATEWAY-001 — backend partagé hors Vercel
- agent: claude
- status: blocked
- blocker: réponse réelle du lead à08h01 : limite hebdomadaire Claude, reset annoncé23h Martinique. Brouillons préservés ; reprendre le même propriétaire après réponse fournisseur valide, sans doublon.
- branch: claude/web-pwa-backend
- base revision: 309ed9f2815c855f5e99ecad6368e2fe96f58975
- worktree: /Users/claudebrafa/.codex/worktrees/depannage-claude-backend
- delegate: lead b4b555f0 désigne un agent Claude backend distinct ; aucun doublon de la session lead.
- objective: permettre les uploads privés authentifiés depuis le futur natif et fermer la fenêtre entre autorisation initiale et insertion de métadonnées, en réutilisant les validations et règles Web existantes. Ce backend peut avancer pendant les corrections Web ; aucun scaffold mobile avant son checkpoint fonctionnel.
- owned files: supabase/functions/native-document-upload/**, lib/shared/document-policy.ts si utile, migration013 additive réservée à la finalisation des documents, app/api/documents/route.ts refactor coordonné pour validations/finalisation partagées, tests ciblés, docs/CLAUDE_NATIVE_DOCUMENT_CONTRACT.md et rapport. Ne pas modifier les autres routes, UI, migrations001–012, config Auth ou mobile package en parallèle.
- deliverables: lire les docs officielles Supabase Edge/Auth actuelles, produire/pousser plan et contrat avant code ; gateway JWT utilisateur vérifié côté serveur, même magic bytes/MIME/4MiB que le Web ; pas de service key dans l’app ni bucket public. Autorisation finale sous verrous cohérents org→dossier, contrôles de chemin propriétaire/objet réel et métadonnées, compensation des objets créés par la tentative en cas d’échec. Si idempotence retenue, corrélation serveur réelle (hash/contenu/clé), jamais nom/date comme preuve.
- acceptance: anonyme/token invalide/tiers/rôle lecture seule/droits révoqués refusés avant métadonnées ; authentifié autorisé réussi ; retrait concurrent avant finalisation ne crée pas un document accessible ; aucun effacement d’objet d’une autre tentative ; pas d’élargissement des helpers/RLS existants ni de cache privé. Exécuter tests significatifs + revue indépendante et recette contrôlée dans le seul projet dédié avant clôture. Déploiement Edge de test par pilote après revue, pas d’achat/production client.
- dependencies: backend012 actif, contrat Web documents existant, futur natif utilise SDK Supabase/RPC non-paiement plutôt qu’un secret de bypass Vercel. Préserver le parcours de pièces artisan sans dossier intervention.
- verification report: CORRECTIONS.md / NATIVE-DOCUMENT-GATEWAY-001 et rapport exactSHA complémentaire.


## Mission WEB-ACCEPTANCE-TESTS-001 — scripts de recette pilotables
- agent: claude
- status: blocked
- blocker: réponse réelle du lead à08h01 : limite hebdomadaire Claude, reset annoncé23h Martinique. Brouillons préservés ; reprendre le même propriétaire après réponse fournisseur valide, sans doublon.
- branch: claude/web-pwa-qa
- base revision: 309ed9f2815c855f5e99ecad6368e2fe96f58975
- worktree: /Users/claudebrafa/.codex/worktrees/depannage-claude-qa
- objective: fournir des tests de recette navigateur réutilisables et un nettoyage sûr, pour que Codex exécute sans écrire/modifier de code de test après minuit.
- owned files: scripts/qa/** et docs/CLAUDE_WEB_ACCEPTANCE_CONTRACT.md/rapport ; aucun fichier applicatif, package, migration ou secret. Dépendances existantes injectées depuis les caches internes, jamais chemins personnels figés dans le code publié.
- deliverables: contrat/plan puis scripts CLI configurables base-url/sha/projet attendu/chemin de credentials privé, auteurs Claude ; scénarios viewer/manager/site-grant/owner, réponses tardives supportA→B, création support commit+réponse perdue+remount/rechargement, véritable éditeur de brouillon save/reload/409/send, photos reprise, annuaires anciens et captures M35/M43/M66. Réutiliser les anciens scripts temporaires pré-minuit comme référence sans transformer leurs résultats en nouvelle preuve.
- acceptance: aucun token/password/HAR dans les logs, aucune donnée QA dans le bundle ; fixtures identifiées par IDs manifestés et cohorte unique, nettoyage FK ordonné (support events/messages/tickets, drafts, documents/Storage, messages/quotes/jobs/audits/org/profiles/Auth), readback et échec de cleanup signalé. Seul projet dédié explicitement attendu et URL locale/preview autorisée. Ne jamais supprimer d’autres cohortes/utilisateurs. Les anomalies de sélecteur/headless sont distinctes des défauts app.
- dependencies: le lead b4b555f0 délègue un agent Claude test distinct ; Codex relit puis exécute les scripts avec paramètres et secrets fournis seulement à l’exécution. Les tests touchant au cloud ne sont pas lancés par le simple import. Les preuves restent rattachées au SHA testé et à local/cloud, jamais à une supposée nouvelle preview.
- verification report: CORRECTIONS.md / WEB-ACCEPTANCE-TESTS-001, rapport exactSHA.


## Natif — missions préparées, porte Web encore fermée (01h20 AST)
Ces entrées préparent le relais ; elles N’AUTORISENT PAS encore de scaffold, projet EAS ou build. Dépendance commune : Codex consigne un checkpoint fonctionnel Web/PWA réel, hors Vercel/Stripe différés. Base proposée actuelle62b1f7fca7532cb37fbad338607dea472a691733, à actualiser explicitement au SHA de ce checkpoint avant claim. Le lead Claude b4b555f0 reste unique et délègue dans la limite1–10 agents réels ; pas de doublons. Lire docs/NATIVE_READINESS_PLAN.md et docs/NATIVE_BUILD_PREFLIGHT.md. Ne pas importer les versions React/Next du Web dans Expo ; lire expo-overview puis les skills Expo/EAS adaptés, vérifier les docs officielles du SDK retenu.

### NATIVE-FOUNDATION-001
- agent: claude
- status: pending
- branch: claude/native-foundation
- scope: apps/mobile/package*.json, configuration Expo/TypeScript, routes racines et (auth), src/core/**, thème et composants partagés natifs. Seul propriétaire des dépendances, session et navigation racine. Checkout sur disque interne à préparer après gate ; Web inchangé.
- deliverables: vrai package Expo/React Native, contrat session/données/navigation publié avant code fonctionnel ; SDK/versions verrouillés ; SecureStore, hydratation, logout/A→B et revalidation AppState ; Auth Supabase réelle et lectures/RPC sous JWT/RLS. Pas de WebView, service key ou secret bypass. Liens natifs PKCE à coordonner avec serveur et régression SSR Web ; aucune clé/token dans URL ou logs.
- acceptance: typecheck/expo-doctor/export, connexion réelle et rôle serveur, erreurs/offline honnêtes, session tardive sans effet sur nouveau compte, stockage sécurisé vérifié ; première livraison commune avant missions Client/Artisan.

### NATIVE-CLIENT-001
- agent: claude
- status: pending
- branch: claude/native-client
- scope: apps/mobile/src/app/(client)/**, src/screens/client/**, src/features/client/** uniquement. Base contractuelle = premier checkpoint Fondation, SHA à consigner avant départ.
- deliverables: demande électrique, estimation distincte du devis, photos, liste/détail dossiers, devis exact et acceptation, messages, profil ; interactions natives et références mobiles. Gateway upload attend correction/revue/recette cloud ; reprise incertaine sans renvoi automatique ni confirmation nom/date.
- acceptance: nominal/erreurs/vide/chargement, validation/double soumission, refus intercomptes et session A→B, photos <=4MiB, données réelles autorisées et aucun paiement simulé ; captures et parcours exécutés sur iOS/Android.

### NATIVE-ARTISAN-001
- agent: claude
- status: pending
- branch: claude/native-artisan
- scope: apps/mobile/src/app/(artisan)/**, src/screens/artisan/**, src/features/artisan/** uniquement ; dépendances/session/racine à Fondation. Base contractuelle = premier checkpoint Fondation exact.
- deliverables: offres anonymisées/acceptation atomique/refus, missions et devis brouillon (version/conflit/envoi exact), rendez-vous/rapport, disponibilité et pièces ; pas de contournement approbation/suspension.
- acceptance: vrais RPC/RLS, concurrence acceptation, conflits sans écrasement, état payé lu du serveur seulement, pièces privées et sessions isolées ; parcours sur les deux plateformes.

### NATIVE-EAS-QA-001
- agent: claude
- status: pending
- branch: claude/native-delivery
- scope: apps/mobile/eas.json, scripts/recette natifs, rapports. extra.eas.projectId transféré par Fondation explicitement, aucune édition concurrente config/manifeste.
- deliverables: contrôler compte/owner/quota puis projet EAS exact ; iOS simulateur et Android APK interne cloud, installation et recette des vrais artefacts. Codex revoit, lance et intègre ; code de scripts écrit par Claude. Aucun achat, soumission publique store ou production.
- acceptance: chaque artefact porte SHA/buildID/plateforme et preuve de lancement/parcours ; binaire simulateur distinct d’IPA iPhone ; scans secrets et tests Auth froid/chaud/recovery, permissions, erreurs et fidélité mobile. Pas d’annonce de livraison sur seul lancement de build. OTA seulement avec binaire compatible vérifié.

Entreprise cliente et Super Admin restent actuellement livrés/recettés Web ; le périmètre natif ci-dessus client/artisan est explicite dans ce plan et ne retire aucun back-office du produit. Les capacités non implémentées restent listées, pas annoncées complètes à l’échéance.
