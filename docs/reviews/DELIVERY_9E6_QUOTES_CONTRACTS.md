# Devis historiques et contrats cadres — 7 novembre 2026, Martinique

L’intégration `9e6d24f55d9625bd93813ac58e324044d58136a1` est déployée en preview `dpl_GqtHDXw1UQtkPx7aW6GBLWi7xrqP`. Le chargement public renvoie 200. La provenance confirme le commit, la branche et le build servi `oHAJxQYgMU7Xu6Qzsiull`. Les 28 tests ciblés, TypeScript strict et les deux jobs CI passent. [Preview](https://depannage-electricite-huai4bhrp-brafas-projects.vercel.app) · [CI](https://github.com/claude972/depannage-electricite/actions/runs/42434033531)

## Parcours vérifiés en ligne

- Les lectures client retrouvent 201 devis sur cinq pages, y compris une version hors des vingt révisions chargées au dossier. Le dossier est hors des cent premiers. Le point restitue les lignes exactes et la version courante. Un autre client reçoit 404. La lecture entreprise est limitée à l’organisation et au site autorisés.
- Chromium ouvre l’ancienne version client en lecture seule. Sur le même dossier, le devis courant est accepté via le bouton. Le POST porte l’identifiant exact et une nouvelle lecture confirme le statut accepté.
- L’API des contrats retrouve 101 contrats sur trois pages dans l’organisation A et son unique contrat ancien dans B. Le détail contient les conditions exactes. Un lecteur global y accède. Un membre limité à un site reçoit 404 pour cette lecture à l’échelle de l’organisation.
- En entreprise, le choix initial de l’organisation est exercé. Le lien direct d’un devis ancien chargé ouvre la bonne version. Le 101ᵉ contrat est ouvert puis archivé. Le détail reste affiché après la relecture et propose « Réactiver ». Le passage dans l’autre organisation efface le brouillon et affiche ses seules conditions. Le viewport mobile reste sans débordement.
- Le brouillon PWA est sauvé hors connexion, restauré au rechargement et repris dans le formulaire au retour du réseau. Seuls les trois fichiers publics hors ligne sont en cache et aucune écriture API n’est émise.

## Exécutions et nettoyage

Les deux essais groupés `59496cb589b8` et `d579ec225ce9` se sont arrêtés en cherchant le sélecteur d’organisation. Le pilote avait omis l’écran initial de choix imposé aux comptes de plusieurs organisations. Le second essai enregistre explicitement les contrôles API et la décision client passés avant cet arrêt. Les deux échecs restent dans les preuves avec 50 étapes de nettoyage et 115 lectures indépendantes par essai.

L’essai ciblé entreprise `cb352a7679ba` a réussi après le choix explicite de l’organisation. Les 50 étapes de nettoyage et 51 lectures indépendantes passent après fermeture du navigateur et arrêt du processus. Aucun compte de recette connu actif après ces contrôles.

La décision du gestionnaire sur le devis courant d’un dossier hors liste fait l’objet du lot suivant. L’activation des fournisseurs et la recette du compte propriétaire sont séparées.
