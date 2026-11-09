# Dépannage électrique — application de recette

Application Expo SDK 58 pour iOS et Android. Cette version se connecte à un environnement de recette, avec une URL d’API HTTPS, l’URL Supabase correspondante et sa clé publique uniquement.

```sh
npm ci
cp .env.example .env.local
npm run typecheck
npx expo start
npx eas-cli@27.5.0 build --profile preview --platform all
```

Le profil EAS `preview` produit un APK Android et un build simulateur iOS. Les variables `EXPO_PUBLIC_*` du profil pointent vers la preview. Un appareil iOS physique nécessite une distribution signée distincte. Voir [le plan de livraison](../../docs/MOBILE_DELIVERY.md).
