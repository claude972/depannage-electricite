# Devis issu d'une grille publiée — recette API du 19 novembre 2026

Nouveau dossier synthétique INT-593638 sur le site bureaux existant de recette. Aucun travail réel, aucun accord client et aucun paiement.

- Création par le compte entreprise, acceptation par l'artisan éligible.
- Entreprise : autorisation explicite de la grille fictive « AUDIT R1217 grille », version 1.
- Artisan : lecture de la ligne publiée à 4 500 centimes HT ; application de quantité 2, TVA de fixture 8,5 %. Brouillon calculé depuis cette ligne, sans montant saisi par le client.
- Rejeu avec ancienne version du brouillon : 409. Compte client tiers tentant l'application : 403, sans modification.
- Envoi du devis synthétique réussi. Relecture entreprise : 9 765 centimes TTC ; référence persistante à la grille, sa version 1 et son intitulé.
- Compte tiers lisant la source du devis : 404.

Preuve externe : `preuves/grid-fixture-20261119.json`. Le premier harnais attendait 404 pour l'écriture du tiers ; la réponse contractuelle 403 a été conservée et la vérification corrigée, sans modifier le serveur.

Complément vérifié : une version 2 explicitement fictive a été publiée. La version 1 est remplacée dans le catalogue, mais la source persistée du devis, son montant de 9 765 centimes et son statut restent inchangés. L’interface entreprise affiche encore « Basé sur la grille AUDIT R1217 grille version 1 ». Écriture et lecture du tiers refusées (403/404). Preuves externes : `preuves/grid-version-closure-20261119.json`, `preuves/closure-ui.json`, `preuves/grid-frozen-v1-ui.png`. Aucun accord client ni paiement ; le dossier demeure `quoted`.
