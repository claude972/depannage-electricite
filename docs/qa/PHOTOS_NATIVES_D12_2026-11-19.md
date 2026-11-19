# D12 — rejet silencieux du sélecteur iOS

Après D8, la sélection de l’image PNG synthétique dans le simulateur iOS peut rejeter la promesse du sélecteur avec une `Error` dont le message est vide. La composante affichait directement ce message : aucune erreur visible et aucun envoi au serveur.

La sélection de photothèque est désormais centralisée pour la création de demande, les photos privées et les photos de compte rendu. Tout rejet produit un message explicite permettant de réessayer ou de choisir une autre image, sans chemin natif. Une annulation volontaire reste une annulation. La représentation compatible et la conversion JPEG de D8 sont conservées.

7 tests ciblés réussis : préparation, erreurs de sélecteur vides ou techniques, annulation/reprise, multipart natif/web et isolation du sélecteur de compte rendu. Le diagnostic temporaire ne journalisait ni compte ni jeton ; il a été retiré du code avant le candidat à livrer.

La cause de l’échec du fournisseur Photos du simulateur n’est pas encore établie. Cette correction de message ne prouve pas un téléversement iOS réussi. INT-0E073E contient toujours les deux photos Android lors de ce constat. Une nouvelle vérification avec un JPEG synthétique est en cours. Ne pas promouvoir la cellule iOS avant lecture du document créé au serveur.

## Vérification du candidat iOS

Build propre D12 installé, bundle SHA-256 `7f4240af329939fd790751aac3afe5139b2917eefbcb69089a48456a671662c5`. Sélecteur ouvert avec succès (`ios-final-picker-jpeg-open-20261119`, exit 0), JPEG synthétique sélectionné, mais aucun téléversement après 60 s (`ios-final-jpeg-selected-20261119`, échec). Le nouveau message explicite est visible dans `preuves/ios-d12-final-message.png`. La lecture serveur `ios-d12-final-readback-20261119.json` confirme toujours exactement deux photos Android. Aucun diagnostic temporaire dans ce binaire final.

## Reprise après redémarrage du simulateur

Le 19 novembre à 09:24, avec le binaire D14, la sélection du PNG synthétique échoue encore après redémarrage complet du simulateur. Le message D12 reste visible, l'application permet de réessayer et le serveur conserve exactement les deux documents Android. `ios-photo-after-reboot-v2-20261119.redacted.log`, capture `ios-photo-reboot-v2-state-20261119.png`, lecture `ios-photo-after-reboot-readback-20261119.json`. Le premier essai après redémarrage n'avait pas atteint la photothèque : saisie XCTest tronquée de la référence, puis pilote corrigé pour vérifier la référence complète avant recherche. La cause native reste ouverte ; aucun upload iOS n'est attesté.

## Isolation sur simulateur neuf

Le 19 novembre à 09:43, un second iPhone virtuel vierge, avec la même application D14 et une seule image JPEG synthétique importée, reproduit le refus après sélection de cette image. Le compte client est connecté et les deux photos Android existantes restent visibles ; l’application présente le message explicite et permet de réessayer. Aucune troisième photo ajoutée. Preuves : `ios-photo-fresh-open-v4-20261119` réussi pour ouverture du sélecteur, `ios-photo-fresh-jpeg-20261119` échoué pour ajout, capture `ios-photo-fresh-jpeg-state-20261119.png`. Cela écarte un simple état corrompu de la première installation mais ne permet pas de départager le runtime iOS et le fournisseur Photo/Expo. Le parcours photo iOS reste non validé ; les autres recettes continuent.

## Résolution du scénario nominal sur APFS — 14:00 UTC

Le même binaire iOS D14, sans modification du sélecteur ni des dépendances, réussit l’ajout de la même image JPEG synthétique lorsque le jeu de simulateurs est stocké sur APFS. Le volume APFS `DomDepannageSimQA` est une image disque dédiée de taille maximale 24 Go, stockée sur le second disque externe ; aucune partition du disque utilisateur n’a été reformatée. Le premier démarrage termine sa migration, contrairement aux essais HFS+ précédents. Ce résultat incrimine l’environnement de stockage dans les échecs observés ; il ne constitue pas une expertise exhaustive du runtime Apple.

- Simulateur : `31C2C400-536C-44E5-A9E5-B95E913424CD`, iPhone 18 Pro / iOS 27.2.
- XCTest `ios-photo-apfs-jpeg-20261119` réussi, trois photos affichées.
- Nouvelle photo `10428018-85f1-4809-9cca-dda77f85a9ef`, `image/jpeg`, créée à 14:00:16 UTC, relue dans INT-0E073E.
- Le tiers et l’artisan non attribué reçoivent toujours 404 sur le dossier.
- Preuves : `ios-photo-apfs-readback-20261119.json`, `ios-photo-apfs-success-20261119.png`.
- Le premier essai d’ouverture a été interrompu par la proposition système d’enregistrement du mot de passe ; « Plus tard » choisi, aucun mot de passe sauvegardé. Le second essai ouvre le sélecteur et le test de sélection réussit.

Limites : ce succès couvre l’ajout JPEG nominal ; formats supplémentaires, saturation et rapport d’intervention iOS restent à compléter. Les essais HFS+ échoués sont conservés comme preuves de diagnostic, sans les compter comme succès.

Le document JPEG iOS est également téléchargé par son lien privé autorisé : 37 012 octets, dimensions 640×480, signature JPEG valide, SHA-256 `f995038587dc33e66854d3019730df0152a6253e4419e2ce4bf3f019e347f25c`. Le tiers ne peut pas obtenir le lien (404). Aucun lien signé n’est enregistré dans le rapport. Preuve `ios-photo-apfs-download-20261119.json`.

## Variante PNG sur APFS

`ios-photo-apfs-png-20261119` réussit également : sélection de l’image PNG synthétique, préparation JPEG et quatre photos affichées. Document `9a6a9b44-cc93-41b6-ab84-ca4ce2f29e32` relu puis téléchargé : 37 623 octets, MIME image/jpeg et signature JPEG valides. Preuve `ios-photo-apfs-png-readback-20261119.json`. Le dossier contient maintenant deux photos Android et deux photos iOS ; l’ajout nominal JPEG et PNG est validé sur le simulateur APFS.

## Persistance et consentement de partage

Après relance de l’application, les quatre photos sont retrouvées. `ios-photo-sharing-20261119` vérifie l’annulation de la confirmation sans partage, puis la confirmation d’un partage. L’API propriétaire passe de 0 à 1 photo partagée ; tiers et artisan de test non éligible restent refusés (404). `ios-photo-unsharing-20261119` retire le partage et l’API confirme le retour à 0, les quatre documents étant conservés. L’accès d’un artisan éligible à cette offre n’est pas prouvé par ce compte non éligible. Preuves `ios-photo-share-before-20261119.json`, `ios-photo-share-confirmed-20261119.json`, `ios-photo-unshared-readback-20261119.json`.
