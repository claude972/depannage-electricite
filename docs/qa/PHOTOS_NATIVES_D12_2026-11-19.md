# D12 — rejet silencieux du sélecteur iOS

Après D8, la sélection de l’image PNG synthétique dans le simulateur iOS peut rejeter la promesse du sélecteur avec une `Error` dont le message est vide. La composante affichait directement ce message : aucune erreur visible et aucun envoi au serveur.

La sélection de photothèque est désormais centralisée pour la création de demande, les photos privées et les photos de compte rendu. Tout rejet produit un message explicite permettant de réessayer ou de choisir une autre image, sans chemin natif. Une annulation volontaire reste une annulation. La représentation compatible et la conversion JPEG de D8 sont conservées.

7 tests ciblés réussis : préparation, erreurs de sélecteur vides ou techniques, annulation/reprise, multipart natif/web et isolation du sélecteur de compte rendu. Le diagnostic temporaire ne journalisait ni compte ni jeton ; il a été retiré du code avant le candidat à livrer.

La cause de l’échec du fournisseur Photos du simulateur n’est pas encore établie. Cette correction de message ne prouve pas un téléversement iOS réussi. INT-0E073E contient toujours les deux photos Android lors de ce constat. Une nouvelle vérification avec un JPEG synthétique est en cours. Ne pas promouvoir la cellule iOS avant lecture du document créé au serveur.
