# D15 — Notifications et assistance natives

## Défaut observé
Le 19 novembre, les lectures de `/api/notifications` et `/api/notifications/preferences` renvoient 401 sur la recette avec un jeton client synthétique valide. Les routes appelaient `authenticatedClient()` sans transmettre la requête : seule la session navigateur était prise en compte. Le même oubli existe sur les quatre opérations de liste, création, détail et réponse de l’assistance.

## Correction
Les neuf méthodes de cinq fichiers transmettent désormais `request` au helper existant. Le helper valide le Bearer auprès de Supabase et conserve ce jeton pour les politiques RLS. Les cookies web restent pris en charge ; un jeton invalide ne déclenche aucun repli sur les cookies. Les contrôles d’origine, droits, périmètres, versions et validations métier sont conservés.

L’inventaire des appels natifs a également vérifié les routes organisation, sites, artisan, administration artisan, messagerie, profil, contrats, approbations, suivi et aperçu entreprise : les méthodes utilisées transmettaient déjà la requête.

## Vérification locale
- 36 tests ciblés réussis : notifications, assistance, helper Bearer et contrats mobiles.
- Régression de transmission du jeton sur les cinq méthodes notifications et quatre méthodes assistance.
- Tests existants : cloisonnement du destinataire/créateur, autorisations opérateur, refus de session, paramètres invalides, conflits et erreurs.
- TypeScript racine : réussi.
- Preuves externes au dépôt : `preuves/native-auth-d15-20261119.log`, `preuves/native-auth-d15-tsc-20261119.log`.

## À terminer
Déploiement de recette, puis lecture/écriture avec les comptes synthétiques et refus entre comptes. Le succès local ne vaut pas validation en ligne ni recette visuelle native.
