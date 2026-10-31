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
