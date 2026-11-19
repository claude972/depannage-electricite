# D12 — rejet silencieux du sélecteur iOS

Après D8, la sélection de l’image PNG synthétique dans le simulateur iOS peut rejeter la promesse du sélecteur avec une `Error` dont le message est vide. La composante affichait directement ce message : aucune erreur visible et aucun envoi au serveur.

La sélection de photothèque est désormais centralisée pour la création de demande, les photos privées et les photos de compte rendu. Tout rejet produit un message explicite permettant de réessayer ou de choisir une autre image, sans chemin natif. Une annulation volontaire reste une annulation. La représentation compatible et la conversion JPEG de D8 sont conservées.

7 tests ciblés réussis : préparation, erreurs de sélecteur vides ou techniques, annulation/reprise, multipart natif/web et isolation du sélecteur de compte rendu. Le diagnostic temporaire ne journalisait ni compte ni jeton ; il a été retiré du code avant le candidat à livrer.

La cause de l’échec du fournisseur Photos du simulateur n’est pas encore établie. Cette correction de message ne prouve pas un téléversement iOS réussi. INT-0E073E contient toujours les deux photos Android lors de ce constat. Une nouvelle vérification avec un JPEG synthétique est en cours. Ne pas promouvoir la cellule iOS avant lecture du document créé au serveur.

## Vérification du candidat iOS

Build propre D12 installé, bundle SHA-256 `7f4240af329939fd790751aac3afe5139b2917eefbcb69089a48456a671662c5`. Sélecteur ouvert avec succès (`ios-final-picker-jpeg-open-20261119`, exit 0), JPEG synthétique sélectionné, mais aucun téléversement après 60 s (`ios-final-jpeg-selected-20261119`, échec). Le nouveau message explicite est visible dans `preuves/ios-d12-final-message.png`. La lecture serveur `ios-d12-final-readback-20261119.json` confirme toujours exactement deux photos Android. Aucun diagnostic temporaire dans ce binaire final.
