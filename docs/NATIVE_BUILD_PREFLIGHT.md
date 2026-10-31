# Prévol comptes et outils natifs — préparation en lecture seule

31 octobre2026 UTC /30 octobre America/Martinique. Aucun scaffold, projet Expo/Supabase/EAS, build d’application, simulateur lancé, authentification interactive, achat, licence acceptée ou composant installé. Aucun fichier package.json/global skill modifié. Le propriétaire diffère Vercel et Stripe ; le codage reste à Claude à partir de00:00, Codex au pilotage.

## EAS27.2.0

- Pas de CLI globale `eas` trouvée initialement.
- CLI épinglée exécutée via `npx --yes eas-cli@27.2.0` avec cache **`/tmp/depannage-eas-npm-cache`**, sur le disque système interne ; aucune installation globale ni dépendance du dépôt ajoutée.
- Le premier chargement `--help` a déclenché une compilation de dépendances natives de la CLI via node-gyp. Après plus de3minutes, arrêt de ce seul arbre de processus de la mission, puis reprise avec `npm_config_ignore_scripts=true`. Il ne s’agissait pas d’un build de l’application.
- `--help` a ensuite réussi : `eas-cli/27.2.0 darwin-arm64 node-v24.15.0`. Cette exécution sans scripts d’installation prouve le fonctionnement du prévol/help, pas la disponibilité de toutes les fonctionnalités de build/credential de la CLI.
- `whoami --help` lu ; `whoami` lancé avec `CI=1` et stdin fermé, sans login ni navigateur.
- **Résultat compte : `whoami` exit0, connecté comme `claude972` ; comptes `claude972` et `claude972s-team`, rôle Owner sur les deux.** Aucun jeton affiché/lu dans les rapports. Aucun accès Apple/Google ni quota EAS inféré d’un compte connecté.

## Xcode/iOS réels sur la machine

- `xcode-select -p` : `/Applications/Xcode.app/Contents/Developer`.
- `xcodebuild -version` : **Xcode26.3**, build17C529.
- `xcodebuild -showsdks` : iOS26.2 et simulateur iOS26.2 ; autres SDK tvOS/watchOS/macOS présents mais hors périmètre.
- `xcrun simctl list devices available` a finalement réussi après interruptions de connexion CoreSimulator ; aucune réparation/restart/installation/launch effectuée. Runtime disponible **iOS26.3**, iPhone17Pro/17ProMax/Air/17/16e et plusieurs iPads, tous **Shutdown**.
- SDK Expo58 demande au minimum **Xcode26.4+** ; le Xcode26.3 présent est donc insuffisant pour affirmer un build local SDK58 compatible. Le fait d’avoir un runtime26.3 n’est pas une toolchain de compilation26.4. [Table officielle SDK58](https://docs.expo.dev/versions/v58.0.0/).

**Route de test envisageable :** un build simulateur iOS produit par EAS avec image compatible SDK58, puis installation sur un runtime local compatible, ou un simulateur EAS cloud. Compatibilité du binaire, exécution et accès cloud ne sont pas encore testés. L’image EAS SDK58 documentée est macos-tahoe-26.6-xcode-27.1 ; revalider l’image au build. La présence d’un simulateur local ne fournit ni signature device ni TestFlight. [Infrastructure EAS](https://docs.expo.dev/build-reference/infrastructure/).

**Limites appareil :** compte Apple Developer, profils/signatures, UDID autorisés et App Store Connect/TestFlight non vérifiés. Aucun IPA appareil signé/installable disponible ; un binaire simulateur n’est pas un IPA iPhone.

## Android réel sur la machine

- `ANDROID_HOME=/Users/claudebrafa/Library/Android/sdk` ; `ANDROID_SDK_ROOT` non défini.
- `adb version` : Android Debug Bridge1.0.41, build37.0.1-15733141, Darwin arm64.
- `emulator`, `sdkmanager`, `adb` présents ; aucune installation ou démarrage d’émulateur.
- `emulator -list-avds` : **Pixel_API_36**, **knowrok**. Configs lues : images Android36 arm64-v8a ; Pixel utilise google_apis_playstore, knowrok une image default.
- Plateforme installée : **android-36** seulement, images système Android36.
- Java : **Temurin17.0.20.1**, JAVA_HOME existant.
- Expo58 compileSdk37 / targetSdk36 ; plateforme37 non installée. SDK/NDK/Gradle complets nécessaires à un build local58 non vérifiés ; aucun composant ajouté. [Table officielle SDK58](https://docs.expo.dev/versions/v58.0.0/).

**Route de test envisageable :** APK arm64 compatible construit sur EAS puis installation/déroulé sur l’AVD Android36 existant, ou émulateur EAS cloud. La toolchain de build locale incomplète n’empêche pas conceptuellement de faire tourner un APK cloud compatible ; aucune exécution n’est encore prouvée. ADB est utilisable pour le prévol ; état de devices physiques, connexion et permissions non interrogés. Aucun compte Google Play ou keystore applicatif vérifié ; APK interne direct ne nécessite pas un déploiement Play public.

## Ce que l’on peut et ne peut pas annoncer

- **Disponible constaté :** Node24.15, CLI EAS27.2 help, Xcode26.3, runtime iOS26.3 arrêté, Android outils/AVD36/JDK17.
- **Pas prêt pour build local SDK58 sans compléments :** Xcode sous le minimum26.4, Android compileSDK37 absent.
- **Cloud possible sous réserve d’accès/quotas :** EAS Build sur images adaptées, runtime simulateur et test appareil selon signature. Pas de projet/build/session créé pendant ce prévol.
- **Produit à préparer :** voie directe Supabase Auth+SDK/RPC pour les fonctions non financières, évitant les endpoints Next cookie-only/protection Vercel ; gateway Edge revue pour uploads privés et maintien des contrôles d’autorisation/validation. Proposition détaillée ajoutée à `/tmp/DEPANNAGE_NATIVE_READINESS_PLAN.md`.
- **Auth email :** proposition conditionnelle native PKCE / Web SSR conservé, aucune config ni template changé. Les codes/verifiers/URLs de session ne sont pas journalisés.
- Stripe reste différé ; aucun binaire ne peut contenir une clé de service Supabase, secret Stripe ou bypass Vercel.

La découverte d’outils n’est pas une preuve d’application native livrée. Pour chaque route effectivement utilisée ensuite, rapporter SHA/buildID/runtime/plateforme et scénario exécuté.
