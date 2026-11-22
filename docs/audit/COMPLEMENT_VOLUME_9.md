# Audit documentaire — volume 9 FINAL

Lecture seule, 30 octobre 2026. Collecte pour l’audit consolidé ; aucun code applicatif, document du projet, service, base ou déploiement modifié. Ce rapport de travail est écrit uniquement dans /tmp/courant-audit/v9-report.md.

## Sources consultées

- Pièce jointe originale : `3-MAQUETTES_UNE_PAR_PAGE_VOLUME_9_FINAL.pdf`, chemin complet fourni par le propriétaire ; copie identique dans le workspace `MAQUETTES_UNE_PAR_PAGE_VOLUME_9_FINAL.pdf`.
- Les six pages ont été lues : couverture puis cinq pages titrées « Maquette finale 1 » à « Maquette finale 5 ».
- Le texte intégré a été extrait entièrement avec PyMuPDF ; il ne contient que la couverture et les titres des pages. Les cinq images JPEG intégrées (1168 × 784) ont été extraites et inspectées en pleine résolution avec view_image.
- `DESIGN.md`, skill PDF ; `docs/AUDIT_COMPLET_SPECIFICATIONS.md` ; `docs/audit/INVENTAIRE_SOURCES.json` pour les identités des images du corpus précédent.
- Les images des autres PDF du workspace ont été comparées par SHA-256, sans modification des fichiers sources.

## Résultat de la comparaison

**Six pages, cinq occurrences de maquettes, zéro nouvelle image distincte. Les cinq images sont des doublons stricts des octets JPEG déjà reçus.** Le volume ne contient pas de nouvelle maquette artisan, Super Admin, finance, planning ou logistique.

La couverture porte « MAQUETTES – VOLUME 9 (FINAL) » puis « Compléments finaux – Application de Dépannage Électricité ». Elle n’énonce aucune règle disant de remplacer la spécification finale du projet, ni de changer le périmètre ou la priorité des documents. Le mot FINAL dans le nom ou la couverture ne suffit pas à lui donner une telle autorité.

Identifiants d’audit proposés : **V9-C01 à V9-C05**, pour préserver les libellés imprimés « Maquette finale ». Ne pas les confondre avec M1–M5 ou les numéros absents 19–32.

## Catalogue intégral

| ID proposé | Page PDF | Titre imprimé | Acteur / écran | Fonctions visibles | Correspondance exacte antérieure |
| --- | --- | --- | --- | --- | --- |
| V9-C01 | 2 | Maquette finale 1 | Entreprise cliente bureaux / responsable technique — fiche Tour Horizon | Navigation bâtiment, étages/zones, interventions, maintenance, budget, documents, contacts, rapports ; identité et caractéristiques du bâtiment, surfaces/étages/occupant ; conformité/certification ; tableau étages/usages/zones/plans ; historique électrique ; maintenances et calendrier ; budget énergie consommé/engagé/restant/projection ; contacts avec téléphone/email ; bibliothèque PDF/DWG, dates et version. | V5-C01 page 2 ; également V6 page 2 et V7 page 2. SHA-256 e04e1da2cccbf7b6166964018c6821cf793d2e05c992629d0ebadf3a945ef518. |
| V9-C02 | 3 | Maquette finale 2 | Entreprise cliente ERP / responsable maintenance — fiche Hôtel Le Régent | Conformité par domaines ; audits électriques et réserves ; interventions planifiées/en cours ; alertes de sécurité et nouveau signalement ; budget annuel par catégories ; contacts ; archives PDF/DWG, rapports, plans et export ; niveau d’accès affiché. | M57, volume 4 page 10 = V5-C02 page 3 ; également V6 page 3 et V7 page 3. SHA-256 911af6b66be329f31277d8a9ee78ab5785f585095b65d85da960d9c18861ab6a. |
| V9-C03 | 4 | Maquette finale 3 | Entreprise cliente restauration — fiche Restaurant Le Gourmet | État cuisine/froid/éclairage, derniers contrôles ; interventions en cours/terminées ; budget HT engagé/restant et prochaine facture ; contrat/SLA ; contact sur site et horaires ; documents ; export et modification du site. | M50, volume 4 page 3 = V5-C03 page 4 ; également V6 page 4 et V7 page 4. SHA-256 4d6d6f7d8a5d78c7ea5d8a21d350cb5502d1e831f930bf6f56e3355a44beba15. |
| V9-C04 | 5 | Maquette finale 4 | Entreprise cliente restauration / responsable maintenance — dashboard RestauTech | Sites/interventions/tickets/équipements/contrats-SLA/rapports/alertes/paramètres ; KPI interventions, tickets critiques, conformité SLA, sites impactés ; recherche/filtres et état des restaurants cuisine/froid/éclairage ; indicateurs réponse/résolution/délais et tickets récents ; site actif. | M56, volume 4 page 9 = V5-C04 page 5 ; également V6 page 5 et V7 page 5. SHA-256 285d55ed909249edc6c88aa88a770299a1402aa2049c3007277bdec916ced0aa. |
| V9-C05 | 6 | Maquette finale 5 | Entreprise cliente bureaux / responsable patrimoine — dashboard Bureaux360 | Sites/bâtiments, interventions, maintenance, budgets-factures, énergie-environnement, alertes, rapports, documents ; filtres date/site ; KPI MWh, interventions/urgences, maintenance à 30 jours, budget engagé ; portefeuille bâtiments, surface, occupation, état ; budgets par bâtiment ; équipes/impact/ETA ; calendrier ; alertes énergie/équipements/rapports. | V5-C05 page 6 ; également V6 page 6 et V7 page 6. SHA-256 e19f56f3f3abe875376b869495a02e58ac7208629454523560ded9d76d4ce52d. |

## Conséquences pour l’audit du code

Ces cinq occurrences renforcent des références déjà connues ; elles ne créent pas cinq nouvelles fonctionnalités et ne doivent pas gonfler le nombre de besoins ni le taux d’achèvement. Les manques existants restent inchangés :

- ENT-04 / BE-33 : fiches sites détaillées, contacts et documents liés ; la carte actuelle nom/type/adresse/budget ne couvre pas ces vues.
- ENT-06/07 / BE-35 : équipements critiques, état des restaurants, tickets et SLA ; pas d’équivalent métier complet dans le code audité.
- ENT-08/09 / BE-36 : modèle bâtiment/étage/zone, occupation, mesures MWh et budget énergie, maintenance ; les références bureaux étaient déjà fournies par V5, leur code reste absent.
- ENT-10 / BE-37 : audits structurés, réserves, obligations et pièces ERP ; une note de registre ne certifie pas la conformité.
- ENT-11/14/15 : horloges SLA, budgets par période/catégorie et vrai reporting vertical ; ces règles ne sont pas davantage définies par la répétition des captures.
- Le back-office artisan reste référencé par les maquettes antérieures (M14/34–36/44/65/67), et Super Admin par M43. Aucun nouvel écran dédié à ces acteurs dans V9.

Aucune nouvelle API, signature ou règle métier technique ne peut être déduite de ces doublons. L’audit backend et ses limites de connexion restent ceux de la version de code inspectée ; je n’ai pas relu ni exécuté le backend ici.

## Précisions qui restent nécessaires, sans nouvelles questions artificielles

Les décisions déjà consignées Q-PDF-22 à 30 et V5-Q01 à Q10 restent pertinentes :

1. Sources réelles des consommations/occupations, unités et périodes ; prévisions et budgets énergie distincts des budgets interventions.
2. Modèle bâtiment/étages/zones/équipements/contacts et propriétaire des documents.
3. Référentiels et autorité de preuve pour conformité/certifications ; ne pas afficher BREEAM ou Conforme comme un calcul automatique non vérifié.
4. Calendriers, récurrences, statut des équipes, SLA, critères d’alerte et dates de validité.
5. Formats PDF/DWG/XLSX, tailles, sécurité, prévisualisation et archivage selon les catégories.
6. Périmètre électrique à maintenir : certains exemples ERP/bureaux montrent incendie, hygiène, extincteurs, climatisation ou ascenseurs. Ils ne remplacent pas la spécification électrique par une plateforme générale de facility management.
7. Noms, adresses, numéros, compteurs, certifications, prix HT et promesses 24/7 / quatre heures sont des exemples visuels, pas des données réelles ou engagements approuvés.

Aucun nouvel élément de contrat commercial, de monétisation, de finance, de logistique ou d’équipe prestataire n’est spécifié par le texte ajouté au volume 9.

## Comptage global de contrôle — information pour le parent

Au moment de la lecture, les neuf PDF étaient déjà copiés dans le workspace. Leur comptage mécanique donne **9 PDF, 102 pages, 93 occurrences d’images de maquettes et 63 SHA-256 d’images distinctes**. Ce comptage global ne remplace pas l’analyse sémantique des volumes 6–8 par les autres revues ; il permet de contrôler le futur manifeste du parent.

## Confiance et limites

Confiance élevée sur la lecture des six pages, les cinq écrans et les doublons exacts. Les images sont byte-identiques, donc aucun nouveau petit champ visuel n’a été ajouté par rapport aux références citées. Le contrôle porte sur les octets extraits des images, pas sur une ressemblance approximative après redimensionnement. Aucune modification d’app, aucun service cloud, aucune transaction ou test live exécuté. Aucun statut de conformité ou de livraison n’est déduit d’un écran source.

SHA-256 du PDF original : `a6ead871d34b1b02594c1062eb36179e23eec238db0f381f7f1d80518ece4b83`.
