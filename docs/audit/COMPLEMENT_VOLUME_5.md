# Complément documentaire — volume 5

Annexe de [l’audit complet](../AUDIT_COMPLET_SPECIFICATIONS.md). Source ajoutée pendant la revue, conservée sans altération ; aucune fonction applicative n’est déclarée livrée par cette réception.


Lecture seule. Aucun code, aucune base, aucun fichier de documentation du projet ni déploiement modifié par cet audit. Le document ajouté complète la revue précédente ; il ne la remplace pas.

## Source et méthode

- Fichier reçu : `/tmp/codex-remote-attachments/01a18f4a-c5d0-7ed0-a011-384496267135/FBA56630-35CA-4290-AD9A-A6BAAD3D8E17/1-MAQUETTES_UNE_PAR_PAGE_VOLUME_5_MANQUANTES.pdf`.
- Nom de copie annoncé par le parent dans le workspace : `MAQUETTES_UNE_PAR_PAGE_VOLUME_5_MANQUANTES.pdf`.
- 11 pages : couverture p1 ; **10 maquettes complémentaires numérotées 1 à 10**, pp2–11.
- Texte intégré de toutes les pages lu par PyMuPDF ; toutes les images intégrées extraites et inspectées. Zoom pleine résolution des trois nouveaux écrans.
- Images de revue : `/tmp/courant-audit/volume5-images/`.
- Comparaison des SHA-256 des images JPEG intégrées avec les 56 images de la revue précédente : **7 doublons stricts**, **3 nouvelles images**.
- Le volume n'attribue PAS les numéros 19 à 32 à ses écrans. Les anciens numéros 19–32 demeurent non fournis/non identifiés ; ne pas les réinventer à partir du titre « manquantes ».
- Ensemble documentaire désormais : **5 PDF, 71 pages, 66 occurrences de maquettes (56 initiales + 10 complémentaires), 59 images distinctes par SHA-256 exact**. Les variantes sémantiquement similaires parmi les anciennes 56 ne sont pas fusionnées par cette mesure.

## Catalogue des dix écrans complémentaires

| Référence stable | Page PDF | Acteur et surface | Fonctions visibles | Rapport aux sources précédentes |
| --- | --- | --- | --- | --- |
| V5-C01 | 2 | Entreprise cliente bureaux / facility management, fiche de site « Tour Horizon » | Navigation Vue d'ensemble, Bâtiment, Étages & Zones, Interventions, Maintenance, Budget, Documents, Contacts, Rapports ; identité bâtiment/photo/adresse/surface/année/type/nombre étages/occupant ; conformité et certification ; tableau étages/usages/surfaces/zones et lien plan ; historique électrique ; maintenance planifiée/calendrier/prochaine intervention ; budget électrique annuel, consommé, engagé, restant, projection fin d'année ; contacts avec fonctions et appel/email ; documents PDF/DWG et bibliothèque ; site actif, date et version. | **NOUVEAU** : première fiche explicitement dédiée à un bâtiment de bureaux dans les sources reçues. |
| V5-C02 | 3 | Entreprise cliente ERP, fiche hôtel Le Régent | Conformité par domaines, audits, alertes/sécurité, interventions, budget détaillé, contacts clés, archive de documents et export. | **DOUBLON STRICT** de maquette 57, volume 4 p10, image identique par SHA-256. |
| V5-C03 | 4 | Entreprise cliente restauration, fiche Restaurant Le Gourmet | Cuisine/froid/éclairage, derniers contrôles, interventions, budget HT et prochaine facture, contrat/SLA, contact et documents. | **DOUBLON STRICT** de maquette 50, volume 4 p3. |
| V5-C04 | 5 | Entreprise cliente restauration, dashboard RestauTech | Sites, interventions, tickets, équipements, contrats/SLA, rapports, alertes ; KPI et état des restaurants ; indicateurs SLA et tickets récents. | **DOUBLON STRICT** de maquette 56, volume 4 p9. |
| V5-C05 | 6 | Entreprise cliente bureaux, dashboard « BUREAUX360 » | Navigation Sites & Bâtiments, Interventions, Maintenance, Budgets & Factures, Énergie & Environnement, Alertes & Notifications, Rapports & Analytics, Documents ; date et site ; KPI sites gérés, consommation électrique mensuelle MWh et tendance, interventions/urgences, maintenances à 30 jours, budget total engagé ; liste bâtiments/ville/surface/taux d'occupation/état/actions ; budget par bâtiment engagé/restant ; interventions en cours avec impact par étage ou ETA/équipe sur place ; calendrier maintenance ; alertes de surconsommation, équipement à remplacer et rapport disponible. | **NOUVEAU** : premier dashboard explicitement consacré aux bureaux dans les sources reçues. |
| V5-C06 | 7 | Entreprise cliente ERP, dashboard SafeERP | Établissements, conformité, interventions, audits, signalements, documents, rapports, KPI et courbes. | **DOUBLON STRICT** de maquette 37, volume 3 p6. |
| V5-C07 | 8 | Syndic, dashboard SyndiPro | Immeubles, budget, alertes, interventions, fournisseurs, copropriétaires, assemblées, documents et paramètres. | **DOUBLON STRICT** de maquette 13, grand format p13. |
| V5-C08 | 9 | Syndic / approbateur entreprise, détail d'approbation d'un devis | Navigation propriétés, fournisseurs, devis, appels de fonds, assemblées, documents, communications ; retour liste ; référence, propriété/adresse, fournisseur et lien fiche, réception, description, validité, pièces jointes, montant TTC/TVA ; choix Approuver/Refuser ; commentaire facultatif compteur 500 ; bouton Enregistrer ma décision ; historique daté/horodaté avec statut, acteur, rôle et commentaire ; mention de traçabilité et sécurité. | **NOUVEAU** : écran de décision détaillé qui précise le workflow au-delà du simple seuil et bouton. Le titre imprimé « Approvision d'un devis » semble une erreur textuelle, l'intention d'approbation est étayée par les boutons et la navigation ; ne pas en déduire un module d'approvisionnement distinct. |
| V5-C09 | 10 | Syndic, fiche résidence Jardins d'Azur | Lots, copropriétaires, recouvrement, exercice/budget, interventions, contacts, archives/PV AG, export et notifications. | **DOUBLON STRICT** de maquette 16, grand format p16. |
| V5-C10 | 11 | Syndic, nouvelle demande | Sélecteur immeuble/site, type de problème, description, quatre urgences, impact budgétaire/politique de coûts, annuler/créer. | **DOUBLON STRICT** de maquette 55, volume 4 p8. |

## Détails des trois nouveaux écrans et implications fonctionnelles

### V5-C01 — fiche bureaux, p2

**Présentation du bâtiment** : photo et adresse, surface (m²), année de construction, type Bureaux, étages + RDC, occupant principal. Certification d'exemple « BREEAM Very Good » et surface certifiée, statut conformité. Ce badge est une donnée documentaire à attester, pas une conformité à calculer ou promettre automatiquement.

**Structure spatiale** : étages 12/11/10/9/8/7 à 1/RDC ; usages direction/départements/plateformes/bureaux/accueil ; surfaces ; zones A/B/commun ; lien « Voir le plan » et note de plan interactif dans Bâtiment. Le modèle simple `site` ne représente pas ce niveau de structure à lui seul.

**Interventions et maintenance** : historique avec date/type/détail/statut, certaines interventions localisées par étage/zone/local électrique/salle serveurs ; total sur 12 mois ; tâches de maintenance avec date, nom et localisation, calendrier, prochaine intervention et horizon 60 jours. Les exemples BAES/TGBT/UPS précisent la structure des équipements mais ne fixent pas la taxonomie finale.

**Budget énergie** : année sélectionnable ; budget annuel 215 000 € ; consommé 126 540 € (58,9 %), engagé 18 650 € (8,7 %), restant 69 810 € (32,5 %), projection fin d'année 205 000 € ; source indiquée « Factures & contrats énergétiques ». Il ne s'agit donc pas seulement d'additionner des devis d'intervention. Les pourcentages totalisent 100,1 % par arrondi, sans contradiction majeure.

**Contacts/documents** : rôles responsable technique, maintenance, électricien titulaire, achats ; téléphone/email/actions ; rapports annuels, plans d'étages, contrat énergétique, schéma électrique DWG, certificat de conformité ; taille/type/date et bibliothèque/historique. DWG est visible dans la source alors que les formulaires d'autres maquettes annoncent PDF/JPG/PNG : définir les règles de fichiers par catégorie.

### V5-C05 — dashboard bureaux, p6

**Portefeuille immobilier** : six sites gérés, tableau partiel de cinq bâtiments visibles avec lien « Voir tous les sites » ; ville, surface, taux d'occupation et état. Le chiffre six contre cinq lignes n'est pas nécessairement une contradiction : l'écran peut être une liste résumée.

**Énergie** : indicateur de consommation mensuelle en MWh, variation par rapport au mois précédent, entrée Énergie & Environnement, alerte de hausse par rapport à moyenne hebdomadaire et rapport de performance énergétique disponible. Besoin de définir source/compteur, unité, fréquence et agrégation ; aucune intégration de compteur ne peut être déduite comme déjà définie.

**Maintenances** : compteur des maintenances des 30 prochains jours, liste datée/calendrier, type préventif ; exemples extincteurs/climatisation/ascenseurs au-delà du strict dépannage électrique, à réconcilier avec le périmètre final.

**Pilotage d'incidents** : interventions en cours, urgences, bâtiments et étages impactés, estimation d'intervention ou présence d'équipe sur site ; notifications classées Élevée/Moyenne/Info et horaires relatifs. La définition de ces niveaux et des émetteurs reste ouverte.

**Budgets** : engagement total de portefeuille et taux du budget annuel, déclinaison par bâtiment engagé/restant ; année 2025 affichée dans les exemples, à rendre paramétrable plutôt que coder une année fixe.

### V5-C08 — approbation détaillée, p9

**Dossier décisionnel** : référence DEV-2024-0876, immeuble/propriété, fournisseur avec lien vers sa fiche, date de réception, description, validité du devis, PDF de 2,4 MB, montant TTC 18 900 € avec TVA 10 % incluse. Ce sont des données d'exemple.

**Décision en deux temps** : choix Approuver ou Refuser puis Enregistrer ma décision ; commentaire explicitement **facultatif** et limité visuellement à 500 caractères. L'obligation d'un motif de refus est une règle à décider : elle n'est pas portée par ce texte source.

**Historique** : dates et heures, statuts successifs, identité et rôle (Système, Trésorière, Administrateur), commentaires. Statuts visibles : Soumis ; En attente d'approbation (l'image contient le mot « approvision ») ; En cours d'examen ; Complément d'information ; Information reçue. Ceci suggère un aller-retour d'information avant décision finale, pas seulement pending/approved/rejected.

**À spécifier** : qui peut examiner, demander des informations, répondre, réviser le devis, approuver/refuser ; rôle de la trésorière ; contrôle de validité et version jointe ; pouvoir sur devis expiré ; nécessité de revalider après modification du montant ; journal immuable ; éventuelles étapes multiples et délégations. Ces points ne sont pas résolus par la présence de l'écran.

## Corrections nécessaires au rapport initial

1. Remplacer « pas de maquette dédiée bureaux fournie » par : **absence dans les quatre premiers PDF, désormais comblée visuellement par V5-C01 et V5-C05**. Ne pas conserver cette absence comme lacune actuelle des sources.
2. Le manque de modèle de données, de collecte énergétique, de rôles et de règles métier reste réel : une maquette apporte la cible visuelle et les champs, pas les contrats techniques ou les définitions de calcul.
3. L'approbation syndic possède désormais une cible de détail plus précise : V5-C08. Mettre à jour les critères vers dossier complet, pièces, validité, examen/compléments et historique acteur/horodatage.
4. Les maquettes originales 19–32 restent non identifiées. Ces dix complémentaires ne doivent pas être renumérotées arbitrairement en 19–28 ni présentées comme les quatorze anciennes manquantes.
5. Ne pas compter les sept images dupliquées comme sept nouvelles fonctionnalités ou sept écrans à développer une seconde fois.
6. Aucun nouveau dashboard artisan ni Super Admin dans V5 : leur référence reste respectivement les maquettes artisan des volumes précédents et maquette 43.
7. Les trois nouveaux écrans renforcent la distinction **back-office d'entreprise CLIENTE B2B/syndic** ; ils ne définissent toujours pas complètement un back-office d'entreprise PRESTATAIRE employant des artisans, ni les permissions fines de l'EXPLOITANT plateforme.

## Nouvelles précisions et questions de spécification

| ID complément | Domaine | Information nouvelle | Décision encore nécessaire |
| --- | --- | --- | --- |
| V5-Q01 | Bâtiment | Adresse, photo, surface, année, étages, occupant, certification | Champs obligatoires, autorités et preuves des certifications, historique/changement d'occupant, droits de modification. |
| V5-Q02 | Étages/zones | Usage, surface, zones multiples, plan interactif | Structure bâtiment/étage/zone/local, unités, liaison équipements/interventions, format et interactions du plan. |
| V5-Q03 | Énergie | MWh mensuels, coûts consommés/engagés/restants et prévision | Source factures/contrats/compteurs, mesure réelle vs estimation, périodes, unités, facteurs de projection, recalcul et qualité des données. |
| V5-Q04 | Occupation | Taux par bâtiment et état du site | Source/calcul/période, import d'un outil immobilier ou saisie interne, périmètre par occupant. |
| V5-Q05 | Maintenance | Horizons 30/60 jours, dates et équipements | Récurrence, planification, affectation, temps ouvrés, confirmation et clôture, périmètre électrique vs facility management global. |
| V5-Q06 | Budgets | Portefeuille/site/année, engagé/restant | Correspondance avec budget énergie et budget interventions, HT/TTC, nature des engagements, frais et allocations par catégorie. |
| V5-Q07 | Documents plans | PDF et DWG avec version/date/taille | Autorisation de ces formats, prévisualisation, limites, traitement sécurité, stockage privé et rétention. |
| V5-Q08 | Gouvernance devis | Trésorière/administrateur, examen et compléments d'information | Rôles, transitions, délégation, droit de révision, visibilité des pièces et historique, conditions finales d'acceptation. |
| V5-Q09 | Décision devis | Validité, fournisseur, commentaire facultatif 500 | Expiration, changement de version, désaccord, motif de refus facultatif/obligatoire ; synchronisation du statut avec l'acceptation client et le budget. |
| V5-Q10 | Identité des exemples | Tour Horizon présent dans les nouveaux écrans | L'adresse p2 (Nanterre/La Défense) diffère de celle p6 (Paris8e). Ne pas importer les exemples comme référentiel unique de sites réels. |

## Traçabilité des doublons

Correspondances exactes des octets JPEG extraits, prouvées par SHA-256 :

- V5 p3 → `/tmp/courant-audit/pdf-images/v4-p10.jpeg` (maquette 57).
- V5 p4 → `v4-p3.jpeg` (50).
- V5 p5 → `v4-p9.jpeg` (56).
- V5 p7 → `v3-p6.jpeg` (37).
- V5 p8 → `v1-p13.jpeg` (13).
- V5 p10 → `v1-p16.jpeg` (16).
- V5 p11 → `v4-p8.jpeg` (55).

## Confiance et limites

Confiance élevée : nombre de pages, libellés complémentaires, catalogue des dix images, trois nouvelles images et sept doublons stricts, contenu des trois nouveaux écrans inspectés en résolution source 1168×784. L'intention d'approbation est claire malgré les erreurs textuelles de l'image C08. Aucune vérification du code ou des comptes cloud pendant ce complément ; aucun effet fonctionnel déclaré livré du seul fait de la réception du PDF. Les valeurs et marques sont illustratives. Le parent doit intégrer ces nouveaux éléments à sa matrice en conservant la distinction source / besoin confirmé / détail à spécifier / code existant / validation réelle.
