# Application iOS et Android

Base fonctionnelle Web `56ea166`. Expo SDK 58, Expo Router, React Native et TypeScript dans `apps/mobile`. Identité temporaire « Dépannage électrique », palette B, clair et sombre. Le dépôt et les règles Web restent la référence métier.

## Ordre de réalisation

1. Relier une session mobile chiffrée aux API existantes. Introduire le Bearer sur les routes réutilisées, sous RLS, avec tests d’authentification et de compatibilité SSR. Utiliser une preview dédiée et la base de recette.
2. Relier l’accueil client, la création de demande avec estimation, le suivi et les devis. Relier l’espace artisan et l’acceptation d’offre au serveur, puis le devis, les photos, le rapport, la signature et la clôture. Réutiliser les transitions serveur et les contrôles de paiement.
3. Étendre la couverture aux fonctions restantes des rôles, avec la liste exacte des écrans disponibles et des limites de recette. L’accès Web aux rôles entreprise et administration reste disponible. Le paiement et le SMS sont testés dans leurs environnements autorisés.
4. Vérifier TypeScript, les contrats, les refus d’accès et les parcours sur appareil. Produire un APK Android et un build simulateur iOS par EAS. Un build iPhone physique et la publication aux stores nécessitent leurs propres accès et vérifications.

Les artefacts d’essai sont associés au SHA de leur code et au déploiement de recette. Aucun secret serveur ou contournement d’accès Vercel dans l’application.
