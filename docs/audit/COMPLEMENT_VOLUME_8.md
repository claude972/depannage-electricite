# Audit documentaire du volume 8

30 octobre 2026. Revue en lecture seule : aucun fichier applicatif, documentation du projet, service ou déploiement modifié. Ce rapport de travail est destiné à la consolidation par l’agent principal.

## Sources consultées et méthode

- Pièce jointe `2-MAQUETTES_UNE_PAR_PAGE_VOLUME_8.pdf` dans le dossier d’attachement `845D6D8E-F3A1-4BEE-B892-FF10737F1505` ; copie canonique de même contenu : `MAQUETTES_UNE_PAR_PAGE_VOLUME_8.pdf`.
- PDF entièrement lu : **9 pages**, couverture page 1 et huit images légendées **Maquette 1 à Maquette 8** aux pages 2 à 9. Chaque image a été extraite sans modification et inspectée pleine résolution ; desktop 1168×784, trois écrans mobiles 784×1168.
- DESIGN.md et skill PDF lus intégralement ; audit consolidé et références du code existant relus pour les écarts déjà constatés. Aucun test live ni examen des secrets.
- Comparaison SHA-256 des octets d’image intégrée avec `docs/audit/INVENTAIRE_SOURCES.json`, puis contrôle de l’index global frais `/tmp/courant-audit/new-volumes-image-index.json`.
- Identifiants stables adoptés : **V8-C01 à V8-C08**, en conservant les numéros imprimés. Aucun de ces numéros locaux ne doit être présenté comme une récupération des numéros initiaux 19 à 32.

## Résultat synthétique

**Quatre doublons exacts d’images déjà fournies et quatre images nouvelles.** Les quatre nouvelles images sont V8-C03, C05, C06 et C07. Le titre du volume ne modifie pas les priorités ni la primauté de la spécification finale du projet. Les nouveaux écrans apportent de vraies références, pas de nouvelles fonctions déjà implémentées.

Le contrôle global reçu du parent, corroboré par son index d’images, porte le corpus à **9 PDF, 102 pages, 93 occurrences de maquettes et 63 images distinctes**. Les volumes 6, 7 et 9 n’ajoutent pas d’image distincte dans cet ensemble. Les nombres globaux ne sont pas déduits du seul volume 8.

## Catalogue complet

| Référence | Libellé imprimé | Page PDF | Acteur / surface | Fonctions visibles | Identité d’image |
| --- | --- | --- | --- | --- | --- |
| V8-C01 | Maquette 1 | 2 | Syndic / fiche résidence Jardins d’Azur | Lots, copropriétaires, exercice, budget annuel et postes, interventions, contacts gardien/conseil syndical, archives, export et notifications ; navigation propriétés, appels de fonds, interventions, fournisseurs, documents, assemblées, communication, paramètres. | Doublon exact de M16 et V5-C09. SHA `1545f26aa762aef7f484aa56593fa12df867e0b911c6ff18c61d9c9ef4da303d`. |
| V8-C02 | Maquette 2 | 3 | Syndic / nouvelle demande | Immeuble/site, type de problème, description 1000 caractères, quatre niveaux Critique/Élevée/Moyenne/Faible et impact, information budgétaire/politique de coûts, annuler/créer, trace des demandes. | Doublon exact de M55 et V5-C10. SHA `2493e0fdfb6bef11b0ed1fb9f557831949b1c8dbd603edbabb5a4043075885de`. |
| V8-C03 | Maquette 3 | 4 | Public / page À propos d’ElecPro | Hero avec photographie métier, mission, valeurs transparence/qualité/rapidité, histoire, équipe avec portraits et fonctions, demande de devis, confiance, footer juridique/social et contact. | **Nouveau**. SHA `7ba2c99f6c9797c48349f09f27ba1e120254f1bd9fc78eb15decf9b98bb3c8e8`. |
| V8-C04 | Maquette 4 | 5 | Artisan / candidature partenaire | Cinq étapes personnelles/société/documents/zones/disponibilités ; nom, téléphone, email, adresse, société/SIRET/statut/effectif/site, qualification, Kbis/RC Pro/diplôme, jours/capacité, remarques. | Doublon exact de M65. SHA `981e6367be5ceb5b08f3eaee8c241559b421a5f7b19e1ad0775ad8914cf0a79e`. |
| V8-C05 | Maquette 5 | 6 | Public / politique de confidentialité | Page en anglais « Privacy Policy » de « YourCompany » ; collecte, usages, cookies et préférences, partage, droits et contact ; date de mise à jour et footer. | **Nouveau**. SHA `a40c2783d477b9075523f53dffb326fdee932a65043b86363f5e122295cf7590`. |
| V8-C06 | Maquette 6 | 7 | Client mobile / détail d’un devis | Numéro/date, présentation rassurante, prestations et unités/prix, HT/TVA/TTC, téléchargement PDF, fiche artisan et contact, accepter/refuser, conditions d’annulation et satisfaction d’exemple. | **Nouveau**. SHA `69d5fa0dd73d65977edb4bab6c2ff863ae776c2370427b651925712f9b52537c`. |
| V8-C07 | Maquette 7 | 8 | Client mobile / détail d’intervention | Numéro/état et étapes, artisan assigné avec téléphone/note/contact, adresse/appartement/étage et carte, description/catégorie, galerie photos, résumé devis et accès au devis, historique horodaté, annuler et modifier le rendez-vous, partage. | **Nouveau**. SHA `7a85e07024bfb64dccfda3838aa6144eb23a3dd38ded8e226de84277bb424d48`. |
| V8-C08 | Maquette 8 | 9 | Artisan mobile / documents obligatoires | RC Pro validée avec validité, décennale à renouveler, diplôme manquant ; remplacer/ajouter, explications et profil complet, navigation basse Accueil/Chantiers/Documents/Profil. | Doublon exact de M14. SHA `746de997ffdb3ca90e640f0dc6577ca570cf3c0a124336eaa6c5d2cf83dd6013`. |

## Les quatre nouvelles références

### V8-C03 — À propos, page 4

La page complète la partie publique : mission, histoire, équipe et valeurs, photographie d’électricien et entrée devis. Les profils d’équipe affichent noms, portraits et fonctions ; une histoire de création en 2020 et des milliers de clients sont des exemples. Le bandeau de confiance évoque artisans vérifiés, avis certifiés/plus de 4,8/5, garantie jusqu’à 12 mois et support 7j/7. La navigation propose Accueil/Services/Comment ça marche/Devis/À propos/Contact ; footer mentions légales, CGU, confidentialité et réseaux sociaux.

**Conséquence d’audit** : ajouter une ligne publique « À propos / exploitant, mission et équipe » à la matrice. L’application actuelle possède un accueil et une aide génériques, pas cet écran. Les textes, l’équipe, les portraits, le nombre de clients, l’ancienneté, les notes et les engagements doivent venir de données réelles approuvées ; ne pas copier les exemples pour remplir une page.

Cette page n’exige pas à elle seule un CMS ni des comptes pour les membres de l’équipe. Le choix contenu statique administré dans le dépôt / interface éditoriale reste une décision de maintenance.

### V8-C05 — Privacy Policy, page 6

Il s’agit d’un **gabarit générique en anglais**, avec « YourCompany », domaine yourcompany.com et privacy@yourcompany.com. La date affichée est mai 2024. Les rubriques portent sur données personnelles, données d’usage et données techniques ; usage pour le service/personnalisation/communication ; cookies essentiels, analytiques et marketing et gestion des préférences ; partage aux prestataires, exigences légales et transfert d’entreprise ; droits d’accès/mise à jour, demande de suppression, opt-out de communication et retrait de consentement.

**Conséquence d’audit** : une page confidentialité distincte et son entrée dans la navigation sont désormais explicitement représentées. Le contenu actuel « coordonnées et conditions à publier » ne la couvre pas. Toutefois, le gabarit ne constitue pas une politique prête à publier et n’établit ni les traitements réellement effectués, ni une validation juridique. Les cookies analytiques/marketing ne doivent pas être ajoutés simplement pour correspondre au texte d’exemple ; la politique doit décrire le produit réel, ses prestataires, ses finalités et les choix accessibles. La gestion des préférences, de l’exercice des droits et des suppressions est à préciser selon les fonctions effectivement retenues.

La langue de cet exemple ne change pas automatiquement l’interface française du projet.

### V8-C06 — Devis client détaillé, page 7

Numéro de devis #D1258, date/heure de réception, invitation à étudier les détails, téléchargement du **devis PDF**. Tableau avec prestations, prix unitaire et unité (m² ou heure) ; sous-total HT, TVA 10 %, total TTC. Les valeurs d’exemple 3600 + 320 + 1500 + 180 = 5600 HT, TVA 560, total 6160 sont arithmétiquement cohérentes. La présence d’unités métier est distincte d’une simple quantité entière générique.

Carte artisan avec photo, nom, métier, ancienneté, note/nombre d’avis, badge vérifié et bouton **Contacter**. Deux actions explicites : **Accepter le devis** et **Refuser**. Le refus n’est donc plus seulement un cas à imaginer ; sa surface est fournie. Les règles associées (motif, clôture ou nouvelle proposition, notifications, conséquences financières) restent à définir.

**Écarts existants confirmés** : acceptation codée, mais pas de commande client de refus ; pas de véritable PDF commercial, d’unité de prestation, de données de contrepartie autorisées dans workspace ou de profil artisan complet. L’interface n’offre pas le suivi des versions/validité/accord détaillé attendu pour un devis exploitable.

**Variantes à ne pas figer** : l’exemple porte sur peintre/peinture et remise en état de murs, hors périmètre électrique. Il affiche une « garantie satisfaction 30 jours », alors que le projet final annonce une garantie un an ; ces deux concepts peuvent éventuellement être distincts, mais leurs conditions ne sont pas définies. La mention annulation gratuite jusqu’à 48 h avant les travaux n’est pas une politique commerciale validée. Les mots « Je suis satisfait et je souhaite démarrer les travaux » ne doivent pas être transformés sans examen en attestation de travaux déjà réalisés.

### V8-C07 — Intervention client détaillée, page 8

Le haut de page affiche un identifiant et un état, une progression et un partage. La fiche artisan expose identité/photo, métier, certification, téléphone, note et bouton de contact. L’adresse comporte appartement et étage ainsi qu’une petite carte. Le problème comprend description, catégorie et galerie de trois photos avec navigation. Un résumé de devis affiche main-d’œuvre, pièces, déplacement, total TTC, date/heure d’accord et action Voir le devis. L’historique montre événements, dates/heures et statuts. Deux actions finales : **Annuler l’intervention** et **Modifier le rendez-vous**.

**Écarts existants confirmés** : les contacts de la contrepartie, la localisation/carte, les pièces dans le détail, les événements historiques détaillés, la réservation et sa modification n’existent pas dans le cycle actuel. La demande actuelle n’enregistre pas de créneau de rendez-vous ; il faut donc un modèle serveur avant de simplement ajouter un bouton. L’annulation existante ne couvre que certaines étapes précoces ; ses nouvelles règles doivent être définies.

**Incohérences de source** : exemple plombier/fuite d’eau et photos de plomberie, hors métier électrique ; ordre graphique Demandée → En cours → À planifier → Terminée et étape À planifier après un travail en cours, à réconcilier avec les autres timelines. Le droit de modifier le rendez-vous alors que l’intervention est « En cours » peut signifier replanification d’une suite, mais ce n’est pas explicitement expliqué. Ne pas reproduire un graphe d’états illogique à partir de cette seule variante.

## Besoins techniques et couverture à ajouter ou préciser

| ID de complément | Besoin | Référence / impact | Couverture actuelle connue |
| --- | --- | --- | --- |
| V8-G01 | Page À propos | V8-C03 : exploitant, mission, équipe, histoire et engagements vérifiables | Absente comme page dédiée ; ajouter une ligne publique distincte, sans faux contenu. |
| V8-G02 | Page confidentialité | V8-C05 : contenu propre au produit, navigation/footer, date et contact réel | Absente ; déterminer les fonctions d’exercice des droits/préférences réellement applicables avant intégration. |
| V8-G03 | Refus d’un devis par le client | V8-C06 : action explicite Refuser | Absent dans intervention_action ; ne pas recycler l’annulation du dossier comme refus sans règles. |
| V8-G04 | Document de devis fidèle | V8-C06 : PDF, numéro, date, unités, fiscalité, version choisie | Récapitulatif TXT et lignes génériques seulement ; le modèle commercial est incomplet. |
| V8-G05 | Contact client/artisan autorisé | V8-C06/C07 : photo/nom/téléphone/note/contact | Contrat workspace et profils n’exposent pas la projection de contrepartie après attribution. |
| V8-G06 | Rendez-vous et replanification | V8-C07 : Modifier le rendez-vous et étapes horodatées | Absents du modèle actuel ; ne pas promettre un bouton opérationnel sur un simple statut scheduled. |
| V8-G07 | Galerie et adresse détaillée | V8-C07 : photos, carte, appartement/étage | Documents privés génériques seulement ; pas de galerie liée au formulaire/détail, ni localisation structurée. |
| V8-G08 | Événements d’intervention | V8-C07 : historique daté, accord du devis, étapes | Audit serveur partiel mais pas timeline métier complète avec dates/acteurs/statuts exposée à l’utilisateur. |

## Décisions de spécification encore ouvertes

| ID | Domaine | Décision à formaliser |
| --- | --- | --- |
| V8-Q01 | Exploitant / contenu public | Nom et équipe réels, photographie et droits, mission/histoire, responsabilité de publication et mise à jour, preuve des notes/certifications/engagements. |
| V8-Q02 | Confidentialité et langues | Politique propre au produit français, traitements/prestataires/finalités/durées/contact, langue(s) requises et validation professionnelle ; ne pas publier le gabarit YourCompany comme texte réel. |
| V8-Q03 | Cookies et préférences | Cookies réellement utilisés, catégories retenues, état initial, interface de préférences et preuve des choix ; aucun outil de suivi ajouté par simple mimétisme du texte. |
| V8-Q04 | Exercice des droits | Qui reçoit et traite une demande d’accès/correction/suppression, vérification du demandeur, périmètre export/effacement, journal et gestion des exceptions ; aucune conclusion juridique présumée. |
| V8-Q05 | Devis client | Numérotation, émetteur, unités de prestation, document PDF/version/validité, preuve d’accord, refus et possibilité de contre-proposition. |
| V8-Q06 | Conditions satisfaction / annulation | Satisfaction 30 jours vs garantie un an, annulation gratuite 48 h, étapes où elle est permise, frais/remboursements et information avant acceptation ; exemples non automatiquement contractuels. |
| V8-Q07 | Rendez-vous | Proposition, confirmation, modification, participants autorisés, calendrier et indisponibilités, replanification pendant travaux, notification des parties et absence/no-show. |
| V8-Q08 | Détail intervention et données personnelles | Données et coordonnées visibles selon étape, photos et liens vers devis exact, unité adresse/appartement/étage, cartographie et destinataires du partage. |
| V8-Q09 | Timeline | Ordre des états, événements/acteurs/dates source, distinction planifié/en route/sur place/en cours/terminé ; corriger la variante À planifier après En cours. |

## Correspondance avec l’audit existant et points de reprise

- Ajouter deux surfaces publiques distinctes après PUB-08 : À propos (V8-C03), Confidentialité (V8-C05). Leur contenu ne doit pas être confondu avec la future page de mentions légales.
- Renforcer CLI-07 avec la source explicite de refus V8-C06 et CLI-08/FIN-05 avec le devis PDF précis ; ne pas présenter le TXT actuel comme équivalent.
- Renforcer CLI-04/CLI-05/CLI-06 et ART-06 avec V8-C07 : rendez-vous, événements et contact de l’artisan/client.
- Renforcer SYS-06 et CLI-02 avec galerie/photos réellement liées au dossier ; le stockage générique ne constitue pas le parcours illustré.
- Compléter Q-PDF-01/02/09/10/12/14/17/19/36/38 selon les précisions ci-dessus ; le nouveau document ne résout pas toutes ces règles.
- Conserver les fonctions serveur existantes de calcul/autorisation et la séparation démo/réel ; les nouvelles images ne justifient ni nouvelle simulation, ni ouverture globale des données personnelles.

## Sources et emplacements réutilisables

- Références visuelles : V8 pages 4, 6, 7 et 8 ; images extraites `/tmp/courant-audit/v8/p4-0.jpeg`, `p6-0.jpeg`, `p7-0.jpeg`, `p8-0.jpeg`.
- Catalogue et comparaison : `docs/audit/INVENTAIRE_SOURCES.json` et `/tmp/courant-audit/new-volumes-image-index.json` ; les huit références V8 ont été rapprochées de leurs SHA.
- Couverture inspectée par l’audit parent : `docs/AUDIT_COMPLET_SPECIFICATIONS.md`, notamment PUB-01–08, CLI-04–08, ART-06, FIN-05 et SYS-06 ; annexes frontend/backend.
- Points de code existants à reprendre : `components/courant-app.tsx` renderPublic, Help, RequestForm, Detail, ProfileView, QuoteEditor et DocumentManager ; `app/api/interventions/[id]/actions`, `lib/domain.ts`, fonctions SQL de transition et RLS. Une recherche ciblée confirme l’absence de page dédiée À propos/confidentialité dans les entrées actuelles ; aucun nouveau parcours n’a été testé en intégration.

## Confiance et limites

Confiance élevée sur les 9 pages, huit images, quatre doublons exacts, quatre images nouvelles et les fonctions visibles, toutes inspectées en résolution source. Les chiffres, identités, notes, engagements, métiers peinture/plomberie et dates sont illustratifs. Aucun conseil juridique, fiscal ou promesse fournisseur n’est déduit du gabarit. Les écarts de code reposent sur le corpus audité et une vérification ciblée, pas une nouvelle exécution de tests ni un service distant reconfiguré. Les identifiants locaux restent qualifiés par volume pour éviter les collisions.
