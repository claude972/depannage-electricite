# Devis issu d'une grille publiée — recette API du 19 novembre 2026

Nouveau dossier synthétique INT-593638 sur le site bureaux existant de recette. Aucun travail réel, aucun accord client et aucun paiement.

- Création par le compte entreprise, acceptation par l'artisan éligible.
- Entreprise : autorisation explicite de la grille fictive « AUDIT R1217 grille », version 1.
- Artisan : lecture de la ligne publiée à 4 500 centimes HT ; application de quantité 2, TVA de fixture 8,5 %. Brouillon calculé depuis cette ligne, sans montant saisi par le client.
- Rejeu avec ancienne version du brouillon : 409. Compte client tiers tentant l'application : 403, sans modification.
- Envoi du devis synthétique réussi. Relecture entreprise : 9 765 centimes TTC ; référence persistante à la grille, sa version 1 et son intitulé.
- Compte tiers lisant la source du devis : 404.

Preuve externe : `preuves/grid-fixture-20261119.json`. Le premier harnais attendait 404 pour l'écriture du tiers ; la réponse contractuelle 403 a été conservée et la vérification corrigée, sans modifier le serveur.

Limites : recette API, pas nouveau parcours visuel complet ; aucune version 2 publiée sur la grille partagée, donc la conservation après publication d'une nouvelle version reste à vérifier. Le dossier demeure `quoted` pour examen ultérieur.
