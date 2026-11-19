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

## Parcours avec photo : défaut D7 et vérification progressive

Android crée exactement un dossier `INT-0E073E` (UUID `0e073e8b-9b73-4cc2-be3d-7f7257415038`) à partir du formulaire natif avec une image explicitement synthétique. La photo est sélectionnée mais son envoi échoue ; deux reprises restent en échec et la relecture serveur montre zéro document. La demande elle-même reste persistée, état `requested`. Les comptes tiers et artisan non affecté reçoivent 404 sur son détail privé.

Diagnostic local sans données sensibles : échec à l’étape `upload`, statut transport 0. Le convertisseur Expo `convertFormDataAsync` installé rejette les parties React Native qui ne portent qu’une URI. Trois appels sont concernés : photo de demande, photo privée/partagée et photos avant/après du rapport. Une première adaptation par Blob construit depuis ArrayBuffer échoue également : le Blob React Native ne prend pas en charge ce constructeur.

Le correctif utilise un véritable `File` Expo, avec nom multipart stable redéfini, sans renommer le fichier temporaire ni changer sa responsabilité de nettoyage. Le Web conserve un Blob standard. Deux tests ciblés passent, dont une simulation qui interdit la construction du Blob natif ; TypeScript mobile passe. Les preuves Android après correction figurent ci-dessous. La validation iOS et les photos de rapport restent à obtenir ; les binaires intermédiaires ne sont pas des candidats de livraison.

L’APK diagnostic et la première tentative ne sont pas des livraisons finales. Les APK générés ont été déplacés vers le volume externe Stockage 2, avec des liens aux chemins précédents.

### Reprise Android validée après correctif D7

APK `domdepannage-android-photo-fix-v2-20261119.apk`, SHA-256 `2da5dea06b953c9dbb9677e6d749bdc05aaf804d96b92854461c9d7d78860b2e`, sources `9117e14` : build Gradle réussi, certificat interne attendu. Après installation par-dessus le binaire précédent et réouverture de la demande, la photo en attente est récupérée. La relecture API confirme exactement un dossier correspondant et exactement un document JPEG (`8df0d915-0bde-4e38-94ab-372fc2bab18f`). Preuves : `android-photo-recovered-v2-current-20261119.png`, `native-create-readback-final-20261119.log`. La relecture du même dossier après relance ne propose plus de reprise photo. Les autres envois natifs et la validation iOS restent à compléter.

### Ajout privé Android et contrôle continu

Le sélecteur système ajoute ensuite volontairement une seconde photo au même dossier. La relecture API confirme deux JPEG, état `requested` conservé : `android-private-photo-readback-20261119.log` et `android-private-photo-added-current-20261119.png`. Le contrôle après relance utilise un dump ADB frais ; le pilote rejette désormais les dumps dont la racine est absente pour éviter de relire un ancien écran.

CI GitHub 211, commit `01e79c3087f02cb8859d3be5e9c488e2e8ebbcf9` : `check` et PostgreSQL isolé réussis. Deux reconstructions iOS ont échoué sur le délai de cinq secondes du scanner de modules Expo. Le scan isolé a ensuite réussi en 3,6 secondes ; la reconstruction suivante a réussi (sortie 0), avec le simulateur Android arrêté et sans modification des dépendances. La recette photo iOS de ce candidat reste en cours.

### D8 : fichier vide renvoyé par le sélecteur iOS

Le build iOS contenant D7 réussit et retrouve INT-0E073E par la recherche de commande (`ios-current-photo-picker-replay-20261119.redacted.log`, XCTest 0). La sélection de la fixture échoue ensuite avant l’envoi : le fichier ImagePicker `.png` existe mais mesure zéro octet. La relecture API conserve les deux JPEG Android. Capture `ios-photo-upload-result-20261119.png` ; test `ios-photo-upload-20261119` en échec, sans le compter comme validation. Le bundle testé porte le SHA-256 `84c8a9a64e4ec01a728a1b648c1b90172b0240cf8be4a6a4d6c4d73cb9079c22`.

Le sélecteur Expo installé prend par défaut le chemin de copie directe `.current` lorsque quality=1. Les trois sélections de bibliothèque demandent maintenant explicitement la représentation `Compatible`, qui passe par le décodage des données. Un helper commun prépare le JPEG et transforme les exceptions natives de conversion (qui exposaient un chemin local) en message invitant à réessayer. Six tests ciblés passent : préparation/réessai sans chemin local, multipart natif/web et ticket de reprise Android. TypeScript mobile passe. **Validation native du correctif D8 encore en cours.**

#### Candidat D8 et limite de la recette iOS

Sources `fdaa441`, CI GitHub 213 entièrement réussie (check et PostgreSQL isolé). Les builds iOS et Android réussissent ; bundle iOS `1fea31225017a6c016c4fc94c72e65bb22da495f3e5d02db04e0eb5038315fcc` ; APK `domdepannage-android-photo-compatible-20261119.apk`, SHA-256 `8c1eb5abac29796033ad3267361282e693a32d2d5e001e08e82612ba2a138f76`, certificat interne attendu.

Les essais iOS `ios-photo-compatible-20261119` puis `ios-compatible-continuous-20261119` sont interrompus par un crash de **Recette-Runner**, confirmé par `xcresulttool get test-results summary`. L’essai intermédiaire de sélection seul ne crée pas de document, sans erreur affichée : il ne valide pas l’envoi. La cause n’est pas assimilée à un plantage applicatif. La recette photo iOS reste ouverte ; le simulateur est arrêté pour poursuivre les parcours Android indépendants.

### Nouvelle chaîne native compatible avec la qualification artisan

Sur le candidat Android `8c1eb5a`, création UI du dossier synthétique `INT-44B1D4` (`44b1d49b-0a8a-46ba-bc79-05019b830587`), catégorie `socket`, description `RECETTE NATIVE 20261119 MATCH - prise synthetique, ne pas intervenir`. Relecture API : exactement un dossier, `requested` ; projection artisan : `eligible=true` et une offre pour cet identifiant. Le dossier précédent `INT-0E073E` de catégorie `outage` reste correctement exclu pour cet artisan qualifié uniquement `socket`.

Sans photo, l’interface ouvre directement le dossier : le pilote qui attendait la confirmation intermédiaire a été corrigé dans la recette, sans modification de l’application. Captures `android-socket-progress-20261119.png` et `android-socket-request-created-current-20261119.png`. La suite acceptation/devis/rapport reste en cours.

#### Attribution et devis Android

Sur INT-44B1D4, ouverture de l’offre par lien profond vers l’identifiant vérifié (la liste affiche les offres, mais la sélection d’une carte précise n’est pas couverte par cette étape). Acceptation réelle via le bouton natif : état `assigned`, lecture client et artisan affecté autorisée, tiers 404 (`android-match-assignment-readback-20261119.log`).

Le formulaire refuse l’envoi vide avec un message explicite. Une ligne synthétique à 100 € HT et TVA d’essai 8,5 % est ensuite envoyée par l’interface ; relecture : un seul devis `sent`, 10 850 centimes TTC, dossier `quoted` (`android-match-quote-readback-20261119.log`). Captures de validation et d’envoi conservées. Les taux utilisés sont des données de test, pas une validation de règles fiscales commerciales.

Le client accepte ce devis par l’interface Android : état `accepted`, montant accepté figé 10 850 centimes (`android-match-accepted-readback-20261119.log`). L’artisan signale son départ puis son arrivée et démarre l’intervention ; API : `in_progress`, `travel_stage=on_site` (`android-match-start-readback-20261119.log`). Le GPS et le calcul d’ETA ne sont pas couverts par ces déclarations de déplacement.

#### Rapport et clôture Android

Le rapport vide est refusé. Deux fixtures explicitement synthétiques et distinctes sont sélectionnées par la photothèque système ; les deux JPEG `avant.jpg` et `apres.jpg` sont persistés, puis associés à la révision du rapport. Preuve `android-match-report-readback-20261119.log`, captures `android-report-before-photo-current-20261119.png`, `android-socket-report-saved-current-20261119.png`. La clôture par l’interface passe ensuite le dossier à `completed`. Cela vérifie le troisième appel photo concerné par D7 sur Android, avec le candidat D8, sans conclure pour iOS.

#### Réception client et retour du paiement non payé

La signature est désactivée avant saisie du nom et accusé de réception. Le client signe ensuite ; la relecture confirme une réception correspondant exactement à la révision du rapport (`android-match-completed-receipt-readback-20261119.log`).

Le bouton Stripe TEST crée une tentative et ouvre Chrome Android. Le navigateur de cet émulateur demande sa première acceptation des conditions d’utilisation : cette étape n’est pas franchie. Retour système à l’application : « Règlement en attente de confirmation », puis vérification manuelle du règlement. Le dossier reste `completed`, un seul paiement `pending` à 10 850 centimes, `paid_at=null`, une tentative (`android-match-payment-attempt-readback-20261119.log`). **Aucun paiement réussi ni rapprochement de ce nouveau dossier n’est annoncé.** Le test de paiement réussi natif reste ouvert ; ce blocage d’initialisation du navigateur est distinct d’un défaut applicatif.

## Suite iOS — D12 et limite persistante de la photothèque

Le candidat D12 corrige le rejet vide du sélecteur : le simulateur affiche maintenant « Cette photo n’a pas pu être sélectionnée. Réessayez ou choisissez une autre image. ». Le JPEG synthétique échoue également, avant envoi. Lecture API du 19 novembre : INT-0E073E conserve exactement les deux JPEG Android. La tentative n’est pas une réussite iOS. Voir [D12 et hash du binaire propre](PHOTOS_NATIVES_D12_2026-11-19.md). Tous les diagnostics temporaires ont été retirés. Le candidat Android D8 demeure distinct ; aucun rebuild Android D12 n’est encore revendiqué.

## Complément paiement et retour iOS — 19 novembre 09:20

INT-44B1D4 payé en Stripe TEST depuis iOS après réalisation Android : serveur paid 10850 centimes, une seule tentative. Confirmation affichée dans le dossier natif. Le défaut D14 de fermeture du navigateur iOS est corrigé dans ceda27d et vérifié avec abandon d'un autre Checkout synthétique INT-A9155E : retour au dossier, une tentative pending et paid_at nul. Voir `PAIEMENT_NATIF_TEST_2026-11-19.md`. L'APK Android reste D8 ; aucun alignement binaire implicite.

## Modification du profil iOS — 19 novembre

Sur le binaire D14, le champ Prénom vidé désactive Enregistrer. Le compte client synthétique est modifié de « Audit Astra » vers « Audit Astra iOS » ; après enregistrement puis relance complète, le nom modifié reste affiché et `/api/workspace` confirme les champs exacts. Le nom initial est ensuite restauré par la même interface et relu au serveur. Journaux `ios-profile-edit-v2-20261119.redacted.log` et `ios-profile-restore-20261119.redacted.log` : réussis ; lecture `ios-profile-edit-readback-20261119.json`. Le premier test utilisait un intitulé d'accessibilité incomplet et a échoué avant toute modification ; le pilote utilise désormais l'intitulé complet déjà observé. Cela ne valide ni le carnet d'adresses Web, ni les autres préférences.
