# Dépannage électrique — application de recette

Application Expo SDK 58 pour iOS et Android. Cette version se connecte à un environnement de recette, avec une URL d’API HTTPS, l’URL Supabase correspondante et sa clé publique uniquement.

```sh
npm ci
cp .env.example .env.local
npm run typecheck
npx expo start
npx eas-cli@27.5.0 build --profile preview --platform all
```

Le profil EAS `preview` produit un APK Android et un build simulateur iOS. Les variables `EXPO_PUBLIC_*` du profil pointent vers la preview. Voir [le plan de livraison](../../docs/MOBILE_DELIVERY.md).

## Profils simulateur et appareil

```sh
npx eas-cli@27.5.0 build --profile simulator --platform ios --non-interactive   # simulateur iOS, sans signature
npx eas-cli@27.5.0 build --profile device --platform ios --non-interactive      # iPhone physique, diffusion interne
npx eas-cli@27.5.0 build --profile device --platform android --non-interactive  # APK signé pour un téléphone
```

- `simulator` reprend `preview` sous un nom explicite ; `device` vise les appareils physiques. Aucun profil de production ni d’envoi aux stores n’existe.
- iOS `device` n’utilise que des identifiants déjà enregistrés sur le compte Expo `claude972` pour `com.claude972.depannageelectrique.preview` : certificat de distribution, profil ad hoc et iPhone de test déjà inscrit. Avec `--non-interactive`, EAS échoue au lieu d’en créer.
- Android n’utilise que le keystore local existant : `credentials.json` et le fichier `.jks` qu’il désigne, à la racine de `apps/mobile`, tous deux ignorés par git. Rien n’est généré s’ils manquent.
- La version et les compteurs de build sont locaux (`appVersionSource: local`) : `version`, `ios.buildNumber` et `android.versionCode` de `app.json` suivent `shared/release.ts`. Augmenter les deux compteurs avant chaque build remis à un testeur ; `npm test` à la racine refuse un écart.
- `requireCommit` impose un dépôt propre ; le dossier `shared/` du dépôt doit faire partie du commit envoyé, Metro le lit (`metro.config.js`).
