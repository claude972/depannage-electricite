# Spécifications à compléter et contradictions à résoudre

État : 30 octobre 2026. Ce registre complète la lecture des documents fournis ; il ne modifie pas les PDF et ne transforme pas une suggestion en exigence approuvée.

## Intégration du volume 5 reçu pendant l’audit

Le nouveau document apporte deux références bureaux et un écran détaillé d’approbation. Sept autres images sont des doublons exacts. Il résout l’absence de références graphiques bureaux, mais ne définit toujours pas les sources de consommation/occupation ni toutes les transitions du workflow. Les compléments 1 à 10 ne sont pas renumérotés arbitrairement 19 à 32.

## Comment lire ce registre

- **38 domaines de décisions** Q-PDF-01 à Q-PDF-38 sont rattachés à leurs sources ; chacun regroupe plusieurs règles à préciser.
- **16 contradictions, variantes ou exemples** sont listés après le tableau. Le document final fait autorité sur le périmètre et les priorités ; un chiffre illustratif n’est pas un tarif ni un engagement commercial validé.
- Le refus du style IA générique concerne l’interface. Il ne supprime pas le diagnostic photo IA explicitement prévu en V3 : ce dernier doit avoir sa propre définition et ses contrôles.
- Ces décisions ne signifient pas que toutes les fonctions sont exigées dans le MVP. Les versions MVP/V2/V3 restent distinctes.
- Les questions commerciales, les responsabilités et les contenus réels relèvent du propriétaire et, si nécessaire, des professionnels compétents. Aucune conclusion juridique ou fiscale n’est inventée dans cet audit.

## Décisions qui conditionnent les prochains lots

1. Nommer les espaces : client particulier, entreprise cliente B2B, artisan, éventuelle entreprise prestataire avec salariés, administration de plateforme. Le mot entreprise ne suffit pas à déterminer les droits.
2. Définir pour chaque espace sa plateforme : web, web mobile/PWA ou application native. Le code actuel n’est pas une application native.
3. Désigner une maquette de référence par écran parmi les variantes. Le nouveau volume 5 fournit désormais la fiche bureaux V5-C01 et le dashboard V5-C05 ; ne plus les considérer comme références absentes.
4. Fixer la candidature artisan, les disponibilités, les rendez-vous, le refus, le contact et la réaffectation.
5. Fixer les barèmes, la TVA applicable, les commissions, les contrats, l’émetteur des factures et le cycle des règlements/remboursements.
6. Définir les membres et les payeurs B2B, les droits par site, l’approbation et le devenir des dossiers au départ d’un salarié. Le créateur d’un dossier d’entreprise n’est pas nécessairement son propriétaire permanent.
7. Définir la garantie, les SLA, le support et les preuves d’intervention ; préciser ce que signifie automatisée.
8. Renseigner les données réelles : identité de l’exploitant, contacts, territoire, horaires et conditions commerciales. Ne pas reprendre les noms, adresses, chiffres et promesses d’exemple.

## Points de contrôle ajoutés par la lecture du code

- L’acceptation d’un devis B2B et son paiement n’ont pas actuellement la même portée : le créateur exact peut payer ; le rôle d’un payeur délégué doit être défini avant d’élargir l’accès.
- Le retrait d’un membre doit préciser si les droits liés à son ancien `client_id` sont supprimés, transférés ou conservés. Aucune procédure applicative de retrait n’existe aujourd’hui.
- Les pièces doivent pouvoir être liées au bon objet : candidature, intervention, site, contrat, audit ou facture. Le modèle actuel ne couvre pas ces relations.
- Une réception de paiement ne prouve pas un virement bancaire reçu par l’artisan ; les états financiers attendus doivent être distingués.
- Les métriques doivent préciser période, source, formule, périmètre et unité ; un compteur sur les 100 dossiers chargés n’est pas un total global.
- Les corrections de sécurité et d’intégration identifiées dans l’audit ne sont pas des options produit à arbitrer : elles constituent des contrôles avant mise en service.

## Informations réelles à compléter dans les spécifications

Ces lignes sont des **décisions manquantes dans les documents**, pas des exigences déjà approuvées ni une preuve que chaque fonction doit être dans le MVP.

| IDsource | Domaine | Lacune / décision nécessaire | Preuves déclenchant la question |
| --- | --- | --- | --- |
| Q-PDF-01 | Identité | Nom, logo, exploitant, coordonnées, territoire, langues/devise et juridiction commerciale finaux ; plusieurs identités incompatibles. | Maquettes11/33/41/43/49/51/60/63/65/66/70 ; spécificationp1 ne fixe pas de marque. |
| Q-PDF-02 | Plateformes | Web responsive vs applications natives client/artisan, distribution/stores, offline et notifications push ; appmobile évoquée, aucun engagement technique déterminé. | Maquettes7/35/61 et blueprints3/6/48/69. |
| Q-PDF-03 | Acteurs | Rôles et responsabilités entre client particulier, B2B, syndic, occupant/locataire, assureur, artisan indépendant, entreprise prestataire et personnel plateforme ; qui demande, approuve, paie, reçoit le rapport. | Spécification§1–3 ; blueprints6/52/69. |
| Q-PDF-04 | Organisations | Hiérarchie groupe/organisation/site/bâtiment/zone/lot, membres/invitations/délégation, multi-rôle et portée des permissions ; différence owner/adminorganisation/superadminplateforme. | Maquettes13/16/43/50/56/57/66. |
| Q-PDF-05 | Onboarding artisan | Pièces obligatoires selon statut, validation/expiration/renouvellement/refus/correction/suspension ; SIRET, entreprise, qualifications, salariés et vérificateur. | Maquettes14/36/43/60/64/65. |
| Q-PDF-06 | Disponibilité | Planning, capacité simultanée, horaires/jours, disponibilité immédiate et indicateurs occupé/absent ; fonctionnement de l'équipe prestataire. | Maquettes35/65 et blueprints1/6/69. |
| Q-PDF-07 | Demandes/urgence | Catalogue exact de pannes/prestations, quatre niveaux B2B vs urgence simple, qualification initiale/triage, lieu/accès/contacts requis ; politique de demande incomplète ou dangereuse à définir. | Maquettes5/15/55/61 ; spécification§2–3. |
| Q-PDF-08 | Matching | Score, filtres compétences/certification/zone/disponibilité, rayon et fournisseur carte, géolocalisation consentement/fréquence/rétention, délais acceptation/refus/expiration, absence d'artisan et réaffectation manuelle. | Spécification§4 ; maquettes7/8/44/67 ; blueprints1/6/52/69. |
| Q-PDF-09 | Vie privée | Adresse/téléphone client visibles avant ou après attribution, appels directs ou masqués, partage aux occupants/partenaires, droits des documents. | Maquettes8/44/67 montrent adresse/appeler avant acceptation ; besoin de contrôle d'accès explicite. |
| Q-PDF-10 | RDV/déplacement | Proposition/créneau/confirmation/replanification/no-show/annulation ; statut enroute/surplace, ETA, preuve arrivée et suivi itinéraire, qui déclenche chaque étape. | Maquettes1/3/7/9/40/48/58/68. |
| Q-PDF-11 | Estimation/prix | Barème, unités et quantités, déplacement/diagnostic/pièces/mainœuvre, taxes, urgence/majorations, zone, abonnement/contrat ; bornes d'estimation et variations après diagnostic. | Spécification§2/4 ; maquettes5/12/15/34/38/60. |
| Q-PDF-12 | Devis | Identité de l'émetteur, mentions, numérotation, validité, version, acceptation/signature, preuve d'accord, refus, supplément et devis modifié ; moment exact avant/après déplacement. | Maquettes1/3/9/12/34/48/69. |
| Q-PDF-13 | Intervention | Statuts, acteurs autorisés, check-list sécurité, tests/remise enservice, rapport obligatoire, mesures/pièces, photos avant/après/horodatage, signature client, clôture/validation partenaire, reprise après échec ou litige. | Blueprints1/6/52/58/68/69 ; maquette7. |
| Q-PDF-14 | Paiement | Après travaux vs acompte/préautorisation, payeur B2B/assureur/occupant, CB/wallets/PayPal/fractionné, statuts, réconciliation, échec/reprise/remboursements/chargebacks. | Maquettes12/18, spécification§2/5 ; Stripe imposé par propriétaire, modalités non définies dansPDF. |
| Q-PDF-15 | Reversement/commission | Commission exacte et assiette HT/TTC, qui paie frais, calendrier de reversement, retenues/litiges, pièces bancaires ; volume d'affaires vs revenu plateforme pour KPI. | Spécification§5 (15–25 %) ; maquette 60 (5–8 % exemple), maquette 43 CA HT, blueprints1/69. |
| Q-PDF-16 | Facturation | Émetteur/facturier, numérotation, taxes, B2Bélectronique, échéances/relances, avoirs/notesdecrédit, export/comptabilité, distinction factureartisan/facturecommission. | Maquettes4/12/16/43/50/66 ; blueprints6/52/69. |
| Q-PDF-17 | Garantie | Date de départ, bénéficiaire, travaux/pièces inclus/exclus, justificatif, récurrence, réclamation et décision, délai d'intervention, coût de retour, automatisation exacte et notification échéance. | Spécification§4/7 ; maquettes9/40/45/54/69. |
| Q-PDF-18 | Notes/performance | Éligibilité avis, modération/contestation/réponse artisan, calcul moyenne/satisfaction/qualité/délais/ancienneté/CA et périodes ; distinction noteartisan et noteplateforme. | Maquettes35/36/43/47/60 ; spécification§2. |
| Q-PDF-19 | Documents | Types, nombre/taille/formats, version/remplacement/expiration, validation, visibilité, propriété, recherche, pièces jointes de chat, politique archivage/rétention/suppression et format rapport/signature. | Maquettes5/14/15/34/50/57/62/65 ; spécification§4. |
| Q-PDF-20 | Messagerie | Conversations autorisées, piècesjointes, statutslu / non lu, historique/fermeture, appel, signalement d'abus et accès support. | Maquettes7/35/39/62/66 ; spécification§4. |
| Q-PDF-21 | Notifications | Événements, destinataires, préférences/consentements, canaux/providers, templates, horaires, retries/doublons/délivrabilité et désabonnement ; flux enpage lu / non lu. | Maquettes39/54/64, blueprints6/52/69 ; spécification§4. |
| Q-PDF-22 | B2B sites/contacts | Fiche métier, équipements et état/criticité, zones, consignes d'accès, contacts et horaires, prestataires autorisés, documents/contrats applicables. | Spécification§3 ; maquettes 16/50/56/57/66. |
| Q-PDF-23 | Workflows | Approbation affectation/devis/réceptiontravaux/facture distinctes, seuils, niveauxséquentiels/parallèles, délégation/absence, budgetdépassé, refus/escalade et journal ; aucun graphe d'état exhaustif. | Spécification §2/4/7 ; blueprints 6/52/69 ; V5-C08 page 9, historique et compléments d’information. |
| Q-PDF-24 | Budgets | Année/exercice, HT/TTC, engagé vs réalisé vs prévu, montant par site/catégorie/zone, dépassement bloquant ou informatif, droits de modification et alertes. | Maquettes13/16/50/57 ; spécification§2–4. |
| Q-PDF-25 | SLA/contrats | Niveaucontractuel, horloges ouvrées/calendaires, début/pause/fin et événements, criticités, seuils, pénalités, escalade, renouvellement/rupture, version grille tarifaire et règles de priorité. | Maquettes50/56, blueprints6/69 ; spécification§3–4. |
| Q-PDF-26 | Restaurant | Inventaire/identifiants cuisinefroidéclairage, état et derniercontrôle, tickets/exploitation, lienéquipement/site, maintenance et collecte SLA / KPI. | Spécification§3 ; maquettes50/56. |
| Q-PDF-27 | Bureaux | Références visuelles désormais fournies (V5-C01/C05) ; restent à définir le modèle bâtiments/étages/zones, le calendrier, les sources des mesures MWh, les taux d’occupation, les périodes et les budgets. | Spécification §3 ; V5-C01 page 2 et V5-C05 page 6 ; maquette 66. |
| Q-PDF-28 | Syndic | Lots/propriétaires/occupants, assemblées et rapportsAG, appelsdefonds/recouvrement/budgetvoté, conseilsyndical/gardien ; définir si vrai module syndic ou contexte importé d'un outil tiers, et exclure hors-métier assumé. | Spécification§2 ; maquettes 13/16/55. |
| Q-PDF-29 | ERP | Catégories, référentiels applicables et qui attesteconforme, audits/rapports/réserves/levée, fréquences, preuves, plans/équipements, sécurité/alertes ; imagecouvre aussi incendie/accessibilité/hygiène au-delà électricité. | Spécification§3/7 ; maquettes37/57. |
| Q-PDF-30 | Reporting | Définitions KPI/dénominateurs/périodes, consolidé vs parsite, frais/HT/TTC/encaissé, filtres/exports/pagination, rapportannuel/AG, seuils de conformité et sources mesures. | Maquettes4/13/16/35/36/37/43/50/56/57/66 ; spécification§2–4. |
| Q-PDF-31 | Back-office plateforme | Actions et portées par rôle support/finance/admin/superadmin ; annuaireclients/entreprises/artisans, dispatch et réaffectation, vérificationdocuments, revenus/commissions, devisfactures/avoirs, modérationavis, litiges, paramètres, traçabilité. | Maquette43 ; blueprints1/6/58/69. |
| Q-PDF-32 | Entreprise prestataire | Dirigeant/dispatch/techniciens salariés, attribution interne, disponibilités/équipe, stockpièces/logistique, rapport et facture émis pour l'entreprise ; granularité/multiteam non spécifiées. | Maquette65 effectifs/entreprise ; blueprints6/69. |
| Q-PDF-33 | Intégrations | CRM/ERP/comptabilité/BI : fournisseurs, interfaces, formats, sensdesflux, identifiants/synchronisation, traitementerreurs et responsabilités ; webhook/API non décrits réellement. | Blueprints3/6/48/52/53/69 ; le résumégrand formatp1 évoque endpoints/modèle sans livrer un contrat détaillé. |
| Q-PDF-34 | Abonnements/premium | Offresdistinctesclient/artisan/B2B, prix/périodicité/quotas/avantages/remises/priorité, activationrésiliationrenouvellementremboursements, paiement récurrent et relationcommission. | Spécification§5 ; maquette33 vs60 etcomparateurs2/10/17. |
| Q-PDF-35 | Diagnostic IA | Fournisseur/modèle, photos/données envoyées, consentement, sécurité du résultat, limites d'usage, protocole d'évaluation, validation humaine, coût et échec/fallback ; simple mentionV3 seulement. | Spécification§4/7. |
| Q-PDF-36 | Sécurité/exploitation | Authentification renforcée admin, gestion sessions, journaux et supervision, antiabus, sauvegarde/restauration, disponibilité/capacité, droits d'accès/export/suppression et conservation. | Mention sécurité/confidentialité récurrente mais objectifs mesurables/processus absents. |
| Q-PDF-37 | Serviceclient | Canaux/horaires/rôlessupport, créationtickets, escalades/assistance technique/réclamations/litiges, rappel téléphonique et avisatisfaction ; règles de responsabilité et délais non spécifiés. | Maquettes11/42/60/64/70 etblueprints1/6/58/69. |
| Q-PDF-38 | Fidélité visuelle | Écranchoisi parmi variantes, typographies/couleurs/tokenscohérents, navigationnativebasse/desktoplatérale, cohérenceclient/artisan/B2B, étatsvideerreurchargementresponsive ; DESIGN.md fournit une proposition, pas des mesures exactes desPDF. | Ensemble des 93 occurrences de maquettes (63 images distinctes) ; note basesàaméliorer ; refusstyle IA du propriétaire. |

## Contradictions, variantes et exemples à ne pas transformer en règles

1. **Commission** : spécification finale15–25 % ; recrutementmaquette 60 propose5–8 %. La spécification finale prévaut comme orientation, mais le tauxcontractuel doit être fixé, pas copié au hasard.
2. **Abonnement artisan** : spécification finale prévoit abonnementsclient/artisan ; recrutement60 dit zéroabonnement, comparateurs parlent aussi nonobligatoire. Choisir modèlecohérent et distinguer offreoptionnelle d'obligation.
3. **Prix** : panne tableau maquette8/44/67 à120–180TTC, pageTarifs38 tableau120–200 ; demande5/15 à150–250 ; plan40 à100–300. Ce sont des exemples, pas un barème complet exploitable.
4. **TVA** : paiement12 affiche20 % et10EUR sur des lignes90+40+58HT ;10necorrespondpas20 %de188. Les futurs calculs doivent être définis et testés, pas recopier l'image.
5. **Limites formulaire/fichiers** : description500sur5,300sur15,1000sur55 ; photos0/6sur5, fichierJPG/PNG10 Mo sur15, PDF/JPG10 Mo sur65. Aucun contrat de validation unique.
6. **Devis et paiement** : certains diagrammes montrent «devis signé» lorsduRDV avantdiagnostic, d'autres devis établi sursite avanttravaux ; FAQ70 parle de devisverbal avanttravaux et écritsurdemande alors que lesparcours affichent validationnumérique/signée. Paiementaprèsfin évoqué, pas défini pour touscasB2B.
7. **Délais** : moins15 min de réactivitéblueprint6, rappel2–30 min/parcours40, intervention24–48 h/home11, «quelquesminutes»51, SLA4 houvrées50, candidature48 houvrées64, règlement48 h60. Les événements et garanties diffèrent ; aucun délai global ne doit être promis.
8. **24/7, prixfixe et absence majoration** : beaucoup de pages commerciales/exemples le proclament ; la spécification finale ne fixe pas d'engagement nationalni horairesni surcharge. Nécessite décisioncommerciale.
9. **Périmètre métiers** : spécification finaleélectricité ; quelques images/diagrams montrent plomberie/chauffage, multitechnique, peinture/maçonnerie, incendie/accessibilité/hygiène/ascenseurs/espacesverts. Reprendre structure métier, pas élargir silencieusement le produit.
10. **Zone** : maquette59 Franceentière, contact42 Île-de-France, exemples partoutFrance. Aucun territoiredefourniture validé par la spécification finale.
11. **Marques** : MesDépanneurs.fr est utilisé dans nombreuxschémascomparatifs ; autres identités incluentÉlecPro/ÉlectroPro/ÉlecFacile/Sérénité/Voltéo/ArtisanPro/PartenaRx/SyndiPro/SafeERP/RestauTech/MonService. Aucune n'est implicitement identitéfinaleautorisée à copier.
12. **Contacts et chiffres** : numéros, emails, adresses, notes, avis, CA etcompteurs sontdesexemplesvisuels. Ne pas créer de faussespreuvescommerciales.
13. **Statuts** : client7 comporte enroute/surplace ; artisans35 montrent àréaliser/dépannage/préventif ; B2B différentsencours/planifié/attente/clos etniveauxpriorité ; modèletransitionetmapping non exhaustifs.
14. **Documents professionnels** : maquette 14 exigeRC Pro/décennale/diplôme ;65 Kbis/RC Pro/diplôme etlabelsoptionnels ; typesetconditions d'éligibilité à réconcilier selonprofil.
15. **Fidélité** : maquettes sontdesbasesàaméliorer mais le propriétaire rejette le style IA et demande reconnaissancevisuelle. Les adaptations doivent être explicitement tracées ; reprendre seulement bleu/blanc ne constitue pas fidélité.
16. **Nom «spécificationcomplète»** : documentfinal d'unepage décritlepérimètre etlespriorités ; le résumégrand format évoque modèle/endpoints mais aucun schéma complet ni API détaillée n'est présent danscesPDF. Le titre ne signifie pas que touteslesrèglesnécessairesaucodage existent.


## Traçabilité

Catalogue et pages sources : [CATALOGUE_MAQUETTES](audit/CATALOGUE_MAQUETTES.md). Couverture et priorités : [AUDIT_COMPLET_SPECIFICATIONS](AUDIT_COMPLET_SPECIFICATIONS.md). Les dates et montants illustratifs des PDF n’ont pas été vérifiés comme des faits actuels du marché.

## Dix précisions issues du volume 5

Ces points affinent les 38 domaines précédents ; ils ne constituent pas dix fonctions livrées ni dix décisions déjà validées. Le commentaire facultatif et la limite 500 de V5-C08 doivent notamment être rapprochés du motif de refus actuellement obligatoire dans le code.

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


La fiche Tour Horizon et son tableau de bord montrent des adresses d’exemple différentes. Les sites, badges, chiffres d’énergie/occupation et certifications des images ne doivent pas être importés comme données réelles.

## Neuf précisions issues du volume 8 et bilan des volumes 6/7/9

Le volume 8 ajoute quatre images distinctes ; les volumes 6/7/9 et la moitié des images V8 sont des répétitions. Ces précisions complètent les domaines existants, sans rendre leurs exemples contractuels. Le titre FINAL du volume 9 n’énonce aucune modification des priorités fonctionnelles.

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


Les autres détails et correspondances sont consignés dans les annexes des volumes 6 à 9. Le refus de devis est désormais explicitement illustré ; il reste à définir sa commande, ses effets et ses notifications, distincts d’une annulation de dossier.

## Précisions issues des archives JSX/CSS

Les quatre archives ne résolvent pas les règles manquantes : estimation fixe, disponibilité fictive, gains et budgets figés, absence de soumission ou Stripe. La promesse sans majoration 24/7 et les montants sont des exemples à arbitrer avec les contradictions déjà recensées. Le fichier B2BDashboard ne définit pas les droits d’organisation ; ArtisanDashboard ne définit pas les comptes d’une entreprise prestataire. Voir [l’annexe](audit/ARCHIVES_CODE.md).

## Décisions affinées par le réaudit consolidé

- **Q-PDF-05 / suspension** : bloquer seulement les nouvelles missions ou également les travaux déjà affectés ? Définir accès aux preuves, réaffectation, information client et règlement des travaux déjà accomplis. Actuellement acceptation/Checkout bloqués, mais devis/début/fin encore permis sur les missions affectées.
- **Q-PDF-12/23 / refus distincts** : séparer refus d’offre artisan, rejet d’approbation B2B, refus de devis client, annulation de dossier et réaffectation. Le rejet d’approbation actuel ne modifie ni devis ni intervention.
- **Q-PDF-08 / matching** : éligibilité minimale par territoire, compétence et disponibilité dès le socle ; scoring/GPS avancés dans un sous-lot distinct. Les offres actuelles sont triées plus anciennes d’abord, pas par pertinence.
- **Q-PDF-30 / rapports** : tester les exports frontend et serveur séparément ; le test csvCell serveur ne valide pas la copie frontend ni ses espaces/onglets initiaux.

Ces points précisent des domaines existants ; aucune donnée commerciale ou autorisation de codage nouvelle n’est déduite. Voir [réaudit](audit/REAUDIT_CONSOLIDE.md) et [couverture du plan](audit/COUVERTURE_PLAN.csv).
