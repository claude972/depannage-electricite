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
