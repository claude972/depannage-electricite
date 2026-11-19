# Préparation commerciale et contrôles du 19 novembre 2026

Statut : recette en cours, ouverture commerciale non validée. Consigne du propriétaire : créer les documents manquants comme brouillons modifiables et poursuivre exclusivement sur les appareils virtuels.

## État courant — 19 novembre, 15:19 UTC

- Photos iOS débloquées sur simulateur APFS avec le même binaire : JPEG/PNG, conservation, partage et retrait vérifiés. Les échecs HFS+ décrits plus bas sont historiques.
- Notifications, préférences et assistance vérifiées sur Android et iOS ; deux tickets résolus par la file opérateur et relus côté client.
- D17 corrige les messages entrants absents de l’écran natif ouvert. Réception et conservation du brouillon vérifiées sur Android et iOS reconstruits.
- D16 est sur l’alias de recette, candidat hbqmw2992 ; CI 227 réussie. Limite de preuve du formulaire final explicitée dans son rapport.
- La suite web v3 complète syndic, consommations et budget. D18 corrige le message de contestation en anglais ; déploiement et recette en ligne encore attendus.
- D20 : clavier iOS corrigé, envoi unique et connexion sans en-tête vérifiés sur simulateur ; non-régression Android et CI232 réussies.
- D18/D19 déployés et vérifiés sur n2scdfas8 (alias confirmé par Vercel). D21 appliqué à la recette : dates futures refusées 422 sans mutation, dates passées acceptées ; CI233 réussie.
- D22 : partage GPS synthétique Android et iOS, accès tiers refusé et arrêt en arrière-plan vérifiés ; itinéraire IGN réel reçu par API. ETA iOS visible puis retirée après arrêt ; carte encore à vérifier. Quota429 observé, disponibilité permanente non revendiquée.
- Aucun lancement commercial, paiement LIVE ou dossier store n’est déclaré validé. Les contrôles partiels restent signalés dans la matrice.

## Complément — 19 novembre, 12:35 Martinique

- Nouveau paiement TEST INT-D0FA86 : refus, reprise 108,50 EUR et retour succès natif vérifiés. Rapprochement API terminé : règlement10850c et commission1845c uniques, rejeux sans doublon, zéro règlement manquant.
- Disponibilité artisan iOS corrigée : interrupteur auparavant inactif et débordant ; nouveau binaire 9d1121c testé, serveur true → false → true.
- Corrections web O1/O2/O3/O7/O10 et D23 intégrées ; leur preview nn2dylxph est READY et l'alias est confirmé indépendamment par Vercel. Dix-sept tests ciblés passent localement, aucun ignoré.
- Protection additionnelle de la validation asynchrone des photos : passage à l'étape suivante et édition attendent la fin de la lecture. Test Chromium monté réussi ; cette protection additionnelle n'est pas encore déployée.
- Données privées : 36 lectures et refus API sur trois rôles ; aucune demande d'effacement. Les limites de chaque preuve restent indiquées dans les rapports.

## Documents livrés

Le dossier [lancement](../lancement/README.md) contient identité/offre, prix/commissions, conditions de service, confidentialité et exploitation/ouverture. Aucun de ces textes n'est chargé automatiquement par l'application. Les données réelles restent à renseigner ; aucune identité, couverture, garantie, commission ou assistance n'a été publiée.

## Corrections et preuves

- Fixtures du webhook de paiement et de la commission adaptées à la nouvelle relecture Stripe ; test de reprise après échec ajouté. Test webhook ciblé : 3/3. CI201 : contrôle applicatif réussi ; scénario signé E72 réussi ; suite SQL arrêtée par sa limite de dix minutes pendant des contrôles réussis. Limite portée à vingt minutes sans retrait de scénario.
- Test React monté du rattachement intégré depuis le commit Claude 07124e0b : 2/2 exécutés avec Chromium sur le mini, quatre mutations détectées. Sur CI sans Chromium, ces tests sont explicitement ignorés, jamais comptés comme exécutés.
- Next.js fixé à 16.4.6. Audit npm Web après mise à jour : zéro vulnérabilité. TypeScript et builds Turbopack/Webpack réussis localement. Sources des avis : [GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h), [GHSA-vc7v-qv4w-wrv8](https://github.com/advisories/GHSA-vc7v-qv4w-wrv8).
- Défaut du harnais local corrigé : 78 fichiers de tests convertissent désormais leurs URL en chemins avec fileURLToPath, au lieu de conserver %20 pour les espaces de « Stockage 2 ». Après correction, 2 116 tests passent sur cette copie ; les deux échecs restants (chemin relatif et métadonnées Git absentes de la copie) sont résolus et leurs suites ciblées passent : 22 succès, un contrôle privé ignoré. TypeScript passe après retrait du cache de types dev obsolète. Les 288 tests ignorés restent explicitement distincts des tests exécutés.
- Audit mobile : trois signalements modérés liés à la chaîne Expo/fingerprint/minimatch ; aucune vulnérabilité haute ou critique observée. La solution automatique proposée rétrograde Expo de 58 vers 52 : non appliquée. Une correction compatible reste à vérifier ; [avis minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249).

## Recette virtuelle supplémentaire

Android API36, compte client synthétique existant : demande planifiable créée depuis l'interface, numéro INT-ECF5C4, description explicite RECETTE-CODEX-20261119-ANDROID. Confirmation de l'estimation avant envoi ; dossier serveur affiché ; application arrêtée puis relancée et demande retrouvée. Adresse et téléphone fictifs, aucun paiement supplémentaire. L'APK préexistant pointe vers la preview bswte5fe6 : ce contrôle ne prouve pas un nouveau binaire de distribution ni le dernier backend.

Le simulateur iOS a ensuite relu ce même dossier Android avec le compte client, vérifié son identifiant et sa description, puis restauré la session après relance et déconnecté le compte : XCTest réussi.

Le client a annulé INT-ECF5C4 depuis Android après confirmation ; le statut Annulée est affiché, le bouton d’annulation disparaît et l’historique reste lisible.

La recette physique a été interrompue à la demande du propriétaire qui reprend son iPhone. Aucune validation physique complète n'est revendiquée.

## Conditions d'ouverture encore absentes

Voir l'[audit de configuration](AUDIT_EXPLOITATION_2026-11-19.md) pour les constats de recette datés : profil/garantie non publiés, couverture inconnue, barème fermé, environnement commercial et domaine absents, notifications externes inactives. Restent également Stripe LIVE distinct, preuve de restauration hébergée avec fichiers privés, réception d'alertes, liens Auth/e-mail distribués, signatures et dossiers des stores. Le paiement et le rapprochement TEST réussis ne remplacent pas ces preuves.

## Actualisation de la recette

- GitHub Actions run 44462059347 (commit 5e35d461) : contrôles applicatifs et suite SQL isolée réussis.
- Preview de sécurité READY : https://domdepannage-recette-20261112.vercel.app, déploiement dpl_G8TQpwy2NZj9PeLiq5AL1iCkxv9x. Rapport du mini : 35/35 contrôles administratifs, largeurs 1440 et 390, contrôle du refus client, aucune erreur JavaScript. Cela ne ferme pas tous les parcours des quatre rôles.
- Défaut tactile reproduit dans les fenêtres de profil natives. Ajout du pont RNHostView requis par Expo UI : Android vérifie la fermeture des fenêtres Adresses, Sécurité et Mes données et le lancement du navigateur par le lien du carnet. Le navigateur du simulateur affiche son premier démarrage : aucune gestion d’adresse web encore validée.
- iOS : après reproduction dans ios-sheet-fix-v2-20261119, le pont RNHostView et son enfant non aplati (collapsable=false) corrigent les appuis. XCTest ios-sheet-fix-v3-20261119 réussit : fermeture Adresses/Sécurité/Mes données, prénom vide interdit, fermeture du formulaire et déconnexion. Les nouveaux binaires ciblent l’alias de recette courant.

La demande du propriétaire de vérifier tous les parcours est suivie dans le plan complémentaire et la matrice des 76 capacités. Les brouillons commerciaux ne remplacent pas ces contrôles.

## Passe complémentaire des rôles natifs

Sur le binaire iOS reconstruit avec l’alias de recette courant et HOME_SUPPORT_PREVIEW=false, XCTest ios-three-roles-final-20261119 réussit pour client, artisan et entreprise : connexion, demandes/missions/devis/sites selon rôle, restauration de session après relance et déconnexion. La boîte système de sauvegarde du mot de passe est refusée par « Plus tard » ; aucun mot de passe n’est enregistré. Ces contrôles ne valident pas toutes les écritures métier natives.

Les correctifs web D1/D3/D4/D5 et la reprise réseau D2 sont documentés dans CORRECTIFS_PARCOURS_2026-11-19.md. Les tests GitHub du premier lot passent intégralement (run 206).

### Sessions Android et iOS

Les trois rôles passent sur les deux plateformes virtuelles : connexion, lecture, restauration après relance, profil et déconnexion. Voir [preuves et limites](RECETTE_NATIVE_ROLES_2026-11-19.md). La couverture complète des écritures métier natives reste à terminer.

## Actualisation — parcours métier et corrections D9 à D13

Le candidat Android D8 a parcouru INT-44B1D4 jusqu’au devis accepté, déplacement, rapport avec photos avant/après, clôture et réception signée par le client. Les montants et statuts ont été relus au serveur ; aucun travail réel. À cette étape Android, le paiement était encore pending après ouverture du navigateur à son premier démarrage ; le paiement iOS et le rapprochement réalisés ensuite sont documentés ci-dessous.

Les suites Web complémentaires vérifient photos multiples, remplacement/examen de justificatif, rendez-vous et conflits de version, réaffectation et retrait des droits de l’ancien artisan, retrait/réinvitation d’un membre et premières opérations de site. Le rapport intermédiaire est conservé dans RECETTE_WEB_SUITE_INTERMEDIAIRE_2026-11-19.md ; ses succès ciblés ne ferment pas les variantes manquantes de la matrice.

D9 ajoute le journal administratif ; D10 actualise les accès d’entreprise visibles ; D11 corrige une erreur Leaflet après sortie de la carte ; D13 expose la contestation d’avis artisan. Tous passent leurs tests ciblés locaux ; les validations preview D9, D10, D11 et D13 sont rapprochées dans la suite web v2. CI 215 et 216 entièrement réussies, y compris PostgreSQL isolé. D12 rend l’échec du sélecteur iOS explicite, mais le téléversement iOS reste non validé. Ces preuves ne suffisent toujours pas à déclarer une ouverture commerciale prête.

### Paiement natif — complément du 19 novembre, 09:20 Martinique

INT-44B1D4, réalisé sur Android, est désormais payé en Stripe TEST depuis iOS : 108,50 €, une seule tentative, état serveur paid. Confirmation également visible dans le dossier natif après fermeture manuelle du navigateur. Le retour iOS nécessite une correction D14 (feuille Safari restant devant) ; correctif validé sur simulateur par abandon du Checkout et retour au dossier sans fausse confirmation. Rapprochement TEST désormais attesté : 10850 c au registre, commission figée de 1845 c inscrite une seule fois ; rejeux sans doublon, aucun versement bancaire prouvé. Voir `RAPPROCHEMENT_INT_44B1D4_2026-11-19.md`. Preuves et limites dans `PAIEMENT_NATIF_TEST_2026-11-19.md`. CI GitHub 217 (D11), 218 (D12), 219 (D13) : check et PostgreSQL isolé réussis ; le SQL isolé ne vaut pas recette du Supabase distant.

### Correctifs D15 et D16, contrôle courant

D15 corrige neuf méthodes notifications/assistance qui ignoraient le Bearer mobile : 36 tests ciblés et TypeScript réussis, candidat 60ifc6p9z publié sur alias et 21 contrôles Bearer en ligne réussis. D16 supprime la note 5/5 présélectionnée et exige un choix explicite ; composant monté vérifié en 390/1280, TypeScript réussi. CI 222 (D14) entièrement réussie. Les deux correctifs sont poussés dans la PR 9 en brouillon. Android D15 est recompilé ; recettes natives en cours. Les photos iOS échouent également sur un simulateur neuf HFS+ ; une isolation APFS est préparée. Le lancement commercial reste non validé.

### Photo iOS : scénario nominal débloqué

À 14:00 UTC, le même binaire D14 ajoute correctement la photo JPEG synthétique sur un simulateur APFS dédié, conservé sur disque externe. La photo est relue au serveur et les comptes tiers/non attribués sont refusés. Les essais précédents HFS+ restent des échecs historiques ; ce succès nominal ne couvre pas encore tous les formats ni le rapport iOS. Voir `PHOTOS_NATIVES_D12_2026-11-19.md`.
