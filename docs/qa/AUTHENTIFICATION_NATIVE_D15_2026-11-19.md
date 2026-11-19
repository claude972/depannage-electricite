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

## Vérification en ligne du candidat

Candidat `60ifc6p9z` / `dpl_3Xkx26iiUgfRs8Zpf9zWE5AF1mFV` READY. Lectures notifications, résumé et préférences : 200 avec Bearer client. Absence de session et jeton invalide : 401 sur les quatre familles testées. Préférences sauvegardées et relues, conflit 409 sur ancienne version, puis état initial restauré. Ticket synthétique créé, lu et complété avec réponse ; tiers refusé en lecture (404) et écriture (403). Preuve `native-auth-d15-online-20261119.json`.

La clôture du ticket par le compte nommé « admin » dans le fichier de recette est refusée 403 ; `/api/workspace` confirme que ce compte a en réalité le rôle client. Ce refus est attendu. Le ticket `9610e14b-5c58-4032-933a-195216b60879` reste ouvert et sa résolution est confiée à la file opérateur existante, sans élargir les droits. La recette visuelle native et la promotion de l’alias restent à confirmer.

Après promotion, l’alias `domdepannage-recette-20261112.vercel.app` renvoie lui aussi 200 pour les préférences et la liste d’assistance avec le Bearer client (preuve `native-auth-d15-alias-read-20261119.json`). Les 21 contrôles métier du candidat réussissent ; le 22e contrôle initial était la clôture avec un compte incorrectement étiqueté admin, dont le rôle client a été confirmé et le refus documenté.
