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
