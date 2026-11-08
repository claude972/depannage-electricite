# Levée déclarative d’une réserve ERP sur 81742d3

Chromium a exécuté la recette `2f2f304a2721` sur le commit `81742d3db1493af09ea4a850092964e68ac92d09`, avec attestation de la source Git et du build servi avant création des données de test. [Preview](https://depannage-electricite-ngl9mjr03-brafas-projects.vercel.app)

Le gestionnaire a ouvert une réserve depuis l’onglet « Contrôles ERP » à 390 px, puis renseigné la date et la note de levée. Le compteur est passé de 1 à 0. L’API et les événements d’audit ont conservé le même contrôle et deux versions distinctes. L’événement de création contient la réserve ouverte et l’événement de modification contient la date de levée. La reprise avec la première version a reçu HTTP 409.

Le lecteur a ouvert le contrôle sans action de modification et a reçu HTTP 403 sur le POST. Le tiers a conservé l’accès à son propre site et a reçu HTTP 403 en lecture et écriture sur le site de test de l’autre organisation. Le contrôle et les deux événements sont restés inchangés après les refus.

Les 36 étapes de nettoyage et 38 lectures indépendantes ont réussi. Cette preuve porte sur la date, la note et le journal déclaratifs. La documentation des modalités de preuve et d’attestation reste ouverte. [Décisions à compléter](../SPECIFICATIONS_A_COMPLETER.md)
