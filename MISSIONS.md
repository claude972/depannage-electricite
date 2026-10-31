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


## Mission VISUAL-FIDELITY-001 — reprise fidèle aux maquettes, accès Claude reconnecté
- agent: claude
- status: ready_for_review (checkpoint 1 entreprise shell/sites/interventions, implementation e7aaef7bddb8559a8442ecd918c3f6d160b8520c ; contrat ca7bda6 ; rapport CORRECTIONS.md § VISUAL-FIDELITY-001 — claude checkpoint 1 ; preview en ligne non réalisée, Vercel différé)
- desktop session: local_f1ccd82d-80d6-45b6-b176-ea12b56f0317, titre Visual fidelity web PWA design, worktree/branche design confirmés dans l’interface.
- lead: Codex pilote cette mission ; propriétaire de code Claude Desktop (nouvelle session dédiée sur le worktree design), à confirmer par réponse utile. Le CLI b4b555f0 et un processus neuf renvoient toujours weekly limit malgré auth connectée ; ils ne possèdent pas une exécution concurrente de cette mission. Aucun doublon design ne doit être lancé. Tout code demeure Claude.
- branch: claude/web-pwa-design
- base revision: 9b3dae03e1a413ffe89b34e0db7553ddc1b3ade9
- worktree: /Users/claudebrafa/.codex/worktrees/depannage-claude-design (interne, préparé propre, aucun code créé par Codex).
- priority: le propriétaire rejette explicitement le style IA du site ouvert depannage-electricite-seven.vercel.app/#sites et réitère la fidélité aux PDF. Cette adresse est l’ancien déploiement, mais son ancienneté ne justifie pas un design générique. Le style des dernières branches n’est pas approuvé par déduction des tests fonctionnels.
- objective: reprendre structure, disposition, navigation, hiérarchie, densité des tableaux, proportions, typographie et traitements des références fournies. Ne pas proposer une nouvelle direction esthétique générique ni remplacer les tableaux métier par une collection de grandes cartes.
- masters: entreprise/interventions M4 (PDF initialp4) et M66 (volume4p19) ; syndic/sites/immeubles M13 (initialp13) ; fiche de site adaptée par verticale, bureaux V5-C01/C05 ; artisan M35/M34/M36 et M14/M65 ; SuperAdmin M43 (volume3p12) ; pages publiques M11 et variantes cataloguées pertinentes. Associer CHAQUE route à une référence maîtresse, ne pas comparer deux surfaces différentes comme si elles devaient être identiques.
- reference images: /tmp/courant-audit/pdf-images/v1-p4.jpeg, v1-p13.jpeg, v4-p19.jpeg, v3-p12.jpeg et autres images extraites ; /tmp/courant-audit/volume5-images/p2.jpeg et p6.jpeg. Retrouver les PDF intacts via docs/audit/INVENTAIRE_SOURCES.json et CATALOGUE_MAQUETTES.md. Lire ARCHIVES_CODE.md avant toute réutilisation des archives CSS/composants.
- owned files: components/role/enterprise-space.tsx et enterprise.module.css en premier ; puis public-site.tsx/public.module.css, artisan-space.tsx/artisan.module.css et admin-space.tsx/admin.module.css par checkpoints séparés. app/globals.css uniquement après contrat partagé du lead ; conserver interfaces Session et contrats serveur. Aucun backend, migration, package, session/auth/génération ni script QA modifié par cet agent.
- first deliverable: lire les images réelles ; pousser docs/CLAUDE_VISUAL_FIDELITY_CONTRACT.md avec tableau route→référence/page→écarts→correction→vérification AVANT code. Première tranche entreprise/sites et liste interventions, avec screenshots avant/après 1280 et360, texte pertinent lisible et navigation propre au rôle.
- acceptance: captures comparées côte à côte référence/rendu à taille compatible, écarts restants explicites ; pas de validation de fidélité sur seuls mots bleu/blanc ou zéro overflow. Respect des contrôles de lecture seule, erreurs/vide/chargement, formulaires et données réelles sous droits ; pas de faux chiffres/SLA/certifications/légendes commerciales inventés pour imiter une image. Les identités/chiffres des maquettes restent exemples. Pas de cadres téléphone/navigateur simulés, animations décoratives permanentes, ou contenu essentiel tronqué.
- dependencies: QA001/002/003/004 et GW002 poursuivis par leurs agents/worktrees existants sous le lead, sans doublon et sans écraser les brouillons. Le design ne doit pas régresser la session, les permissions, brouillons, photos et support déjà recettés. Checkpoint fonctionnel ET visuel Web avant natif.
- reporting: CORRECTIONS.md au SHA exact, captures/limitations, CI et preview seulement réellement vérifiées. Vercel/Stripe restent différés selon consigne actuelle ; pas de production ni changement de l’ancien site public implicite. Toute preview locale est nommée locale.


## Amendement A3 — exécution autonome des lots1,2,3,5 via Claude CLI
Le propriétaire ordonne explicitement les lots1(fidé­lité),2(recette),3(Web/PWA),5(fonctions avancées) du plan présenté dans le chat. Les développements V2/V3 correspondants ne sont plus seulement « à prévoir » : leur exécution indépendante est autorisée, sans inventer les données commerciales/réglementaires ni prétendre les services différés actifs. Pas de natif/EAS dans cette tranche ; Vercel/Stripe restent différés, aucune production/store/transaction réelle. Tout code et tests Claude, Codex pilote/revoit/exécute/intègre. Le lead CLI b4b555f0 répartit entre1–10 agents Claude effectifs, propriétaires uniques et worktrees isolés, avec contrats avant code et checkpoints courts poussés.

### Transfert du chantier visuel vers les sous-agents CLI
Le worker Desktop16d349f9 est idle et a livré e7aaef7 ; sa branche/worktree est le point de reprise, pas une nouvelle copie de rendu. La suite de VISUAL-FIDELITY-001 revient à un seul sous-agent du lead CLI sur claude/web-pwa-design. Ne pas relancer Desktop en parallèle ; conserver son historique et ses images. Périmètre : corrections de revue entreprise puis autres acteurs/références du contrat. Les nouvelles features ci-dessous livrent des composants feuilles, sans éditer les coques des rôles possédées par cet agent.

### WEB-SHARED-001 — raccordements communs, propriétaire unique
- agent: claude
- status: pending
- owner: lead CLI b4b555f0, pas de sous-agent concurrent sur fichiers globaux.
- branch: claude/web-shared
- worktree: /Users/claudebrafa/.codex/worktrees/depannage-claude-shared
- base revision: 9b3dae03e1a413ffe89b34e0db7553ddc1b3ade9
- owned files: types/session/controller/navigation communs components/app/types.ts, session.ts, courant-app.tsx, app/globals.css si nécessaire et package/lock seulement après dépendance justifiée. Ne pas modifier les coques role/*.tsx possédées par design sans transfert explicite.
- objective: contrats partagés stables, raccordement des composants avancés et menus aux capacités serveur réelles ; intégrer leurs branches revues dans cette branche de préparation avant transfert final Codex. Ne pas modifier integration/web-pwa possédée par Codex, ni main.
- acceptance: pas de menus sans action, session/rôle/site restent serveur, typecheck/check/tests de refus après chaque raccordement, captures selon maquette ; aucun droit par seule visibilité du menu.

### ADV-DOCUMENTS-001 — devis enrichis et documents
- agent: claude
- status: pending
- branch: claude/web-documents
- worktree: /Users/claudebrafa/.codex/worktrees/depannage-claude-documents
- base revision: 9b3dae03e1a413ffe89b34e0db7553ddc1b3ade9
- owned files: nouvelles routes app/api/quote-documents/** et app/api/quote-amendments/**, lib/features/quote-documents/**, components/features/quote-documents/**, tests/documents ciblés ; migration015 réservée. Aucun changement direct aux routes/contrats devis existants sans accord lead ; pas de fichiers globaux/role shells/package concurrents.
- objective: PDF de devis à partir de données réelles, informations émetteur/validité et avenants versionnés liés au devis accepté, téléchargement privé et historique. Contrat produit/données/API/états à pousser avant code. Les factures/avoirs relèvent du lot plateforme ; coordonner une interface de rendu PDF, pas deux sources de vérité.
- invariants: devis accepté immuable, nouvel avenant explicitement accepté, montants calculés serveur, documents exacts à la version sélectionnée ; pas d’émetteur/SIRET/TVA/mentions fictifs. Si données nécessaires absentes : erreur/configuration explicite, pas de PDF mensonger. Anciennes validités non renseignées restent explicites, pas de rétro-expiration silencieuse.
- acceptance: PDF réel lisible inspecté et relecture du montant/version/TVA ; refus tiers/site retiré ; conflit de version et double envoi ; audit, génération contrôlée et URLs privées. Aucune signature certifiée inventée.

### ADV-PLANNING-NOTIFICATIONS-001 — planning artisan et notifications internes
- agent: claude
- status: pending
- branch: claude/web-planning
- worktree: /Users/claudebrafa/.codex/worktrees/depannage-claude-planning
- base revision: 9b3dae03e1a413ffe89b34e0db7553ddc1b3ade9
- owned files: app/api/planning/**, app/api/notifications/**, lib/features/planning/** et notifications/**, components/features/planning/** et notifications/**, tests ciblés ; migration016 réservée. Aucun controller/types/globals/role shells modifié directement.
- objective: planning personnel, disponibilités/plages récurrentes et rendez-vous cohérents, détection chevauchement/concurrence, centre de notifications métier persistant lu/nonlu et préférences. Événements réels idempotents liés aux opérations serveur ; contrat avant code. Un modèle d’employeur/techniciens est distinct : ne pas rebaptiser organisation cliente en société prestataire.
- invariants: pas de double réservation ni d’accès aux plannings privés d’autrui ; approbation/suspension et attribution restent effectives ; aucune notification d’un autre compte/site ; pas de promesse SMS/email/push externe sans fournisseur configuré. Préparer les adaptateurs/configuration et signaler indisponibilité, pas de faux envoi.
- acceptance: nominal/erreur/vide, dates/fuseaux, récurrence/exception, concurrence, mutation idempotente, notification liée au bon événement/acteur, marquage lu/nonlu et révocation des accès ; tests serveur/RLS et captures de composants raccordables.

### ADV-B2B-OPERATIONS-001 — équipements, maintenance, SLA et ERP
- agent: claude
- status: pending
- branch: claude/web-b2b
- worktree: /Users/claudebrafa/.codex/worktrees/depannage-claude-b2b
- base revision: 9b3dae03e1a413ffe89b34e0db7553ddc1b3ade9
- owned files: app/api/site-operations/**, lib/features/site-operations/**, components/features/site-operations/**, tests ciblés ; migration017 réservée. Ne pas modifier enterprise-space/CSS en concurrence avec design ; proposer composants feuilles et contrat de raccordement au lead.
- objective: fiches équipements/criticité, plans maintenance/interventions, budgets par exercice et données contractuelles/grilles versionnées, suivi de délais SLA configurables et contrôles/audits/réserves ERP. ERP signifie ici établissement recevant du public ; aucune intégration à un ERP comptable tiers choisie arbitrairement.
- invariants: RLS organisation/site/grant can_write, retrait et portée courante ; aucune donnée énergétique/calendrier/SLA/conformité inventée. Un délai ou calendrier non configuré reste non mesurable ; une checklist déclarative n’est pas une certification réglementaire. Relire les sources officielles pour toute affirmation réglementaire, sans figer une obligation non validée.
- acceptance: CRUD privé, historique/audit, configuration et calcul serveur testés avec données synthétiques explicitement QA, fenêtres calendaires/pauses/reprise/échéances, accès intersites/org/viewer refusés et révocation ; pas d’alerte globale « aucune » sur données partielles.

### ADV-PLATFORM-FINANCE-001 — super back-office et finance préparée
- agent: claude
- status: pending
- branch: claude/web-platform
- worktree: /Users/claudebrafa/.codex/worktrees/depannage-claude-platform
- base revision: 9b3dae03e1a413ffe89b34e0db7553ddc1b3ade9
- owned files: app/api/platform-operations/**, lib/features/platform-operations/**, components/features/platform-operations/**, tests ciblés ; migration014 réservée (fondation droits opérateurs). Aucun autre numéro partagé ; si dépendance commune requise, publier et synchroniser avant code.
- objective: permissions opérateur/support/finance distinctes de SuperAdmin et des owners B2B, paramètres persistants, audit, modération/contestation des avis, suivi de factures/avoirs/commissions/remboursements/litiges et rapprochement. Lire les contrats Stripe existants et docs officielles actuelles avant adaptateur, pas de nouveau taux commercial par défaut.
- invariants: ne jamais donner profile.role=admin à un opérateur limité en prétendant le restreindre par un menu ; permissions serveur explicites et RLS, plus petit périmètre, révocations, protection du dernier superadmin. Aucun élargissement réel de compte utilisateur sans besoin de recette synthétique bornée. Les actions financières réelles restent inactives sans Stripe test/config et événement de confirmation serveur ; une demande de remboursement ne vaut jamais remboursement accompli. Ledger idempotent, centimes/devise et audit inviolable pour utilisateurs ordinaires.
- acceptance: refus rôle/périmètre/CAS, audit horodaté serveur, transitions et montants testés, messages indisponibles explicites, factures/avoirs basés sur émetteur et conditions réels uniquement. Connexion fournisseur et débit réel non prétendus testés ; aucun achat/transaction réelle/prod.

### Contrats et synchronisation des nouveaux lots
Chaque agent lit les missions distantes, claim sa seule entrée et pousse un contrat docs/CLAUDE_<LOT>_CONTRACT.md avant code. La base commune est9b3dae0 ; les composants/API nouveaux évitent les fichiers globaux, les numéros014–017 sont réservés par lot, une migration ne dépend pas d’une fonction d’un numéro ultérieur. Le lead valide l’ordre et les interfaces partagées avant branches dépendantes. Les fichiers globaux et menus sont raccordés par leur propriétaire unique après checkpoint des composants. Réutiliser les caches/dépendances épinglés disponibles, pas quatre installations/builds lourds simultanés sur disque limité. Rapports exactSHA, tests significatifs et captures ; Codex fait revues/intégration et applique séquentiellement uniquement les migrations revues. Ces missions sont des travaux autorisés, pas des livraisons annoncées.


## Amendement A4 — délégation partielle explicite à Codex (2026-10-31T11:53:37-04:00)
Le propriétaire demande « Si on délègue un peu à codex ? » dans l’objectif d’accélérer. Cet ordre autorise du code et des tests Codex sur les deux missions précises ci-dessous ; il remplace pour ces fichiers la règle antérieure tout-code-Claude. Claude reste propriétaire du design fidèle aux PDF, des coques de rôle, des fichiers globaux/session/controller/shared et des corrections de ses lots existants. Pas de production, achat, débit réel, store, natif ou levée des services différés. Revues croisées au SHA exact avant intégration.

### CODEX-INVOICE-PDF-001
agent: codex ; status: done. Base : plateforme782ce0d + documents5960ad9 pour le writer existant, sans modifier ces deux branches. Branche codex/invoice-pdf ; worktree /Users/claudebrafa/.codex/worktrees/depannage-codex-invoice-pdf. Fichiers exclusifs : lib/features/platform-operations/invoice-pdf.ts, app/api/platform-operations/finance/invoices/[id]/pdf/route.ts, tests/platform-operations/invoice-pdf*.test.ts et docs/CODEX_INVOICE_PDF.md. Aucun autre fichier applicatif possédé. Rendu facture/avoir depuis instantané immuable stocké, réutiliser writer documents, pas de données/manches réglementaires inventées. Route privée no-store finance_read contrôlé serveur/RLS, 401/403/404, filename sûr, montants exacts et crédit lié à facture. Vérification : tests structure/montants multipage/erreurs/permissions, ouvrir PDF rendu et relire visuellement, typecheck, rapport+SHA poussé. Fournir contrat URL/type et lien à raccorder par lead Claude dans sa coque ; aucun menu sans action déclaré livré. Aucun appel Stripe, aucune migration/appli cloud.

### CODEX-PLANNING-QA-001
agent: codex ; status: ready_for_review. Base : integrationc92f4de (helpersQA091fff0) ; API planning selon contrat8574b78 et correctifb26bc45 en revue. Branche codex/planning-qa ; worktree /Users/claudebrafa/.codex/worktrees/depannage-codex-planning-qa. Fichiers exclusifs : scripts/qa-advanced/**, tests/qa-advanced*.test.ts, docs/CODEX_PLANNING_QA.md. Réutiliser helpers existants en lecture seule, jamais modifier scripts/qa/** (worker Claude les possède encore), package/lock/globaux/migrations. Livrer harnais exploitable de recette planning/notifications, préflight SHA/projet/origine explicites, credentials privés externes, cohorte technique qa.invalid bornée, manifeste0600 durable, stop/drain/cleanup relançable/readbacks ; tests conflits de créneaux/concurrence premières préférences, accès artisan tiers, notifications liées ticket après révocation, rendu navigateur états. Aucun fixture finance/ledger/audit immuable. Aucun cloud automatique par l’agent : root revoit puis exécute après migrationsrevues. Rapporter ce qui est réellement couvert vs non vérifié, commandes exactes, SHA poussé, aucun secret/fixturelog commité. Pas de build/install dupliqué inutile.


### QA-ADV-ROLLBACK-001 — preuve SQL réelle sans fixtures persistantes (2026-10-31T12:01:51-04:00)
agent: claude ; status: done. Propriétaire à réutiliser : worker backend Claude existant, branche claude/web-pwa-backend / worktree depannage-claude-backend, aucun doublon. Code/tests de cette mission reviennent à Claude. Périmètre exclusif scripts/qa-advanced-platform/rollback.sql, docs/CLAUDE_ADV_ROLLBACK_CONTRACT.md et éventuelle vérification locale ciblée nouvelle ; jamais scripts/qa-advanced/** Codex, migrations, API, coques ou globaux. Dépendances : source plateforme782ce0d/documents5960ad9/B2B3c7aeff, migrations014–017 revues ; execution root APRÈSapply dédié. Publier contrat avantcode.
Objectif : recette SQL de vrais RPC/RLS finance/documents/B2B sous comptes synthétiques QA dans une unique transaction BEGIN…ROLLBACK obligatoire ; aucun COMMIT, aucune fixture permanente. Cela permet tester avec admin temporaire malgré garde du dernieradmin sans affaiblir le trigger : toutes insertions/écritures sont annulées normalement. Refuser environnement schéma sans014–017, bornes statement/locktimeout ; identifiants gen_random_uuid, noms QA, aucun compte réel ni e-mail envoyé, aucun Stripe. Insérer seulement la cohorte nécessaire auth.users/profiles/membership/jobs/quotes/payments QA dans la transaction ; ne jamais réutiliser ni modifier rows réelles. Tester scopes opérateur/révocation sans rôleadmin global, audit/ledger/commissions estimées vsconfirmées, readiness données manquantes/refus, plafonds/idempotence et TVAavoirs cumulée, RLS docs tiers/ancienartisan, B2Bviewer/site/org. Aucun provider positif fictif présenté réel ; données de paiement QA seulement dans transaction et rapport explicite. Tests permissions par rôle SQL et JWTclaim locale (pas secret/bypass embarqué). Aucun TRUNCATE/DROP de table persistante, désactivationtrigger, migration appliquée, fuitecredentials, appelréseau de l'agent ou publication. Revue root+SQLisolé avant exécution Supabase CLI db query --file parroot, vérification absencecohorte après rollback. Rapport résultats réellement exécutés, pas preuve HTTP/browser ni concurrence multisession.


### QA-PWA-LIFECYCLE-002 — deux builds réels, deux onglets, origine locale unique (2026-10-31T12:38:22-04:00)
agent: claude ; status: in_progress. Propriétaire : worker QA Claude existant après sa relecture Codex, sans doublon. Branche/worktree QA existants, fichiers nouveaux scripts/qa-pwa-lifecycle.mjs, tests/qa-pwa*.test.ts si tests de helpers pertinents et docs/CLAUDE_PWA_LIFECYCLE_CONTRACT.md. Ne pas toucher public/sw.js, PwaInstallControl, scripts/qa-advanced/**, package ou coques (tout défaut app est assigné séparément au lead). Lire ancien harnais /tmp/depannage-web-pwa-qa/pwa-two-deploy.mjs sans le modifier et les règles PWA existantes.
Objectif : fermer la preuve deuxversions/deuxonglets qui ne peut être déployée actuellement sur Vercel (explicitement différé). Tester en navigateur les vrais builds Next source1be8f00 (SWv2) et nouveau774f65c ou snapshot a2faa02 (SWv3), successivement à la MÊME origine localhost:3020. Les checkouts/builds isolés sont préparés par le pilote (paths/SHA en flags), aucun npm install/dépendance/fournisseur/authQA/cloud nécessaire. Le runner peut piloter ses SEULS serveurs enfants next start sur port dédié3020 (refus si occupé), arrêter uniquement ses PID, attendre Ready/HTTP avant browser, puis switchold→new à origine inchangée, conserver deux vrais onglets et leurs contrôleurs. Préflight fullSHA/HEAD, buildID/SWhash, traces privées horsGit, aucun secret/bypass, pas de données utilisateur : démo explicite et réseau privé/cache contrôlés.
Vérifier installation/activation réelle du SW, nouvelleversion waiting tantqu’aucunconsentement, actionmiseàjour, comportement de l’autreonglet, reprise/avertissement si formulairemodifié (pas perte silencieuse), pageoffline réelle et repriseonline, aucun cache de route/api/auth/documentprivé, aucune erreurconsole/overflow. Si uncritèreéchoue, FAIL avecpreuve etsignalement, jamais ANOMALY→PASS. Comparer/cachev2v3observés, pas seulement changerunlabelduharness. Rapporter clairement que ce sont deux builds locaux testés (PAS deux previewsdéployées), pas une preuve installationOS/iOS/Android ni workflowpaiement. Propriétéexclusive des scripts, contrat avantcode et SHA poussé/revuecroisée ; éviterdupliquerbuilds déjà prêts. Ne pas démarrer un compteadmin synthétique sous014.


### État des missions A4 et QA au31octobre13h09 Martinique
PDFCodex604/252/e257 revuClaude70tests/visuel,13PDFtests/typecheck, intégré774puisd937, routeanonyme401réel : missionmoduleterminée, donnéesémetteur/Stripe/HTTPfinancepositifnonconclus ; celaNEvautPASlotfinancecomplet. PlanningQAf0a5cdb livré16unitPASS/root13étapesAPI+browserPASS/cleanup33/readback27scopes0/6Authabsents ; ready_for_review finaleClaude579/15/f0avantmergeharness. SQLrollbackd352revucroisé/exécutéréel343PASS/rollbackabsencecohorte, missionterminéedansborneSQL. PWA5a bloquépar3findingsP2enrevue, workerClaudeQA corrige,mêmesession,pasnouveaudoublon.


### QA-GW-EXPIRED-REVOKE-003 — 2026-10-31T13:26:01-04:00
agent: claude ; status: pending. Même worker backend Claude (claude/web-pwa-backend), pasnouvelagent ni modification app/Edge/migrations. Propriété scripts/qa-gateway/**, tests/qa-gateway*.test.ts et docs/CLAUDE_GATEWAY_REMAINING_QA_CONTRACT.md. Mission autorisée pour fermer les critèresJWTexpiré/révocation/concurrence déjà inscrits aucontratgateway ; ce ne sontpasdesfonctionsnouvelles. Publiercontratavantcode, revue root avantexécution, jamaiscloudparworker. Les9scénariosnominaux ac72sontPASSsurEdgev1JWTtrue, nettoyage40etreadbacks0 ; nepaslesrépéterinutilement.
1. Préparer/verifierexpirationréelle en DEUXphases sansattentebloquante. Cohorteunique UNcompteclientAuthtechniqueconfirméqa.invalid, sansadmin/finance/document niemailenvoyé. Obtenirsontokenréelparpasswordgrant ; prouveravantéchéance qu'ilauthentifiepourunecommandesansmutationattendue400/formulairemanquant. Stockertoken0600horsGituniquement, issuerprojet/UID/expires_at/claimexpcohérents ; nepasforger/signertoken, lireJWTsecret, changerTTLAuthprojet, ourefreshletoken. ModepreparepeutlaisserCEcompteintentionnellementjusqu'àexp+60s, annoncePREPAREDpasPASSexpiration. Manifesteprivépréservéavecfinbailbornée(max2h), IDdurableavantauth, motdepasseseulementmémoire. Modeverifyrefusesitroptôt, vérifiecompteencoreactif(Authadmin200)pourisolerexpirationducompteeffacé, appellevraieEdgeverify_jwttrueavecmêmetokenexpiré etexige401/aucunefuite, puisnettoieUID etrelit404. Relanceparautomationexistanteaprèséchéance, AUCUNEnouvelleautomation/longsleep. Erreur/interruption=>cleanupsûroumanifesteactionnable, pasabandonmuet ; aucunsecret/nouveaucomptepermanent.
2. Proposerunprotocole de concurrence révocationpendantvrai upload (pasuniquementrefusdéjàrévoqué). Exploiterverrouorg/dossiercohorteuniquementpourordonnerfinalisationRPC, JWTacteurvalide, objetStorageobservéaprèsprécontrôleavantlibérationpuisrévocationcommitavantfinalisation. UnecommandeSQLracine doit être explicitement revue/bornéeet neviserqu'UUIDetnomdecohortevalidés ; jamaistrigger/testhook/bypass ajoutéàEdge, authglobale/production/tableutilisateurautrerun. Préférerrefus403aveccompensationobjetaprèsrévocationquiagagné, puisreadbacksdocumentobjetabsents ; site/assignationpeuventêtretestés séparément. Siordrenonprouvé,outcomeincertainoufenêtrenonexercée, marquerFAIL/nonpreuve,pasPASSthéorique. Préparerd'abordprotocolecontrat, rootchoisitexécutionaprèsrevues ; nelecod erpascommegarantieabsoluetimeout.
Leploiement/testplanresteWeb/PWA ; aucuneapplicationnative/store, achat, cléserviceclient, fichierutilisateursupprimé. ConservertoutespreuvesexactSHA/nettoyage ; nepasaffirmerfinlot3tantcritèresouverts.


### PUBLIC-HERO001 —2026-10-31T13:28:20-04:00
agent: claude ;status: pending. Réutiliserworkerpublicexistant/worktreeplanning, brancheclaude/web-design-public ; propriétépublic-site.tsx/public.module.cssetuniquementassetillustratifdérivédesourcespublic/imagespourblocM11. Dépendanced2e906e, dériversurshared18favecpropriétépublicinchangée. Addendumcontrat avantcode,règlesCOPY/references/sourcePDFpréservées ;voirPUBLIC-HERO001dansCORRECTIONS. Aucunvisage/équipe/certificationcommercialeinventés, aucuncontenuIAgénéré ;reprendreéquilibrevisuelvraimaquettedéjàfournie. Revu/captures/clavier/3601280/CTAfonctionnelavantrootmerge.


### CODEX-PLANNING-QA-001 — amendement recette reprise intégrée —2026-10-31T13:29:17-04:00
MêmeagentCodex/branchecodexplanningQA/fichiersexclusifsdéjàautorisésA4. Sourcef0appd937a13PASSconservés ; nouvelshared18fbfce clôtureSHARED006avecactionreprisevalidée41tests/source ; recetterlenouveauraccordementaprèsbuildroot. ContratQAàactualiseravantcode (docs/CODEX_PLANNING_QA.md) : scénario503browser/alldoitcliquervraiRéessayerDANSbloc[data-blocker=capability:planning]après503injecté, enleverroutepuisobservernouvelleGET200can_edittrueetretourcontenu/bouton, pasreloaddocument. Marqueurdocumentavant→aprèsdoitrester, identitéworkspaceinchangée. Strictdroits/nofuitepréservés ; nepasconfondreboutonPWAinstallationauhautdepageavecretryplanning. Sourceappoldf0capturaitdéfautmaintenantcorrigé ; conserverhistFAILs/limitesprécédentes, nepasrefairepreuveréelleavantrootrun. PasétendrefichiersClaude niAPI/SQL ; ownerCodeXactuelréutilisé, testsunit/syntaxesiginfiants,push/revueClaudefinale579→nouveauencoredueavantmerge.


### QA-ADMIN-PREFLIGHT-001 —2026-10-31T13:52:14-04:00
agent: claude ; status: pending. WorkerQAexistant/claudewebpwaQA,fichiersexclusifsrun/libconfigouhelpernouveaurefusQA/tests/READMEcontrat. Petitgardeinteropavantfixturespournepascréercourtadminimpossibleàretireraprès014. VoirCORRECTIONS, aucunchangementapp/SQL/RLS/production/compteréel. Contrataddendumavantcode, testsrefus0seed,typecheck/syntax,push/revue,pascloudparworker.


### QA-DOCUMENTS-B2B-004 — 2026-10-31T13:55:53-04:00
agent: claude ; status: pending. Réutiliser le worker B2B Claude existant, qui a terminé le module017, sans nouvel agent. Branche de recette dédiée issue de l'intégration actuelle, worktree séparé si son checkout sert encore au code ; claim et contrat avant code. Propriété EXCLUSIVE nouvelle : scripts/qa-business/**, tests/qa-business*.test.ts, docs/CLAUDE_BUSINESS_QA_CONTRACT.md. Ne pas modifier scripts/qa/** (worker QA), scripts/qa-advanced/** (Codex), l'app, les migrations, package/lock ou les globaux.
Objectif : recette réelle API+navigateur des deux lots déjà codés015 et017 ; ils ont des preuves SQL mais pas encore les circuits UI assemblés. Aucun finance/provider/administrateur QA : ces fixtures créeraient des écritures immuables non nettoyables. Les tables015/017 accordent service_role pour nettoyage borné ; vérifier de nouveau les FK/grants avant proposer les fixtures. Le worker ne fait AUCUN appel cloud ni lecture de credentials ; root revoit/exécute.
Plan : (1) contrat détaillé avec commandes/endpoints/payloads/locators relevés dans les SOURCES exactes actuelles, projet/SHA/BUILD_ID/origine préflight ; (2) harnais sélectionnable docs|b2b|all/dry-run/cleanup-manifest, réutilisant les helpers existants en lecture seule, sorties0700/0600 et redaction, suivi durable des intents/UID avant authentification, stop/drain/finalisation unique et refus de supprimer sur issue inconnue ; (3) tests purs significatifs du cleanup FK, des refus/détection issue inconnue et du cycle finally, pas des regex qui recopient le source ; (4) livraison poussée/revue avant root exécution sur app figée/Supabase dédié. Pas d'installation/build dupliqué.
Documents : acteurs client/artisan/tiers, dossier/devis techniques uniques ; vraie UI document/PDF/validité, fichier téléchargé privé non vide, bonne version/montants, tiers et ancien artisan refusés, devis expiré refusé côté serveur si ce circuit est exposé ; avenant préparé/accepté distinct de paiement, aucun clic paiement ni montant présenté payé. Conserver les dates/émetteurs QA identifiés, aucun document commercial réel inventé. Préférer une cohorte minimale et des événements015 nettoyables plutôt que toute écriture014.
B2B : propriétaire, membre manager avec grant lecture seule, tiers ; vrai équipement créé par UI et readback ; maintenance/ERP/budget selon contrats existants, aucune conformité certifiée ou automatisation absente déduite ; version périmée/concurrence si protocole réel prouvable ; read-only ne montre pas d'actions d'écriture et ne lance aucun POST, commandes directes refusées ; révocation d'accès puis absence de vieux faits/droits ; séparation de deux sites/organisations et états erreur/reprise. Captures360/1280, logs réseau sans tokens. Chaque fonction partielle/non exercée est marquée explicitement, jamais ANOMALY→PASS.
Nettoyage : tables enfants015/017/notifications/audits avant dossiers/sites/organisations/profils/Auth, découverte des données créées et readbacks ; identifiants strictement issus du manifeste, aucune suppression globale, aucun admin/grant plateforme/paiement/ledger/audit finance. Les objets Storage éventuels doivent être recensés et supprimés avant documents. Aucune fixture permanente ; root relit indépendamment l'absence. Les tests sont locaux + vrai backend, PAS une nouvelle preview Vercel. Ce contrat complète les lots autorisés ; pas de nouveau périmètre applicatif ni de natif/EAS.


## Amendement A5 — support opérateur délégué — 2026-10-31T14:03:49-04:00
Le propriétaire autorise une délégation partielle à Codex puis la poursuite autonome des lots1/2/3/5. Le support délégué sans rôleadmin reste un manque explicite ADM07/09 du plan. A5 ajoute ce seul module backend Codex ; Claude conserve interface et raccordement. Les deux modules A4 restent inchangés. Réserver018, aucune autre migration ne l'utilise. Contrat détaillé partagé et accord du lead sur les propriétaires AVANT code. La découverte en lecture seule est docs/SCOPED_SUPPORT_DISCOVERY_BE17.md ; ce n'est pas une implémentation livrée.

### ADV-SCOPED-SUPPORT-BACKEND-005
agent: codex ; status: pending. Agent Codex existant review_gateway_013 à réutiliser après fin de la recette planning, pas nouveau sous-agent. Base commune : integration/web-pwa `be17b24` (révision exacte à inscrire au contrat). Branche codex/support-operators, worktree /Users/claudebrafa/.codex/worktrees/depannage-codex-support-operators à créer seulement après accord d'ownership du lead Claude.
Propriété proposée exclusive, à confirmer avant implémentation : nouvelle supabase/migrations/202610310018_scoped_support_operators.sql ; app/api/support/route.ts et app/api/support/[id]/route.ts ; lib/features/platform-operations/types.ts (union/capabilities) et http.ts (describeAccess uniquement) ; nouveau lib/features/support/permissions.ts si utile ; tests/support-operators*.test.ts, tests/sql-support-operators-review.mjs, docs/SCOPED_SUPPORT_CONTRACT.md. Aucun fichier UI, contrôleur ou ancienne migration001–017 modifié. L'enum importé /operators doit se mettre à jour par les types ; aucun autre fichier backend existant sans accord précis.
Contrat métier minimal : scopes support_read/support_reply/support_status, read requis avec chaque write ; file globale explicitement limitée aux tickets/messages/événements support. Aucun accès supplémentaire aux dossiers/photos/devis/profils complets/finance/audit/modération/admin/dispatch. Créateur garde ses droits011, retrait opérateur ne supprime pas ses droits sur ses propres tickets autorisés ; aucune promotion de rôle. Transitions, CAS, limites et rate limit existants conservés. Révocation concurrente : verrouiller et relire les grants nécessaires avant org→dossier→ticket, ordre déterministe, pas simple has_scope puis mutation. Définir précisément le contraste créateur/admin et les non-preuves de rétrogradation.
Migration018 additive : étendre check/gestion des scopes, helpers de permissions, droits RLS de lecture support, mutation011 et kind operator, notifications016 réellement déclenchées pour l'opérateur sans ouvrir notifications d'autrui. Préserver grants/audit immuables et dernieradmin ; révoquer EXECUTE public/anon des nouvelles fonctions privées, search_path vide. /support scopeall et permissions détail suivent le serveur, pas profiles.role ; 401/403/404/409/422/503 explicites et aucune cléservice dans ces routes.
Vérification : SQL isolé puis batch réel BEGIN…ROLLBACK revu/exécuté par root, matrices read/reply/status/read+write, créateur/tiers/perte site/révocation, notification/dédup, aucun droit finance/dossier, CAS et refus ; absence cohorte après rollback. Aucun grant/admin QA commité :014 est immuable et empêche un nettoyage honnête. Les preuves HTTP/UI live positives nécessitent acteur réel légitime ou environnement éphémère autorisé ; à défaut annoncer source/unités/SQL/contrôles UI simulés comme tels, sans faux PASS ni grant hors audit. Pas de cloud/apply par l'agent ; push régulier et revue exacte avant root intégration/apply.

### ADV-SCOPED-SUPPORT-UI-005
agent: claude ; status: pending. Propriétaire à réutiliser : worker plateforme Claude existant disponible, branche/worktree UI isolés depuis la même base, aucun doublon. Après accord du contrat backend : components/role/support-tickets.tsx et son module CSS, nouveau components/features/support-operations/**, components/features/platform-operations/platform-operators-view.tsx (libellés3scopes), tests UI et contrat. Geler les types/http backend au propriétaire Codex, aucun chevauchement. Le lead seul garde components/app/types/session/session-types/features/demo, anchors/platform-anchor/admin-space/client-space/artisan-space/enterprise-space et menus.
Réutiliser l'assistance existante, sans deuxième système de tickets. L'opérateur voit Assistance et les commandes permises, jamais roleadmin ; read-only sans write, refus/reprise/null stale sans effet sur une autre identité, 360/1280/clavier/44px. Extraire le traitement admin via le propriétaire lead sans copier deux implémentations divergentes. Le message operator doit être rendu Assistance et déclencher les notifications internes réelles. Données de démonstration explicitement isolées, aucun nouveau KPI/délai inventé. Capture références M43/assistance/avant-après. Même cadence de revue/push, pas de production ni de nouveau store/natif.


## Amendement A6 — Web/PWA complet avec GPS/ETA — 2026-10-31T14:28:30-04:00
Ordre propriétaire : « Termine la tranche complète web/pwa gps/eta En Autonomie. Partagez les tâches pour allé plus vite ». Ajoute la localisation/itinéraire/heure d’arrivée estimée au périmètre courant, sans supprimer les contrôles des lots déjà ouverts. Vercel/Stripe et premier SuperAdmin restent différés ; aucun achat, production, store/natif ni service API payant engagé. Les autres manques du plan76 restent à qualifier, pas déclarés clos par cet amendement.

### WEB-TRACKING-BACKEND-006
agent: codex ; status: pending. Réutiliser review_gateway_013 après livraison A5, sans doublon. Base proposée integration/web-pwa0f57d964c537ed989569fbe68bf216263a838b65 ; branche codex/gps-eta, worktree interne dédié à créer après confirmation lead019 libre. Mission de conception/contrat AVANT code, source métier M7/M44/M67/V8-C07 et phase5 du plan. Propriété exclusive proposée : supabase/migrations/202610310019_intervention_tracking.sql ; app/api/interventions/[id]/tracking/** ; lib/features/tracking/** ; tests/tracking*.test.ts, tests/sql-tracking-review.mjs ; docs/TRACKING_CONTRACT.md. Aucun ancien001–018, package/lock, controller/session/coque ni codeGPS dans modulesfinance/support. Contrat partagé signatures/capabilities avant UI.
Objectif : vraie position consentie de l’artisan attribué, trajet routier et ETA sourcés/horodatés, accès uniquement participants autorisés au dossier. Le déplacement est distinct du statut financier/intervention ; ne pas élargir enum central en concurrence. État en route/arrivé/arrêté spécifique, démarrer/arrêter explicites, pas tracking avant consentement ou après retrait/fin/réaffectation ; pas d’historique des parcours par défaut. Dernier point seul, politique de conservation/effacement concrète documentée. Contrôler serveur rôle/approbation/attribution/statut, sitegrants courants, organisolation, transitions, versions/idempotence/ordre des échantillons, coordonnées/accuracy/timestamps bornés, rythme et limites. Ne jamais utiliser une position périmée/refusée comme position actuelle. Point de destination confirmé par utilisateur habilité, géocodage optionnel explicite, pas de fausse localisation déduite silencieusement d’une adresse ambiguë.
Fournisseur à retenir après recherche officielle (coverage Martinique, quotas/licence/attribution, accès réel). Adaptateur serveur sans cléclient/SSRF, appels bornés et réponse validée, source/distance/durée/calculated_at, cache frais par session/destination/version et relecture droits après appel externe. Aucune ETA inventée à vitesse constante/ligne droite, aucune promesse trafic temps réel sans fournisseur le prouvant. Indisponibilité précise si route absente/clé manquante/quota/timeout, jamais faux succès. Carte avec attributions et politique tuiles/cache, pas précache horsligne nonautorisé.
Vérification : tests nominal/erreur/refuslocalisation/offline/reprise/horodatage/stale/réaffectation/fin/révocation/tiers/lectureseule ; SQL isolé RLS et concurrence réellement prouvée séparée ; route fournisseur réelle sur coordonnées publiques fixes, pas donnéesutilisateur ; recette API+navigateur réelSupabase avec position navigateur simulée explicitement, deuxcomptes et cleanupborné. Root seul applique/cloud après exactSHAreview. Aucun secret ni position privée dans Git/logs.

### WEB-TRACKING-UI-006
agent: claude ; status: pending. Réutiliser worker design artisan disponible, après confirmation lead. Composants feuilles components/features/tracking/** + testsUI/docs/TRACKING_UI_CONTRACT.md, branche/worktree isolés depuis mêmebase après contratAPI. Lead conserve coquesclient/artisan/enterprise, app types/session/capabilities et menus. Références M7/M44/M67/V8-C07 cataloguées : carte et trajectoire réellement alimentées, position/heure/source visible, autoriser/démarrer/arrêter/arrivé, précision/périmé/erreurs/refus/réseau/permissions ; surfaces360/1280 et clavier/44px, pas style générique. Geolocation watchPosition uniquement après consentement, clearWatch à arrêt/déconnexion/changementdossier/unmount, abandon callbacks anciens et pas de reprise cachée au reload. PWAweb en arrière-plan non garantie ; le dire sans prétendre tracking natif. Pas nouvelle dépendance ni facture fournisseur avant accord contrat/ownership root.

### WEB-TRACKING-QA-006
agent: claude ; status: pending. Réutiliser worker public ou QA disponible après ses corrections courantes ; propriétaire exact à confirmer lead. Contrat puis scripts neufs scripts/qa-tracking/** et tests/qa-tracking*.test.ts, helpersQA existants en lectureseule. Root exécute cloud après revue, aucune fixture admin/finance immutable. FixerSHA/buildID/origine/projet, position simulée explicitement (pas vraie mesure physique), refus de localisation et pause réseau, viewers/tiers/anciensartisans, cleanupFK/intents/unknowns failclosed. Preuve fournisseur réelle distincte de mockbrowser, preuve GPS physique appareil distincte de géolocation simulée. Ne pas effacer les gates existants (documentsB2B/PWAOS/expiry/revoke/support).


### WEB-PWA-DESKTOP-INSTALL-006 — complément A6 — 2026-10-31T14:34:00-04:00
agent: codex ; status: pending. Le propriétaire demande la tranche Web/PWA complète et le partage des tâches. Réutiliser review_ui_checkpoint, disponible après sa recherche IGN, pour la recette PWA desktop réelle ; aucun code interface. Propriété exclusive : scripts/qa-pwa-desktop/**, tests/qa-pwa-desktop*.test.ts, docs/PWA_DESKTOP_INSTALL_CONTRACT.md. Aucune modification app/package/worker existant. Branche codex/pwa-desktop-qa, worktree interne dédié depuis6c67644af48b899857256d2211a843cd67efc608.
Contrat/protocole poussé AVANT code, navigateur ou installation. Lire /tmp/depannage-pwa-desktop-install-feasibility.md et documentation officielle Chromium CDP. Utiliser Playwright/Chrome for Testing156 existants, headed, profil neuf0700, aucun compte browser ni permission automatique, origine locale identifiée. Préflight manifeste servi et inventaire des shims préexistants. Aucun changement de navigateur par défaut, autostart ou profil utilisateur ; --test-type/--app/headless/matchMedia seuls ne valent pas installation OS.
L’installation peut créer uniquement son nouvel artefact test identifié hors profil/tmp (shim macOS), tracer AppID/profil/path/bundle. Prouver installationCDP, shim attribuable, fenêtre autonome réelle, relaunch et captures ; puis uninstallCDP de cette seule identité et relecture registre/shim/PID owned libérés. Finally/signal idempotent ; aucun killall, rm par simple nom Courant ou suppression globale Apps. Au doute, préserver le manifeste et déclarer INCOMPLETE. Aucune permission OS contournée.
Root revoit contrat, harnais et tests puis exécute. L’agent ne lance aucun navigateur/serveur/installation/cloud avant feu explicite. Build figé be17 sur3017, aucune nouvelle preview Vercel ni preuve iOS/Android. La preuve deux versions/deux onglets31ac est conservée. Aucun fichier utilisateur supprimé, achat, store ou natif.


### WEB-TRACKING-RETENTION-006 — complément A6 — 2026-10-31T14:51:08-04:00
agent: codex ; status: pending. Même auteur review_gateway_013, branche codex/gps-eta, propriété étendue EXCLUSIVEMENT à nouvelle migration020_tracking_retention.sql et tests/docs de son lot. Les migrations001–019 ne sont pas réécrites. Réserver020, aucun autre auteur ne la prend. Publier amendement de contrat avant code.
La revue Claude relève que l’effacement au prochain appel ne suffit pas si l’application est fermée. Pour livrer GPS sans conservation indéfinie du dernier point, ajouter un vrai mécanisme SQL planifié de purge, sans service externe, clé ou achat : Supabase Cron/pg_cron documenté officiellement. Préflight root : cron.job absent sur le dédié, aucune extension activée à ce stade. Vérifier disponibilité et installation supportée ; échec explicite si module indisponible, ne pas prétendre le scheduler actif par simple présence du SQL.
Plan : fonction purge service-only existante remplacée de façon compatible, travail borné par lot et verrous SKIP LOCKED, index utile sur derniers points, aucun parcours/historique ni donnée métier non GPS effacée. Un seul job nommé pour ce projet, cadence une minute, commande SQL constante sans réseau/secrets ; refuser collision avec un job préexistant non conforme, ne modifier aucun autre job. Aucun contournement RLS ou droit client à cron.
Vérifier ACL/conditions stale/frais, stop/reassign/suspension, borne de travail et concurrence ; tests SQL isolés doivent identifier leur éventuel stub scheduler et ne pas le présenter comme moteur réel. Root seul applique après revue exacte puis vérifie cron.job et job_run_details, succès réel du job sur point QA expiré, point frais conservé et absence cohorte après nettoyage. La cadence ordinaire ne garantit pas un SLA strict si le scheduler tombe en panne : indiquer dernier succès/erreur et limites, pas conservation physique maximale garantie sans exploitation. Aucun nouveau suivi Codex ni cron OS : il s’agit d’une fonction de l’application dans sa base dédiée.


## A7 — QA-DEPLOYMENT-PROVENANCE-001 (31octobre15h55AST, avant code)

La preview4c Gitliée est publique à la demande explicite du propriétaire (override du seul déploiement, ni main/production ni protectionglobale). URLnue https://depannage-electricite-rb28derhl-brafas-projects.vercel.app, mobile390sanscookies200/hydratation/anon401/no-store vérifiés. Plus besoin d'adaptateurcookieQA : garder ses contrats/WIP, ne pas intégrer complexité devenue inutile.

ROOT réserve exclusivement à Codex review_gateway_013 les NOUVEAUX fichiers scripts/qa/lib/deployment-proof.mjs, scripts/qa/tests/deployment-proof.test.mjs et docs/QA_DEPLOYMENT_PROVENANCE_CONTRACT.md. Worktree propre réutilisé depannage-codex-ci-sql, nouvelle branche codex/qa-deployment-proof depuis4c398e8 ; ancien CI37eb conservé/intégré, aucunWIP supprimé. Ce module ne touche ni produit, ni fixtures/browser/config, ni appelsBusiness/Tracking, ni cloud/credentials. Contrat doit être commité/poussé avant implémentation ; ROOT l'a relu et autorise code dans ce périmètre après publication.

API courte : lectureprivée0600horsGit/O_NOFOLLOW/UID/taille16KiB et schéma strict attendu indépendant ; reçu ROOT depuis vrai Vercelmetadata+HTMLservedFlight : origin/project/team/deployment READY/preview/gitSource exactSHAref et BUILD_ID/âge15min. Import lectureseule du parseurFlight Business4c, pasduplication/regexcontains. Mode REMOTE explicite, aucune prétention cryptographique ; LOCAL garde sa vraie vérification locale. Testervalide/NULL/types/URLmainprod/âge/symlink/UID/Flightambigu.

Aprèsrevuemodule : workersClaudeBusiness etTracking raccordent dansleursseulsfichiers, sous amendements avantcode. Défauts déjàobservés sansfixture : Trackingd333 html.includes rejette Flightéchappé réel ; Business compareBuildIds impose BUILD_IDlocal≠distantsmalgrémêmeSHA. Corrigerprovenancedistante sansfakerunBUILD_IDlocal. ROOT collecteattestationproviderjusteavantrecette et exécute seul cloud. RootQAcore garde autre propriété de durabilité Fixtures, séparéeetcoordonnée.


## DESIGN-DELIVO-TEST-001 —31octobre16h30AST — agent:claude — done

Ordreutilisateur : nouveauZIPDelivo reçu, «faitune maquette test, justeune maquette test», refusvisuelactuel. Livrable UNIQUEMENTprototypeAccueilclient mobileadaptéélectricité, séparéapp ; sourceHTML/CSS/fontsdeZIP commebaseesthétique orange#FD6931/noir#000/Jakarta, headerarrondi/categories/navigationbasse/cartes. PasnouvelleidentitéIA, pasmétriques/délais/avis/qualificationsinventés, mentionmaquettetest. Unécranprincipal+petitdialoguelocalfacultatifpasbackendauth/RLS/paiement. Pasintégrationapplicationniactivepreviewmodifiée.
Basecommune4c398e8393026598c5b629d3912cf80285acc2f5. Brancheclaude/design-delivo-test, nouveauworktreeisolé/tmp/depannage-delivo-test-worktree si nécessaire ; propriétaireClaudeUIexistantseul, ROOTcoordination/inspection/capture/previewisolée. Fichiersexclusifs prototypes/delivo-test/** etdocs/reviews/DELIVO_TEST_DESIGN.md, aucuneéditionglobals/app/tests. SourceZIPpréservé ; extractionréférencelectureseule /tmp/depannage-delivo-reference (home/CSS/fonts/images,scriptsretirés). Vérifierarchiveavantlecture, pasexécutionJSauthfourni. Plancompactcouleurs/type/layoutavantcode. Accepterparcapture390x844+360 etdesktop1280sansoverflow/texte16px/tactile44/focus ; ROOTaffichevraiecapturevisibledanschatetHTMLconsultable/publicsi possible sans modifierdeploymentapp. Contratdansrapportavantcode, commit/pushisolés puis revueROOT. Aucuneadoptionpourappentièreparcetest.


DESIGN-DELIVO-TEST-001 clôture bornée ROOT31oct16h56 : fd13ce6 poussé, revue visuelle réelle390/360/1280 + interactions et preview publique statique 7xo6v93eo vérifiées/livrées au propriétaire. Aucun changement application ni adoption implicite. Voir CORRECTIONS.md et rapport DELIVO_TEST_DESIGN.md de claude/design-delivo-test.


## DESIGN-DELIVO-TEST-002 —31oct17h03AST — agent:claude — done

Ordreowner «Fait2/3maquettesupplémentairepourvoircommentonfait». Interprétationannoncée :3écranssupplémentaires cohérentsduprototypeDelivo :1demande de dépannage,2suivi artisan,3devis. MAQUETTESUNIQUEMENT, pasrefonteapplication ni backend/GPS/paiement/auth. Réutiliserbrancheclaude/design-delivo-test worktree/tmp/depannage-delivo-test-worktree basefd13ce6ec104cf829f120a10feaa3da70b0ffafb. PropriétaireClaudeUIexistantseul ; ROOTpilotage/revue/captures/previewstatiqueisolée. Fichiersexclusifsprototypes/delivo-test/** etrapportdocs/reviews/DELIVO_TEST_DESIGN.md, aucunapp/globals/tests. Plancompactavantcode/commitpoussé ; conserveraccueilprécédentetZIP.

Références :ZIPDelivo fourni déjàextraitlectureseule/tmp/depannage-delivo-reference contientaussiordertracking/checkoutsourcesencoreaccessiblesarchiveinitialsiutile ; styleexactnoir/orange#FD6931/Jakarta, en-têterond/navigationbasse/adaptationmobile. RéutiliserpolicesetimageM41, pasgénérerunautrestyle. Demande : choixpanne/adresse/description/photoétatvide/actionpoursuivre locale ;suivi : artisanscénariodémoexplicitementfictif, états/timelineetcarteillustrative sansfausseposition/ETA réel, prixsurdevis ;devis : ligneslisibles+totaldemonstrationclairementidentifiésoumontantsàvenir, distinctiondevis/paiement, acceptationlocaleaucunservice. Aucunfauxavis/certifications/délaispromis/chiffresréels. Boutonslocaux réellementnavigables/dialogues/clairs, aucuneémissionAPI.

Galerieparcoursliantles4écrans, titres/lienretourvisibles, élément de choixécran horsfluxprincipalclairementmaquettetest ; nepasfairepasserpourappfinale. Vérification360/390/1280sansoverflow,44px/focus/retour/catégories/formsprototype, capturesréelles3écrans390àmontrerdanschat. Commit/pushréguliersisolés, livraisonscourtes ; ROOTpreviewstatiquePUBLICséparéedu4cbackend etancienprototypefd13 resteconsultable. Aucuneadoptiondansapp sansordreowner.


## WEB-DEEPLINK-REFRESH-001 / LIVE-WORKSPACE-001 —31oct17h18AST — agent:claude — pending(amendement)

BugproduitconfirméT6d79 :hashversdossiercrééaprèsbootstrapafficheintrouvableavanttrackingcarworkspacepérimé, malgrébadgeEndirect. Branch/worktree exclusifsleadClaude claude/web-deeplink-refresh /Users/claudebrafa/.codex/worktrees/depannage-claude-shared depuisbase5eb0f8540e253833f87fae1bc5007247770c6700. ContratsdocsCLAUDE_LIVE_WORKSPACE_001.md(acc6+67fd)etCLAUDE_DEEPLINK_REFRESH_CONTRACT.md(cd2b8d3)publiésavantcode/lusROOT, AMENDEMENTdemandéavantFEUimplémentation. Propriétéeleadseulcoques/session-types/refresh+nouveauhelperdécision/testsànommerdansamendement ;pasworkerprototypeconcurrent, pasbackend/migrations/leafGPS.

Objectif :lienclientdetail/artisanmission/entreprisedetailabsentcache=>unevraierevalidationbornéeparidentité+scopeactifrôle/org/site+view+id,générationrequête ;loadingavantabsence ;absenceaprèsrefreshRÉUSSIseulement ;503/transport=>erreur+reprise,pasnotfound. Refreshactuelleavaleerreurs(Promisevoid) :contratdoitexposerstatutexpliciteoustatebounderr ;singleflightréel/borneIDs/resetcontext/changementsdroits/résultatsanciensignorés ;demoisoléinchangé. Testsintégrationhook,races/errors/contextepasuniquementdecisionpure. ROOTchoisitbadgeConnecté+ActualiservisibletantqueeffectivitéLiveinconnue, aucunepromessestatistiqueinventée. PascodeavantamendementSHA/lectureGOroot, pascloudagent.

LIVEcloudROOTREADONLYréel21:14:08.811977UTC :publication supabase_realtimeEXISTEetpublictablesEXACTinterventions/messages/quotes,paymentsABSENT ;authenticatedEXECUTEcan_access_intervention(uuid)=TRUE. DoncabsenceINTERVENTIONS/grantexclusréels ;rôlesocketetengineRLSencoreUNKNOWN,pasaffadissementRLS/newSQLsurhypothèse. Preuveprivée/tmp/depannage-live-workspace-readonly-2115-private.json,aucunecohorteoumodificationDB. LogsRealtimepasexposésCLI ;contratfuturobservationpassivebornéeJWTrole/matchUIDSANSJWTpayloadpersistenceavantcode siunécessaire. AttribuerLIVEetDEEPLINKséparément ;défensivelienn'estpaspreuvemessagesRealtimearrivent.


## DESIGN-DELIVO-TEST-003 —31oct17h20AST — agent:claude — done

Ordreowner :«Jeveuxremplaceleorangepar duvert.Labannièrehauteorange doitrecevoirnospub». Interprétationannoncée :touteslesmaquettesenvert ;bannièrehautedel'ACCUEIL devientespacePUBLICITÉpourlesvisuelsdupropriétaire, emplacementneutreenattendantcontenufourni. ToujoursPROTOTYPESEULEMENT(brancheclaude/design-delivo-test/worktree/tmp/depannage-delivo-test-worktreebasec246067f6767ac102c39b8e6b59fd9e7426dd59f),pasrefonteapplicationaucunbackend/adserver/campagneréelle. ClaudeUIworkerprototypeexistantseul,ROOTreview/captures/previewPUBLICstatiqueisolée ;propriétéeprototypes/delivo-test/**+rapportplan.

PlancompactAVANTcodeetpush :vertforêtprincipalproposé#18794E(blanclisible),varianteclairepouricônes/textesvertsurfondnoirsiAArequise, chipfondsvertfoncéremplacentbrun/orange. Remplacertoutesaccentuationsorange3nouvellespages+accueil+galerie+SVG/footerboutons, sanschangementparcoursniétatsréels. Headeraccueil intègrepublicitéSTATIQUEsignalée«Publicité» ;texteplaceholderneutre«Votrepublicitéici», aucunevraiepromo/annonceur/logo/prix/avis/tempsinventé,pasURLréelleoutracking. Zoneadaptéevisuelultérieur ; conserveradresse/rechercheetaccèsdemande(éviterpubmasquantnavigation). Aucun carrouselanimépermanent,niveaubannièrepolluée. Autrespagesheadervertsavecfonctionnavigation, paspubimposéeaucœurdevis/formulaire.

LivrerSHApoussé/pasWIP ;ROOTvérif390/360/1280nooverflow/focus/clicdialoguepub+galerie+contrastepalette, capturesaccueilvertet3écransmisàjour,puisnouveaupreviewstatiquePUBLIC(navliensréels,sanscompteVercel), anciensprototypesorangesetapp4créellerestentconsultables. Aucuneadoptionglobalapp sansordreexplicite.


## DESIGN-DELIVO-WEB-TEST-004 —31oct17h40AST — agent:claude — pending

Ordreowner «Faitmoiunexempledelapaged'accueilwebavec lenouveauthème». LivrerUNaccueilWEBORDINATEURresponsive autonome/mêmevert-noir-Jakarta, exempleTESTpasrefonteapp. RéutiliserworkerUIprototypeEXISTANT/worktree/tmp/depannage-delivo-test-worktree/brancheclaude/design-delivo-test base30a70a97a066f726163f1d7f73ff349fbf8ec203. Propriétéeexclusiveprototypes/delivo-test/web.html +web.css(+assetsexistants/dialog.jsréutilisés)etrapportdocs/reviews/DELIVO_TEST_DESIGN.md. Aucunapp/globals/backend/refontepagesmobiles ;éventuellementunliengalerieverswebseulementaprèsplan. PlancompactpubliéAVANTcode, commit/pushcourtssourcefigée.

Direction :vraielargedispositiondesktop1280–1440px, navigationhorizontale+wordmarkdescriptifDépannageélectrique(nomarquéfinalnonvalidée),identitéverte#18794E/blancAA/accent#5BD49A,noir#000etcartes#1A1A1A,Jakar­taduZIP. BannièrehautePUBSTATIQUEformatlarge(placeholderPublicité/Votrepublicitéici,pascontenuréelpubfourni), pasbarredepromofausse. Hero2colonnesgrandephrasefunctional/problèmeélectrique+CTA Décriremapanne versdemande.html +illustrationM41fournie(local), pasavis/prix/délai/certificationstatinventés. Catégoriesréelles4pannesetpetitparcoursdemande/estimationindicative/devis/interventionpaiementdistinct. Liensancragesréelsservices/parcours, CTAversmaquettemobileexistante, autresactionsdialoguelocaldémoseulement. AucunAPI/campagnereelle/Stripe/Auth. Pasunécranmobilejusteagrandi ;pasnouveaustyleIAgénérique, mêmescodesDelivovert/adslot.

VérifROOT1440x1000+1280+390pasoverflow/44/focus/navigation/publicitédialogue, CSSsourcecontrasté, pasrequêtemutante. ROOTvraiecaptureDESKTOPPNGdanschat+nouvellepreviewstatiquePUBLIC/web.htmlsanscompteVercel, anciensprototypesetapp4cunchangés. Pasadoptionglobalappsansordreowner.


## DESIGN-DELIVO-WEB-TEST-005 — agent: claude — pending
Ordre propriétaire : grande photo en slide, inspiration disposition MesDepanneurs.fr. Prototype seul, base9430bf7 brancheclaude/design-delivo-test /tmp/depannage-delivo-test-worktree. Référence consultée https://www.mesdepanneurs.fr/ : grand hero/action principale, rubriques service, explication étapes et FAQ. Conserver vertforêt18794E/noir/Jakarta, publicité distincte haute. Nouveau web-slide.html/web-slide.css/web-slide.js et assets photos seulement, docs/reviews/DELIVO_TEST_DESIGN.md ; garderweb.html et toutesmaquettes antérieures inchangés. Plan avantcode. Deuxphotos stock électricité Pexels (17842832 FatihYurtman et27928762 ranjeet) illustrations, pasnotreéquipe. Ne pascopiermarque/textes/avis/chiffres/promesses concurrent. Grandphoto panoramique hero, panneaucontenu lisible/actionDécriremapanne, slidesmanuel précédent/suivant+indicateursboutons44px, pasautoplay permanent. Dessous4services,parcours3étapes,FAQaccordéons,publiciténeutre. Pasbackend/API/Auth/env ni adoptiondansapp. ROOTcontrôle1440/1280/390/360overflow/chargementphotos/contraste/clavier/slidechange/pasJSerror/CTA, capturepublique réelle etpreviewstatique séparée.


## DESIGN-DELIVO-WEB-TEST-006 — agent: claude — pending
Ordre propriétaire : aucunepublicité accueilWEB ; slidefullpage ; thèmesombre/clair. Prototype uniquement basee39b458 brancheclaude/design-delivo-test worktree/tmp/depannage-delivo-test-worktree. Nouveauxweb-full.html/css/js etrapportDELIVO_TEST_DESIGN.md, référencesexistantesweb-slide/web etmobile inchangées. Plan avantcode. Hero2photos pleinelargeurviewport sansmaxwidth/marges/rayon ethauteurpremierécran100svh moinsnav ; navigationthèmeexistanteverte/Jakarta,contenuCTA lisible/photo recadréeréel, fleches/indicateurs44px clavier,pasautoplay. Aucunpubplaceholder/annonce surcettepage. Boutonaccessibleclair/sombre : initialprefers-color-scheme, choixtogglepersistlocalStoragecléprototypespécifique trycatch, fallback sansstorage ; couleursAA pourles2modes,boutonlibelléétataccessible. Thèmeclairfondsblanc/grispâle,textenoir,cartesclaires,accentvertforêt ;sombreresteanciennoir/vert/cartesfoncées. Scopeaucunapp/global/auth/backend/API/cookiessecret, pasrefonteglobale. ROOTrecette4formats1440/1280/390/360les2thèmes, fullwidth/height/photos/slides/clavier/toggle/persist/reload/systeme/reducedmotion/nooverflow/noJS ;capturepublique réelle +previewstatiquePUBLICnouvelle.


## DESIGN-DELIVO-WEB-TEST-007 — agent: claude — pending
Ordre propriétaire trois captures : ajouter blocsinterventionscartes, catalogueservicesonglets,blogarticlevedette+liste, même thèmevert etclair/sombre ;photosdifférentesdemêmetype ;texteàmodifierplustard. Base1ab7eb8brancheclaude/design-delivo-test /tmp/depannage-delivo-test-worktree. Planavantcode, nouveauxweb-sections.html/css/js+assetsphotoslocales+rapportuniquement. Conserverpleinhero006sanspub/toggle/slider/anciensprototypesimmuables/appinchangée. Cartes3colonnesdesktop/1mobile8itemsillustratifs,sansfaussepopulariténi prixconcurrent commevraitarif (libelléestimationàconfirmer/texteprovisoire). Onglets5famillesresponsiveclavier+panelcorrespondant vraichangement ;liensdemande.htmloudialoguelocalidentifié. Blog2colonneslargevedette+liste4thumbs, datesàvenir/éditorialexempleaucunfauxarticlepublié/ranking. ConserverstyleDelivovert/Jakarta/rayons/boutons, modesclair/sombreAA/focus44. Photosstocktableau/prise/outilsdépannagecontemporainescréditéeslocales,aucuncropcapturedusiteconcurrent ni logos. Inspirerdispositionseulement,paragraphesprovisoirespasguidesdangereux. AucuneAPI/service/auth/backend/globalappprod. ROOTvalidation8formats2modes,nooverflow/photo/togglepersist/tabspanelsclavier/CTA/blogdialogue/Escape ;capturedesktopréelle+previewPUBLICstatique. Références troisJPG reçus préservés.


## QA-CLEANUP-EXTRACT-B1-001 — agent: claude — pending
ROOTautoriseB1SEULEMENTseloncontratf4021ac luavantcode. ObjectifréutilisercleanupWithProofsansextrairecopieaveugle, pasnouveauxparcoursniapp. Baseintegration7b05d3f559f57d1890384fe28ffdd024ce9a47e1 (A10cloud3/3PASS+cleanup42), workerTrackingClaudeEXISTANTbrancheclaude/web-qa-tracking checkoutdepannage-claude-planning ; propriétéEXCLUSIVE scripts/qa-tracking/run.mjs,nouveaulib/cleanup-proof.mjs,tests/qa-tracking-auth.test.ts/qa-tracking.test.ts partiescleanupetnouveautestqa-tracking-cleanup-proof.test.ts, noteCLAUDE_TRACKING_QA_CONTRACT.md. ToutautrefichierQAshared/business/scenariosread-only ;B2necodepasavantrevueSHA B1. ExtractionparamétréerunCleanupFnobligatoire/settleSideEffectsoptionneldéfautno-op,wrappertrackingconservecallproviderleases. Invarianceordre/schema/verdicts/exit, aucunDELETEavantpersistid/ownershipproof/cleanup_attempt,UNKNOWNjamaisabsenceetintentopenpreservé. TestsréelsinjectedlostAuthcommitthenrecoverUIDpersistbeforeDELETE,malformed/nonlegacy404/exhaustiveabsence/interruptresume,normalETcleanupOnly,throwscleanup/hookpasPASS,providerhook/nooppreserventunknown. Suites57Trackingassertionsinchangées, testssupplémentairesmoduleimportsanssideeffect,strictTypeScript. ContratB1noteavantcodepuisSHAshortpoussérevueROOTindép, aucuncloud/credentialsagent, aucuneprod/mainmigration. Rootpilotage/exécutioncloudaprèsrevuepasnouvellecohorteB1nécessairepurextraction.
