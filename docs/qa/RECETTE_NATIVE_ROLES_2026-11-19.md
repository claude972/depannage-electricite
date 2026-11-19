# Recette des sessions natives — 19 novembre 2026

Sur simulateurs uniquement, avec les comptes synthétiques existants :

| Plateforme | Client | Artisan | Entreprise |
| --- | --- | --- | --- |
| iOS | PASS | PASS | PASS |
| Android | PASS | PASS | PASS |

Chaque passe couvre connexion, navigation et lecture de l’espace du rôle, arrêt/relance de l’application, restauration de la session, accès au profil et déconnexion. Le client couvre aussi l’ouverture et la fermeture de la feuille des adresses ; artisan : missions et devis ; entreprise : dossiers et sites. Ces résultats ne prouvent pas les écritures métier, tous les refus d’accès ni les autres variantes de chaque capacité.

## Candidats et preuves

Sources runtime locales : `236f4ca7a4ca10551f190bf8e36dcf69cc73dc8c` ; correction AppSheet conservée, navigation d’origine conservée. Les deux builds désactivent `EXPO_PUBLIC_HOME_SUPPORT_PREVIEW` pour retirer le délai illustratif. API : alias de recette `https://domdepannage-recette-20261112.vercel.app` (alias mutable ; les corrections D1/D3/D4/D5 ont été promues pendant cette séquence, sans modification du contrat de session).

Preuves hors Git dans le dossier parent `preuves/` :
- `ios-three-roles-final-20261119.redacted.log`, sortie XCTest 0, trois rôles réussis ; résultat détaillé privé conservé dans le disque de recette.
- `android-three-roles-current-20261119.log` et `.json`, trois résultats PASS ; captures `android-client-current-20261119.png`, `android-artisan-current-20261119.png`, `android-enterprise-current-20261119.png`.
- APK `livraison/domdepannage-android-recette-20261119.apk`, SHA-256 `8b88fe6ea0c3467754ef0494ed414db241833f5673acc5c5ac658be877591405`.

## Incidents de pilotage résolus

Sur iOS, la proposition système d’enregistrer le mot de passe empêchait le passage aux onglets. Le pilote choisit « Plus tard » ; aucune modification de navigation n’a été conservée et aucun mot de passe n’a été enregistré. Sur Android, la déconnexion artisan est sous la zone visible du profil : le pilote défile jusqu’au bouton. Ces deux incidents ne sont pas comptés comme défauts applicatifs.

La création native avec photo et les écritures suivantes restent en cours.

## Parcours avec photo : défaut D7 en cours de vérification

Android crée exactement un dossier `INT-0E073E` (UUID `0e073e8b-9b73-4cc2-be3d-7f7257415038`) à partir du formulaire natif avec une image explicitement synthétique. La photo est sélectionnée mais son envoi échoue ; deux reprises restent en échec et la relecture serveur montre zéro document. La demande elle-même reste persistée, état `requested`. Les comptes tiers et artisan non affecté reçoivent 404 sur son détail privé.

Diagnostic local sans données sensibles : échec à l’étape `upload`, statut transport 0. Le convertisseur Expo `convertFormDataAsync` installé rejette les parties React Native qui ne portent qu’une URI. Trois appels sont concernés : photo de demande, photo privée/partagée et photos avant/après du rapport. Une première adaptation par Blob construit depuis ArrayBuffer échoue également : le Blob React Native ne prend pas en charge ce constructeur.

Le correctif utilise un véritable `File` Expo, avec nom multipart stable redéfini, sans renommer le fichier temporaire ni changer sa responsabilité de nettoyage. Le Web conserve un Blob standard. Deux tests ciblés passent, dont une simulation qui interdit la construction du Blob natif ; TypeScript mobile passe. **La preuve sur appareils virtuels après cette dernière correction reste à obtenir : ne pas annoncer D7 résolu ni promouvoir le binaire intermédiaire.**

L’APK diagnostic et la première tentative ne sont pas des livraisons finales. Les APK générés ont été déplacés vers le volume externe Stockage 2, avec des liens aux chemins précédents.
