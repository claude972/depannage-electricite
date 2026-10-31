# WEB-PWA-DESKTOP-INSTALL-006 — contrat de recette macOS

## Objectif et état

Prouver qu’un utilisateur peut installer cette PWA comme une véritable application macOS, ouvrir sa fenêtre autonome puis la relancer. Une page web ouverte, un manifeste valide ou un mode standalone émulé ne constituent pas cette preuve.

**CONTRACT ONLY — aucune installation exécutée.** Publication avant code, navigateur et serveur ; revue root obligatoire avant implémentation, puis revue du SHA du harnais avant exécution par root seul. Les tests purs sont séparés de cette exécution. Base `6c67644af48b899857256d2211a843cd67efc608`, mission publiée dans `missions/web-pwa` au commit `1bef22dbecdfce274af563b821622f0d79b16fd1`. La preuve lifecycle deux builds/deux onglets `31ac` reste acquise ; cette recette ne la répète pas.

Propriété exclusive : `scripts/qa-pwa-desktop/**`, `tests/qa-pwa-desktop*.test.ts`, ce document. Aucun changement app, manifeste, service worker, package/lock, profil utilisateur ou autre harnais. Aucun compte, secret, appel Supabase, cloud, achat, EAS, natif iOS/Android ou publication. La preview distante reste différée par décision propriétaire ; la preuve OS sera explicitement locale.

## Phase 0 — documentation et API réellement disponibles

Cette phase sert l’objectif en séparant une véritable intégration OS d’une fenêtre de test.

Sources lues :

- `AGENTS.md`, `DESIGN.md`, `app/manifest.ts`, `scripts/qa-pwa-lifecycle.mjs`, `scripts/qa/lib/browser.mjs`, mission/corrections `1bef22d`, `/tmp/depannage-pwa-desktop-install-feasibility.md`.
- [Guide officiel Chromium CDP/PWA](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/web_applications/docs/cdp-integration.md), notamment lancement headed, session navigateur et avertissement d’installation réelle à désinstaller. Il recommande le pipe et documente aussi le WebSocket.
- [Exemple officiel demo2.mjs](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/web_applications/docs/cdp/demo2.mjs), séquence install/launch/getOsAppState/uninstall.
- [Schéma officiel CDP, domaine PWA](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json), commandes expérimentales : `PWA.install({manifestId, installUrlOrBundleUrl?})`, `PWA.getOsAppState({manifestId})`, `PWA.changeAppUserSettings({manifestId, displayMode:'standalone'})`, `PWA.launch({manifestId, url?}) -> {targetId}`, `PWA.uninstall({manifestId})`. `getOsAppState` expose badge/fileHandlers ; son succès seul ne prouve pas un shim ni une fenêtre macOS.
- [Dossier Applications macOS](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/web_applications/os_integration/mac/apps_folder_support.mm), `GetChromeAppsFolderImpl` et localisation : écritures hors profil possibles.
- [Shim et garde test-type](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/web_applications/os_integration/mac/web_app_shortcut_mac.mm), `AppShimCreationAndLaunchDisabledForTest` et `GetBundleIdentifierForShim` : `--test-type` peut neutraliser l’intégration réelle.
- [Lecture de métadonnées des bundles](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/web_applications/os_integration/mac/bundle_info_plist.mm), `IsForCurrentUserDataDir`, `GetFullProfilePath`, `GetExtensionId`, `GetURL`, `GetBundleId`. Le user-data-dir peut désigner le sous-dossier de données webapp : reprendre la résolution de profil, pas un préfixe texte naïf.

Confiance : faisabilité documentaire et binaire présents ; compatibilité des commandes **non interrogée en runtime**. Le protocole expérimental doit être vérifié contre Chrome réellement lancé, pas supposé depuis tip-of-tree. L’implémentation devra relever les noms littéraux des clés de plist dans `chrome/common/mac/app_mode_common.h`/source associée avant d’écrire le parseur ; les symboles Chromium ne sont pas des clés JSON à inventer.

## Phase 1 — préflight sans installation

Cette phase sert l’objectif en rendant chaque effet attribuable au seul essai.

Interface prévue, à implémenter après revue :

`node scripts/qa-pwa-desktop/run.mjs --app-dir <checkout-buildé> --origin http://127.0.0.1:3017 --app-sha <40hex> --build-id <exact> --chromium-path <binaire-CfT> --playwright-path <module-existant> --out <dossier-neuf-hors-repo> [--execute] [--proof-timeout-ms 180000]`

Sans `--execute` : validation de configuration, fichiers et HTTP public seulement, **aucun navigateur/profil/installation**, résultat `PREFLIGHT_ONLY`, jamais PASS installation. Le harnais ne démarre ni ne stoppe le serveur HTTP : celui de root est explicitement externe. Refus d’origine distante, URL avec userinfo/query/hash, redirection hors origine, mauvais SHA/build-ID ou serveur absent ; pas de recherche d’un autre port. L’origine n’est pas un secret ; aucune lecture `.env`.

Avant `--execute` : vérifier Darwin, Node existant, binaire complet Chrome for Testing **156** et version plist, dépendance Playwright existante. Aucun téléchargement ni installation. L’inventaire initial identifie notamment CfT sous `chromium-1248` ; ces chemins sont arguments validés, non chemins de projet codés en dur.

Créer un dossier résultat unique mode0700 hors Git et un manifeste atomique0600. Lire manifeste réellement servi, contenu et hash, URL canonique/start_url/scope. À la base, `app/manifest.ts` contient `id:'/'`, `start_url:'/'`, `display:'standalone'` : résoudre les URL avec les règles du manifeste, ne jamais dériver l’identité du libellé Courant. Vérifier la page réelle et son marqueur de build ; pas de page synthétique substituée au produit.

Inventorier **avant lancement et installation** les bundles candidats des dossiers Applications utilisateur Chrome/Chromium/Canary existants, leur chemin réel, inode, hash plist, bundleID, AppID, URL et profil lorsqu’ils sont présents. Ne pas suivre de symlink ni parcourir les données de profils utilisateur. Préserver ce baseline privé. Refuser si identité AppID/origine candidate déjà présente dans un autre profil ou si inventaire d’un dossier candidat existant est impossible ; aucune tentative d’écrasement/réparation. Avant AppID connu, une correspondance d’URL suffit à bloquer conservativement ; dès AppID déterminé, refaire le contrôle de collision **avant install**. Aucun bundle existant n’appartient au test.

Créer un user-data-dir neuf par `mkdtemp` sous tmp système, mode0700, conserver chemin réel et inode. Ne pas redéfinir HOME, ouvrir le Chrome personnel, changer navigateur par défaut, login items ou autostart. Capturer l’intention durable avant chaque effet : lancement navigateur, installation, lancement app, uninstall.

## Phase 2 — lancement possédé et installation réelle

Cette phase sert l’objectif en reliant l’application au profil vierge et au binaire exact.

Choix prévu : processus CfT **spawn directement possédé**, headed, avec user-data-dir unique, `--remote-debugging-port=0` et adresse loopback. Lire uniquement SON `DevToolsActivePort`, vérifier endpoint loopback puis `playwright.chromium.connectOverCDP(endpoint)` et `browser.newBrowserCDPSession()` publics. Cette variante WebSocket est documentée par Chromium ; elle permet d’enregistrer immédiatement le vrai ChildProcess/PID, contrairement à des accès privés Playwright. Aucun port CDP fixe/exposé, aucun `--remote-allow-origins=*`, aucun attachement à un navigateur existant. Si cette voie refuse les commandes PWA privilégiées, résultat BLOCKED, pas modification de sécurité ni autre navigateur non revu. Un passage au pipe exigerait addendum/revue avant exécution.

Arguments interdits : headless, `--test-type`, `--app=`, override/mock d’intégration OS, flags contournant permission/signature/sandbox ou politique OS. Contrôler la ligne effective du processus, son binaire et profil, pas seulement les options JS. Aucun profil/session incognito pour l’installation, aucune permission accordée automatiquement. Aucun écran d’identification ni compte QA.

Lire version CDP et informations du manifeste via `Page.getAppManifest` sur la page du produit. Déterminer manifeste et AppID selon les champs réellement exposés et métadonnées documentées ; si AppID ne peut être déterminé avant l’installation, ne pas deviner : BLOCKED et addendum nécessaire. L’état du registre doit être absent avant install ; distinguer une erreur « non installée » attendue d’une commande absente/transport cassé. Un second appel de contrôle valide au domaine est nécessaire pour ne pas assimiler toute erreur à une absence.

Écrire `install_intent` puis `PWA.install` pour cette seule identité et origine ; résultat timeout/transport inconnu reste `install_outcome:unknown` et déclenche réconciliation dans le finally. Jamais recommencer aveuglément l’installation. Lire `PWA.getOsAppState`, puis observer un nouveau shim .app absent du baseline. Exiger cumulativement chemin réel, inode, plist parseable, exécutable présent, AppID exact, profil résolu exactement sous notre user-data-dir et URL dans le scope attendu. Un nom « Courant » ou une simple date récente ne suffit pas. Si plusieurs candidats, symlink ou attribution incohérente : INCOMPLETE et aucun effacement manuel.

## Phase 3 — fenêtre et relance

Cette phase sert l’objectif en démontrant l’ouverture de l’app installée au-delà d’une inscription de registre.

Régler `displayMode:'standalone'` par CDP sans émulation CSS. `PWA.launch` doit renvoyer un target de page attachable ; enregistrer targetId et windowId via `Browser.getWindowForTarget`. Vérifier URL/origine, document public produit réellement chargé HTTP200, titre cohérent, visibilité document, fenêtre avec dimensions positives non minimisée, `matchMedia('(display-mode: standalone)')` comme indice complémentaire seulement. Capturer page et métadonnées de fenêtre. Ne pas réclamer des permissions GPS/notifications.

Preuve OS indépendante requise : root constate la **fenêtre macOS réelle** via surface de computer-use déjà autorisée ou capture de fenêtre attribuée au PID/shim, sans contourner Screen Recording/Accessibility ni accepter automatiquement une demande OS. Relier cette preuve au target/window/PID et heure du lancement. Une capture Playwright de contenu seule ne montre pas les contours natifs. Si l’observation/capture OS n’est pas disponible, marquer cette étape BLOCKED et aucun PASS global ; conserver les preuves techniques déjà obtenues.

Fermer uniquement ce target installé, attendre sa disparition, garder Chrome/profil en vie ; relancer via **PWA.launch**, sans `page.goto` comme substitut. Exiger nouveau targetId, fenêtre autonome, mêmes identité/profil/shim et page produit. Ce test prouve une relance d’application pendant la même session navigateur, pas une survie au redémarrage de macOS ni un parcours manuel Finder/Dock. Aucune installation manuelle par dialogue n’est revendiquée.

## Phase 4 — arrêt, uninstall et preuves de nettoyage

Cette phase sert l’objectif en laissant les applications personnelles intactes.

Un finaliseur unique idempotent intervient sur succès, exception, SIGINT et SIGTERM. Arrêter immédiatement le scheduling, attendre/drainer les opérations mutantes en vol dans un délai borné, puis réconcilier les effets inconnus. Chaque continuation après await recontrôle le stop gate ; aucun nouveau spawn/install/launch après son activation. Un timeout JS ne signifie jamais que l’installation Chrome a été annulée. Avant d’affirmer absence, fermer le navigateur possédé pour empêcher un effet tardif et refaire l’inventaire disque.

Tant que la session possédée répond, `PWA.uninstall({manifestId})` de cette identité seulement. Aucun uninstall d’une identité sans intent journalisé dans ce profil neuf. Vérifier registre absent avec erreur attendue reconnue (jamais erreur de transport générique), targets installés disparus et shim test absent, baseline préexistant inchangé. Ne jamais boucler uninstall sur toutes les applications.

Quitter le processus enfant avec fermeture CDP/Playwright normale, attendre son événement exit, puis TERM/KILL seulement si PID, heure de départ et commande/profil prouvent encore qu’il appartient à cet essai. Ne jamais tuer un PID réutilisé, groupe global, parent ou processus trouvé par nom. Les éventuels shims détachés ne sont pas présumés enfants : découverte positive par chemin exécutable du nouveau bundle et identité de processus ; inconnu => manifest/INCOMPLETE. Pas de killall/pkill.

Aucun fallback `rm` sur bundle OS : en cas d’échec uninstall, conserver chemin/métadonnées/profil/manifeste et intervention root ciblée ultérieure ; jamais retirer une application préexistante ni un parent Apps. En cas de succès, effacer seulement le dossier de profil tmp créé par ce run, après sortie possédée et disparition des shims associés, avec contrôle realpath/inode/parent avant retrait. Les preuves hors profil restent conservées.

Les effets de localisation/icône des dossiers Apps et l’enregistrement LaunchServices sont des effets macOS réels potentiellement hors profil ; ne pas restaurer/effacer aveuglément ces métadonnées partagées ni reconstruire globalement LaunchServices. Comparer baseline/final. Toute modification préexistante inattendue ou résidu non attribuable empêche un statut « nettoyage complet ». Documenter séparément la disparition du bundle et les éventuelles traces système non observables ; aucune promesse de retour bit à bit du système.

## Résultats, tests purs et feu d’exécution

Fichiers privés prévus : `manifest.json` (intents, états/unknowns, PID/start-time/argv validés, profil, AppID, bundle/plist), `report.json`, `report.md`, captures. Écriture atomique avant effets, aucune valeur de cookie/token, aucun contenu utilisateur. L’origine et identité technique ne contiennent que données publiques. Rapport : app SHA/buildID/origine, harnais SHA, binaire/version/CDP, étapes de preuve, nettoyage et limites séparés.

PASS seulement si installation + shim + fenêtre OS attribuée + relance + uninstall + absence registre/shim/PIDs et baseline préservé sont tous prouvés. BLOCKED pour précondition/permission/surface indisponible ; FAIL pour assertion produit/harnais ; INCOMPLETE pour effet inconnu ou résidu. Un exit0 peut accompagner `--help`/préflight mais jamais être interprété comme PASS OS ; exécution incomplète/non prouvée sort non zéro.

Tests purs à écrire **après feu code**, exécutables sans navigateur, port, macOS UI ou réseau : manifeste relatif et mauvaise origine ; candidat préexistant/même AppID autre profil ; plist usurpé, préfixe de chemin trompeur, symlink, inode changé ; attribution exacte positive ; registre erreur transport ≠ absence ; ordre install-intent avant effet ; interruption pendant attente et installation tardive ; finaliseur réentrant unique ; aucune continuation/spawn après stop ; PID réutilisé/détaché inconnu ; uninstall échoué conserve profil ; flags interdits ; refus de PASS sans preuve OS, relance ou nettoyage. Injection d’interfaces de processus/CDP/fichiers, pas tests regex reproduisant l’implémentation.

Après revue du contrat : implémentation uniquement dans la propriété réservée, tests purs/syntaxe existante sans build ni nouvelle dépendance, commit/push et revue exacte du harnais par root. **Root seul** choisit puis exécute `--execute` sur build/origine figés. La présente livraison ne constitue ni feu d’exécution ni PASS installation.

## Implémentation après feu code root — 31 octobre 2026

Root a accepté `3a96df0` pour code/tests purs uniquement et exigé `--app-dir`. Le runner compare HEAD exact du checkout, `.next/BUILD_ID` disque et présence du même BUILD_ID dans HTML public servi ; aucune assertion sur la provenance d’un build sale ne dépasse ces contrôles. Il n’exécute pas le serveur externe et ne lui envoie aucun signal.

Compléments officiels effectivement lus avant le parseur : [clés plist littérales](https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/mac/app_mode_common.mm), [AppID Chromium double-haché](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/web_applications/app_id_helpers.cc), [conversion de hash en alphabet AppID](https://raw.githubusercontent.com/chromium/chromium/main/components/crx_file/id_util.cc), [erreur exacte de registre inconnu](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/devtools/protocol/pwa_handler.cc). AppID est le premier SHA-256 binaire re-haché, tronqué à 128 bits, hexadécimal converti a–p. La réponse documentée `Unknown web-app manifest id <url>` seule signifie registre absent ; fermeture/timeout/méthode absente restent des erreurs. Deux lectures du registre reconnu précèdent install, sans mutation préalable des préférences d’une application potentiellement existante.

Le baseline inclut les nouveaux shims potentiels et les métadonnées partagées des dossiers Applications/Chrome Apps existants (inode, permissions, hash des fichiers de localisation et attributs étendus). Si Chrome change un ancien dossier ou laisse un nouveau dossier partagé après uninstall, statut INCOMPLETE : aucun nettoyage global automatique. Les chemins, bundles et métadonnées ambiguës sont conservés dans le manifeste. Avant uninstall, attribution de shim, profil/inode actuel, process exact et intent durable sont de nouveau exigés, y compris après une installation incertaine. Avant fermeture Chrome, les descendants connus sont recensés ; un helper encore vivant empêche l’effacement du profil, sans tentative de le tuer arbitrairement.

### Handoff de preuve OS à root

Après `PWA.launch`, le runner écrit `phase: await-os-proof` et `proofRequest` dans le manifeste puis attend au maximum 180 secondes (configurable de 1 à 300 secondes). Pendant cette attente, root observe la fenêtre réelle via CUA existant ; aucun booléen CLI ne peut valider l’étape. Root dépose une capture PNG mode0600 directement dans le dossier résultat, puis écrit atomiquement `os-proof.json` mode0600 :

```json
{
  "kind": "macos-visible-window",
  "runId": "copier proofRequest.runId",
  "appId": "copier proofRequest.appId",
  "windowId": 123,
  "browserPid": 456,
  "nonce": "copier proofRequest.nonce",
  "observedAt": "date ISO de l'observation réelle après proofRequest.startedAt",
  "capture": "/chemin/absolu/du/dossier-resultat/os-window.png",
  "sha256": "hash SHA-256 du PNG effectivement observé"
}
```

windowId et browserPid sont les nombres exacts de proofRequest. Le PNG doit être attribuable à la fenêtre/process/application observés, pas à une capture générique de page. Le contrôle vérifie liaison, fraîcheur, hash et signature PNG ; la véracité de l’observation indépendante relève de root, elle ne peut être déduite cryptographiquement d’une image seule. Absence, preuve incorrecte, permission OS indisponible ou délai dépassé déclenchent le nettoyage puis BLOCKED si tout est propre, sinon INCOMPLETE.

### Validation livrée, sans navigateur

`tsx --test tests/qa-pwa-desktop.test.ts` : **19 tests purs PASS**. Ils exercent les helpers effectivement importés par le runner : préflight et mismatch checkout/build/HTML, identité et double-hash, collisions/attributions négatives, baseline, registre inconnu versus transport, autorité uninstall après résultat unknown, preuve OS liée/fraîche, refus de PASS incomplet, stop pendant intent, installation tardive/drain après timeout, finalisation unique, PID réutilisé et conservation du profil si nettoyage non prouvé. `node --check` passe sur les deux modules ; `--help` exécuté sans préflight ni effet OS. Aucun build/install de dépendance, préflight HTTP, navigateur, serveur ou installation PWA exécuté par l’agent. Les tests purs ne prouvent pas CDP runtime ni installation OS et ne couvrent pas une exécution réelle du finaliseur macOS ; cette limite reste ouverte pour revue puis recette root.

## Amendement transport A1 — DOCS ONLY, avant nouveau code/exécution

### Constat réel conservé

Root a exécuté le SHA `b5f1b399659e18b6630fba37bc57cdf86f5f649c`, préflight `/private/tmp/depannage-pwa-os-b5f-preflight`, puis essai `/private/tmp/depannage-pwa-os-b5f-live` sur application `be17b24adbc0035d1ba82347c09f9045bac03d71`, BUILD_ID `Aw8cMtqXjVJ3P-OZovGFa`, origine3017, CfT156.0.8078.4. Le rapport original reste inchangé : statut émis FAIL, erreur exacte `cdpSession.send: Protocol error (PWA.getOsAppState): 'PWA.getOsAppState' wasn't found`. **Aucun intent install**, uniquement création de profil/spawn puis retrait du profil possédé. Cleanup root prouvé : PID/profil/shims absents et baseline intact. Ce résultat constitue un blocage du transport du harnais, aucune preuve d’un défaut d’installabilité de l’application.

La classification à corriger sera **BLOCKED** lorsque la commande PWA requise est indisponible, à condition que le cleanup reste prouvé ; effet inconnu/résidu => INCOMPLETE garde priorité. Le fichier historique FAIL ne sera ni modifié ni présenté comme un essai réussi.

### Cause prouvée au tag exact du binaire

Sources officielles Chromium **156.0.8078.4** :

- [chrome_devtools_session.cc, lignes122–138](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/chrome/browser/devtools/chrome_devtools_session.cc) : `PWAHandler` n’est créé sur browser/page qu’avec `AllowUnsafeOperations()` (exception spécifique ChromeOS hors de ce Mac). Aucun flag de fonctionnalité PWA macOS n’est requis par ce code.
- [devtools_http_handler.cc, classe DevToolsAgentHostClientImpl, lignes310–368](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/content/browser/devtools/devtools_http_handler.cc) : le client WebSocket n’override pas ce droit. [Implémentation par défaut, lignes33–37](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/content/public/browser/devtools_agent_host_client.cc) : false. Attacher Playwright à un browser target via WebSocket ne change pas cette propriété.
- [devtools_pipe_handler.cc, lignes436–438](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/content/browser/devtools/devtools_pipe_handler.cc) : le pipe local hérité redéfinit `AllowUnsafeOperations()` à true. C’est une voie d’automatisation locale documentée, sans patch ni désactivation de politique/sandbox. Le [guide officiel](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/web_applications/docs/cdp-integration.md) recommande explicitement `pipe:true` pour les commandes privilégiées ; la mention générique de WebSocket ne garantit pas la disponibilité de PWA dans cette version.

La méthode `AllowUnsafeOperations` est une capacité de transport interne existante, **pas un flag CLI à inventer** et pas une autorisation de modifier le navigateur. Aucun `--enable-unsafe-*`, `--disable-web-security`, mode développeur ChromeOS, contournement OS ou modification produit ne sera ajouté.

### Protocole proposé après nouvelle revue root

Conserver le spawn possédé, le profil0700 et le port loopback éphémère existants ; ajouter uniquement `--remote-debugging-pipe` et les deux descripteurs hérités du processus possédé. **PWA passe exclusivement dans le pipe ; Playwright reste connecté au WebSocket du même processus pour les pages/captures**. Aucun serveur/bridge WebSocket additionnel et aucune API Playwright privée.

Cette coexistence est explicitement implémentée : [remote_debugging_server.cc GetInstance, lignes321–360](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/chrome/browser/devtools/remote_debugging_server.cc) démarre indépendamment le pipe puis le serveur HTTP si leurs deux paramètres sont présents, avec le contrôle normal de politique et de profil non par défaut. [devtools_agent_host.h, lignes66–69/140–142](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/content/public/browser/devtools_agent_host.h) fixe lecture enfant fd3 et écriture enfant fd4. Le parent Node écrit `child.stdio[3]` et lit `child.stdio[4]`. Format par défaut : JSON UTF-8 terminé par NUL, sans CBOR ; [PipeWriterASCIIZ/PipeReaderASCIIZ](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/content/browser/devtools/devtools_pipe_handler.cc).

Nouveau helper exclusif `scripts/qa-pwa-desktop/pipe.mjs` envisagé : transport local minimal `send(method, params)`, IDs incrémentaux, map de promesses en vol, parseur Buffer conservant les fragments jusqu’au NUL, corrélation stricte id/résultat/erreur, limite mémoire8MiB. Aucun log de trame complet et aucune reconnexion/réémission automatique. EOF, EPIPE, JSON invalide, trame surdimensionnée ou ID inconnu font fermer le transport et rejeter les attentes ; pas conversion en absence d’app. Les événements sans ID peuvent être ignorés sans modifier les pending. Écouteurs/FDs sont attachés dès spawn et fermés dans finally après fin du protocole, pas avant uninstall : la déconnexion du pipe appelle normalement CloseBrowserSoon.

Avant toute installation : comparer `Browser.getVersion` via les deux transports et vérifier `SystemInfo.getProcessInfo` via le pipe pour retrouver le PID browser possédé ; confirmer la même page/manifeste/identité déjà validés. Lire deux fois le registre PWA par pipe, avec la réponse exacte « Unknown web-app manifest id » ; commande absente reste BLOCKED. Passer ensuite les seules commandes PWA install/state/settings/launch/uninstall par le pipe. Conserver tous les contrôles actuels d’attribution, journalisation avant effets, collision, fenêtre réelle, relance et preuve OS root ; aucune réduction de critères.

Le stop gate et le suivi de promesse **originale** restent applicables au pipe. Un délai client ne supprime pas la commande en vol et ne prouve pas son annulation. Si pending non drainé : fermer uniquement le navigateur possédé, confirmer sa sortie, relire le disque puis INCOMPLETE/profil conservé si effet d’installation non résolu. Ne jamais réinstaller, ouvrir une nouvelle instance ou effacer un shim pour « réparer » automatiquement une issue inconnue.

### Tests purs exigés avant le prochain SHA exécutable

Ajouter à la suite existante : erreur **réelle** `PWA.getOsAppState wasn't found` => BLOCKED avec cleanupOK, -32601 protocole équivalent => BLOCKED pour les méthodes PWA seulement ; erreur applicative/incohérence d’identité reste FAIL ; erreur de transport ne devient jamais absence du registre ; cleanup incomplet garde priorité. Injecter des streams mémoire pour fragmentation multi-trames/UTF-8/NUL, réponses hors ordre, erreurs protocolaires, ID inconnu/dupliqué, événement, limite taille, EOF/EPIPE, stop avant envoi et fermeture pendant install ; vérifier zéro retry/duplicate et pending non oublié après timeout. Tester que les commandes PWA utilisent le pipe, les lectures de pages restent dans Playwright et les deux identités browser doivent correspondre avant install. Aucun navigateur ou pipe OS réel dans les tests purs.

### Alternative UI, uniquement si la voie officielle pipe échoue

Ne pas basculer silencieusement. Un second addendum devra décrire une pause durable root/CUA sur le **même** profil/Chrome possédé pour l’action native Installer depuis le menu navigateur, puis preuve shim/profil et fenêtre réelle. La désinstallation se fera seulement depuis l’entrée de l’app attribuée à cet essai, vérifiée par ses métadonnées ; pas manipulation d’une app de même nom d’un profil personnel. Absence de contrôle UI sûr => BLOCKED et manifeste conservé ; aucune simulation standalone ne remplace l’installation. Cette alternative n’est ni codée ni autorisée à l’exécution par le présent amendement.

**État A1 : documentation seule.** Le code b5f est inchangé, aucun nouveau test, navigateur, serveur, profil ni installation lancé par l’agent. Attendre revue root du protocole, puis feu code/tests purs ; root revoit le nouveau SHA avant tout nouvel essai réel.

### Livraison de code A1 après accord root

Root a donné feu code/tests purs après lecture de l’amendement `1b08a9c`. Implémentation limitée à la propriété réservée : pipe hérité fd3/fd4 dès spawn, Playwright WebSocket conservé ; `bindPwaChannel` vérifie les cinq champs version et l’unique PID browser de `SystemInfo.getProcessInfo` avant de fournir l’interface PWA. Le manifeste note le port de débogage possédé et la vérification pipe. Toutes les opérations PWA passent par cette interface ; la lecture de page, les fenêtres et captures restent via Playwright/CDP WebSocket. FD fermés après uninstall/arrêt possédé, jamais avant la tentative de nettoyage.

31 tests purs PASS (19 précédents +12 transport) ; syntaxe run/lib/pipe et diff whitespace valides. Couverture nouvelle : trames NUL fragmentées avec UTF-8, réponses hors ordre et événements, méthode réellement absente limitée à PWA => BLOCKED, réponses ambiguës/JSON invalide/UTF-8 invalide/IDs inconnus ou dupliqués/taille/EOF/EPIPE, absence de retry, promesse install suivie après timeout, stop empêchant launch, correspondance version/PID et routage exclusif par le canal vérifié. La fermeture logique sur erreur interdit tout nouvel envoi ; la destruction des streams reste au finally pour ne pas supprimer prématurément la possibilité de réconciliation.

**Aucun navigateur, serveur, profil, appel préflight HTTP ou installation lancé pour cette correction.** L’essai historique FAIL b5f et ses preuves root sont conservés sans modification. Compatibilité runtime du pipe, installation réelle, fenêtre OS, relance et nettoyage restent à éprouver par root après revue du nouveau SHA. Les tests mémoire ne constituent pas cette preuve.

## Amendement A2 — shim multi-profil et récupération du même essai — DOCS ONLY

### État réel et cause

Root a exécuté `be779172` (réordonnancement de possession du child avant initialisation pipe). Essai conservé dans `/private/tmp/depannage-pwa-os-be779-live` : run `badffa11-c02f-4c07-ad88-199162fa53ac`, début1793472729670, install intent1793472739690, `proofs.installed:true`, puis refus d’attribution du shim et INCOMPLETE. Pas de launch/fenêtreOS/relaunch prouvés. Browser5318 fermé ; helper5394 absent selon relecture root. Aucune nouvelle installation à effectuer avant récupération.

Bundle créé : `/Users/claudebrafa/Applications/Chromium Apps.localized/Courant — Dépannage électrique.app`. AppID `mflagdbdnhheocmiajkbgeklnokffeie`, URL `http://127.0.0.1:3017/`, browserBundle `com.google.chrome.for.testing`, bundleID `com.google.chrome.for.testing.app.mflagdbdnhheocmiajkbgeklnokffeie`. Son champ UserDataDir vaut exactement le root temporaire de cet essai suivi de `/-/Web Applications/_crx_mflagdbdnhheocmiajkbgeklnokffeie`. **ProfileDir est absent et le dossier `-` n’existe pas : cela est normal.** Le helper antérieur ne supportait que les shims mono-profil et doit être corrigé sans relâcher l’appartenance au user-data-root.

[Source officielle tag156.0.8078.4 web_app_shortcut_creator.mm](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/chrome/browser/web_applications/os_integration/mac/web_app_shortcut_creator.mm) : `GetMultiProfileAppDataDir` lignes362–381 remplace le nom du profil par le placeholder `-` en conservant Web Applications et le répertoire _crx_AppID. `UpdatePlist` lignes838–854 choisit cette forme pour IsMultiProfile et ne renseigne ProfileDir/ProfileName que dans l’autre branche. Ne pas créer de profil `-`, ne pas faire realpath de cette chaîne virtuelle et ne pas la transformer arbitrairement en Default.

### Garde supplémentaire de registre, effectivement observée

Le seul profil temporaire existant est `/private/var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-pwa-os-rrDlEC`, mode0700, inode127315203, naissance1793472729.6731448s. Lecture ciblée de SON Local State uniquement, sans dump des clés cryptographiques : `profile.info_cache` contient seulement `Default` ; `app_shims` contient seulement cet AppID ; `app_shims[AppID].installed_profiles` et `.last_active_profiles` valent chacun `["Default"]` ; Default/Preferences existe. Aucun `-` réel.

[Source officielle app_shim_registry.cc tag156](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/chrome/browser/web_applications/os_integration/mac/app_shim_registry.cc) : clés aux lignes39–42, `GetInstalledProfilesForApp`/`IsAppInstalledInProfile` lignes88–98 ; GetProfilesSetForApp lit installed_profiles et `GetFullProfilePath` lignes468–475 les résout dans le user_data_dir courant. `OnAppUninstalledForProfile` retire ce profil ; `SetAppInfo` supprime l’entrée lorsque la liste devient vide. Il s’agit d’une preuve ciblée d’installation dans Default, pas d’une déduction depuis le titre du shim ni d’une lecture non fiable de LevelDB.

### Attribution à implémenter après revue

Conserver la voie mono-profil strictement existante. Ajouter une voie **multi-profil explicite**, distincte de fullProfile : ProfileDir absent, UserDataDir brut égal à `path.join(root,'-','Web Applications','_crx_'+AppID)` sans normalisation de `..`, bundleID exact `browserBundleId+'.app.'+AppID`, CrBundleIdentifier exact, AppID/URL exacts, shim nouveau absent du baseline, plain realpath/inode/exécutable contrôlés. Ne jamais accepter un simple startsWith(root), un suffixe _crx différent, un chemin de root voisin ou un ProfileDir conflictuel.

Exiger en plus, pour ce harnais à profil unique : Local State plain dans CE root, `profile.info_cache` exactement Default, registre app_shims ne contenant que l’AppID attendu avec installed_profiles exactement Default ; last_active_profiles si présent doit être limité à Default. Default et Preferences sont plain, sans symlink ; aucun autre répertoire avec un Preferences de profil Chrome. L’existence d’autres dossiers techniques Chromium n’est pas un second profil. Toute pluralité/incohérence/inaccessibilité => INCOMPLETE et pas uninstall aveugle. Le registre disk sert à attribuer le placeholder ; après réouverture, ajouter la réponse PWA du profil courant. Aucune modification manuelle de Local State, LevelDB ou plist.

Pour les futurs essais, persister l’inode/naissance/mode du root dès création, et identité inode/hash du shim dès première attribution, avant effets suivants. L’ancien manifeste ne persistait pas l’inode de création : ne pas inventer cette preuve rétrospective. La reprise de CET essai doit être une adoption explicite root du chemin déjà journalisé, naissance dans la fenêtre du run, mode/propriétaire et registre exacts, avec nouvelle photo d’inodes/hash à l’entrée de récupération.

### Récupération prioritaire : une seule instance, même profil, zéro réinstallation

Proposer une entrée `--recover-manifest <manifest-original>` et un NOUVEAU dossier résultat privé lié au SHA256 de l’ancien manifeste et au runID. L’ancien rapport/manifeste reste intact et INCOMPLETE. Un mode récupération ne passe pas par mkdtemp/create-profile ni par PWA.install ; il interdit ces effets par construction. Il récupère le root, l’identité, le binaire et le baseline du seul manifeste journalisé ; aucun profil arbitraire fourni séparément. Préflight relit le bundle exact avec les gardes ci-dessus, le registre Default, le profil0700 sous tmp, l’absence d’ancien process lié à ce root, ainsi que le build/origine attendus. Un fichier SingletonLock n’est jamais supprimé manuellement : verrou vivant ou état incertain bloque.

Root pourra ensuite lancer le même CfT possédé avec **le user-data-dir existant et `--profile-directory=Default`**, pipe+port loopback, puis vérifier version et PID comme en A1. Ne pas ouvrir le shim par Finder pour amorcer cette reprise : cela pourrait choisir un autre navigateur/profile. La première commande PWA sera getOsAppState de l’identité attendue ; toute absence inattendue ou autre profil bloque et conserve les artefacts. Avant uninstall : relire registre disk/attribution/inode et vérifier la session possédée.

Par défaut récupération **cleanup-only** : après confirmation du registre PWA, désinstaller cette identité via PWA.uninstall, fermer le navigateur possédé, attendre ses helpers et relire l’absence du registre app_shims après flush, du shim et des PID identifiés. Si root choisit explicitement de poursuivre la preuve avant désinstallation, un mode `--continue-proof` utilisera uniquement l’app déjà installée : standalone/launch → pause preuve OS liée au NOUVEAU run de récupération → close/relaunch → finally uninstall. La preuve installation est alors reliée au premier essai et confirmée par les registres, sans prétendre avoir réexécuté install ou reclasser l’ancien rapport. Aucun nouveau profil, nouveau compte ou seconde application.

### Nouveau dossier Chromium Apps.localized

Le baseline original démontre son absence. Son contenu observé en lecture seule : le seul bundle du test, `.localized/fr.strings`, `Icon\r` (fichier vide avec métadonnées). Aucun autre bundle. La récupération pourra adopter **ce dossier exact uniquement**, enregistré par inode/naissance/parent et hashes de ces deux fichiers ; vérifier naissance pendant le run et parent Applications identique au baseline. Après uninstall confirmé et absence de processus : si le dossier ne contient plus que ces métadonnées générées et inchangées, retirer par unlink les seuls fichiers explicitement journalisés, puis `rmdir` .localized et `rmdir` ce dossier exactement. Aucune suppression récursive, glob ou parent Applications. Toute entrée supplémentaire, hash/inode changé, symlink ou erreur conserve le dossier et INCOMPLETE. Ne pas toucher Chrome Apps.localized préexistant ni son app Twilio. Aucune opération globale LaunchServices ; traces système non observables restent une limite explicitée.

Tests purs à prévoir après revue : placeholder multi-profil exact positif avec registre unique Default ; absence de registre/second profil/ID ou URL ou root voisin/normalisation `..`/ProfileDir contradictoire refusés ; ancien chemin mono-profil préservé ; recovery refuse manifeste sans intent, hash/source changé, profil hors tmp, inode nouveau ou process existant ; chemin récupération ne peut jamais installer ni créer un profil ; cleanup des seuls fichiers parent générés échoue fermé devant un fichier étranger. Revue root du nouveau SHA avant toute reprise réelle. **A2 ne modifie pour l’instant que ce contrat : aucune récupération, installation, suppression ou nouveau navigateur exécuté par l’agent.**

### Livraison A2 après feu code root

Mode ajouté : `--recover-manifest <original0600> --recover-sha256 <SHA256-original>` ; `--continue-proof` facultatif, `--execute` toujours indispensable. Sans execute : préflight seulement. La récupération est bornée par le code au runID et SHA be779 ci-dessus et au basename rrDlEC ; elle ne constitue pas un outil générique d’adoption d’un profil personnel. Elle exige registre unique Default, naissance/UID/mode/root tmp, absence de SingletonLock/process réutilisant ce root, attribution du seul shim et baseline initial intact. Le manifeste neuf lie sourceHash/sourceRunId et adoption actuelle d’inode. Enregistrement d’effets refuse `create-profile` et `install` en recovery, indépendamment des branches de contrôle.

Le profil est repris avec Default explicite ; un ancien DevToolsActivePort conservé n’est pas utilisé : attendre son contenu renouvelé après le nouveau spawn puis vérifier à nouveau versions et PID pipe. Avant uninstall, registre disk et shim sont relus. Après fermeture : attente bornée8s des helpers connus/shim, vérification du flush app_shims absent, puis retrait des seuls fichiers de localisation/icône dont inode/hash/contenu/attributs étendus correspondent à l’adoption ; unlink ciblé puis rmdir nonrécursifs, jamais retrait du bundle par filesystem. Inode des dossiers revérifié après journalisation. Tout contenu étranger ou changement conserve les artefacts et INCOMPLETE.

Le mode cleanup-only émet **RECOVERED_CLEAN** si tout a été retiré et relu, pas PASS installation/fenêtre. Avec continue-proof, les preuves OS/relance et le nettoyage restent tous requis pour PASS ; l’installation est explicitement issue du run historique lié. Ancien rapport INCOMPLETE inchangé.

Commande root après revue, compléter les arguments déjà validés du même build et module/binaire :

```text
node scripts/qa-pwa-desktop/run.mjs [arguments app-dir/app-sha/build-id/origin/chromium-path/playwright-path/out validés]
  --recover-manifest /private/tmp/depannage-pwa-os-be779-live/manifest.json
  --recover-sha256 <sha256 recalculé du manifeste historique>
  --execute
```

Root ajoute seulement s’il le choisit `--continue-proof --proof-timeout-ms 300000` pour constater la vraie fenêtre puis relance avant uninstall. Aucun nouvel essai normal avant cette récupération.

**39 tests purs PASS** :31 précédents +8 attribution/récupération (registre Default, placeholder strict, source/hash/intent, interdiction des nouveaux effets, adoption actuelle, uninstall lié, plan de dossier sans entrée étrangère, optionsCLI). Syntaxe et diff-check PASS. Ces tests n’exécutent ni navigateur, ni reprise, ni suppression OS, ni procédure filesystem réelle de retrait du dossier : cette dernière reste soumise à revue source puis recette root. Aucun appel préflight HTTP/serveur/navigateur/installation/suppression de profil ou de shim effectué par l’agent pour A2.

## Amendement A3 — SingletonLock périmé, avant correctif de code

La reprise6af a été bloquée avant spawn et création du dossier résultat : SingletonLock est un symlink de cible `mac-mini-de-claude.home-5318`, tandis que root a confirmé l’absence du PID5318 et de tout processus utilisant rrDlEC. Ce verrou conservé n’est pas une panne applicative. Le refus de tout lock de l’A2 est remplacé uniquement par la règle étroite suivante, autorisée par root : lire lstat/readlink **sans suivre** le lien dans le root déjà adopté ; exiger hostname exactement égal à os.hostname(), PID décimal exactement égal au browserPid5318 du manifeste historique approuvé et relecture process/PID absent. Aucun PID vivant, même réutilisé par un autre programme, n’est accepté. Autre host/PID, fichier ordinaire, erreur de lecture ou lien modifié => BLOCKED.

Snapshotter inode et cible du lien au préflight. Relire ce même inode/cible et l’absence du PID immédiatement avant le spawn contrôlé, après intent durable ; si le lock est apparu/disparu/changé entre ces lectures, arrêter sans mutation. Recontrôler stop gate après les awaits. L’absence de lock aux deux lectures est aussi admissible. **Aucun unlink, rm, rmdir ou remplacement de SingletonLock par le harnais/root** : Chrome du même profil gère lui-même son verrou périmé. Registre, hash source, attribution et adoption d’inodes restent inchangés.

Incident de pilotage communiqué par root : une sélection CUA prématurée a ouvert une autre instance CfT défaut PID9793, ensuite fermée par root après vérification PID/start/argv ; aucune suppression de profil ou connexion compte. Ne pas attribuer ce processus au run de récupération ni utiliser son profil. Root n’effectuera la prochaine sélection CUA qu’après phase await-os-proof et confirmation du nouveau PID possédé.

Tests purs requis : lock absent, stale même host/PID absent accepté ; PID vivant ou réutilisé, host incorrect, autre PID, fichier ordinaire et symlink altéré entre lectures refusés ; zéro opération de suppression du lock. Root a autorisé code/tests purs dans ces bornes après publication de cet amendement ; nouveau SHA à revoir avant exécution. Aucun navigateur lancé par l’agent.

A3 publié avant code au SHA `7e46968`. Correctif livré après feu code root : source browserPid5318 exigé, inspection injectée read-only du lock avec double lstat/readlink, relecture PID absent, snapshot durable du lock dans la récupération et comparaison après intent juste avant spawn. Les erreurs d’inspection sont BLOCKED ; aucun changement des gardes registre/profil/adoption. **43 tests purs PASS** (+4 scénarios lock, dont PID réutilisé et changement de lien), syntaxe et diff-check PASS ; aucun nouveau navigateur/serveur/préflight HTTP ni suppression de lock effectué par l’agent. Nouveau SHA soumis à revue root avant reprise réelle.
