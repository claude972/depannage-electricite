# Audit documentaire des volumes 6 et 7

Lecture seule, 30 octobre 2026. Les deux nouveaux documents sont intégralement lus et leurs images vérifiées. La collecte n’a modifié aucun code applicatif, service distant ou déploiement ; cette annexe documentaire en consigne les résultats. Ce rapport de travail est écrit uniquement dans `/tmp/courant-audit/`.

## Résultat principal

- **Volume 6 : 7 pages**, couverture puis **6 maquettes complémentaires**.
- **Volume 7 : 9 pages**, couverture puis **8 maquettes**.
- **14 occurrences d’écrans, 8 images distinctes entre ces deux volumes ; les 14 sont des doublons stricts d’images déjà reçues avant eux.** Aucun écran ni champ nouveau n’est ajouté par ces deux volumes.
- Les identifiants imprimés repartent de 1 : volume 6 « Maquette complémentaire 1–6 », volume 7 « Maquette 1–8 ». Ils ne doivent pas être confondus avec les maquettes globales M1–M8 ni attribués arbitrairement aux numéros 19–32.
- Les deux volumes réaffirment des références **entreprise cliente / partenaire B2B / syndic / facility management**. Ils ne fournissent aucun nouveau dashboard artisan, aucun back-office d’entreprise prestataire avec techniciens et aucun écran Super Admin de plateforme.
- Les mots « étapes complémentaires » du volume 6 ne prouvent pas un nouveau parcours séquentiel : le contenu réunit des fiches et tableaux déjà existants.

## Sources consultées et méthode

1. Instructions projet et DESIGN.md, skill PDF.
2. Fichier reçu volume 6 : `/tmp/codex-remote-attachments/01a18f4a-c5d0-7ed0-a011-384496267135/845D6D8E-F3A1-4BEE-B892-FF10737F1505/1-MAQUETTES_UNE_PAR_PAGE_VOLUME_6.pdf`.
3. Fichier reçu volume 7 : même dossier, `4-MAQUETTES_UNE_PAR_PAGE_VOLUME_7.pdf`.
4. `docs/audit/INVENTAIRE_SOURCES.json` : comparaison avec son état précédent à cinq PDF et ses empreintes d’images.
5. Copies PDF du workspace pour comparaison croisée avec les volumes 8 et 9 également arrivés, sans conclure à leur inventaire complet dans cette mission.
6. Audit actuel `docs/AUDIT_COMPLET_SPECIFICATIONS.md` et ses identifiants de couverture, utilisé pour rattacher les écarts déjà constatés au code.

Texte intégré de toutes les pages extrait avec PyMuPDF. Les 14 images JPEG intégrées ont été extraites sans altérer les PDF ; SHA-256 calculé sur leurs octets exacts, comparé au manifeste initial et aux copies des nouveaux documents. Les huit images distinctes ont été réinspectées en résolution source **1168 × 784**. Les six premières images du volume 7 étant identiques octet par octet à celles du volume 6, la seconde occurrence ne nécessite pas d’inventer une interprétation différente.

Preuves temporaires : `/tmp/courant-audit/v6-v7/v6-p2.jpeg` à `v6-p7.jpeg`, et `v7-p2.jpeg` à `v7-p9.jpeg`.

Empreintes des fichiers PDF reçus :
- Volume 6 : `a2ab8d3e2e1685577b3526793046a4aae679baa65f35137182a6d0a2069bb1d6`.
- Volume 7 : `a60e8d5e00c9f563237d6cea14e7398af83ec5e016cf70779674b22071fe6897`.

## Catalogue exhaustif du volume 6

Les références V6-C01 à C06 ci-dessous sont des identifiants d’audit préfixés, pas une nouvelle numérotation globale imposée au projet. Toutes les lignes sont des doublons stricts.

| Référence | Page PDF / libellé imprimé | Acteur et écran | Fonctions visibles | Correspondance déjà reçue |
| --- | --- | --- | --- | --- |
| V6-C01 | p2 / Maquette complémentaire 1 | Entreprise cliente bureaux, fiche de site Tour Horizon | Bâtiment/photo/adresse/surface/année/type/étages/occupant ; conformité/certification ; étages et zones avec plans ; interventions électriques ; maintenance et calendrier ; budget consommation/engagé/restant/projection ; contacts et documents PDF/DWG ; statut site et date/version | **V5-C01**, volume 5 p2 |
| V6-C02 | p3 / Maquette complémentaire 2 | Entreprise cliente ERP, fiche Hôtel Le Régent | Conformité par domaines, audits électriques, alertes de sécurité, interventions, budget détaillé par catégorie, contacts, documents/archives/export, plans/équipements | **M57**, volume 4 p10 ; également **V5-C02** p3 |
| V6-C03 | p4 / Maquette complémentaire 3 | Entreprise cliente restauration, fiche Restaurant Le Gourmet | Cuisine/froid/éclairage, état et dernier contrôle ; interventions en cours/terminées ; budget et prochaine facture ; niveau de SLA, contrat et délai ; contact sur site/horaires ; documents | **M50**, volume 4 p3 ; **V5-C03** p4 |
| V6-C04 | p5 / Maquette complémentaire 4 | Entreprise cliente restauration, dashboard RestauTech | Sites/interventions/tickets/équipements/contrats/SLA/rapports/alertes ; compteurs et tendances ; tableau cuisine/froid/éclairage/SLA par restaurant ; indicateurs réponse/résolution ; tickets récents | **M56**, volume 4 p9 ; **V5-C04** p5 |
| V6-C05 | p6 / Maquette complémentaire 5 | Entreprise cliente bureaux, dashboard BUREAUX360 | Sites et bâtiments, consommation mensuelle MWh, occupation, interventions/urgences, maintenances à 30 jours, budgets par bâtiment/portefeuille, énergie/environnement, alertes, rapports et documents | **V5-C05**, volume 5 p6 |
| V6-C06 | p7 / Maquette complémentaire 6 | Entreprise cliente ERP, dashboard SafeERP | Établissements, conformité, interventions, audits, signalements, rapports/documents/paramètres ; KPI ; table établissements ; répartition par urgence ; planning audits et courbe de conformité | **M37**, volume 3 p6 ; **V5-C06** p7 |

## Catalogue exhaustif du volume 7

Les références V7-C01 à C08 distinguent ce volume des maquettes M1–M8 du grand format. Toutes les lignes sont des doublons stricts.

| Référence | Page PDF / libellé imprimé | Acteur et écran | Fonctions visibles | Correspondance déjà reçue |
| --- | --- | --- | --- | --- |
| V7-C01 | p2 / Maquette 1 | Entreprise cliente bureaux, fiche Tour Horizon | Même contenu que V6-C01 : bâtiment, étages/zones/plans, maintenance, énergie/budget, contacts, documents et conformité | **V5-C01** p2 ; **V6-C01** p2 |
| V7-C02 | p3 / Maquette 2 | Entreprise cliente ERP, fiche Hôtel Le Régent | Même contenu que V6-C02 : conformité/audits/sécurité/interventions/budget/contacts/archives | **M57** ; **V5-C02** ; **V6-C02** |
| V7-C03 | p4 / Maquette 3 | Entreprise cliente restauration, fiche Le Gourmet | Même contenu que V6-C03 : systèmes critiques, interventions, budget/SLA/contrat/contact/documents | **M50** ; **V5-C03** ; **V6-C03** |
| V7-C04 | p5 / Maquette 4 | Entreprise cliente restauration, dashboard RestauTech | Même contenu que V6-C04 : portefeuille, tickets critiques, équipements, SLA, indicateurs et alertes | **M56** ; **V5-C04** ; **V6-C04** |
| V7-C05 | p6 / Maquette 5 | Entreprise cliente bureaux, dashboard BUREAUX360 | Même contenu que V6-C05 : occupation, MWh, budgets, interventions, maintenance et alertes | **V5-C05** ; **V6-C05** |
| V7-C06 | p7 / Maquette 6 | Entreprise cliente ERP, dashboard SafeERP | Même contenu que V6-C06 : établissements, conformité, audits, signalements et rapports | **M37** ; **V5-C06** ; **V6-C06** |
| V7-C07 | p8 / Maquette 7 | Syndic / entreprise cliente, dashboard SyndiPro | Immeubles, interventions multisites, budgets, fournisseurs, copropriétaires, assemblées, documents, alertes et paramètres ; tableaux de sites et d’interventions | **M13**, grand format p13 ; **V5-C07** p8 |
| V7-C08 | p9 / Maquette 8 | Syndic / approbateur entreprise, dossier d’approbation de devis | Référence, propriété, fournisseur, réception, description, validité, pièces jointes, montant/TVA ; choix approuver/refuser puis enregistrer ; commentaire facultatif 500 ; historique date/acteur/rôle/commentaire, examen et compléments d’information | **V5-C08**, volume 5 p9 |

## Correspondances exactes des images

| Image commune | SHA-256 des octets JPEG |
| --- | --- |
| Tour Horizon : V6-C01 / V7-C01 / V5-C01 | `e04e1da2cccbf7b6166964018c6821cf793d2e05c992629d0ebadf3a945ef518` |
| Hôtel ERP : V6-C02 / V7-C02 / V5-C02 / M57 | `911af6b66be329f31277d8a9ee78ab5785f585095b65d85da960d9c18861ab6a` |
| Restaurant fiche : V6-C03 / V7-C03 / V5-C03 / M50 | `4d6d6f7d8a5d78c7ea5d8a21d350cb5502d1e831f930bf6f56e3355a44beba15` |
| Restaurant dashboard : V6-C04 / V7-C04 / V5-C04 / M56 | `285d55ed909249edc6c88aa88a770299a1402aa2049c3007277bdec916ced0aa` |
| Bureaux dashboard : V6-C05 / V7-C05 / V5-C05 | `e19f56f3f3abe875376b869495a02e58ac7208629454523560ded9d76d4ce52d` |
| ERP dashboard : V6-C06 / V7-C06 / V5-C06 / M37 | `4e2a4848fc65a8d351daf36e429f2316e1c4f00d07ed2d6feeeeadeb01055ec1` |
| Syndic dashboard : V7-C07 / V5-C07 / M13 | `462ea669bc387f3107a96f6de187f9f46cbe345d22d7ee5d7d4d22d628773ecd` |
| Approbation syndic : V7-C08 / V5-C08 | `c4772f6856bd69bd35fc92205a7e4356632a55b40ad8cf8e7f8f545b72748930` |

Comparaison croisée observée avec les copies des autres nouveaux volumes : les cinq premières images du volume 9, pp2–6, correspondent également à ces cinq premières références. Aucun apport du volume 8/9 n’est déduit de cette seule comparaison ; leur collecte relève de l’audit séparé du parent.

## Ce que ces documents précisent et ce qu’ils ne résolvent pas

Ils ne précisent rien de nouveau au-delà des images déjà cataloguées : il faut enrichir les **alias de source** du catalogue, pas créer 14 nouvelles fonctions ou augmenter artificiellement les manques.

Les questions ouvertes suivantes restent identiques :
- Source, unité, période et qualité des mesures d’énergie/occupation ; calcul des budgets consommation et intervention, projections et alertes.
- Structure bâtiment/étage/zone/équipement, plans, contacts, documents et rôles autorisés.
- Référentiels ERP, pièces de preuve, périodicité et responsable des attestations ; la présence d’un badge n’établit pas une conformité réelle.
- Définition des SLA, calendriers, urgences, pauses et escalades.
- Circuit d’approbation, rôle de trésorière/administrateur, examen et demande de compléments, refus et révision ; commentaire facultatif dans l’image, pas obligation de motif déjà approuvée.
- Délimitation du dépannage électrique face aux exemples de gestion immobilière/facility management, hygiène, incendie, ascenseurs ou climatisation.

Les valeurs chiffrées, adresses, marques, dates, certifications et engagements de l’image ne deviennent pas des données réelles ni des paramètres validés parce qu’ils apparaissent dans plusieurs volumes identiques.

## Rattachement aux manques de code déjà inventoriés

| Références sources réaffirmées | Points de couverture existants | Ce qui reste manquant dans le code audité |
| --- | --- | --- |
| Fiches et dashboards bureaux | ENT-03/04/08/09, SYS-06/07 ; BE-33/36/41/43 ; FE-B02/05/10/16 | Modèle bâtiment/étages/zones/occupation/énergie, vraies fiches et dashboards, maintenance récurrente, contacts/plans/documents et sources/calculs de mesures |
| Fiche et dashboard restauration | ENT-04/06/07/11 ; BE-35/42 ; FE-B04 | Équipements critiques structurés, état cuisine/froid/éclairage, tickets, contraintes d’exploitation et métriques SLA |
| Fiche et dashboard ERP | ENT-04/10/11 ; BE-37/42 ; FE-B06 | Référentiel, échéances/audits/réserves/preuves, contacts, documents et permissions ; ne pas assimiler des notes libres à la conformité |
| Dashboard syndic | ENT-05/14/15 ; BE-34/41/43 ; FE-B07 | Immeubles/contacts, budgets par exercice, tableaux dédiés, documents et rapports AG ; périmètre copropriété globale à cadrer |
| Approbation détaillée syndic | ENT-12/13 ; BE-38/39 ; FE-B12 | Dossier de décision complet, fournisseur/validité/document exact, étapes d’examen/compléments, historique nominatif/horodaté, délégations et transitions |

Les preuves et emplacements de reprise sont les annexes du code existantes : `components/courant-app.tsx` (Sites, ProfessionalOperations), `app/api/professional/route.ts`, `app/api/reports/route.ts`, `supabase/migrations/202610310002_professional.sql`. Il n’est pas nécessaire de réinventer une API pour constater que les modèles actuels ne couvrent pas tous les champs visibles.

## Confiance et limites

Confiance élevée sur les pages, libellés, 14 correspondances exactes, acteurs et champs visibles après extraction/inspection. Aucun test de base, de compte réel, de paiement ni de fournisseur n’a été exécuté. Aucune comparaison pixel de l’application déployée n’est prétendue. Les références de code et écarts repris sont ceux de l’audit courant, pas une nouvelle implémentation. Les conditions métiers toujours ouvertes ne sont pas résolues par les titres des fichiers.
