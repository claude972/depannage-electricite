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

## État courant
Correction déployée en recette, vérifiée avec Bearer et sur les écrans iOS/Android ci-dessous. Les notifications externes ne sont pas activées.

## Vérification en ligne du candidat

Candidat `60ifc6p9z` / `dpl_3Xkx26iiUgfRs8Zpf9zWE5AF1mFV` READY. Lectures notifications, résumé et préférences : 200 avec Bearer client. Absence de session et jeton invalide : 401 sur les quatre familles testées. Préférences sauvegardées et relues, conflit 409 sur ancienne version, puis état initial restauré. Ticket synthétique créé, lu et complété avec réponse ; tiers refusé en lecture (404) et écriture (403). Preuve `native-auth-d15-online-20261119.json`.

La clôture du ticket par le compte nommé « admin » dans le fichier de recette est refusée 403 ; `/api/workspace` confirme que ce compte a en réalité le rôle client. Ce refus est attendu. Le ticket `9610e14b-5c58-4032-933a-195216b60879` reste ouvert et sa résolution est confiée à la file opérateur existante, sans élargir les droits. La recette visuelle native et la promotion de l’alias restent à confirmer.

Après promotion, l’alias `domdepannage-recette-20261112.vercel.app` renvoie lui aussi 200 pour les préférences et la liste d’assistance avec le Bearer client (preuve `native-auth-d15-alias-read-20261119.json`). Les 21 contrôles métier du candidat réussissent ; le 22e contrôle initial était la clôture avec un compte incorrectement étiqueté admin, dont le rôle client a été confirmé et le refus documenté.

## Écrans iOS

`ios-notifications-d15-v2-20261119` réussit sur simulateur APFS : liste chargée, filtres Toutes/Non lues, ouverture des préférences, sauvegarde sans changement et confirmation « Préférences enregistrées. ». Les canaux e-mail/SMS restent indisponibles et explicitement expliqués. Le premier essai avait atteint la confirmation mais le processus Recette-Runner a quitté inopinément lors de la capture XCTest ; le rejeu sans cette capture passe. Capture indépendante `ios-notifications-d15-state-20261119.png`.

CI 224 (D15) et 225 (D16) : check et PostgreSQL isolé entièrement réussis.

## Assistance iOS depuis le dossier

Le parcours réel depuis INT-0E073E refuse les champs vides, puis enregistre et ouvre le suivi d’une demande synthétique (`ios-support-finish-d15-20261119`, XCTest réussi). Ticket `55790d99-f35e-4cc0-a2d1-ae9411210040`, un seul ticket avec le sujet exact, message et dossier lié relus au serveur, tiers 404 (`ios-support-d15-readback-20261119.json`). Les essais initiaux avaient buté sur les sélecteurs XCTest du champ multiligne ; ils n’avaient rien soumis. Le brouillon a été repris dans le formulaire existant avant l’envoi réussi.

L’ouverture directe du ticket précédent par simctl n’a pas été validée : premier essai arrêté par la confirmation iOS « Ouvrir », second essai restant sur l’écran précédent. Cela ne remplace pas le parcours interne de création/suivi réussi ; le lien externe reste à qualifier séparément.

Le lien externe d’assistance est finalement validé par `ios-support-deeplink-20261119` : confirmation système ciblée par son bouton accessible « Ouvrir », puis affichage du ticket attendu. Les deux premiers essais avaient mal piloté cette confirmation ; aucune correction de routage applicatif n’a été nécessaire.

Le premier ticket `9610e14b-…` est ensuite résolu par la file opérateur de recette : le client relit `resolved`, version 4 et trois messages (`native-support-resolved-readback-20261119.json`). Le refus initial du compte client étiqueté admin n’a pas été contourné.

## Écrans Android et clôture opérateur

Le binaire D15 passe la liste, les filtres Toutes/Non lues, les préférences et leur sauvegarde sans changement, puis l’ouverture directe et la lecture du ticket d’assistance (`android-notifications-support-d15-20261119.json`, journal `android-notifications-d15-20261119.log`).

Le second ticket créé depuis iOS `55790d99-…` est également relu `resolved` au serveur après traitement par la file opérateur (`ios-support-d15-resolved-readback-20261119.json`). Aucun droit supplémentaire n’a été attribué au compte client.
