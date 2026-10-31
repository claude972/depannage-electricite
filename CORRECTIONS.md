# Coordination et vérifications — WEB-PWA-20261030

Ce journal ne constitue pas une revue passée ; aucune affectation terminée à ce stade.

## CLI-001 — Inventaire et première tentative Claude
- timestamp: 2026-10-30T21:42:29-04:00 (America/Martinique)
- acting agent: codex (pilot)
- target session: aucune session de ce projet dans inventaire initial ; sessions étrangères préservées
- mission/branch: WEB-PWA-20261030 ; claude/web-pwa-ui
- action: aide CLI, inventaire claude agents --json et contrôle authentification ; première tentative --background après publication distante de la mission
- observed result: CLI authentifiée ; tentative refusée car nouveau checkout pas encore approuvé comme espace de confiance
- next action: ouverture normale du CLI dans le checkout créé et inspecté, confirmation ordinaire du dossier ; aucun bypass de permissions/auth

## CLI-002 — Démarrage Claude
- timestamp: 2026-10-30T21:42:29-04:00 (America/Martinique)
- acting agent: codex (pilot)
- target session: b4b555f0 ; name depannage-web-pwa-ui
- mission/branch: WEB-PWA-20261030 ; claude/web-pwa-ui
- action: mission précise transmise, worktree et propriété des fichiers, critères visuels/tests, liens GitHub et prochaine livraison ; mode acceptEdits avec commandes de travail autorisées, sans bypass
- observed result: backgrounded b4b555f0, exit CLI 0 ; session interactive utilisée pour confiance fermée sans mission pour éviter doublon
- next action: vérifier lecture/acceptation effective par Claude et premier checkpoint ; un lancement seul ne vaut pas livraison

## CODEX-CLAIM — backend et PWA
- timestamp: 2026-10-30T21:42:29-04:00 (America/Martinique)
- agent: codex
- branch: codex/web-pwa-backend ; base 3c1ca2ce978f354556c0c691d4ac0d3088308b36
- observed result: agents implement_backend et implement_pwa ont lu les fichiers distants et revendiqué leurs seuls périmètres, avec chemins sans chevauchement
- next action: contrats additifs backend pour Claude, PWA privée sans cache utilisateur, tests ciblés puis contrôles complets

## ENV-001 — Vérification fournisseur initiale
- timestamp: 2026-10-30T21:42:29-04:00 (America/Martinique)
- actor: codex
- checks: supabase projects list ; vercel env ls
- result: aucune base dédiée identifiée, aucune variable applicative Vercel ; projet site électricité préservé sans mutation
- next action: tentative autorisée de création d’une base dédiée, sans toucher une autre base ; résultat à consigner

## CLI-003 — Contrats et statut transmis à Claude
- timestamp: 2026-10-30T21:42:51-04:00 (America/Martinique)
- acting agent: codex
- target session: b4b555f0-67e3-4f63-9671-fc3c14f9e67c
- mission/branch: WEB-PWA-20261030 ; claude/web-pwa-ui
- action: contrôle session busy/working ; attach CLI officiel et message de pilotage dans même session (pas de worker dupliqué) : contrat 08c10c5, propriété PWA/installation, demande premier checkpoint
- observed result: Claude annonce lecture mission/corrections et exécute les lectures ; message envoyé dans la session active ; acceptation finale à vérifier via status
- next action: lire CLAUDE_STATUS et révision frontend ; poursuivre backend/PWA

## ENV-002 — Création dédiée bloquée
- timestamp: 2026-10-30T21:42:51-04:00 (America/Martinique)
- actor: codex
- action: supabase projects create depannage-web-pwa, région eu-west-3, taille micro, organisation existante ; secret généré stocké hors dépôt sans affichage
- result: refus fournisseur pour factures impayées ; aucune base dédiée créée, aucune autre base modifiée
- consequence: Auth/Storage/RLS/Stripe intégrés ne peuvent pas être déclarés vérifiés ; développement/test isolé et previews continuent
- next action: signaler blocage concret au propriétaire sans arrêter les lots indépendants ; ne pas créer ailleurs pour contourner la restriction

## CLI-004 — Lecture du contrat autorisée
- timestamp: 2026-10-30T21:44:47-04:00 (America/Martinique)
- acting agent: codex
- target session: b4b555f0
- action: inspection du prompt CLI normal, commande git log/diff/show du contrat backend en lecture seule ; approbation ponctuelle Yes
- result: session reprend travail, aucun mode bypass/auto ajouté ; aucun accès sans rapport au projet
- next: suivre premier checkpoint et demandes techniques

## Finding PWA-001
- reviewer: codex / verify_web_pwa
- assigned agent: codex / implement_pwa
- reviewed branch/revision: codex/web-pwa-backend, copie de travail avant premier commit PWA (base contrat 08c10c5)
- evidence: components/pwa-registration.tsx, controllerchange et bouton mise à jour ; waiting peut désigner un worker déjà activé par un autre onglet ; message ACTIVATE_UPDATE ensuite sans nouvel événement, bouton reste Actualisation
- expected correction: préserver rechargement volontaire, détecter worker déjà actif/référence périmée et recharger sur clic explicite ; tester cycle multi-onglets
- status: fixed_pending_review
- fix commit: cf52bcdbc46f28348024b8dcf61925ba5d2005e3
- recheck evidence: code et 9 tests recontrôlés indépendamment ; cycle navigateur en cours, cross-review Claude encore attendu

## CLI-005 — Acceptation Claude et questions techniques
- timestamp: 2026-10-30T21:47:59-04:00 (America/Martinique)
- actor: codex
- target session: b4b555f0
- branch/checkpoint: claude/web-pwa-ui ; claim 018f93d
- observed result: docs/CLAUDE_STATUS.md confirme mission accepted/in_progress et lecture des sources/images ; installation npm ci ; checkpoint frontend annoncé
- action: approvals ponctuelles normales pour extraction des images PDF dans le tmp de la session et lecture des skills/tests ; aucune dérogation de permissions
- next: implémentation frontend et réponse directe aux Q-C1/Q-C2 ci-dessous

## Réponses pilote aux questions Claude — contrat checkpoint 0a01406
- Q-C1 : projection réellement implémentée par GET /api/interventions/[id]/operations : participants = tableau {id,full_name,phone,role} des participants réels, vide si non attribué ; accès contrôlé au dossier. workspace participants annoncé dans la première doc mais absent du code 0a01406 : correction demandée au backend, ne pas présumer ce champ. Utiliser operations pour le détail.
- Q-C2 : capabilities réellement livré par admin_overview = {dispatch_before_quote_acceptance:true,refunds:false,invoices:false,support_tickets:false,list_limit:100} ; garder ce contrat, mapper les menus dans UI selon données réellement présentes et distinguer indisponibilité des fonctions. Les données artisans/clients/organisations/interventions/audit sont présentes ; listes bornées à100, comptes globaux distincts.
- Q-C3 : confirmé, aucune valeur commerciale inventée ; tarifs/taxes/commission/pays/exploitant inconnus restent explicitement à définir.
- PWA : source cf52bcdbc46f28348024b8dcf61925ba5d2005e3 prête à revue ; composant PwaInstallControl réel. Codex backend 0a014063a6f2ca4fa323d627554bdfb5ffcd9c11 prêt à revue interne (npmcheck20 tests et SQLisolé19groupes), pas Supabase distant. Claude devra cross-vérifier cette révision ou la suivante publiée avant statut done.

## Preview PWA initiale — pas la nouvelle UI
- integration revision: 1638e765a44347d71b32968180e8e6781a7a7da7
- preview: https://depannage-electricite-e9vyf5jtr-brafas-projects.vercel.app
- build Vercel: réussi ; accès anonyme protégé SSO, accès CLI vercel curl autorisé HTTP200
- limitations: nouveau frontend et nouvelles routes backend non intégrés dans cette première preview ; tests navigateur nécessitent accès autorisé, aucune protection désactivée

## WEB-PWA-20261030 / codex — checkpoint PWA
- timestamp: 2026-10-30T21:49:02-04:00 (America/Martinique)
- agent: codex ; scoped implement_pwa
- branch/revision: codex/web-pwa-backend / cf52bcdbc46f28348024b8dcf61925ba5d2005e3
- changes: manifest standalone, icônes PNG/maskable/Apple, installation, mises à jour volontaires, fallback public hors ligne, aucun cache privé/API/auth
- checks: 9 tests comportementaux du worker/mise à jour ; TypeScript ; revue indépendante ; PWA-001 corrigé et recontrôlé dans le code
- report: https://github.com/claude972/depannage-electricite/blob/cf52bcdbc46f28348024b8dcf61925ba5d2005e3/docs/PWA_VERIFICATION.md
- preview: integration 1638e765a44347d71b32968180e8e6781a7a7da7, build Vercel réussi, URL ci-dessus
- limitations: frontend ancien sur première preview ; tests navigateur en cours via identifiant automation existant, jamais affiché ; authentification preview préservée ; vraie installation OS/mobile non validée
- other agent should verify: Claude doit revoir exactSHA puis intégration UI/retour hors ligne ; ready_for_review pour ce sous-lot uniquement, affectation Codex globale in_progress

## WEB-PWA-20261030 / codex — checkpoint backend
- timestamp: 2026-10-30T21:49:02-04:00 (America/Martinique)
- agent: codex ; scoped implement_backend
- branch/revision: codex/web-pwa-backend / 0a014063a6f2ca4fa323d627554bdfb5ffcd9c11
- changes: migration003, dossier/disponibilité/éligibilité artisan, opérations refus/RDV/rapport et historique immuable, contacts limités, dispatch préaccord, overview admin, propriété dossiers B2B et retrait de droits documents, CI SQLisolée
- checks: npm run check passé (20 tests + typecheck + build) ; 19 groupes SQLisolés avec stubs Auth/Storage ; diffcheck
- report: https://github.com/claude972/depannage-electricite/blob/0a014063a6f2ca4fa323d627554bdfb5ffcd9c11/docs/CODEX_BACKEND_VERIFICATION.md
- limitations: migration non appliquée à Supabase, aucun paiement distant ni accès réel testé ; nouvelles fonctions ne valent pas tout le plan livré ; contrats B2B/suspension conservateurs documentés
- next: revue indépendante à SHA exact en cours, puis intégration et revue Claude ; suite échecs/reprises de paiement sans actes financiers réels

## API-QUOTE-001 — Accord sur version exacte avant paiement
- timestamp: 2026-10-30T21:50:20-04:00 (America/Martinique)
- reviewer: codex pilot ; known gap confirmé par revue backend
- assigned agent: codex (serveur), claude (appel interface)
- reviewed revision: 0a014063a6f2ca4fa323d627554bdfb5ffcd9c11
- evidence: accept_quote actuel ne reçoit pas quote_id affiché ; risque de consentement sur version remplacée entre lecture et clic
- expected correction: POST actions accept_quote exige quote_id ; RPC sous verrou vérifie version sent exacte/active ; ancien accès direct sans ID refusé ; frontend transmet devis effectivement affiché
- status: in_progress
- fix commit: à venir, après checkpoint paiements 70337dc
- recheck evidence: scénarios ID absent/étranger/remplacé et version courante attendus

## Coordination intégration
- timestamp: 2026-10-30T21:50:20-04:00 (America/Martinique)
- backend exact 0a01406 revu indépendamment sans nouveau finding bloquant dans le périmètre ; SQL19 et probes de refus accès sur export exactSHA réussis. Cela ne ferme pas API-QUOTE-001 ni les fonctions hors checkpoint.
- intégration: merge non destructif de 0a01406 dans integration/web-pwa après revue ; première draft PR https://github.com/claude972/depannage-electricite/pull/1 pour CI et revue, aucun merge main/production
- CLI Claude : approbation normale ponctuelle de lecture git show des nouvelles routes (variable de boucle inspectée), pas de bypass. Réponses techniques envoyées dans même session, pas de duplication.
- tests navigateur: preview protégé atteint via identifiant automation déjà configuré, aucun changement de protection ; vérification de bootstrap cookie pour worker en cours, aucune installation OS revendiquée

## A1 — Nouvelle consigne et relais programmé
- timestamp: 2026-10-30T21:54:51-04:00 (America/Martinique)
- source: instruction directe propriétaire dans ce chat
- action: automation heartbeat unique créée via outil Codex puis carte de contrôle consultée ; minuit prochain 31 octobre 2026, timezone de ce chat America/Martinique
- result: ACTIVE, id relais-claude-minuit-d-pannage-web-pwa-puis-mobile ; aucun cron système/sleep-loop ajouté
- mission: amendment A1 ci-dessus ; tout codage à Claude après minuit (1–10 agents selon besoins), Codex pilote/tests/revues ; iOS/Android après Web/PWA vérifiés
- next: relayer au lead Claude actif, maintenir missions/branches/corrections et ne pas dupliquer

## Finding PWA-002
- reviewer: codex / verify_web_pwa
- assigned agent: codex avant relais minuit ; code implement_pwa
- reviewed revision: 1638e765a44347d71b32968180e8e6781a7a7da7 (preview)
- evidence: accès Vercel autorisé cookie-only, SWscript200 mais offlineprefetch credentials omit sans cookie ; worker échoue, registrations vide, controller false, cache vide, aucune notice UI
- diagnostic: hypothèse initiale header non transmis corrigée ; autre essai automatisation avec set-cookieheader global provoquait boucle307, distinct de la preuve cookie-only
- expected correction: cookie same-origin uniquement pour asset public statique, URL exacte/nonredirect/markerHTML vérifiés ; signaler installworker redundant + reprise
- status: verified
- fix commit: 6aaa1b36b99e64de4e0544780c8234c508cc1fd5
- recheck evidence: revue indépendante +14 tests comportementaux et 13 contrôles navigateur réussis sur intégration b0fa1df, chemin authentifié cookie-only ; cache uniquement notice publique. Installation OS et multi-déploiement restent hors preuve.

## WEB-PWA-20261030 / vérification intégration b0fa1df
- timestamp: 2026-10-30T21:59:00-04:00 (America/Martinique)
- revision: b0fa1df5476550c32f3eaefc8477fdbb150d0913 ; code Codex incluant6aaa1b3 et4ae3bd1
- preview vérifiée: https://depannage-electricite-hloqx4c89-brafas-projects.vercel.app (protection Vercel conservée, accès autorisé requis)
- online CI: check et SQLisolé PASS ; Vercel deployment PASS, draft PR1
- browser: 13/13 checks, zéro pageerror, mobile360/desktop1440, manifeste/icônes, worker actif, cachepublicunique, API503/no-store, pas de rejeu API/auth hors ligne, fallbackgénérique et reprise réseau
- evidence report: https://github.com/claude972/depannage-electricite/blob/9b5b495/docs/audit/VERIFICATION_PWA_PREVIEW.md
- limitations: ancienneUI seulement ; nouvelleUIClaude, vrais comptes/Auth/Storage/Stripe, installationOS et update multi-onglet sur deuxdéploiements nonprouvés

## CLI-006 — Revue croisée Claude indépendante
- timestamp: 2026-10-30T21:59:00-04:00 (America/Martinique)
- acting agent: codex
- target session: c38a6bc4-5051-4ba1-acca-3fd4b37445d2, depannage-web-pwa-cross-review
- mission/branch: WEB-PWA-REVIEW-001, claude/web-pwa-review, SHA cible6aaa1b36b99e64de4e0544780c8234c508cc1fd5
- action: après publication mission, checkoutlecture dédié ; CLIprint plan/read-only, aide/inventaire déjàvérifiés, aucunmodebypass, codeisolé du leadfrontend
- observed result: processusbusy dansinventaire ; rapport pas encore reçu. Ce n’est pas un secondworkerfrontend.
- next: lire rapport exactSHA, publier findings ou preuve bornée, fairecorriger puis recontrôler

## Backend4ae3bd1 — revue indépendante Codex complémentaire
- reviewed revision:4ae3bd168bec9e2a704c2fcd7d8b8db379689369
- checks: exportexactSHA,22 groupesSQL et3testsStripeclassifier ; ancienshelpers/RPCfinancières anon-auth refusés, nouvelle signatureseule et mutationdirectetentativesinterdite
- result: aucun findingbloquantnouveau danspérimètre ; consentementIDexact backendvérifié, integrationUIencore àfaire
- report: https://github.com/claude972/depannage-electricite/blob/9b5b495/docs/audit/VERIFICATION_PAIEMENTS_DEVIS.md

## Finding CL-UI-001 — Résultat réseau ambigu
- timestamp: 2026-10-30T22:00:13-04:00 (America/Martinique)
- reviewer: codex pilot
- assigned agent: claude
- reviewed branch/revision: claude/web-pwa-ui, copie en cours après claim018f93d ; api.ts SHA256 5c395c0a6bafd8468dce6b62231ce61b33e6a8fee1e4d86fe24b214b8daad7f6
- evidence: api.ts catch fetch annonce rien enregistré ; une requête POST peut avoir été commise avant perte de la réponse
- expected correction: message de résultat incertain, vérifier dossier avant reprise ; aucun faux zéro mutation ; test panne après soumission
- status: open
- fix commit: à venir
- recheck evidence: non vérifié ; message ciblé envoyé dans sessionb4b555f0, aucune édition concurrente

## Finding CL-UI-002 — Hash malformé
- reviewer: codex pilot
- assigned agent: claude
- reviewed branch/revision: claude/web-pwa-ui, copie en cours après claim018f93d ; session.ts SHA256 b5b5a72641a4650bdd4f05b8772c109815fbe36e534d73a322c9c536446e4bfa
- evidence: parseHash appelle decodeURIComponent sans garde ; hash direct avec échappement pourcent invalide provoque URIError
- expected correction: retour de navigation explicite et sûr, aucun montage de vue interdite ; tests hash invalide et chemin encodé valide
- status: open
- fix commit: à venir
- recheck evidence: non vérifié ; propriétaire averti, code en cours non déclaré prêt

## CLI-007 — Activité Claude confirmée au propriétaire
- timestamp: 2026-10-30T22:00:13-04:00 (America/Martinique)
- target session: b4b555f0 et reviewer c38a6bc4-5051-4ba1-acca-3fd4b37445d2
- action: inventaire réel ; permission normale ponctuelle accordée pour extraction Python des formulaires existants vers composantsowned ; aucune écriture dans autreprojet ni bypass
- observed result: nouveaux modules components/app présents, commandes Update/Write observées ; reviewer Claude actif ; premier checkpoint UI toujours nonlivré
- next: poursuivre intégration/coques et revues, ne pas confondre claim avec livraison

## Finding CL-UI-003 — Le retour URL ne décide pas du paiement
- timestamp: 2026-10-30T22:09:25-04:00 (America/Martinique)
- reviewer: codex pilot
- assigned agent: claude
- reviewed branch/revision: claude/web-pwa-ui, contrôleur en cours après018f93d, pas de checkpoint prêt
- evidence: branche returnContext payment teste cancelled avant statut paid chargé et annonce aucun débit ; le queryparam est forgeable et un paiement peut être confirmé entretemps. Le texte failed promet aussi absence de débit et reprise malgré blocage des asyncfailed ; Connect prétend relire des capacités non fournies.
- expected correction: afficher vérité serveur prioritaire, URL simpleindice ; résultat incertain sans promesse bancaire ni reprise interdite ; Connect retour reçu, pas capacités vérifiées ; tests paid+cancelURL et étatindéterminé
- status: open
- fix commit: à venir
- recheck evidence: message transmis à session lead, pas vérifié

## Finding CL-UI-004 — Réponse200 invalide
- reviewer: codex pilot
- assigned agent: claude
- reviewed branch/revision: claude/web-pwa-ui, api.ts en cours avant premiercheckpoint
- evidence: parseJSON catch fabrique objet error mais HTTP200 passe ensuite comme succès génériqueT
- expected correction: rejeter corpsJSON invalide même200, tests succèsJSON/malformed200/non2xx ; ne pas faire une réponse proxy/pageHTML une mutation réussie
- status: open
- fix commit: à venir
- recheck evidence: consigne envoyée ; validation après checkpoint

## Checkpoints suivants délégués avant minuit
- codex implement_organization_members :006 et contrats fe0f4d3 ; invitations securemanualshare liéesemailAuthvérifié, membres/rôles owner ; périmètre site/payeur horslot
- codex implement_artisan_performance :007 et contrats b1ba515 ; agrégats globaux artisan/parpériode et rendez-vousworkspace, aucune métrique chargée partielle présentée comme totale
- ownership séparée sur routes/migrations/harness/docs ; builds/index coordonnés ; aucun codefronttouché. Relais toutcodeClaude demeure00:00 America/Martinique.

## WEB-PWA-REVIEW-001 / claude — rapport reçu
- timestamp: 2026-10-30T22:15:26-04:00 (America/Martinique)
- reviewer/session: Claude c38a6bc4-5051-4ba1-acca-3fd4b37445d2 ; CLIprint lectureseule
- reviewed exact revision:6aaa1b36b99e64de4e0544780c8234c508cc1fd5
- checks réellement exécutés parClaude : npmtest28/28, TypeScript, SQLisolé22 groupes, sonde suspension ; pas cloud/build/preview par ce reviewer
- résultat : PWA001/PWA002/APIQUOTE001 codecorrects danspérimètre ; deux findings CL-001/CL-002 ci-dessous. Le test PWApreview13 a été effectué séparément ensuitepar QA, ne pas confondre preuves.
- status: ready_for_review du rapport ; mission globale restein_progress tantque corrections/intégration nonfinies

## Finding CL-001 — Suspension effaçable côté candidature
- reviewer: claude, revue WEB-PWA-REVIEW-001
- assigned agent: codex avant00h, puis Claude au relais si encours
- reviewed branch/revision: codex/web-pwa-backend /6aaa1b36b99e64de4e0544780c8234c508cc1fd5
- evidence:003 save_artisan_profile remet draft mêmeaprès suspended, puis submit possible ; disponibilité true aussiacceptée. ReproduitSQLparClaude ; pas d’accèsmission car artisan_approved restefalse, mais gouvernancesuspensioncontournée.
- expected correction: suspension persistante jusqu’à actionopérateur explicite ; pasde resetpar save/submit/dispo ; réactivations contrôlées et lockordercohérent ; tests suspended→edit→submit/dispo, opérateurreactivation, helpersprivés
- status: open
- fix commit: àvenir
- recheck evidence: reproClaude confirmé ; correction demandée

## Finding CL-002 — Filtre des missions trop large
- reviewer: claude
- assigned agent: codex avant00h, puis Claude aurelais
- reviewed branch/revision: codex/web-pwa-backend /6aaa1b36b99e64de4e0544780c8234c508cc1fd5
- evidence:available_missions appelle helpersecuritydefiner sur ensembleinterventions sans prédicat externe requested/artisanNULL, dont dossierspayés/annulés
- expected correction: prédicats externes requested et artisan_idisnull avant éligibilité, préserver tri/limite/anonymisation et permissions
- status: open
- fix commit: àvenir
- recheck evidence: revuecode ; pas testperfcloud

### Texte du rapport Claude (sans transcript)

# Rapport de revue croisée Claude — WEB-PWA-REVIEW-001

Affectation revendiquée : uniquement « Claude review assignment » de WEB-PWA-REVIEW-001 (branche claude/web-pwa-review, worktree depannage-web-pwa-review). Lecture seule, aucun code modifié, aucune interaction avec la session frontend b4b555f0.

**SHA revu :** `6aaa1b36b99e64de4e0544780c8234c508cc1fd5` (diff `3c1ca2c..6aaa1b3`, 6 commits).

## Sources lues
- Distant : MISSIONS.md et CORRECTIONS.md de `origin/missions/web-pwa` (dont PWA-001, PWA-002, API-QUOTE-001).
- Projet : AGENTS.md, DESIGN.md, CLAUDE.md, WEB_PWA_CONTRACTS.md, CODEX_BACKEND_VERIFICATION.md, PWA_VERIFICATION.md.
- Code : migrations 001 à 005, routes artisan, operations, actions, admin/overview, workspace, payments checkout/webhook/status, documents en contexte, lib payment-events, server, validation, stripe, manifest, sw.js, pwa-registration, next.config, layout, offline.html, tests PWA/payment-events/sql-review, test pgTAP, workflow CI.

## Contrôles réellement exécutés

| Contrôle | Résultat |
|---|---|
| `npm test` | 28/28 passent |
| `npm run typecheck` | passe |
| `node tests/sql-review.mjs` avec PGlite 0.5.13 (stubs Auth/Storage) | 22 groupes PASS |
| Sonde PGlite ad hoc pour CL-001 | reproduit |
| Build, Supabase distant, Stripe, preview, installation navigateur | non exécutés |

## Recontrôle des corrections annoncées
- **PWA-001** : `requestPwaUpdate` recharge si le worker n'est plus `installed` ou est déjà contrôleur, sinon poste ACTIVATE_UPDATE. Rechargement uniquement après clic. Correct, testé.
- **PWA-002** : install fetch same-origin, redirect error, URL exacte sans query, marqueur posé par next.config sur /offline.html seul, content-type HTML. Échec initial distingué de l'obsolescence ultérieure. Correct, testé.
- **API-QUOTE-001** : signature 5 paramètres, `accept_quote` exige le devis actif exact sous verrou, `p_quote_id` refusé ailleurs, anciens helpers révoqués, route exige quote_id. Correct, testé en SQL.

## Vérifications ciblées sans finding
- EXECUTE/RLS : toutes les nouvelles fonctions révoquées puis accordées explicitement, helpers internes privés, nouvelles tables en RLS select seul.
- Révocation B2B : helpers d'accès fondés sur l'appartenance courante, documents et storage alignés, review/garantie/messages suivent.
- Verrous et idempotence : dossier verrouillé avant tout contrôle, ordre quote → payment → attempt identique entre succès et échec, clé d'idempotence Stripe par session précédente.
- Paiements : aucune rétrogradation d'un paiement payé, événement tardif d'une ancienne session sans effet sur la tentative courante.
- PWA : seul /offline.html en cache, navigations no-store jamais mises en cache, /api, /auth, non-GET, non-navigate et autres origines non interceptés.

## Findings actionnables

**CL-001 — Un artisan suspendu remet lui-même son dossier en `draft` puis `submitted`** (Moyenne)
- `supabase/migrations/202610310003_web_operations.sql:69-82` et `:83-92`, aussi `:93-101`.
- `save_artisan_profile` force `application_status='draft'` sans tester le statut courant. `submit_artisan_application` accepte ensuite `draft`.
- Reproduit en PGlite : suspendu → submit refusé (22023) → save_profile accepté → draft → submit accepté → `pending_applications=1`. La ligne admin affiche `submitted`, indiscernable d'une première candidature. `set_artisan_availability(true)` est aussi accepté pendant la suspension.
- Pas d'accès données : `artisan_approved` reste false. Problème de gouvernance de la suspension.
- Correction : lever `insufficient_privilege` dans `save_artisan_profile` et `set_artisan_availability` si statut `suspended`, ou porter la suspension dans une colonne que seul `approve_artisan` lève. Ajouter le scénario au script SQL.

**CL-002 — `available_missions` évalue `mission_eligible` sur toute la table** (Basse, performance)
- `supabase/migrations/202610310003_web_operations.sql:127-131`.
- Aucun prédicat externe. La fonction SECURITY DEFINER n'est pas inlinable et s'exécute pour chaque intervention, y compris payées ou annulées. L'index partiel sur `status='requested'` reste inutilisé.
- Correction : ajouter `where i.status='requested' and i.artisan_id is null` avant l'appel à `mission_eligible`.

Aucun autre finding bloquant dans le périmètre.

## Dépendances d'intégration, pas des régressions Codex
- Le frontend présent à ce SHA appelle `accept_quote` sans quote_id (`components/courant-app.tsx:1887`). Il recevra 422 en mode live. Déjà consigné sous API-QUOTE-001 pour l'affectation UI.
- Dossier B2B dont le créateur a quitté l'organisation : plus aucun payeur possible. Blocage délibéré documenté.

## Limites restantes
- Pas de Supabase ni Stripe distants. RLS, Auth, Storage et webhooks validés uniquement par PGlite avec stubs. Pas de preuve de concurrence réelle.
- Installation, offline et mise à jour non vérifiés en navigateur ni sur preview. PWA-002 reste à retester en ligne.
- Preview protégé par SSO : le navigateur récupère le manifeste sans cookies par défaut. Le critère « installable » peut donc échouer sur preview sans défaut du code. Tester sur un déploiement non protégé ou ajouter `crossorigin="use-credentials"` au lien manifest pendant le test.
- Build non exécuté pour éviter une course sur `.next` dans le checkout partagé.
- Factures, remboursements, payouts, équipes, calendrier : absents et déclarés absents, aucun considéré livré.

Rapport complet également écrit dans `/Users/claudebrafa/.claude/plans/you-are-claude-independent-wobbly-charm.md`.


## WEB-PWA-20261030 — nouvelle vérification des fournisseurs

Timestamp: 2026-10-30T22:45:12.613920-04:00 — acteur Codex, coordination.

- L’utilisateur indique Supabase payé et exige Stripe en environnement test. Aucun paiement Stripe réel autorisé.
- Nouvel appel authentifié de création `depannage-web-pwa`, organisation et région déjà prévues : refus persistant de l’API pour factures échues. Aucun projet créé, aucun projet existant modifié. Le règlement annoncé ne permet pas de déclarer ce blocage levé tant que le fournisseur refuse.
- Vercel : aucune variable d’environnement configurée pour cette application. Aucun secret Stripe disponible dans le processus.
- Onglet Stripe ouvert directement sur le dashboard test : redirection vers la connexion. Connexion du titulaire nécessaire ; aucun identifiant demandé dans le chat, aucun secret enregistré dans ce rapport.
- Suite : reprendre le provisionnement dédié après levée du refus fournisseur et configurer uniquement les secrets test dans l’environnement preview, puis vérifier Checkout/webhook/Connect en sandbox.

## WEB-PWA-20261030 — intégration des droits par site

- Backend revu : c04b7527e089caf5dfface2ead58b17710fea652, intégré et poussé sur integration/web-pwa par 1e2eaed.
- Revue indépendante : /tmp/depannage-site-access-review.md, empreintes finales vérifiées par l’implémenteur ; SQL sites 8, principaux 29, performance 6 groupes réussis. Pas de nouvelle fuite bloquante dans ce périmètre. Les opérations service-role déjà en vol et la recette cloud restent des limites explicites.
- Claude UI session b4b555f0 vérifiée active. Message CLI transmis : livrer un checkpoint testé/poussé, intégrer PWA Profil/Aide sans attendre d’approbation supplémentaire, vérifier CL-UI-003/004/006. La nouvelle interface n’est pas encore validée en preview.


## WEB-PWA-20261030 — Supabase débloqué et provisionné

2026-10-30T22:51:36.296608-04:00 — Codex, après confirmation du règlement par l’utilisateur.

- Création dédiée réussie : depannage-web-pwa, ref kcpyjzndybfdlnhvscbs, eu-west-3, ACTIVE_HEALTHY. Aucun autre projet modifié.
- Dry-run neuf puis application distante réussie des neuf migrations 001 à 009, code intégré 1e2eaed. Aucun seed de démonstration chargé.
- Variables Supabase public/serveur et adresse de retour configurées uniquement pour Vercel preview, branche integration/web-pwa. Clé de service stockée comme sensible ; aucun secret dans Git. STRIPE_LIVE_PAYMENTS_ENABLED=false.
- Redéploiement preview lancé. Parcours Auth/RLS/Storage cloud à vérifier ensuite ; appliquer les migrations ne constitue pas une recette complète.
- Stripe test reste à connecter : onglet de connexion ouvert, aucun secret test encore configuré ; aucun paiement réel autorisé.


## WEB-PWA-20261030 — revue frontend 9fdb1e5, intégration et suite autonome

2026-10-30 America/Martinique — Codex pilotage, Claude session b4b555f0, branche claude/web-pwa-ui. L’utilisateur est absent et autorise la poursuite autonome ; aucune attente de connexion Stripe ne doit bloquer les autres lots.

- Nouveau checkpoint Claude 9fdb1e5 intégré par 0017b48 et poussé sur integration/web-pwa pour preview. Pas encore accepté : revue et QA en ligne en cours.
- CL-UI-007 (open, Claude, bloquant connexion) : signIn/signUp appellent clearSessionState puis testent un contexte invalidé sans ctx.rebind. Le rechargement/navigation peut être ignoré. Corriger adoption explicite de l’identité et tester la vraie séquence du contrôleur, en gardant le rejet des anciennes réponses.
- CL-UI-008 (open, Claude) : pas de revalidation focus/visibility, invalidation 403 partielle. Workspace/professional/organisation/site doivent être relus et les contextes invalidés après révocation. Cela ne prétend pas effacer les octets déjà vus ni révoquer instantanément une URL signée.
- CL-UI-009 (open, Claude) : formulaire invitations accepte 30 jours, API limite14. Aligner la validation sur14.
- Les trois findings sont transmis via CLI à la session active ; rapport indépendant /tmp/depannage-ui-checkpoint-review.md attendu. Claude poursuit ses corrections de qualité UI, sans écriture concurrente sur ses fichiers.
- Demandes partagées acceptées : Codex ajoute test:ui au check automatisé et agentRules:false au NextConfig pour préserver AGENTS.md. Fichiers package.json/next.config.ts, branche codex/web-pwa-backend ; revue des changements avant intégration.
- QA cloud séparée autorisée sur le seul nouveau projet : comptes QA temporaires, scénarios refus intercomptes et Storage puis nettoyage des seules ressources créées. Aucun secret dans les rapports.


## WEB-PWA-REVIEW-001 — rapport Claude de relecture du backend 1d93445

# Rapport de revue croisée Claude — WEB-PWA-REVIEW-001 (suite)

Même reviewer, même session, lecture seule, aucun code modifié. Aucune interaction avec la session frontend b4b555f0 ni ses agents de rôle. Affectation revendiquée : uniquement « Claude review assignment ».

**SHA revu :** `1d93445400ca25b7c721d1bc946b6621b9b4a784`. Six commits depuis 6aaa1b3. Les migrations 003, 004 et 005 n'ont aucun diff depuis ma revue précédente.

## Sources lues
MISSIONS.md et CORRECTIONS.md distants, migrations 006, 007, 008, routes organizations, invitations/accept et artisan/performance, diff workspace et CI, WEB_PWA_CONTRACTS.md, WEB_PWA_PERFORMANCE_CONTRACT.md, CODEX_ORGANIZATION_VERIFICATION.md, CODEX_PERFORMANCE_VERIFICATION.md, CODEX_BACKEND_VERIFICATION.md, tests artisan-performance, sql-performance-review et diff de sql-review.

## Contrôles réellement exécutés

| Contrôle | Résultat |
|---|---|
| `npm test` | 30/30 |
| `npm run typecheck` | passe |
| `node tests/sql-review.mjs` avec PGlite, 8 migrations, stubs Auth/Storage | 29 groupes PASS |
| `node tests/sql-performance-review.mjs` | 6 groupes PASS |
| Build, Supabase/Stripe distants, preview, navigateur | non exécutés |

## Recheck CL-001 et CL-002 : corrigés par la migration 008
- **CL-001 clos.** Les trois RPC self-service passent par `guard_artisan_self_edit`, qui verrouille profiles puis artisan_profiles et refuse tout si `suspended`. Les anciennes fonctions sont renommées et leur EXECUTE révoqué. Un `approve_artisan(false)` répété conserve `suspended`, et crée un shell suspended pour un compte hérité sans dossier. Un `approve_artisan(true)` exige un dossier complet en submitted, approved ou suspended, et garde la disponibilité à false après suspension. Ordre de verrou identique dans le guard et dans approve_artisan. Vérifié en source et par les groupes SQL CL-001 et legacy que j'ai exécutés.
- **CL-002 clos.** `available_missions` filtre `status='requested'` et `artisan_id is null` avant `mission_eligible`. Projection anonymisée, ordre et limite inchangés. Vérifié en source et par le groupe SQL CL-002.

## Revue indépendante 006 : organisations et invitations
Conforme au contrat dans le périmètre réel.
- Email du destinataire lu dans `auth.users` avec confirmation requise, jamais depuis les métadonnées ni le corps. Comparaison normalisée exacte.
- Code aléatoire de 32 octets généré côté serveur, seul le SHA-256 est stocké. Aucun grant SELECT sur invitations ni événements, projection expurgée sans hash. Invitations visibles par le seul owner, journal owner ou admin.
- Acceptation sous verrou organisation puis invitation, statut pending non expiré, usage unique, non-membre. Rejeu refusé. Rôles client et manager seulement, artisan et admin non convertis.
- Owner canonique exigé pour inviter, révoquer, changer un rôle, retirer, transférer. Pas d'action sur soi, pas de retrait ni dégradation d'un owner. Transfert atomique vers un membre manager à email confirmé, un seul owner conservé, invitations pendantes révoquées. Tout est scopé par organisation.
- Retrait d'un membre : révocation immédiate des dossiers et documents via les helpers de la migration 003, confirmée par le groupe SQL correspondant.

Rôles par site, payeur délégué, durée d'une URL signée déjà émise et email automatique restent ouverts et sont déclarés comme tels.

## Revue indépendante 007 : performance et rendez-vous
- `artisan_performance` ne prend aucun paramètre cible et dérive l'artisan de la session. Agrégats SQL sur le périmètre complet, pas sur la fenêtre workspace. Bornes demi-ouvertes, périodes contiguës de 32 jours maximum. Croissance nulle si montant précédent nul, note sur tout l'historique, ponctualité nulle, aucun « net » prétendu, garde d'entier sûr. La route refuse clés inconnues et doublons.
- Rendez-vous dans workspace : uniquement pour les dossiers déjà chargés, sous la RLS existante, limite 200 signalée. Les offres anonymisées ne sont pas enrichies.

## Nouveaux findings
Aucun finding actionnable dans le périmètre revu.

Observations sans action requise :
- `link_artisan_credential` n'est pas sous le guard de suspension. Lier une pièce ne modifie ni statut ni disponibilité.
- Le shell suspended d'un compte hérité ne se répare que par une action opérateur hors API. Blocage délibéré et documenté.
- L'échec d'acceptation d'invitation n'est pas throttlé en SQL. L'espace de 256 bits rend l'énumération non pertinente.

## Dépendances d'intégration frontend
Transmettre `quote_id` à l'acceptation, créer la page d'acceptation d'invitation et nettoyer le fragment d'URL, consommer la route performance pour les chiffres globaux, invalider le contexte organisation sur 403.

## Limites
Pas de Supabase ni Stripe réels, pas de concurrence à deux sessions, pas de preview ni navigateur par ce reviewer. Nouvelle UI non vérifiée. La vérification en ligne de PWA-002 a été faite par la QA, pas par moi. Build non exécuté.

Rapport également écrit dans `/Users/claudebrafa/.claude/plans/you-are-claude-independent-wobbly-charm.md`.

## WEB-PWA-20261030 — revue indépendante du frontend 9fdb1e5

# Independent frontend checkpoint review

Reviewer: Codex subagent review_ui_checkpoint. Read-only owner worktree review. Reviewed exact pushed frontend `9fdb1e5cb09933e5b7e77d2962023ea386ba5310`; backend comparison integration `1e2eaed` (009). Source inspected via git show, not mutable working copy. AGENTS.md, DESIGN.md and Claude verification report read. No owner source edited.

## Findings

### UI-REV-001 — P1, successful login self-invalidates its controller continuation
`components/courant-app.tsx:1476` and `:1497` call `clearSessionState()` after successful sign-in or a signup returning a session. Reset bumps identity generation at126. The next `ctx.alive()` is therefore false; refresh and all guarded navigation are skipped. `ctx.rebind()` exists in the guard but has no controller calls at this revision. An auth event may have launched an earlier refresh, but the later reset also invalidates its seq, so this does not reliably rescue login. SDK can be authenticated while UI remains public. Late auth completion also resets a newer identity without checking whether its originating login is still current.

Required fix: handle self-created identity adoption explicitly (with safe rebind/current auth identity reconciliation), then load its workspace and navigate. Cover actual controller auth flow, including normal successful login, signup with session, auth-event ordering, and a stale login response arriving after another identity. Do not weaken stale-chain protection globally.

### UI-REV-002 — P1, membership/scope revocation leaves professional caches visible
`components/courant-app.tsx:160` refresh replaces workspace but never clears/reloads professional state for membership or site-scope changes. Professional loads only on mode/role change at381–383 or explicit request. No visibility/focus revalidation exists in reviewed components. The only permission-loss invalidation is loadOrganization403 at1130–1137, reached through Members view. loadSiteAccess403 at1290–1293 merely marks capability unavailable. Enterprise root siteAccess effect `components/role/enterprise-space.tsx:290` depends only organizationId/accessKey; role change or same-org grant change does not invalidate this cached overview.

Reproduction: user opens organization contracts/compliance or a site, leaves tab; owner removes/restricts user; user returns. Existing organization/site, professional datasets and authority UI remain until unrelated refresh or Members endpoint is visited. Even an ordinary workspace refresh does not prune professional data. Server RLS continues to reject fresh reads/writes; this is stale UI disclosure/authority presentation, not a demonstrated server authorization bypass or a promise to erase previously seen bytes.

Required fix: revalidate on foreground/focus, and centralized 403 handling plus membership/scope comparison to clear affected cached org/site/detail/professional data immediately. Reload all still-authorized scopes and remount dependent caches when rights change. Test same-account remove, manager→viewer, all→selected and a selected grant removal.

### UI-REV-003 — P2, invitation duration validation contradicts API
`components/role/enterprise-space.tsx:2942–2943` accepts 1–30days and displays that range (number input also max30). Current `app/api/organizations/route.ts:11` accepts only1–14. Entering15–30 passes form validation then is rejected422; demo would accept a validity impossible live.

Required fix: align client input/validation/copy to1–14days and add boundary checks14accepted/15rejected.

## Verified bounded corrections

- CL-UI-003: paymentReturnMessage prioritizes paid server status over forged cancelled URL; no banking absence claim. Controller rereads payment endpoint, generation-checks async outcome. Stripe Connect return copy explicitly says account capabilities not verified.
- CL-UI-004: 200 HTML/malformed/primitive/empty JSON throws ApiRequestError502; non2xx safe errors, network mutation outcome uncertain. No fake success found in this path.
- CL-UI-006: runner itself correctly drops stale completion/error/notice/navigation and protects new identity busy flag; controller normal mutations generally wrap side effects. Login integration defect above remains.
- Invitation acceptance posts strict token to existing verified-email SQL flow. No recipient email trusted from client; no server auth bypass found within this review.
- Quote action sends displayed quote_id, consistent backend005 contract.

## Actual checks

- Exported exact revision components/app, tests/ui, lib/domain.ts into `/tmp/depannage-ui-review-9fdb1e5`, using existing read-only node_modules symlink. Ran tsx tests/ui: **21/21 PASS**, exit0. Tests cover pure guard, not controller successful login.
- Additional minimal reproduction uses reviewed createGuard/createRunner plus exact successful-login reset→alive→navigation order: **reproduced no refresh, no navigation, false result**, exit0. Script `/tmp/depannage-ui-review-9fdb1e5/reproduce-login.ts`. Initial top-level-await harness failed CJS transform; wrapped async main and reran successfully. This is a pure ordering reproduction, not a mounted React/browser login test.
- No full build, preview, actual Auth, Stripe, browser or visual comparison executed by this reviewer. Volume constrained; these remain pilot/QA checks.
- No owner code/dependency/source modifications. Temporary reproduction/report only.

Verdict: **changes required** for above concrete findings. Not a complete app audit and no completion claim.


## WEB-PWA-20261030 — vérification Supabase réel

# Supabase cloud verification

UTC 2026-10-31T02:54:18.989Z

Dedicated project: depannage-web-pwa (kcpyjzndybfdlnhvscbs). Expected schema: integration 1e2eaed, migrations001–009 already provisioned by pilot. Real hosted Auth, PostgREST and Storage endpoints; no local stubs. No schema/policy edits.

| Check | Result | Detail |
| --- | --- | --- |
| Hosted Auth password login a | PASS |  |
| Hosted Auth password login b | PASS |  |
| Auth trigger ignores requested admin role | PASS |  |
| Cross-client profile read filtered | PASS |  |
| Direct role escalation rejected | PASS |  |
| Role remains client | PASS |  |
| Intervention creation derives authenticated owner a | PASS |  |
| Intervention creation derives authenticated owner b | PASS |  |
| Own intervention readable | PASS |  |
| Cross-client intervention read filtered | PASS |  |
| Anonymous intervention table denied | PASS |  |
| Cross-client cancel rejected | PASS |  |
| Denied cancel preserves requested status | PASS |  |
| Direct status/payment spoof rejected | PASS |  |
| Storage bucket private and 4MiB cap | PASS |  |
| Own document metadata readable | PASS |  |
| Cross-client document metadata filtered | PASS |  |
| Owner may request short-lived Storage signed URL | PASS |  |
| Other client cannot sign private object | PASS |  |
| Anonymous cannot download private object | PASS |  |
| Public Storage endpoint cannot serve private object | PASS |  |
| Anonymous mutating RPC denied | PASS |  |

## Cleanup

- Remove QA objects: PASS
- Remove QA metadata: PASS
- Remove QA audit rows: PASS
- Remove QA intervention rows: PASS
- Remove actor QA audit rows: PASS
- Delete QA Auth user: PASS
- Remove actor QA audit rows: PASS
- Delete QA Auth user: PASS

## Limits

This is bounded client isolation/Auth/Storage smoke verification. No Stripe account/payment, real email delivery, browser UI, organization site scopes, artisan workflow, concurrency or mobile installation tested. Admin-created confirmed QA users exercise login; this does not prove public signup/confirmation mail. Signed URLs and access tokens were never printed or committed. Only explicitly tracked temporary QA users/jobs/documents were removed.

## Independent post-cleanup readback

- No remaining tracked profiles: PASS
- No remaining tracked interventions: PASS
- No remaining tracked documents: PASS
- No remaining tracked Storage objects: PASS
- QA Auth identity removed: PASS
- QA Auth identity removed: PASS


## WEB-PWA-20261030 — demandes partagées intégrées

Codex f132f6a : test:ui ajouté au check et agentRules:false conforme au type NextConfig installé. Intégration 8cdf5af poussée, CI et build Vercel en cours. Pas de nouveau build local sur volume plein. Claude session b4b555f0 informée via CLI de Supabase actif, de la poursuite autonome et des findings CL-UI-007/008/009. Statut global reste in_progress.


## WEB-PWA-20261030 — QA professionnelle réelle

# Hosted professional permissions QA

Final result: 30/30 functional checks PASS. Initial cleanup FK failure corrected; 14 recovery/readback checks PASS, no tracked QA resources remain.

UTC 2026-10-31T02:55:34.503Z
Dedicated project kcpyjzndybfdlnhvscbs, schema migrations001–009 (provisioned from integration1e2eaed). Real Auth/PostgREST/Storage. All data explicitly temporary synthetic QA, no email sent, no Stripe, no schema/policy edits. A tracked QA operator alone was temporarily granted platform admin via service-role to exercise operator approval/suspension. Synthetic QA dossier is not proof of legal qualification.

| Check | Result | Detail |
| --- | --- | --- |
| Temporary operator role scoped to tracked QA identity | PASS |  |
| Selected invitation returns selected scope without bearer secret | PASS |  |
| Wrong verified email cannot accept invitation | PASS |  |
| Invitation acceptance applies selected grant atomically | PASS |  |
| Accepted invitation replay rejected | PASS |  |
| Selected member sees only granted site | PASS |  |
| Selected member sees only granted-site job | PASS |  |
| Selected member sees only granted-site document | PASS |  |
| Granted-site Storage signing succeeds | PASS |  |
| Excluded-site Storage signing denied | PASS |  |
| Selected manager can write granted site | PASS |  |
| Selected manager cannot write excluded site | PASS |  |
| Viewer downgrade denies retained write grant | PASS |  |
| Viewer downgrade preserves permitted site read | PASS |  |
| Viewer cannot grant itself site access | PASS |  |
| Removed member sees no former sites | PASS |  |
| Removed member sees no former jobs | PASS |  |
| Removed member sees no former document metadata | PASS |  |
| Removed member cannot request new signed URL | PASS |  |
| Removed member cannot read organization overview | PASS |  |
| Unapproved artisan cannot accept mission | PASS |  |
| Approved QA artisan receives eligible anonymized offer | PASS |  |
| Approved eligible artisan accepts mission | PASS |  |
| Repeated operator suspension remains suspended/unavailable | PASS |  |
| Suspended artisan cannot edit dossier to reactivate | PASS |  |
| Suspended artisan cannot resubmit application | PASS |  |
| Suspended artisan cannot restore availability | PASS |  |
| Suspended artisan cannot self-approve | PASS |  |
| Suspension denials preserve unapproved account | PASS |  |
| Suspended artisan receives no eligible offers | PASS |  |

## Cleanup

- Remove QA Storage objects: PASS
- Remove QA documents: PASS
- Remove QA job audit: PASS
- Remove QA jobs: PASS
- Remove QA sites: PASS
- Remove QA membership events: PASS
- Remove QA invitations: PASS
- Remove QA organizations: FAIL (23503)
- Remove QA actor audit: PASS
- Remove QA Auth user: FAIL (500)
- Remove QA actor audit: PASS
- Remove QA Auth user: FAIL (500)
- Remove QA actor audit: PASS
- Remove QA Auth user: PASS
- Remove QA actor audit: PASS
- Remove QA Auth user: PASS

## Limits
No browser UI, mail delivery, Stripe, real concurrency, legal dossier authenticity, complete business lifecycle, or mobile testing. Revocation checks concern subsequent requests; previously issued signed URLs retain their TTL, previously viewed bytes cannot be revoked. Only tracked resources removed.

## Cleanup correction and readback

Initial org deletion was blocked by the professional_audit row emitted by the allowed budget RPC. Deleted only professional_audit rows matching the tracked QA organization, then removed organization and retried remaining QA Auth identities. No schema change.

- Retry cleanup professional_audit: PASS
- Retry cleanup organizations: PASS
- Retry QA Auth user cleanup: PASS
- Retry QA Auth user cleanup: PASS
- No remaining tracked profiles: PASS
- No remaining tracked organizations: PASS
- No remaining tracked sites: PASS
- No remaining tracked interventions: PASS
- No remaining tracked documents: PASS
- QA Auth identity absent: PASS
- QA Auth identity absent: PASS
- QA Auth identity absent: PASS
- QA Auth identity absent: PASS
- QA Storage prefix empty: PASS


Codex a supprimé uniquement son cache de build généré .next (checkout Codex), 76Mo libérés sans source ni dépendance supprimée. Volume toujours presque plein ; builds en ligne prioritaires.


## WEB-PWA-20261030 — Auth dédié configuré pour preview

2026-10-30 America/Martinique — Codex, nouveau projet kcpyjzndybfdlnhvscbs uniquement.

- Audit config CLI a confirmé site_url localhost:3000 et aucune URL de retour ; déploiement preview ne suffisait donc pas aux parcours e-mail.
- Configuration minimale examinée avec `supabase config diff` avant push : adresse de retour stable preview, URLs exactes confirm/reset, objets et HTML français de confirmation/récupération vers le handler SSR token_hash existant. Six propriétés appliquées avec succès. Les douze propriétés distantes non déclarées sont restées inchangées (confirmation requise, MFA, limites, Storage etc.). Aucun message envoyé à un tiers.
- Sources primaires relues : https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs et https://supabase.com/docs/guides/local-development/customizing-email-templates ; CLI installé supporte le push des corps de templates et le signale explicitement.
- Codex conserve cette configuration preview minimale et deux templates dans supabase/config.toml et supabase/templates sur integration/web-pwa (fichiers sans secrets, pas de push automatique vers un autre environnement). Vérification des liens/routes SSR prévue en navigateur ; distribution réelle du courrier pas encore vérifiée.
- CL-UI-007 reste ouvert au75feaab : correction de connexion ordinaire mais ancienne réponse Auth peut encore réinitialiser une identité plus récente. Reproduction indépendante transmise à Claude. CL-UI-008 amendé par8856236, relecture nécessaire avant clôture.
- En ligne, QA annonce41 parcours/contrôles UI et13 PWA réussis sur0017b48 ; rapport complet et captures attendus. Le finding VIS-001 sur densité artisan reste ouvert, indépendamment du succès fonctionnel.


## WEB-PWA-20261030 — revues et contrôles complémentaires

# Real hosted concurrency QA

UTC 2026-10-31T03:00:50.425Z
Dedicated Supabase project kcpyjzndybfdlnhvscbs; migrations001–009. Real authenticated PostgREST HTTP requests sent concurrently with Promise.all. Four temporary synthetic QA users. Approved artisan fixture fields set by service-role only for the two tracked QA identities; not an operator approval or legal qualification test. No schema changes, no email, no Stripe.

## Functional checks

19/19 passed.

| Check | Result | Detail |
| --- | --- | --- |
| artisan1 initially eligible | PASS |  |
| artisan2 initially eligible | PASS |  |
| Exactly one simultaneous claim succeeds | PASS |  |
| Exactly one simultaneous claim fails | PASS |  |
| Stored assignment has single winning artisan | PASS |  |
| Winner retains authorized private job | PASS |  |
| Loser cannot read private job | PASS |  |
| Loser cannot read document metadata | PASS |  |
| Loser cannot request private Storage URL | PASS |  |
| Loser cannot request participant contacts | PASS |  |
| Winner may retrieve assigned participant contacts | PASS |  |
| artisan1 no longer offered assigned mission | PASS |  |
| artisan2 no longer offered assigned mission | PASS |  |
| Exactly one concurrent invitation accept succeeds | PASS |  |
| Exactly one concurrent invitation accept fails | PASS |  |
| Single recipient membership stored | PASS |  |
| Single invitation acceptance event stored | PASS |  |
| Invitation consumed by correct recipient | PASS |  |
| Successful concurrent accept retains selected-site grant | PASS |  |

## Sanitized race responses

```json
[
  {
    "label": "Two artisan claim requests via Promise.all",
    "elapsed_ms": 261,
    "responses": [
      {
        "actor": "artisan1",
        "success": true,
        "error_code": null,
        "status": 200
      },
      {
        "actor": "artisan2",
        "success": false,
        "error_code": "42501",
        "status": 403
      }
    ]
  },
  {
    "label": "Same recipient invitation accepts via Promise.all",
    "elapsed_ms": 198,
    "responses": [
      {
        "success": true,
        "error_code": null,
        "status": 200
      },
      {
        "success": false,
        "error_code": "P0001",
        "status": 400
      }
    ]
  }
]
```

## Cleanup

- Remove QA Storage objects: PASS
- Remove QA documents: PASS
- Remove QA job audit: PASS
- Remove QA jobs: PASS
- Remove QA sites: PASS
- Remove tracked QA professional_audit: PASS
- Remove tracked QA organization_membership_events: PASS
- Remove tracked QA organization_invitations: PASS
- Remove QA organizations: PASS
- Remove QA actor audit: PASS
- Remove QA Auth user: PASS
- Remove QA actor audit: PASS
- Remove QA Auth user: PASS
- Remove QA actor audit: PASS
- Remove QA Auth user: PASS
- Remove QA actor audit: PASS
- Remove QA Auth user: PASS

## Cleanup readback

- No tracked profiles: PASS
- No tracked organizations: PASS
- No tracked sites: PASS
- No tracked interventions: PASS
- No tracked documents: PASS
- QA Auth identity absent: PASS
- QA Auth identity absent: PASS
- QA Auth identity absent: PASS
- QA Auth identity absent: PASS
- QA Storage prefix empty: PASS

## Limits
Concurrent client requests demonstrate bounded production-hosted locking behavior for these two scenarios. This is not a load/stress test or guarantee for every interleaving. No browser, payments, email delivery, native mobile or long-lived signed URL revocation tested. Only tracked temporary QA records removed; public project settings unchanged.


# Focused independent login recheck — 2e3dcf1

Exact reviewed revision: `2e3dcf14ce6e0d6750329dae97ca1e51c759ee3b`. Owner working files not read as delivery and not edited. Helpers/test snapshot exported to `/tmp/depannage-ui-review-2e3`.

## Confirmed corrections

Former awaiting-verification A → newer B listener → old verification responseA now returns superseded before clear/rebind, because loadedB differs from expectedA. Independent reproduction additionally confirms B's active runner busy flag remains true and B's eventual notice publishes normally. A stale verification rejection after B does not publish A's error. Ordinary promise-before-event, own event-before-promise, and identity change during workspace load tests pass.

The former different-account P1 reset finding is corrected in this bounded path.

## Remaining actionable edge — P2 stale logout continuation resets new public state

`components/app/identity.ts:33–46` still permits adoption when loadedUserId is null, without checking whether the original chain was invalidated during verification. Null is correct for initial anonymous login, but also occurs after an explicit later logout.

Deterministic reproduction:
1. A login continuation awaits currentUserId; verification request was sent forA.
2. A later logout clears session, bumps generation, resets runner and leaves loadedUserId null / SDK user null.
3. User enters a new anonymous request draft after logout.
4. Old verification response returnsA (for the earlier request's token). Test controller current state remains loggedout.
5. Helper accepts loadednull, calls clearSessionState again, setsrefA, rebinds the invalidated chain and starts another refresh. This erases the newer public draft. An unauthenticated workspace response triggers the existing401 clear, so private navigation is prevented.

Evidence: helper's clear before checking current context, and actual controller clearSessionState resets pendingDraft and removes DRAFT_KEY. Independent reproduction asserts reset count increases after logout and newer anonymous draft is removed. It also asserts no private navigation and finalrefnull with an unauthenticated-refresh-equivalent reset. This is **public-state loss from obsolete auth work**, not a demonstrated server authorization bypass, return to an authenticated SDK session, or private data leak.

Existing owner test `logout during verification (SDK user null)` has verification returnnull; it does not exercise stale verifiedA arriving after logout.

A minimal bounded guard after awaited verification could reject `!ctx.alive() && loaded === null`, retaining initial anonymous login (alive) and legitimate own listenerA adoption (loadedA). Owner should implement and test the actual controller-used helper, preserving all existing successful-login controls. No need to claim a broader auth rewrite or invent additional interleavings for closure of this finding.

## Actual verification

- **30 existing UI tests PASS**, exit0.
- **3 independent cases PASS**, exit0, in `/tmp/depannage-ui-review-2e3/independent-auth.test.ts`: B preserved during stale verification; staleA verification error suppressed; post-logout staleA response reproduces public draft loss.
- Total **33 tests PASS**. Passing final reproduction documents current bad behavior rather than its correction.
- Harness invokes exact reviewed adoptIdentity/createRunner/createGuard and mirrors relevant controller logout/reset/unauthenticated refresh state transitions. It is a deterministic helper-level test, not a mounted React test or a real Supabase/browser timing observation.
- No build, cloud, preview, visual or complete Auth journey executed by this reviewer. No owner code, build artifacts or dependencies modified.

Verdict: previous B-reset race corrected; one P2 logout/public-state edge remains. UI cache and invitation findings are outside this focused recheck, with no status change asserted here.


### CLI Claude reviewer — ADMIN-LISTS
Codex a vérifié le reviewer c38a6bc4 inactif après son précédent rapport, avancé uniquement son checkout lecture seule jusqu’au d85da06, puis repris la même session CLI en mode plan normal. Revue admin pagination et009 demandée avec tests autorisés et sans mutation cloud/code. Processus lancé, résultat attendu dans /tmp/depannage-claude-admin-review.json ; pas de verdict déduit du lancement. Lead UI b4b555f0 distinct et non interrompu. Suite : publier le rapport réel et traiter les findings avant clôture.

### Intégration courante
fe4c9c9 intègre d85da06 et le correctif Auth2e3dcf1/revalidation8856236 pour recette. P1 ancienne réponse A sur session B recontrôlé corrigé ; P2 brouillon anonyme après logout reste assigné Claude. La nouvelle interface professionnelle doit encore consommer refreshedAt. Aucune clôture globale. Le CSV révisé préserve76IDs et leurs états historiques ; preuves cloud/preview enregistrées dans docs/verification.


## WEB-PWA-20261030 — rapport revue photos6962 et login823

# Independent photo checkpoint review — 6962be6

Exact reviewed frontend: `6962be6ccfae615551d2575edb8ca05420aef635`. Exact git source only, no mutable role work or owner edits. Backend documents route compared to current integration implementation. No full build/dependency install.

## Findings (assign Claude)

### PHOTO-REV-001 — P2: uncertain upload outcome is classified as a definite failure
`components/courant-app.tsx:968–973` catches every upload exception and sets failed. `components/app/upload-queue.tsx:19–20` then says “Certaines photos n’ont pas été enregistrées”; retry resends every failed item. `uploadDocument` correctly reports status0 and502 as uncertain, but queue discards that distinction. A server may have committed the file before a response is lost. Documents POST generates a new randomUUID on each request and has no upload idempotency key, so retry can duplicate an already stored photo.

Independent reproduction drives exact processUploads: file1 confirmed, file2 committed then fetch throws; statuses become done/failed, explicit retry skips file1 but resends file2, creating third stored item. No automatic retry or request recreation is alleged. Required: retain uncertain outcome separately; remove definite “not saved” claims for uncertain files and require document recheck/explicit duplicate-risk acknowledgment before resend, or implement actual server idempotency with a reviewed contract. Do not silently count uncertainty as confirmed success.

### PHOTO-REV-002 — P2: second request silently replaces outstanding photo queue
There is one `uploads: UploadQueue|null` at controller113, and createIntervention1031–1035 unconditionally replaces it for the next request with photos. After partial failure the runner becomes idle; user can navigate to New Request and submit another request with photos. New queue overwrites all old File references. Returning to first dossier no longer shows its outstanding queue/retry (panel only renders matching interventionId). Ordinary request-form unmount is safe because parent owns queue, but this second-request overwrite is not guarded or warned.

Required: retain queues per intervention, or block/ask user to explicitly resolve/abandon outstanding queue before starting a replacement. Avoid silently abandoning failed files. Browser reload/file persistence is outside this finding.

### PHOTO-REV-003 — P2: stale create completion erases newer session/public draft storage
`components/courant-app.tsx:1018–1020` removes sessionStorage DRAFT_KEY unconditionally after awaited request creation/optionalrefresh, even when ctx was invalidated by logout/account change. State setter and navigation are guarded; this storage side effect is not. An A request response completing after logout and a new anonymous draft deletes that newer draft from storage. This is independent of now-fixed login adoption edge.

Required: bind this storage removal to original identity generation (or return immediately when stale before any draft/file/queue side effect). Test held create response → logout/new draft → resolve old response; newer storage must remain, no new upload starts and no old queue/navigation publishes. Demo branch removes storage before its first await and does not create this particular late-response sequence.

## Verified bounded behavior

- Creation POST occurs once per create invocation. Uploads start only after intervention id is returned. Retry invokes processUploads only, never create POST.
- Confirmed done files are skipped on retry. Failed files remain parent-owned across ordinary RequestForm unmount/navigation; panels exist in client and enterprise dossier views.
- Queue and File references cleared by clearSessionState. Process guard checks ctx before each next upload and guarded state publication drops old results. One already-in-flight upload is not canceled; no claim of atomic revocation.
- Demo branch returns before upload path; no document API invoked there and notice explicitly says photos not sent.
- Public form passes only values to saveDraft; File selections not serialized into sessionStorage. Public hint explicitly says photos must be added again after login, so this is disclosed rather than a new silent-loss finding.
- Client validates six photo limit, JPEG/PNG/WebP and nonempty4MiB bound. Generic upload helper supports PDF for documents. Server independently validates size/type and magic bytes. Multipart request has no forced JSON Content-Type, uses no-store and intervention id.
- Malformed HTTP200 response and network failure do not return false confirmed-upload success.

## Prior UI findings

- CL-UI-008 / UI-REV-002 dependent cache gap corrected in source: enterprise siteAccess effect now includes `session.refreshedAt` at337, Members overview at2953. Both clear/reload their respective cache before request and ignore unmounted results. Earlier controller focus/403 logic remains. This closes the previously identified missing revision dependency in code; actual foreground revoke/downgrade/scope-change preview tests remain necessary. No whole cache architecture completion claim.
- CL-UI-009 / UI-REV-003 duration mismatch corrected in source: validation2981, error2982, hint3201 and inputmax3205 consistently1–14, matching backend API. Browser boundary validation14/15 not executed here.
- Earlier login bounded verdict823 is preserved; no newly identified login finding in this photo review.

## Actual checks

Snapshot `/tmp/depannage-ui-review-6962`, dependencies symlinked read-only. Exact inline processUploads function exported to a temporary harness with injected setter and exact API upload helper; owner source unmodified.

**31 existing UI tests +5 new narrow photo checks =36PASS**, exit0:
1. empty/oversize/PDF-photo rejection and exact4MiB JPEG acceptance;
2. correct multipart private endpoint/intervention_id and no fetch for invalidfile;
3. malformed200/network failures yield uncertain errors;
4. partial queue retry skips confirmed success but reproduces duplicate risk for uncertain committed upload;
5. generation invalidation during first upload suppresses next file request.

Tests: `/tmp/depannage-ui-review-6962/photos.test.ts`. Some tests intentionally assert existing undesirable uncertainty classification to document the finding. No source fix verified for PHOTO findings.

No mounted React browser test, actual Storage upload, cloud Auth, online preview, full build, visual/a11y audit or UI admin route runtime test performed by this reviewer. Admin session contract exposure read as a dependency, not claimed delivered server functionality.

Verdict: focused photo corrections required; previous cache dependency and invitation limit fixes are source-confirmed within the stated bounds.


# Focused independent login recheck — 823b021

Exact reviewed revision: `823b02127e033a132314ae1d046cd132ffa05b9d`. Reviewed exact git source only, no role work in progress. No owner edits.

## Verdict

**CL-UI-007 / UI-REV-001 may be marked verified within this bounded helper/controller-ordering review.** No remaining actionable finding identified in the previously reported normal login self-invalidation, different-account verification race, logout stale-verification or stale error/busy preservation cases.

This does not declare actual browser/cloud Auth journeys complete, nor close membership/cache/invitation findings or the overall mission.

## Source recheck

`components/app/identity.ts` checks:
- verification matches expected login identity;
- a differing already-loaded identity supersedes the attempt before clear/rebind;
- `loaded === null && !ctx.alive()` rejects an obsolete verified response after logout;
- initial anonymous login still proceeds when its context is current;
- legitimate own SIGNED_IN adoption still proceeds without another clear when the expected user is loaded;
- after workspace await, invalidated context or replaced user suppresses draft restoration/navigation.

The controller's signIn and session-bearing signup both invoke this same helper. Existing generation guard still suppresses stale error/notice and prevents a stale chain's finally from clearing a newer identity's busy flag.

## Checks actually executed

Snapshot `/tmp/depannage-ui-review-823` exported via git archive with existing dependency symlink, no owner source/dependency/build changes.

- **31 existing UI tests PASS**.
- **3 independent ordering regressions PASS** in `/tmp/depannage-ui-review-823/independent-auth.test.ts`:
  1. A verification pending → newer liveB and active B mutation → stale verificationA; B identity unchanged, no extra clear, B busy preserved, B notice completes normally.
  2. Stale A verification rejection after B does not surface A's error or reset B.
  3. Verification pendingA → logout → newly entered anonymous draft → stale verifiedA; no extra clear, draft preserved, final user refnull, no private navigation.
- **34 total tests PASS**, exit0. Previous logout failure reproduction was changed to assert required preserved state, and now passes.
- Existing controls include promise-before-event, own event-before-promise, staleA already superseded by B, logout returning null verification, logout during workspace load, generic stale mutation, and kept-draft adoption.

These are deterministic tests of exact helper/runner with mirrored relevant controller events and unauthorized-refresh handling. No mounted React render, real cross-tab Supabase race, online preview, full build or visual test performed by this reviewer. Integration should still verify normal login/logout/account switch in the deployed preview with actual Auth.


### Statuts consolidés
- CL-UI-007 : verified pour la revue helper/contrôleur au823b021, intégré5cfad13 ; recette normale connexion A/logout/B en cours surfe4 (avant dernière gardeP2), ne pas confondre les SHA.
- CL-UI-008 : fixed_pending_review au6962be6, consommation refreshedAt présente ; vérifier révocation réelle en navigateur avant clôture globale.
- CL-UI-009 : fixed_pending_review au6962be6 ; source valide1–14, contrôle navigateur à venir.
- CL-PHOTO-001/002/003 : open, assignés Claude sessionb4b555f0, même checkpoint6962. Rapport canonique : 001 résultat incertain,002 file singleton,003 effet storage non gardé. Les deux premiers numéros courts du premier message pilote étaient inversés ; cette correspondance prévaut, aucune correction perdue.
- de6091d publie le contrat quote drafts avant code. CLI lead informé de ce contrat, avec priorités : finir correctifs photo, admin paginé et densité visuelle avant branchement brouillons.


## WEB-PWA-REVIEW-001 — Claude, rapport réel admin009 d85da06

# Rapport de revue croisée Claude — WEB-PWA-REVIEW-001 (checkpoint admin / 009)

Même reviewer, même session, lecture seule. Aucun code ni fichier de coordination modifié, aucune autre session Claude contactée. Affectation revendiquée : uniquement la revue. Le lien symbolique node_modules n'a pas été touché.

**SHA revu :** `d85da0657586f152ee9bba941d67345b4eead616`. Cinq commits depuis 1d93445.

## Sources lues
MISSIONS.md et CORRECTIONS.md distants, migration 009, route admin interventions, route site-access, diff de la route organizations, diffs next.config, package.json et CI, les deux contrats et les deux rapports de vérification Codex, les tests admin-interventions et le harness SQL site-access, plus l'inventaire des RPC appelées par l'application.

## Contrôles réellement exécutés

| Contrôle | Résultat |
|---|---|
| `npm test` | 38/38, dont 8 tests de la route admin |
| `npm run typecheck` | passe |
| `node tests/sql-site-access-review.mjs` avec PGlite, migrations 001 à 009, stubs Auth/Storage | 8 groupes PASS |
| `node tests/sql-review.mjs` | 29 groupes PASS |
| Build, `npm run check`, Supabase réel, preview, UI | non exécutés |

Les contrôles cloud consignés dans CORRECTIONS sont des preuves du pilote, pas les miennes.

## Route admin `GET /api/admin/interventions`
- **Admin vérifié avant toute lecture.** Session serveur puis rôle admin lu sous RLS. Les rôles null, client, artisan, manager, owner et viewer reçoivent 401 ou 403 sans aucune requête interventions ou devis. Pas de service-role.
- **Filtres PostgREST sûrs.** Clés inconnues et doublons refusés. La recherche est normalisée NFKC, bornée à 80 caractères, limitée à un alphabet littéral sans délimiteurs ni wildcards. Un UUID complet devient un `eq` sur l'identifiant. Aucune expression construite par le navigateur n'atteint `.or()`.
- **Curseur contraint.** Base64url strict avec aller-retour, JSON strict versionné, timestamp validé par regex avec fraction de 1 à 6 chiffres, UUID validé, empreinte SHA-256 des filtres exigée. Les valeurs insérées dans l'expression `or` sont donc bornées.
- **Stabilité des tuples.** Tri created_at puis id décroissants, condition keyset citant le timestamp complet avec microsecondes, recherche et curseur combinés dans un seul arbre logique explicite.
- **Total avant curseur.** COUNT exact en HEAD sur les filtres sans curseur. `has_more` repose sur le COUNT restant plus une ligne supplémentaire, robuste à un plafond fournisseur. COUNT absent ou page incohérente donne 503. Non transactionnel avec la page, et documenté comme tel.
- **Projection privée.** La liste exclut description, adresse et contacts. Le détail n'admet que `id`, renvoie les champs opérateur et les 50 derniers devis avec IDs exacts et indicateur de troncature. Les erreurs sont aussi en `private, no-store`.

## Migration 009 : accès par site
- Portée `all` par défaut, `selected` avec attributions par site. Les clés étrangères composites garantissent un site de la même organisation et la cascade au retrait du membre.
- Les helpers dérivent `auth.uid()`. L'owner canonique reste toujours `all`. L'écriture est bornée au rôle courant, un viewer n'écrit jamais même avec une attribution obsolète.
- `can_access_intervention` et `owns_intervention` sont remplacés en place. Toutes les politiques dépendantes héritent du périmètre site. Les politiques sites, règles, approbations et conformité sont réécrites sur le site, contrats et journal professionnel sur la portée organisation.
- Validation des attributions stricte : schéma, maximum 100, unicité, sites de l'organisation, tableau vide si `all`, pas d'écriture pour viewer.
- Invitations : portée validée à la création et réappliquée dans la transaction d'acceptation. Un site supprimé fait échouer l'acceptation entière, confirmé par le harness. Les invariants de la migration 006 sont conservés via la fonction renommée privée.
- Verrous : organisation avant site, membre ou invitation. Les RPC B2B verrouillent l'organisation avant le contrôle. Pas de cycle avec la réaffectation admin.
- EXECUTE : 17 fonctions renommées ou internes révoquées. Aucune référence aux anciens noms dans l'application. Toutes les RPC appelées existent sous leur nom public.

## Config et CI
`agentRules:false` est accepté par le type NextConfig installé. Le script `test:ui` entre dans `check` et une étape CI pour le harness site est ajoutée. Ce checkout n'a pas de `tests/ui`, donc `npm run check` n'y est ni exécutable ni revendiqué.

## Findings
Aucun finding actionnable dans le périmètre revu.

Observations sans action requise :
- Sur la branche backend seule, `npm run check` échouerait faute de `tests/ui`. Attendu jusqu'à l'intégration, déjà documenté.
- Le COUNT exact admin évalue la politique RLS ligne par ligne sur toute la table. Acceptable à l'échelle actuelle, coût croissant avec le volume.
- La course entre un upload en cours et une révocation est une limite préexistante reconnue par Codex, hors de ce lot.

## Limites
Pas de Supabase, PostgREST, Auth ou Storage réels, pas de concurrence multi-connexion, pas de build, de preview ni d'UI vérifiés par ce reviewer. Le fournisseur HTTP des tests admin est un modèle, pas PostgREST. Les preuves cloud de CORRECTIONS restent celles du pilote.

Rapport également écrit dans `/Users/claudebrafa/.claude/plans/you-are-claude-independent-wobbly-charm.md`.

## WEB-PWA-ADMIN-LISTS-001 — recette réelle combinée

# Independent real-browser login and administrator API provider review

Mission WEB-PWA-20261030. Reviewer: Codex verify_web_pwa. No repository application edits, no library installation for this follow-up, no production or Stripe operation.

## Exact target

- Integration fe4c9c984e997675a7421100c89c7ddbff195065.
- Unique Vercel Preview https://depannage-electricite-ia1k2f0d6-brafas-projects.vercel.app .
- Vercel deployment metadata independently confirmed READY, exact githubCommitSha and integration/web-pwa ref before testing. Older preview was not used for new API.
- Contains login correction2e3 and new admin interventions API d85, according to integration history/mission; read actual route at exact integration.
- Dedicated Supabase kcpyjzndybfdlnhvscbs only. Existing private0600 keys/access files read without emitting values. Existing Vercel authorization cookie bootstrapped once, then automation headers cleared in isolated browser.

## Fixtures and containment

Three uniquely named temporary confirmed QA accounts created using admin.createUser, without email: clients A/B and synthetic administrator. Only the synthetic admin's newly created profile was elevated via service role; no existing profile/role/settings changed.

120 explicit tracked intervention UUIDs inserted by service for client A only:117 rows bearing unique literal search/city marker, plus3 tracked decoys with a different marker. Some timestamps intentionally tied in groups of three, statuses requested/cancelled and categories outage/panel. No quote, payment, organization, email or storage object created. IDs persisted in0600 fixtures.json for recovery/cleanup; no passwords/tokens in that registry.

Administrator browser used actual password Auth through public form, but all automatic app API reads except /api/admin/interventions were blocked by test routing to avoid unfiltered workspace/overview retrieval. Only explicitly q-filtered fixture API/detail requests were permitted; every returned list row was asserted against tracked IDs. Thus no adminUI/global-list completion claim.

## Results

**19/19 actual browser/provider checks PASS;10/10 cleanup/readback controls PASS; zero page errors.**

### Normal client UI, not SDK-only proof

1. Client A logs in through normal public password form and enters live client interface. API session identity equals A, profile form contains exact A name, no demo banner. Workspace's old100-row window excludes oldest fixture as expected.
2. Client A cannot read administrator endpoint:403/private-no-store.
3. Actual visible logout control returns workspace401.
4. Client B logs in through same normal UI/browser after A logout; API identity/profile name equal B, zero interventions, no A name or unique fixture marker displayed.
5. Separate fresh unauthenticated browser receives401/private-no-store from admin endpoint.

This independently verifies UI-REV001's normal client sign-in/logout/switch-identity correction at this exact SHA. It does not close the separately tracked stale public draft issue or every possible delayed-response race.

### Administrator API against actual provider

6. Synthetic administrator gets valid browser Auth cookie; first q-filtered API request200 returns exact117-row total; automatic global reads remain blocked.
7. q pagination returns117 unique rows over three40-row pages (40/40/37), consistent total117, exact expected created_at DESC/id DESC order including timestamp ties, no repeated/foreign/decoy row.
8. q AND status=requested with cursor returns59 rows over three25-row pages, total59 on each, exact order and no decoy/unrequested row.
9. q whitespace normalization plus category=outage yields exact30 rows.
10. Oldest fixture, absent from old100-row client workspace window, is retrieved by administrator detail ID200 with expected description and zero quotes.
11. Uppercase UUID q normalized to exactly one expected fixture.
12. Unique absent q returns0 rows/total, null next cursor.
13. Malformed cursor returns422/private-no-store.
14. Reusing cursor with changed q filters returns422/private-no-store.
15. Unsupported limit101 returns422/private-no-store.
16. Wildcard/filter-expression injection attempt in q returns422/private-no-store.
17. Mixing detail id and list filters returns422/private-no-store.

The remaining two checks establish fixture prerequisites (3 isolated accounts, exactly120 inserted tracked jobs). Nineteen checks total are recorded individually in result.json; counts above separate five client checks and twelve admin-session/API checks from two prerequisites.

## Cleanup and readback

- Delete audit rows only for tracked intervention IDs or QA actor IDs.
- Delete only120 explicitly tracked intervention IDs.
- Delete each of3 temporary Auth users and independently verify each is absent.
- Read back tracked job IDs, all3 profiles and QA actor audit records: absent.
- Separate provider readback for audit entries by all120 intervention IDs:0.

Ten cleanup controls all pass. No pre-existing row or setting changed or deleted. The fixture registry contains only run marker/UUIDs, not credentials.

## Evidence

- fe4c9c984e99/auth-admin/result.json —19 successful checks,10 cleanup controls and zero page errors.
- fe4c9c984e99/auth-admin/fixtures.json — scoped IDs for cleanup audit,0600.
- client-a-live-profile.png and client-b-live-profile.png — screenshots after successful normal UI login, no password/hash/token content; B screenshot visually opened.
- Runner auth-admin-smoke.mjs and independent readback-admin-cleanup.mjs under task temp directory only.

## Remaining limits

- Administrator UI was not evaluated for integration of new pagination API: only actual authorized endpoint/provider behavior tested. No claim that all Super Admin menus/actions are complete.
- Stale public draft/UI-REV002 and VIS-001 remain separately assigned; this run does not exercise or close them.
- No normal browser signup with actual email receipt, artisan/organization live journey, Stripe checkout/webhook/payout, actual-device PWA installation or production release.
- Synthetic admin's expected blocked automatic fetches are test setup, not an application failure. This runner records page errors, not a blanket zero-console assertion for the intentionally blocked admin workspace.
- No secrets, tokens, passwords, raw credential-bearing URLs or HAR in outputs.


## WEB-PWA-20261030 — Auth SSR navigateur

# Independent hosted Auth SSR and recovery browser check

Mission WEB-PWA-20261030; explicitly authorized by pilot. Integration SHA0017b48a7a12d918d5c3c759f8da94d1971df727; unique preview https://depannage-electricite-1ng8kugh5-brafas-projects.vercel.app ; dedicated project kcpyjzndybfdlnhvscbs only.

## Method and scope

Read app/auth/confirm/route.ts, reset-password/page.tsx, lib/supabase/client.ts and installed auth-js GenerateLinkParams types. Official generateLink and verifyOtp documentation consulted:
- https://supabase.com/docs/reference/javascript/auth-admin-generatelink
- https://supabase.com/docs/reference/javascript/auth-verifyotp

Supabase JS2.118.0 installed only in /tmp/depannage-web-pwa-qa. Private service/anon keys read from existing0600 task file without logging values. One tracked temporary client account generated per attempt using admin.generateLink(signup), with a new unique reserved-domain email and random password. No email transport invoked. Generated hashed tokens passed only to actual /auth/confirm routes in isolated browser; token/password/credential values redacted from all errors and never written to report/HAR. Existing Vercel cookie bootstrapped once, automation headers then cleared.

First diagnostic attempt had three harness errors, not application findings: final client URL intentionally removes ?auth= after handling, and Next route announcer adds another role=alert. Runner now observes actual /auth/confirm redirect response and scopes the expired-error alert. Its temporary account was deleted and Auth/profile absence verified before rerun. The second attempt uses another unique user and generates signup hash once.

## Results

**12/12 checks PASS;3/3 final cleanup checks PASS; zero page errors.**

1. Admin generates tracked signup hash; no email sent.
2. Actual SSR /auth/confirm consumes hash, sends browser cookies, and /api/workspace returns200 with exact temporary client identity and private/no-store.
3. Main application renders the real authenticated client without demo banner.
4. Separate fresh browser has no app session and workspace returns401.
5. Reused confirmation hash redirects to recoverable auth=expired; separate browser stays401.
6. Invalid hash redirects to auth=expired; no false success.
7. Admin generates recovery hash for same tracked user; no email sent.
8. Actual recovery /auth/confirm redirects to /auth/reset-password and authorized reset form appears.
9. Mismatched password confirmation remains rejected with visible error.
10. Browser form successfully changes tracked account password; success screenshot captured.
11. Previous password rejected; new password authenticates only tracked user through Auth SDK, then SDK session signed out.
12. Unauthenticated reset page displays expired-state guidance and hides password inputs.

Cleanup: delete temporary user ccc6c13c-9b80-4390-bf69-6bf4472156e3; confirm Auth user absent; confirm profiles cascade row absent. First harness-diagnostic user5bbbfaa7-7a50-439d-b6b4-70d134794100 was also deleted with same absence checks. No other account or service modified.

Evidence: 0017b48a7a12/auth-ssr/result.json ; recovery-success.png visually opened; harness-diagnostics.json preserves initial attempt including its successful cleanup. Script auth-ssr-smoke.mjs contains no embedded key/password/token values.

## Limits

- This verifies hosted Auth/SSR confirmation and recovery route behavior and browser password form. It does NOT verify real email delivery or clicking an actually received message; admin.generateLink does not send email.
- Known UI-REV001 explicit login controller bug remains outside this closure; successful SSR confirmation initialization is not proof the sign-in button flow is fixed.
- No artisan/enterprise/admin live-role journey, multi-organization permission test or Storage test in this report; separate cloudQA scope applies.
- No Stripe transaction, payout, production release or OS/mobile PWA install.
- App reset main has no id=main while global skip link targets it (pre-existing accessibility item); recovery functionality passes, but full keyboard/accessibility certification is not claimed.
- All application files remained read-only for this verifier.


Le reviewer Claude c38a6bc4 a terminé réellement sa revue, exit0 et rapport reçu ; aucun finding actionnable dans le périmètre d85. La mission backend ADMIN-LISTS peut être close pour la route, ses filtres, droits et recette en ligne ; le branchement frontend reste dans l’affectation Claude in_progress. Photos6962 en preview5650 pour recette corrective, trois P2 ouverts.


## WEB-PWA-20261030 — plan de vérification PWA multi-onglets

Codex prépare un passage de version de la seule notice publique PWA (cachev2→v3) pour le checkpoint majeur Web/PWA. Le lot conserve strictement un unique offline.html public, sans nouveau cache/API/sync privé. Avant mutation, la QA doit garder deux onglets du même alias preview sous le worker v2 et un brouillon local non soumis. Après le déploiement réel du worker v3 sur ce même alias : vérifier attente visible, absence de reload automatique, activation explicite ongletA, puis clic du contrôle resté ancien dans ongletB qui doit recharger correctement (PWA-001), et suppression du seul ancien cache public. Mettre à jour la seule assertion de version du test existant puis rejouer les tests PWA pertinents ; aucune preuve ne sera déduite de cette planification. Propriétaire du petit changement : Codex public/sw.js et tests/pwa.test.ts sur integration/web-pwa, après signal de préparation QA. Aucun autre fichier PWA ou cache privé élargi. Avant minuit ; sinon transfert de cette mutation à Claude.


## WEB-PWA-20261030 — checkpoint quote010 et annuaires en revue
254d497 (drafts) et22cf05e (annuaires) intégrés1be8f00 pour compilation/preview ; aucune migration010 appliquée à distance à ce stade. Reviewer Claude c38a6bc4 repris dans son checkout lecture seule avancé jusqu’au combiné1be8f00 ; demande explicite de revue SQL/privacy/concurrence/validation/curseurs, sans accès secrets/mutation cloud. Processus40957 lancé, rapport attendu. Lead UI informé des contrats publiés, notamment directory kind/type et draft expected_version/assignment_token/base_quote_id ; pas de succès fournisseur supposé.

CL-PHOTO-004 (open, Codex root → Claude, fcc7f6b) : réconciliation automatique par même nom + date dans une fenêtre60s marque comme enregistrée une photo différente préexistante. Reproduction source exacte /tmp/depannage-photo-recheck-fcc/reproduce.ts réussie (assertion de mauvais comportement). Exiger candidat à vérifier explicitement ou corrélation serveur réelle, jamais preuve de contenu par nom/date. Les trois problèmes antérieurs semblent corrigés dans la source, recheck complet et navigateur encore nécessaires. Instruction transmise par CLI au lead.


## WEB-PWA-20261030 — Vercel quota et réduction des déploiements

2026-10-30 America/Martinique — statut fournisseur du b2acc223 : « Deployment rate limited — retry in 24 hours. » Aucun worker v3 servi ; test PWA multi-onglets bloqué après préparation, aucun résultat de mise à jour réussi revendiqué. La QA ferme proprement son navigateur de test. Dernier déploiement prêt : 1be8f00, https://depannage-electricite-ogoz1a5oz-brafas-projects.vercel.app ; les nouvelles routes serveur010 et directory y existent déjà.

Les nombreux pushes (y compris coordination/documentation et branches d’implémentation) déclenchaient inutilement des builds. Correction technique autorisée : même vercel.json minimal dans les branches actives, git.deploymentEnabled avec wildcard false et seules main/integration-web-pwa explicitement conservées (nom exact integration/web-pwa). Les branches de travail et coordination ne doivent plus déclencher de preview ; les pushes d’intégration seront regroupés par checkpoint fonctionnel, les rapports uniquement sur coordination jusqu’au prochain lot. Production/main n’est ni modifié ni poussé par ce changement. Source officielle relue : https://vercel.com/docs/project-configuration/git-configuration . Cette configuration prévient les déclenchements futurs ; elle ne remet pas le quota à zéro. Aucun changement payant de plan ni contournement du fournisseur.

Propriétaire Codex pour vercel.json sur integration, coordination et branche admin-directories propre. Demande aux agents actifs de cherry-pick le commit de config sur leurs branches avant le prochain push, sans toucher à leurs fichiers en cours. CI GitHub et tests Supabase restent possibles ; recette des routes déjà déployées sur1be continue. Les nouveaux écrans corrigés non déployés devront attendre le fournisseur et restent explicitement non vérifiés en ligne.

### Migration010
Revue indépendante Claude terminée réellement sur1be8f00 :51 testsNode,34UI, typecheck, SQLdraft9/main29/sites8/performance6 réussis ; aucun finding actionnable sur010 etdirectory dans ce périmètre. Après revue, dry-run limité exclusivement à010, application distante réussie sur le seul projet dédié. Aucune011 appliquée. Recette cloud brouillons et annuaires à venir sur le déploiement1be prêt.


## WEB-PWA-REVIEW-001 — rapport Claude réel010 et annuaires

# Rapport de revue croisée Claude — WEB-PWA-REVIEW-001 (brouillons de devis 010 / annuaires admin)

Même reviewer, même session, lecture seule. Aucun fichier source ou de coordination modifié, aucune autre session Claude contactée, aucun accès cloud ni fichier secret. Affectation revendiquée : uniquement la revue. Le lien node_modules reste un artefact d'outillage non touché.

**SHA revu :** `1be8f00a4945a21e3e30f72c73c62873792271a0` (révision combinée). Périmètre backend : commit 254d497 (migration 010, route quote-draft, tests) et commit 22cf05e (route admin/directory, tests), relatifs à d85da06. Les lots UI et photos présents dans la même révision ne sont pas ma cible.

## Sources lues
MISSIONS.md et CORRECTIONS.md distants, migration 010, les deux nouvelles routes, les deux contrats et les deux rapports de vérification Codex, les tests quote-draft, admin-directory et le harness SQL brouillons, le diff de la CI.

## Contrôles réellement exécutés

| Contrôle | Résultat |
|---|---|
| `npm test` | 51/51 |
| `npm run typecheck` | passe |
| `npm run test:ui` (présent dans ce checkout combiné) | 34/34 |
| `node tests/sql-quote-draft-review.mjs` avec PGlite, 10 migrations, stubs Auth/Storage | 9 groupes PASS |
| `node tests/sql-review.mjs` | 29 PASS |
| `node tests/sql-site-access-review.mjs` | 8 PASS |
| `node tests/sql-performance-review.mjs` | 6 PASS |
| Build, application distante de 010, Supabase réel, preview | non exécutés |

## Migration 010 et route quote-draft
- **Confidentialité et RLS.** Table en select seul pour authenticated. La politique se limite à l'artisan courant du dossier, statut assigned ou quoted, profil approuvé, dossier approved, et recalcule le jeton d'attribution. Client, manager, owner, admin et autre artisan ne lisent rien, ni par la RPC ni par lecture directe. Aucune mutation directe possible.
- **Version et époque d'attribution.** Version monotone, `expected_version` exact sinon 409. Le jeton dérive du dernier événement accept_mission ou admin_reassigned du dossier, avec index partiel sur audit_log. Une réaffectation A→B→A produit un nouveau jeton : l'ancien onglet reçoit 409 et la lecture directe du vieux brouillon est masquée par la politique. Testé.
- **Immutabilité.** Toute gestion exige assigned ou quoted. Un devis accepté bloque load, save, discard et send. L'envoi passe par la commande `send_quote` existante : montants recalculés serveur, ancien devis rejeté seulement en cas de succès, approbation B2B conservée.
- **Atomicité.** Consommation du brouillon et publication dans la même transaction. Un échec induit laisse brouillon, version et ancien devis intacts. `base_quote_id` vérifié au save et au send contre le devis sent courant, 409 si publié par un autre canal.
- **Ordre des verrous.** Organisation pour les dossiers B2B, puis intervention, puis profil, puis dossier artisan, puis brouillon. Cohérent avec le guard de suspension et `approve_artisan`, avec la chaîne `intervention_action` de la migration 009 et avec les commandes d'accès par site. La réaffectation ne verrouille que le dossier. Aucun cycle identifié.
- **Validation partielle contre envoi.** Le validateur de brouillon accepte label vide, prix 0, TVA nulle et entiers stricts. L'envoi réutilise la validation du calcul existant et renvoie 422 sans effet. Zod refuse totaux et identités venant du navigateur.
- **EXECUTE.** Le validateur est privé, seule `manage_quote_draft` est accordée, les helpers internes de devis restent refusés. GET sans paramètre, POST strict, erreurs no-store, réponse non-objet en 503.

## Route admin/directory
- Admin vérifié avant toute lecture. Les rôles null, client, artisan, manager, owner et viewer reçoivent 401 ou 403 sans requête annuaire.
- Recherche sur le même alphabet littéral que la liste admin, passée en filtre `ilike` dédié et non dans une expression brute. Un UUID devient une égalité sur l'identifiant. Filtres bornés au kind.
- Curseur strict base64url, versionné, lié au kind et à l'empreinte des filtres, timestamp avec microsecondes et UUID validés, tri created_at puis id décroissants.
- Total exact avant curseur, `has_more` par COUNT restant plus une ligne, COUNT absent en 503. L'enrichissement artisans est borné à la page et renvoie 503 s'il est incomplet, les profils sans dossier sont conservés.
- Projections sans email, SIRET, adresse ni Stripe. Détail avec kind et id seuls, 404 si kind incompatible.

## Findings
Aucun finding actionnable dans le périmètre revu.

Observations sans action requise :
- Le jeton d'attribution dérive de données lisibles par l'artisan. Il n'est pas une permission, conformément au contrat.
- Le chargement n'est pas soumis au throttle `consume_action`. Lecture seule, sans effet.
- COUNT, page et enrichissement sont des lectures séparées, documenté au contrat.

## Dépendances d'intégration frontend
Charger l'enveloppe avant toute sauvegarde, traiter 409 par rechargement, distinguer sauvegarder et envoyer, sélectionner le `quote_id` exact après envoi, consommer l'annuaire paginé au lieu des 100 entrées overview.

## Limites
Pas de Supabase, Auth ou PostgREST réels, pas de concurrence multi-connexion, pas de build ni preview par ce reviewer. La migration 010 n'est pas appliquée à distance et cette revue n'en est pas la recette. Le fournisseur HTTP des tests de route est un modèle, pas PostgREST. Les findings UI photos restent assignés séparément.

Rapport également écrit dans `/Users/claudebrafa/.claude/plans/you-are-claude-independent-wobbly-charm.md`.

## WEB-PWA-QUOTE-DRAFT-001 et ADMIN-DIRECTORIES-001 — recette hébergée

# Hosted quote draft and directory QA

Exact revision: 1be8f00a4945a21e3e30f72c73c62873792271a0
Preview: https://depannage-electricite-ogoz1a5oz-brafas-projects.vercel.app

{
  "root": "https://depannage-electricite-ogoz1a5oz-brafas-projects.vercel.app",
  "revision": "1be8f00a4945a21e3e30f72c73c62873792271a0",
  "checks": [
    {
      "name": "assigned_artisan_load_and_save_partial",
      "status": "pass",
      "detail": {
        "version": 1,
        "partialSaved": true
      }
    },
    {
      "name": "invalid_publish_422_preserves_draft_version_and_old_quote",
      "status": "pass",
      "detail": {
        "versionUnchanged": true,
        "oldQuoteUnchanged": true
      }
    },
    {
      "name": "concurrent_same_version_save_one_winner",
      "status": "pass",
      "detail": {
        "statuses": [
          200,
          409
        ]
      }
    },
    {
      "name": "publish_exact_quote_and_consume_draft",
      "status": "pass",
      "detail": {
        "exactPublishedQuote": true,
        "consumed": true,
        "totalCents": 24000
      }
    },
    {
      "name": "client_other_artisan_admin_cannot_read_private_draft",
      "status": "pass",
      "detail": {
        "apiDenied": 4,
        "clientRlsDraftRows": 0,
        "clientSeesSentQuote": true
      }
    },
    {
      "name": "accepted_quote_immutable",
      "status": "pass",
      "detail": {
        "immutable": true
      }
    },
    {
      "name": "directory_all_three_kinds_strict_projections",
      "status": "pass",
      "detail": {
        "artisans": 2,
        "clientsIncludingManager": 2,
        "organizations": 117,
        "noExtraColumns": true
      }
    },
    {
      "name": "organizations_117_stable_unique_beyond_100_and_oldest_detail",
      "status": "pass",
      "detail": {
        "pages": [
          40,
          40,
          37
        ],
        "total": 117,
        "timestampTies": true,
        "oldestDetail": true
      }
    },
    {
      "name": "directory_filters_uuid_and_denials",
      "status": "pass",
      "detail": {
        "filters": 5,
        "denials": 4
      }
    },
    {
      "name": "directory_invalid_filters_cursors_and_duplicates_422",
      "status": "pass",
      "detail": {
        "invalidCases": 11
      }
    }
  ],
  "cleanup": [
    {
      "name": "quote_drafts",
      "status": "pass"
    },
    {
      "name": "quotes",
      "status": "pass"
    },
    {
      "name": "audit_log",
      "status": "pass"
    },
    {
      "name": "interventions",
      "status": "pass"
    },
    {
      "name": "organization_members",
      "status": "pass"
    },
    {
      "name": "organizations",
      "status": "pass"
    },
    {
      "name": "actor_audit_client",
      "status": "pass"
    },
    {
      "name": "auth_profile_client",
      "status": "pass"
    },
    {
      "name": "actor_audit_artisan",
      "status": "pass"
    },
    {
      "name": "auth_profile_artisan",
      "status": "pass"
    },
    {
      "name": "actor_audit_artisan",
      "status": "pass"
    },
    {
      "name": "auth_profile_artisan",
      "status": "pass"
    },
    {
      "name": "actor_audit_manager",
      "status": "pass"
    },
    {
      "name": "auth_profile_manager",
      "status": "pass"
    },
    {
      "name": "actor_audit_admin",
      "status": "pass"
    },
    {
      "name": "auth_profile_admin",
      "status": "pass"
    }
  ],
  "limits": [
    "Hosted API and direct RLS checks; not UI editing or payment verification.",
    "Only two actual artisan accounts; greater than 100 pagination is exercised for organizations."
  ],
  "finishedAt": "2026-10-31T03:23:01.845Z"
}

Independent cleanup readback: cleanup-readback.json proves zero remaining exact tracked IDs across audit actor/job scopes, quote_drafts, quotes, interventions, organizations, memberships, profiles, artisan dossiers and action_limits. All five Auth users were deleted and getUserById returned absence. Sixteen cleanup operations passed; ten additional table-scope readbacks passed.

Source references at exact deployed revision 1be8f00a4945a21e3e30f72c73c62873792271a0:
- app/api/interventions/[id]/quote-draft/route.ts:39-52: origin/auth/schema/RPC mutation and private error handling.
- supabase/migrations/202610310010_quote_drafts.sql:48-107: assigned approved artisan gate, locked optimistic version, publish transaction and draft consumption.
- app/api/admin/directory/route.ts:23-57: allowed filters and cursor fingerprint validation; 78-118: admin gate, projections, exact totals and pagination.
- app/api/interventions/[id]/actions/route.ts:19-77: exact quote acceptance action.

No findings in this tested scope. This is not a complete application acceptance, directory UI verification, 100-plus-artisan real-provider test, email delivery, payment test, or PWA two-deployment pass. All browser sessions were isolated and closed. Existing-row listing was avoided: every successful admin directory read used the unique QA marker, exact tracked ID, or tracked owner filter. No application file was edited.


## WEB-PWA-20261030 — PWA lifecycle bloqué, sans succès inventé

# PWA-001 actual two-deployment lifecycle

Status: BLOCKED by Vercel build quota (provider requests retry in 24 hours). No lifecycle pass is claimed.

Two isolated tabs on the stable branch alias were confirmed controlled by the v2 worker, each with distinct unsaved request text, never submitted. READY.json and screenshots preserve readiness proof. The v3 revision b2acc223c84a35dd6eb5f7eb78f5cad3701c1e4f did not deploy. No update, activation, cache migration, or stale second-tab reload was tested.

The task-owned browser and runner were closed after the pilot instructed stopping; no unrelated browser was touched. Fresh v2 tabs must be prepared before the first actual v3 deployment. No native OS installation is claimed.


### Avancement complémentaire
La configuration Vercel opt-out des branches de travail est propagée : coordination2ea8c82, admin-directory36cbe43, UI25a1274, backendb83119f. Les commits coordination/admin-directory n’ont pas reçu de contexte Vercel de déploiement lors de la vérification ; aucune remise à zéro du quota supposée. Le lead UI a reçu les consignes de grouper les checkpoints et de poursuivre sans attendre de connexion Stripe. Le mode CLI auto applique les revues normales de permissions ; aucune protection d’authentification retirée.

b8a277a combine les derniers correctifs UI jusqu’au34e998c : garde Auth823, revalidation6667, photosfcc/dbd/34e, densité529, pagination UI interventionsc279, branchement de contrats quote/directory. Le déploiement nouveau est bloqué par quota. Fallback de test explicitement local : /tmp/depannage-web-pwa-local-qa sur stockage interne, source exacteb8, Next webpack127.0.0.1:3017, dépendances épinglées partagées et fichier .env.local privé/ignoré. Aucun résultat local ne sera nommé preview déployée. Origine de test browser localhost pour correspondre à request.url Next dev ; premier essai127 a donné403 sans créer de demande, historique conservé.

Supportfface1a intégré pour compilation e36b7be, reviewer Claude repris sur branche isolée claude/review-support-011, cible exactfface1a. Processus46162 en cours, rapport attendu ; aucune011 appliquée. Le backend support est prêt à revue, frontend assistance n’a qu’un branchement de session à ce stade.


## Préparation native — sans scaffold prématuré
Plan read-only enregistré : docs/NATIVE_READINESS_PLAN.md, découverte des API existantes et recherche primaire Expo/npm. Préparation uniquement ; Web/PWA vérifié reste le prérequis. L’Auth actuelle repose sur cookies, templates e-mail web et preview Vercel protégée ; aucun secret de bypass ne sera embarqué dans une app. Compte/EAS non configurés ni projet créé, aucun build natif déclaré. Les versions proposées seront relues au démarrage réel du lot, pas adoptées sur seule mémoire.

## CL-BE-001 — correction opérationnelle assignée
Le finding Claude sur l’édition du dossier qui retire l’approbation pendant une mission est traité par un blocage conservateur de cette édition, pas par un relâchement des droits terrain. Voir mission ci-dessus : sérialiser aussi acceptation/réaffectation afin d’éviter une course. Code réservé à012, plan/contrat avant implémentation ; ancienne mission Support011 demeure en revue indépendante, aucune011/012 appliquée à ce stade.


### CL-BE-001 — précision avant contrat/code012
L’implémenteur a identifié que Checkout exige encore l’approbation après clôture terrain. La garde conservatrice couvre donc aussi completed (non payé), en plus des quatre états actifs. Seuls paid/cancelled permettent l’édition du dossier ; disponibilité/contact séparés restent possibles. Aucune validation Stripe ni règle financière relâchée. Contrat à publier avec cette décision et tests completed refusé/paid autorisé. Les comptes historiques déjà non approuvés avec règlement dû restent à réexaminer par opérateur, sans auto-approbation.


## WEB-PWA-REVIEW-001 — rapport Claude réel011

# Rapport de revue croisée Claude — WEB-PWA-REVIEW-001 (assistance privée 011)

Même reviewer, même session, lecture seule, branche locale de revue `claude/review-support-011`. Aucun fichier source, schéma, cloud ou coordination modifié. Aucun fichier d'identifiants ouvert, aucune autre session contactée. Affectation revendiquée : uniquement la revue. Le lien node_modules reste un artefact d'outillage non touché.

**SHA revu :** `fface1af11d62b19522cc5266b6f2b6b536209c0`. Quatre commits depuis 254d497 : le contrat e7fb62d, deux commits de configuration Vercel, et le code fface1a. La migration 011 n'est pas appliquée à distance et cette revue n'en est pas la recette.

## Sources lues
Mission WEB-PWA-SUPPORT-001 et CORRECTIONS.md distants, migration 011, les deux routes support, le contrat et le rapport de vérification Codex, les tests HTTP et le harness SQL support, les diffs de la CI et de vercel.json.

## Contrôles réellement exécutés

| Contrôle | Résultat |
|---|---|
| `npm test` | 49/49, dont 6 tests HTTP support |
| `npm run typecheck` | passe |
| `node tests/sql-support-review.mjs` avec PGlite, 11 migrations, stubs Auth/Storage | 8 groupes PASS |
| `node tests/sql-review.mjs` | 29 PASS |
| `node tests/sql-quote-draft-review.mjs` | 9 PASS |
| `node tests/sql-site-access-review.mjs` | 8 PASS |
| `node tests/sql-performance-review.mjs` | 6 PASS |
| `npm run check`, build, preview, Supabase réel | non exécutés, checkout sans tests/ui |

## Migration 011
- **Confidentialité.** La lecture des tickets, messages et événements passe par un helper : admin, ou créateur ayant encore accès au dossier lié via le helper de la migration 009. Pairs d'organisation, artisan affecté et autres comptes ne lisent rien. Retrait de membre, réduction de portée site et réaffectation ferment l'accès, confirmé par le harness.
- **Mutations et auteur.** Select seul pour authenticated, aucune insertion ni mise à jour directe. Auteur, type, acteur, dates et versions sont fixés côté serveur depuis la session.
- **Création idempotente.** Unicité créateur plus clé client. Un rejeu identique renvoie le ticket existant avec `replayed:true`, sans nouvel événement ni consommation de quota. Un contenu différent donne 409. Le rejeu après révocation de l'accès au dossier lié est refusé.
- **CAS et immutabilité.** Version exacte exigée sinon 409, incrément par mutation, messages et événements uniques par version, aucune mise à jour possible. L'échec d'un append annule toute la transaction, confirmé par le harness.
- **Transitions.** Changement d'état réservé à l'admin, matrice exacte du contrat, même état refusé. Une réponse créateur en awaiting_user ou resolved rouvre à open. Une réponse admin sur resolved est refusée tant que non rouvert.
- **Verrous.** Ordre organisation liée, intervention liée, ticket, avec recontrôle d'accès après verrou. La création verrouille aussi le profil du créateur en NO KEY UPDATE avant le ticket. Ordre cohérent avec les brouillons de devis et les commandes 009. La réaffectation ne verrouille que le dossier et l'approbation artisan que profil et dossier artisan : aucun cycle identifié. Le NO KEY UPDATE reste compatible avec les verrous KEY SHARE des clés étrangères des réponses.
- **Helper admin_overview.** Ancien corps renommé et privé, EXECUTE révoqué. Le wrapper conserve la garde admin et ne change que la capacité support_tickets, clé déjà présente depuis la migration 003. Refus compte ordinaire et appel interne testés.

## Routes
- **Liste.** Clés strictes, `scope=all` réservé admin, filtres status, intervention_id et recherche sur le même alphabet littéral passée en `ilike` dédié. Curseur strict lié à l'empreinte scope plus filtres, microsecondes conservées, tri created_at puis id décroissants, total exact avant curseur sous RLS, COUNT absent en 503.
- **Détail.** Ticket sous RLS sinon 404. Événements paginés par version croissante avec COUNT restant, messages des mêmes versions seulement, totaux serveur exacts, permissions cohérentes avec le SQL.
- **Création et mutation.** Schémas stricts sans champ d'auteur, d'état ou de version venant du navigateur, refus du caractère NUL, origine contrôlée, réponses et erreurs en `private, no-store`, réponse RPC non-objet en 503.

## Findings
Aucun finding actionnable dans le périmètre revu.

Observations sans action requise :
- La clé client d'idempotence reste lisible par le créateur et l'admin en lecture directe de la table. Les routes l'excluent et la valeur n'est qu'un UUID aléatoire.
- Une mutation sur un ticket inconnu ou non lisible renvoie 403 plutôt que 404. Comportement anti-énumération cohérent, le détail renvoyant 404.
- La configuration vercel.json limitant les previews à main et integration est hors périmètre fonctionnel et non vérifiée sur Vercel par ce reviewer.

## Dépendances d'intégration frontend
Générer la clé de requête une fois par création, conserver la version attendue, traiter 409 par relecture sans renvoi automatique, afficher les réponses opérateur sans identité supplémentaire, invalider les tickets devenus non lisibles.

## Limites
Pas de Supabase, Auth ou PostgREST réels, pas de concurrence multi-connexion, les entrelacements ayant été vérifiés en séquentiel et par lecture du code. Pas de build, preview ni UI par ce reviewer. Le fournisseur HTTP des tests de route est un modèle, pas PostgREST.

Rapport également écrit dans `/Users/claudebrafa/.claude/plans/you-are-claude-independent-wobbly-charm.md`.

## WEB-PWA-SUPPORT-001 — preuve Supabase réelle

# Support011 hosted RPC/RLS review

{
  "sourceRevision": "fface1af11d62b19522cc5266b6f2b6b536209c0",
  "migration": "supabase/migrations/202610310011_support_tickets.sql",
  "checks": [
    {
      "name": "concurrent_idempotent_create_one_ticket_message_event_server_authorship",
      "status": "pass",
      "detail": {
        "tickets": 1,
        "messages": 1,
        "events": 1,
        "serverDerivedAuthor": true
      }
    },
    {
      "name": "different_body_same_key_conflict_without_extra_rows",
      "status": "pass",
      "detail": {
        "http": 400,
        "code": "P0001"
      }
    },
    {
      "name": "creator_admin_only_not_org_owner_or_assigned_artisan",
      "status": "pass",
      "detail": {
        "jobReadersDeniedSupport": 2,
        "creatorAndAdminRead": true
      }
    },
    {
      "name": "direct_writes_internal_helpers_denied_and_events_immutable",
      "status": "pass",
      "detail": {
        "directUpdateDeleteDenied": 12,
        "internalLockDenied": 2,
        "eventsUnchanged": true
      }
    },
    {
      "name": "concurrent_reply_cas_single_winner",
      "status": "pass",
      "detail": {
        "winnerHttp": 200,
        "loserHttp": 400,
        "loserCode": "P0001"
      }
    },
    {
      "name": "status_transitions_user_reopens_admin_explicit_reopen",
      "status": "pass",
      "detail": {
        "version": 9,
        "events": 9,
        "messages": 5,
        "adminRejectedHttp": 400,
        "adminRejectedCode": "P0001"
      }
    },
    {
      "name": "unlinked_personal_ticket_created",
      "status": "pass",
      "detail": {
        "unlinked": true
      }
    },
    {
      "name": "site_scope_reduction_revokes_linked_read_mutate_replay_not_personal",
      "status": "pass",
      "detail": {
        "linkedDenied": [
          {
            "http": 403,
            "code": "42501"
          },
          {
            "http": 403,
            "code": "42501"
          }
        ],
        "personalAccessible": true
      }
    },
    {
      "name": "membership_removal_keeps_linked_denied_personal_accessible",
      "status": "pass",
      "detail": {
        "linkedDenied": true,
        "personalWritable": true
      }
    },
    {
      "name": "admin_database_support_capability_only",
      "status": "pass",
      "detail": {
        "supportCapability": true,
        "proof": "DB RPC only; no support HTTP/UI deployment claim"
      }
    }
  ],
  "cleanup": [
    {
      "table": "support_events",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "support_messages",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "support_tickets",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "audit_log",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "audit_log",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "interventions",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "professional_audit",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "organization_membership_events",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "organization_members",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "sites",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "organizations",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "Auth/profile manager",
      "status": "pass"
    },
    {
      "table": "Auth/profile manager",
      "status": "pass"
    },
    {
      "table": "Auth/profile artisan",
      "status": "pass"
    },
    {
      "table": "Auth/profile admin",
      "status": "pass"
    }
  ],
  "limits": [
    "Real hosted Supabase RPC/RLS only. Existing Next preview1be8f00 does not deploy support HTTP/UI routes.",
    "No email, Stripe, schema or settings changes; no other accounts touched."
  ]
}

The initial run had 9 passes and one harness failure: it expected six messages, but the controlled sequence creates five (initial, CAS winner, user awaiting-user reply, user reopen reply, admin reply). This diagnostic is preserved at /tmp/depannage-web-pwa-qa/support011/initial-harness-diagnostic.json. That first cohort was fully cleaned (15/15 operations). The corrected harness ran a fresh isolated cohort: 10/10 checks and 15/15 cleanup/readbacks passed. Both cohorts remain separately tracked. Additional exact-ID readback checks are preserved in /tmp/depannage-web-pwa-qa/support-cleanup-readback.json.

Source references at fface1af11d62b19522cc5266b6f2b6b536209c0, migration supabase/migrations/202610310011_support_tickets.sql:
- lines 3–43: private tables, restricted grants and creator/admin read policies.
- lines 47–60: organization/job/ticket locking and second access check.
- lines 62–94: creation idempotency and server-derived authorship.
- lines 96–133: optimistic version check, status/reply transitions and immutable appended events.
- lines 140–145: admin database capability flag.

No application defect found in this bounded hosted RPC/RLS scope. Direct PostgREST P0001 conflicts return HTTP400, distinct from application API409 mapping; access denials return HTTP403/code42501. No support HTTP route or support browser UI deployment was tested or claimed.


## WEB-PWA-REVIEW-001 — rapport Claude réel012

# Rapport de revue croisée Claude — WEB-PWA-REVIEW-001 (CL-BE-001, migration 012)

Même reviewer, même session, lecture seule, branche locale `claude/review-artisan-active-012`. Aucun fichier source, schéma, cloud ou coordination modifié. Aucun fichier d'identifiants ouvert, aucune autre session contactée. Lien node_modules non touché.

**SHA revu :** `d0bf053a3ab3e7f96aa50d587987c54c8dfb3a86`. Trois commits depuis fface1a : le contrat 47e7b13, son renforcement 1951782, le code d0bf053. Migration 012 additive seule, les migrations 001 à 011 sont inchangées dans ce diff.

## Sources lues
Mission « Correction CL-BE-001 » et les deux entrées CORRECTIONS distantes, dont la précision sur completed non réglé. Migration 012, contrat et rapport de vérification Codex, harness SQL garde active, diff de la CI.

## Contrôles réellement exécutés

| Contrôle | Résultat |
|---|---|
| `npm test` | 49/49 |
| `npm run typecheck` | passe |
| `node tests/sql-artisan-active-guard-review.mjs` avec PGlite, 12 migrations, stubs Auth/Storage | 6 groupes PASS |
| `node tests/sql-review.mjs` | 29 PASS |
| `node tests/sql-quote-draft-review.mjs` | 9 PASS |
| `node tests/sql-support-review.mjs` | 8 PASS |
| `node tests/sql-site-access-review.mjs` | 8 PASS |
| `node tests/sql-performance-review.mjs` | 6 PASS |
| Build, tests UI, preview, Supabase réel | non exécutés, checkout backend |

## Analyse de la migration 012
- **Politique conservatrice.** La sauvegarde du dossier appelle d'abord la garde de suspension existante (rôle artisan, verrous profil puis dossier artisan), puis lit sans verrou les interventions de l'acteur en assigned, quoted, accepted, in_progress ou completed. Toute présence déclenche un 409 avant l'appel au helper hérité. Les états paid et cancelled libèrent. Disponibilité et contact restent séparés, la suspension explicite reste prioritaire en 403.
- **Approbation intacte en cas de refus.** Le raise précède la chaîne 008 puis 003. Aucun champ du dossier ni le drapeau d'approbation ne change, vérifié par le harness sur les cinq états.
- **Sérialisation.** L'acceptation de mission vérifie le rôle artisan, puis verrouille organisation, intervention, profil propre et dossier artisan propre avant la chaîne existante. La réaffectation vérifie `is_admin()` avant tout verrou, puis organisation, intervention, profil cible avec rôle artisan et dossier artisan cible. L'édition verrouille profil puis dossier artisan et ne verrouille jamais d'intervention. Les deux ordres d'arrivée convergent : édition d'abord rend l'attribution inéligible, attribution d'abord fait échouer l'édition. Aucun cycle identifié.
- **Interaction avec les brouillons 010.** La gestion de brouillon suit organisation, intervention, profil, dossier artisan, brouillon. Le wrapper 012 n'ajoute aucun verrou pour l'envoi de devis. L'édition étant bloquée pendant le travail actif, un brouillon ne peut plus devenir orphelin par retrait d'approbation self-service.
- **Interaction avec le support 011.** La création de ticket prend le profil en NO KEY UPDATE après l'intervention, les messages prennent KEY SHARE sur le profil. L'édition en FOR UPDATE attend ou fait attendre sans inversion d'ordre, donc pas de cycle.
- **Helpers privés.** Les trois fonctions renommées par 012 sont révoquées, les helpers antérieurs restent révoqués, aucune RPC alternative n'est exposée, signatures publiques inchangées et grants réaffirmés.
- **CI.** Étape harness ajoutée avec l'étiquette « not live Supabase ».

## Findings
Aucun finding actionnable dans le périmètre revu.

Observations sans action requise :
- Le traducteur d'erreurs renvoie un 409 générique pour tout P0001, la raison française du SQL n'atteint pas le client. La sauvegarde du dossier n'a pas d'autre chemin P0001, donc le frontend peut contextualiser ce 409 comme le contrat le prévoit.
- La soumission de candidature et la liaison de pièces ne sont pas sous la garde. Elles ne retirent pas l'approbation, pas d'impact.
- Les comptes déjà rétrogradés par l'ancien comportement avec règlement dû restent une remédiation opérateur, comme documenté.

## Limites
Le harness PGlite est mono-connexion. Les deux ordres d'arrivée sont vérifiés en séquentiel et l'ordre des verrous en source, ce qui ne prouve pas une course réseau multi-session réelle. Pas de Supabase, Auth ou PostgREST réels, pas de build, tests UI ni preview par ce reviewer. La migration 012 n'est pas appliquée à distance.

Rapport également écrit dans `/Users/claudebrafa/.claude/plans/you-are-claude-independent-wobbly-charm.md`.

## CL-BE-001 — concurrence réelle hébergée

# Active work guard012 hosted concurrency QA

{
  "sourceRevision": "d0bf053a3ab3e7f96aa50d587987c54c8dfb3a86",
  "migration": "supabase/migrations/202610310012_artisan_active_work_guard.sql",
  "mode": "Hosted real Postgres authenticated RPC concurrency; no PGlite",
  "checks": [
    {
      "name": "six_real_concurrent_self_edit_vs_accept_trials",
      "status": "pass",
      "detail": [
        {
          "trial": 0,
          "edit": {
            "http": 200,
            "code": null,
            "success": true
          },
          "claim": {
            "http": 403,
            "code": "42501",
            "success": false
          },
          "winner": "edit"
        },
        {
          "trial": 1,
          "edit": {
            "http": 200,
            "code": null,
            "success": true
          },
          "claim": {
            "http": 403,
            "code": "42501",
            "success": false
          },
          "winner": "edit"
        },
        {
          "trial": 2,
          "edit": {
            "http": 200,
            "code": null,
            "success": true
          },
          "claim": {
            "http": 403,
            "code": "42501",
            "success": false
          },
          "winner": "edit"
        },
        {
          "trial": 3,
          "edit": {
            "http": 400,
            "code": "P0001",
            "success": false
          },
          "claim": {
            "http": 200,
            "code": null,
            "success": true
          },
          "winner": "claim"
        },
        {
          "trial": 4,
          "edit": {
            "http": 200,
            "code": null,
            "success": true
          },
          "claim": {
            "http": 403,
            "code": "42501",
            "success": false
          },
          "winner": "edit"
        },
        {
          "trial": 5,
          "edit": {
            "http": 200,
            "code": null,
            "success": true
          },
          "claim": {
            "http": 403,
            "code": "42501",
            "success": false
          },
          "winner": "edit"
        }
      ]
    },
    {
      "name": "completed_unpaid_blocks_edit_preserves_approval_and_dossier",
      "status": "pass",
      "detail": {
        "http": 400,
        "code": "P0001",
        "success": false
      }
    },
    {
      "name": "cancelled_and_synthetic_paid_allow_self_edit",
      "status": "pass",
      "detail": [
        {
          "state": "cancelled",
          "http": 200,
          "code": null,
          "success": true,
          "syntheticPaymentOnly": false
        },
        {
          "state": "paid",
          "http": 200,
          "code": null,
          "success": true,
          "syntheticPaymentOnly": true
        }
      ]
    },
    {
      "name": "availability_and_basic_contact_separate_from_professional_edit_guard",
      "status": "pass",
      "detail": {
        "availabilityChanged": true,
        "basicContactChanged": true,
        "approvalPreserved": true
      }
    },
    {
      "name": "suspended_professional_edit_and_availability_denied",
      "status": "pass",
      "detail": [
        {
          "http": 403,
          "code": "42501",
          "success": false
        },
        {
          "http": 403,
          "code": "42501",
          "success": false
        }
      ]
    },
    {
      "name": "three_real_concurrent_admin_reassign_vs_target_self_edit_trials",
      "status": "pass",
      "detail": [
        {
          "edit": {
            "http": 200,
            "code": null,
            "success": true
          },
          "reassign": {
            "http": 403,
            "code": "42501",
            "success": false
          },
          "winner": "edit"
        },
        {
          "edit": {
            "http": 200,
            "code": null,
            "success": true
          },
          "reassign": {
            "http": 403,
            "code": "42501",
            "success": false
          },
          "winner": "edit"
        },
        {
          "edit": {
            "http": 200,
            "code": null,
            "success": true
          },
          "reassign": {
            "http": 403,
            "code": "42501",
            "success": false
          },
          "winner": "edit"
        }
      ]
    }
  ],
  "cleanup": [
    {
      "table": "messages",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "audit_log",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "audit_log",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "interventions",
      "status": "pass",
      "remaining": 0
    },
    {
      "table": "Auth/profile/dossier/limits client",
      "status": "pass"
    },
    {
      "table": "Auth/profile/dossier/limits artisan",
      "status": "pass"
    },
    {
      "table": "Auth/profile/dossier/limits admin",
      "status": "pass"
    }
  ],
  "limits": [
    "Synthetic paid status is fixture state only, never provider payment proof.",
    "No HTTP browser mapping check; direct PostgREST error codes/statuses are recorded."
  ],
  "finishedAt": "2026-10-31T03:54:41.238Z"
}

The initial run exercised six real concurrent claim/edit races (three edit wins and three claim wins) and three reassignment races successfully. Its separate contact check used a forbidden direct profiles UPDATE; this was a harness mistake, corrected to the documented update_profile RPC. Initial cleanup encountered messages created by successful reassignment and preserved that failure. Recovery deleted only tracked messages before tracked jobs, then verified all three Auth users/profiles/dossiers/action limits absent. Evidence: active-guard012/initial-diagnostic.json and cleanup-recovery.json.

A fresh isolated confirmation run then passed all six grouped checks, including nine actual concurrent races and the corrected contact RPC. All seven cleanup/readback scopes passed. Synthetic completed/paid/cancelled states are test fixtures, never payment-provider evidence. P0001 is HTTP400 through direct hosted PostgREST, not a verified HTTP409 application response.

Source references at d0bf053a3ab3e7f96aa50d587987c54c8dfb3a86:
- supabase/migrations/202610310012_artisan_active_work_guard.sql:6–16: self-edit approval guard and outstanding attributed work exclusion.
- same file:21–34: accept_mission serializes job, profile and dossier before existing eligibility rules.
- same file:39–55: administrator reassignment serializes the target profile/dossier.
- app/api/profile/route.ts:20: contact changes delegate to update_profile, independently from professional dossier approval reset.

No application finding in this bounded real-provider concurrency scope. No PGlite used, no application/schema change, no email/charge, no unrelated data touched. Temporary test code was finished before the midnight relay; all sessions ended and fixtures were cleaned.


## WEB-PWA-20261030 — QA locale photos et entreprise

# Local browser fallback QA

Final rerun: 8/8 functional checks PASS, zero browser page errors; 13 cleanup/readback operations PASS.

LOCAL Next dev browser + REAL dedicated hosted Supabase; NOT Vercel/online deployed UI proof

Revision b8a277afeaac85eec8867d67b236303579e0ec88

- local_compact_artisan_360: PASS
- local_compact_artisan_1280: PASS
- local_live_browser_login: PASS
- photo_partial_failure_keeps_single_request: PASS
- photo_retry_sends_only_failed_file: PASS
- lost_upload_response_remains_uncertain_after_server_store: PASS
- verify_lists_same_name_candidate_without_auto_confirmation: PASS
- explicit_candidate_acknowledgement_does_not_resend: PASS

Fatal: none

## Cleanup

- Read tracked QA docs: PASS
- Remove tracked Storage objects: PASS
- Remove tracked document metadata: PASS
- Read tracked QA jobs: PASS
- Remove tracked job audit: PASS
- Remove tracked jobs: PASS
- Remove tracked actor audit: PASS
- Remove tracked Auth user: PASS
- Auth identity absent readback: PASS
- Profile absent readback: PASS
- documents absent readback: PASS
- interventions absent readback: PASS
- Storage user prefix empty readback: PASS

## Limits

- New Vercel preview blocked by daily quota, local fallback explicitly authorized.
- No Stripe, email, OS PWA installation or native app tested.
- Enterprise foreground/coalescing cases not run in this bounded photo/artisan session.

## Captures

- /tmp/depannage-local-fallback-captures/artisan-360.png
- /tmp/depannage-local-fallback-captures/artisan-1280.png
- /tmp/depannage-local-fallback-captures/partial-photo-failure.png
- /tmp/depannage-local-fallback-captures/photo-retry-success.png
- /tmp/depannage-local-fallback-captures/uncertain-upload.png
- /tmp/depannage-local-fallback-captures/uncertain-manual-candidate.png
- /tmp/depannage-local-fallback-captures/candidate-acknowledged.png


## Execution history and verification limits

- Initial harness expected “Tableau de bord” as a heading; current compact screen correctly uses this as a kicker span and uses “Missions d’aujourd’hui” as a heading. Corrected the test selector; no application source changed. Preserved `harness-initial-selector-error.json`.
- Browser origin `http://127.0.0.1:3017` was rejected by local Next request-origin reconstruction, while `http://localhost:3017` reached authentication normally. Used localhost for browser QA on the same server bound exclusively to 127.0.0.1. No server policy bypass or application change. Preserved `local-origin-blocked-run.json`; its later browser-closed failures were test teardown after the initial origin problem, not independent product findings. QA user cleaned.
- A cold first localhost run exceeded the 60-second queue wait while compiling routes and completing cloud calls. Its retry/uncertain checks still passed and resources were cleaned. Preserved `local-cold-compilation-timeout.json`. Final warm rerun used a 120-second bound and passed all eight checks.
- Final real browser photo flow: one request created; first photo forwarded/stored, second deliberately returned 422 before forwarding. Retry produced exactly one additional upload, preserved the single intervention and did not resend the successful first file. Second request forwarded/stored its photo but the response was deliberately aborted before browser receipt. State remained uncertain. Verification listed its same-name candidate while preserving uncertainty, made no automatic upload, and required explicit “C’est bien cette photo” acknowledgement to mark it stored. No resend occurred.
- M35 visual comparison: navy overview band, daily mission rows, performance panel, blue mission CTA, greeting/bell and five navigation tabs present. No horizontal overflow at 360 or 1280. The performance panel stacks on narrow screens; this is not pixel identity or a claim that the whole screen fits one viewport. Screenshots include explicit demo controls, a warning caused by Playwright blocking service workers, the Next dev badge and fixed-position navigation artifacts in full-page capture. These are local test conditions, not production screenshots.
- The candidate Open action was present but opening the signed object in a new tab was NOT exercised in this run; Storage URL authorization was verified in earlier hosted QA.
- Browser contexts closed, Next local server stopped successfully (port3017 no longer responds). Restored only generated next-env.d.ts. Git tracked files unchanged; pre-existing node_modules symlink remains. No production deployment or new Vercel preview claimed.


# Local enterprise browser QA

Final bounded run: 7/9 automated checks PASS; one concrete UI action-gating finding and one 22-second latency timeout. Zero browser page errors. All cleanup and readback operations passed.

LOCAL browser + real dedicated hosted Supabase; NOT Vercel deployed UI proof

Exact revision b8a277afeaac85eec8867d67b236303579e0ec88

- sole_org_effective_context_and_membership_badge: PASS — {"singleOrgBadge":"Gestionnaire","orgSelectorAbsent":true,"effectiveOrgDisplayed":true}
- first_healthy_foreground_reads_workspace_and_professional: PASS — {"workspace":true,"professional":true,"firstCompletedAt":1793418159816}
- rapid_second_foreground_revalidates_without_third_signal: PASS — {"elapsedMs":17860,"secondSignalAfterHealthyMs":1245,"noThirdSignal":true,"siteBOptionGone":true,"siteBDataAndGlobalContractGone":true}
- restricted_server_reads_match_browser: PASS — {"oneAuthorizedSite":true,"oneAuthorizedJob":true,"organizationWideContractHidden":true}
- viewer_membership_badge_updates_after_foreground: FAIL — locator.waitFor: Timeout 22000ms exceeded.
Call log:
[2m  - waiting for getByText(/Votre rôle : Lecture/) to be visible[22m

- viewer_server_budget_write_denied: PASS — {"status":403,"storedBudgetUnchanged":true}
- viewer_budget_editor_visually_unavailable: FAIL — Viewer still has enabled Modifier le budget control

true !== false

- removed_membership_clears_org_site_and_professional_ui: PASS — {"oldContextGone":true,"oldProfessionalMarkerGone":true}
- removed_member_fresh_reads_refused_or_filtered: PASS — {"workspaceStatus":200,"orgs":0,"sites":0,"jobs":0,"organizationStatus":403,"contracts":0,"compliance":0}

Fatal: none

## Cleanup

- Remove tracked job audit: PASS
- Remove tracked jobs: PASS
- Remove tracked compliance records: PASS
- Remove tracked sites: PASS
- Remove tracked contracts: PASS
- Remove tracked professional_audit: PASS
- Remove tracked organization_membership_events: PASS
- Remove tracked organization_invitations: PASS
- Remove tracked organizations: PASS
- Remove tracked actor audit: PASS
- Remove tracked Auth identity: PASS
- Remove tracked actor audit: PASS
- Remove tracked Auth identity: PASS
- Readback absent profiles: PASS
- Readback absent organizations: PASS
- Readback absent sites: PASS
- Readback absent interventions: PASS
- Readback Auth identity absent: PASS
- Readback Auth identity absent: PASS

## Limits

- No Stripe, email, OS PWA or native app.
- Headless bringToFront alone emitted no useful foreground events. Final browser run explicitly dispatched synthetic DOM blur/focus into the real app handler; no actual OS foreground/visibility proof.

## Captures

- /tmp/depannage-local-enterprise-captures/sole-org-members-manager.png
- /tmp/depannage-local-enterprise-captures/healthy-site-b-context.png
- /tmp/depannage-local-enterprise-captures/restricted-site-a-auto-refresh.png
- /tmp/depannage-local-enterprise-captures/failure-viewer_membership_badge_updates_after_foreground.png
- /tmp/depannage-local-enterprise-captures/viewer-site-budget.png
- /tmp/depannage-local-enterprise-captures/failure-viewer_budget_editor_visually_unavailable.png
- /tmp/depannage-local-enterprise-captures/membership-removed.png


## Finding — viewer still offered operational write actions

Confirmed on exact b8a277afeaac85eec8867d67b236303579e0ec88. After owner downgraded membership to viewer and refreshed siteAccess visibly displayed “(lecture)”, the site sheet still exposed an enabled “Modifier le budget” button. The same screenshot shows Nouvelle demande, Ajouter and Configurer la règle actions; those extra controls were observed but not submitted by this test. Source: components/role/enterprise-space.tsx:1981 always mounts BudgetEditor; components/app/forms.tsx:2177 disables its trigger only while busy. Expected: absent/disabled unavailable write actions based on current membership AND effective per-site write grant, with a read-only explanation. This is misleading UI, not an authorization bypass: actual browser POST /api/professional returned403 and stored budget stayed unchanged. Capture: failure-viewer_budget_editor_visually_unavailable.png.

## Revalidation evidence and latency

- Sole organization effective membership badge was Gestionnaire without an explicit organization selector; org in header/context matched fixture.
- First healthy synthetic browser focus caused real workspace and professional network reads.
- Owner restricted member from ALL to siteA within1,237ms of healthy response; second signal was sent in that window. SiteB selection/option, B compliance marker and organization-wide contract data disappeared automatically, siteAccess showed siteA. Automatic bounded UI refresh finished17,860ms after second signal, with no third signal/manual reload. Actual fresh hosted reads matched one site/one job and no global contract.
- Viewer badge wait at22 seconds timed out. This is NOT classified as a dropped revalidation signal: actual local log shows GET /api/workspace took24.7 seconds, in addition to configured quiet-window scheduling; response arrived about42.3 seconds after that focus. Subsequent site sheet screenshot shows refreshed read-only siteAccess. The precise final badge text after this late response was not separately reasserted before navigating to the site sheet.
- Removal then cleared old org/site/professional context automatically and fresh organization lookup returned403; workspace and professional data were empty for the removed member.

## Test-method history

The first two setup attempts contained harness selection errors: inactive professional subtab and duplicate selected site label matching strong+option. Both cohorts cleaned fully; preserved harness-initial-tab-not-open.json and harness-duplicate-site-label.json. Corrected tests click actual role buttons “Contrats cadres” and “Audits et maintenance”, and assert selected combobox value.

A third run using only headless bringToFront recorded ZERO focus/visibility events, so its stale UI observations are not product foreground failures. Its complete results are preserved in headless-tab-switch-no-focus-events.json, cohort cleaned. Final run dispatched synthetic DOM blur/focus into the actual app handler. Real network and rendered state were observed, but actual OS foreground/visibility-event generation remains unverified. No application source or schema modified.


Server/browser cleanup: contexts closed, local Next server stopped; port3017 no longer responds. Restored generated next-env.d.ts; tracked source unchanged. Only pre-existing node_modules symlink remains untracked.


## WEB-PWA-20261030 — revue source autorité/support9a321

# Independent authority/support review — 9a321d4

Exact reviewed revision: `9a321d49231d6f4d3553029f4d308ee70a98596d`, includes e5e7750,11f90d5,b0343e5,9b9f293. No owner source/working files edited. Review and independent test-script authoring below occurred before00:00 America/Martinique; no source/test coding is delegated to Codex after that boundary.

## Existing enterprise presentation P2 remains open

The new enterpriseAuthority helper and ProfessionalOperations props are not wired through EnterpriseSpace in this exact checkpoint:

- `components/role/enterprise-space.tsx:1741–1758` passes no canWriteOrganization/canWriteSite/readOnlyReason. `components/app/forms.tsx:1391–1392` defaults omitted props totrue, leaving write forms enabled.
- Enterprise SiteForm remains unconditional1826–1834; BudgetEditor unconditional1998–2004. Read-only viewer or selected-site read-only member gets edit controls that the server correctly refuses.
- ApprovalDetail2223–2228 blocks viewer and owner-only-rule manager, but null role and manager selected-site can_writefalse are not blocked.
- `components/app/session.ts:enterpriseAuthority` defaults null/undefined scope metadata toall for a manager. An independent negative check confirms both organization write and excluded-site write returntrue when metadata unavailable. This is fail-open presentation while access metadata loads/fails.

Required fix to existing enterprise P2: compute authority from effective membership and current user's siteAccess, pass it into shared professional forms, and gate dedicated site creation, budget, rules/config, contract and approval controls. Fail closed for manager until access metadata available; canonical owner can retain legitimate owner authority. Preserve personal profile/support actions (not organization administration). Server403 remains the security boundary; no new SQL authorization bypass is asserted.

Reproduction for Claude/browser: real viewer→Sites and sitebudget; selectedmanager with can_writefalse→same site+pendingapproval; manager with siteaccess loader held/missing→no organization write controls; owner/all-manager writable controls still usable. Root's older local7/9 report remains relevant; helper-only tests do not resolve the missing component wiring.

## SUPPORT-REV-001 — P1 stale create result escapes runner into newer identity

`components/courant-app.tsx:1705–1739` stores created from the awaited API and returns it even if run() returnsfalse due to generation change. The mutation's own notice/capability are guarded, but its return payload is not.

`components/role/support-tickets.tsx:390–405` awaits that value then calls the old session.go and session.setNotice without mounted/current-identity checking. An unmounted component's state setter is harmless, but these session methods mutate the root controller.

Sequence: A submits supportcreate; response held; A logsout/Blogs in (role remount); A create response returns; old NewTicket continuation navigates B to A's ticket id and publishes A's creation notice. Fresh server reads should deny access, so no ticket-content leak/server permission bypass is claimed. It is the same class of cross-identity root effect that session guards are intended to prevent.

Required: suppress stale mutation results at controller boundary (return null when runner says notapplied), and bind post-await caller navigation/notices to identity/mount ownership. Review other returned command results for the same pattern before claiming global stale effects closed. Test held create→identity change→old completion, ensuring no new identity navigation/notices.

## SUPPORT-REV-002 — P2 unresolved create idempotency key only survives a mounted form

NewTicket365 creates requestId with local useState(uid). A network-uncertain create keeps that key only while this component remains mounted. The PageTitle Back action remains usable while submitting and navigation/remount/reload discards the key. Returning to NewTicket creates another key; resubmitting the same unresolved intent may duplicate a server-committed ticket whose response was lost.

Within the same mounted form, retry correctly reuses requestId. Do not describe this as persistent idempotent creation across navigation. Required for persistent retry intent: retain unresolved create key/payload account-scoped until outcome resolved/explicitly abandoned, including appropriate identity clearing, or constrain/warn navigation and qualify the guarantee. Test commit+lostresponse→leave/reopen→retry retains original key and server replay rather than newticket. No claim that deliberate new separate requests must be deduplicated.

## Bounded support behavior verified in source

- Private list calls scope mine with server cursor/limit/filter; user has no all-scope UI. Admin list uses explicit allscope and server response total/cursor.
- Detail requests limit50 and after_version, merges message/eventids, sorts byversion; reply sends current expected_version. CAS409 preserves body, shows conflict, disables resend until explicit reread. No automatic conflicting retry.
- Detail renders can_reply from server; user status picker absent; admin state actions separate. Server reload null/403/404 gives unavailable/notreadable state rather than fabricated data.
- Loader seq guard suppresses stale read payload across identity change. The write return-value escape above is distinct and remains.
- TicketDetail initial-read effect depends id/reloadKey, not refreshedAt. A linked ticket cached before same-account accessrevocation is not automatically revalidated on focus; treat under existing CL-UI008 cache revalidation concerns, not duplicate a new finding ID. Server denies future access.
- Personal support/profile remain available to enterprise viewer, as required; do not hide them behind organization write authority.

## Admin directories source check

`useDirectory` at admin-space2276+ requests server kind/filter/limit/cursor, uses returned items and server totals/has_more/next_cursor; filterchanges reset cursor, previous pages use saved cursors. This is actual server paging plumbing, not slicing the overview100-array. Bounded overview fallback is separately labeled. Artisan detail calls loadAdminDirectoryItem and dossier read uses its dedicated endpoint. No runtime proof or full directory journey coverage claimed by this review.

## Actual checks

Snapshot `/tmp/depannage-ui-review-9a321` exported exact revision, read-only dependency symlink. **42 existing UI tests +2 independent negative reproductions =44PASS**, exit0.

Independent cases in `/tmp/depannage-ui-review-9a321/support-authority-negative.test.ts`:
- exact enterpriseAuthority returns unrestricted writes for manager with absent metadata (asserts current bad behavior);
- exact runner plus copied create-return/caller sequence demonstrates stale created payload still drives old-form root navigation after generation reset (asserts current bad behavior).

No mounted React/browser, cloudsupport, actualCASrace, screenshots or full build performed. Negative tests passing documents defects, not fixes. Owner should add meaningful regression coverage while implementing through Claude. No owner edits.

Verdict: authority wiring remains incomplete; support stale-return and persistent unresolved-key handling need correction. Server authorization is not declared broken. Entire app/preview acceptance remains outside this review.


### Nouveaux statuts et instructions du propriétaire
Objectif explicite : résultat complet le31octobre à08h America/Martinique. Le propriétaire autorise Vercel et Stripe à ATTENDRE ; ces services ne bloquent plus la progression sur le reste. Deux automations effectivement enregistrées et relues : pilotage de nuit à00,01,02,03,04,05,06,07 ; bilan distinct à08. La première tentative d’update est restée sans confirmation et a été interrompue, configuration relue inchangée ; la seconde update courte a réussi. Aucun bilan programmé dupliqué.

Supabase001–012 réellement appliquées :012 limitée seule par dry-run puis appliquée après revue Claude sans finding ; concurrence réseau ensuite réussie, voir rapport ci-dessus. CL-BE-001 est verified dans ce périmètre backend ; UI contextualisation a4eca69 à recontrôler.

CL-UI-008 reste OPEN : e5e7750/9a321 introduisent un helper mais les callsites restent incomplets et certains defaults autorisent l’écriture. Ne pas fermer sur seul test du helper. SUPPORT-REV001 P1 OPEN : résultat de création retourné malgré runner invalidé et continuation ancien compte qui navigue/notifie le nouveau. SUPPORT-REV002 P2 OPEN : clé idempotente perdue au démontage/rechargement après résultat incertain. Reproduction source9a321 et44 tests, rapport ci-dessus. Findings transmis par CLI au lead avant minuit. Exiger des tests sur la chaîne réellement utilisée, et audit des autres mutations retournant une valeur.

Le compte EAS a été vérifié connecté (claude972, Owner), sans projet/build créé. Prévol/plan dans docs ci-dessous. ExpoSDK58 nécessite des outils plus récents que le compilateur local ; privilégier builds cloud compatibles déjà autorisés et vérifier quotas/signatures avant toute affirmation. Vrai natif après checkpoint fonctionnel Web/PWA hors Vercel/Stripe différés, pas de webview renommée native.


## Relais00h — dispatch réel et état
2026-10-31 après00h America/Martinique, Codex : inventaire CLI confirme b4b555f0 actif dans le checkout UI, aucune autre session projet interrompue. Relecture des missions/corrections distantes et night handoff effectuée. Nouveau worktree backend Claude préparé sur disque interne à309ed9f, branche claude/web-pwa-backend, aucun code écrit par Codex. Mission gateway publiée pending avant instruction au lead ; acceptation/délégation restent à constater. UI c899e4e fixe partiellement retours tardifs et scope inconnu, 71f7fc9 ajoute runForResult et raccordements d’autorité ;97ccc7e contient le rapport. Le checkout est encore en cours d’édition pour l’éditeur de devis : ne pas examiner ces changements comme un SHA validé. Revue du checkpoint poussé et tests existants à exécuter, sans nouveaux scripts Codex après00h.


## Pilotage00h — revue frontend97ccc7e
Codex a exécuté les tests UI EXISTANTS du snapshot97ccc7e dans le checkout de revue arrêté (nouvelle branche locale claude/review-ui-midnight) :43/43 PASS. La première commande npm test:ui a échoué car cette branche UI ne contient pas le script d’intégration ; relance du binaire tsx épinglé sur tests/ui/*.test.ts réussie, aucune source modifiée. Source : autorité désormais passée aux formulaires pro, budget/site/approbation conditionnés par canWriteSite ; runForResult supprime le résultat stale de création support. Les mutations retournant conflict nécessitent encore vérification (certaines ne neutralisent que outcome.ok quand runnerfalse). Le brouillon support est désormais stocké par profileId en sessionStorage, mais clearSessionState ne supprime pas la clé du compte sortant : demander la suppression du contenu privé au logout/changement d’identité sans effacer le pending de la même identité au simple boot/reload. Recette navigateur et traitement de ces points restent ouverts ; pas de clôture globale sur43 tests purs.

Lead CLI b4b555f0 a effectivement enregistré le message de relais dans son transcript et a déclaré la délégation backend dans CLAUDE_STATUS.md ; code du gateway/contrat à constater sur la branche avant tout statut ready. Le checkpoint éditeur de devis d8a206b est annoncé par Claude : une recherche antérieure sur l’ancien snapshot ne prouvait pas son absence actuelle. Revoir le composant artisan-quote-draft.tsx au SHA courant et les callbacks effectivement branchés.
