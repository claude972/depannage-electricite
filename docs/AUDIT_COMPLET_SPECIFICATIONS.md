# Audit complet des spécifications et de la couverture actuelle

**Date : 30 octobre 2026. Code inspecté : `46aac2a`. Statut : audit documentaire et technique, sans modification applicative.**

## Conclusion

Les documents décrivent une plateforme de dépannage électrique beaucoup plus large que la démonstration livrée. Le code possède un socle serveur et plusieurs parcours, mais les espaces client, artisan, entreprise et administration partagent essentiellement une coque commune. Les back-offices complets visibles dans les maquettes ne sont pas réalisés.

La maquette **43** prévoit explicitement un **Admin / Super Admin** avec indicateurs, artisans, interventions, devis et factures, clients, avis et notes, messages et paramètres. Ce besoin ne devait pas être réduit à deux panneaux de validation artisan et de garantie. Les maquettes **4 et 66** décrivent un véritable portail entreprise/partenaire, et les maquettes **14, 34–36, 44, 65 et 67** un parcours artisan métier distinct.

La lecture complète fait aussi apparaître des besoins opérationnels peu visibles dans la seule page de spécification : candidature structurée, rendez-vous, refus, contacts, rapports, preuves/photos, signature, validation de fin, factures/avoirs, dispatch, escalades et intégrations. Certains sont montrés dans les blueprints, mais leurs règles précises restent à définir. Ils ne doivent être ni oubliés, ni tous déclarés obligatoires dans le MVP sans arbitrage de périmètre.

## Documents de l’audit

- [Catalogue des 93 occurrences de maquettes et de leurs fonctions](audit/CATALOGUE_MAQUETTES.md) : PDF, page, rôle, écran, variantes et limites de lecture.
- [Inventaire complet des interfaces et back-offices](audit/FRONTEND_BACKOFFICES.md) : menus, actions, code, écarts visuels et risques statiques.
- [Inventaire complet du backend](audit/BACKEND.md) : 59 capacités examinées, fonctions SQL, routes, limites et preuves disponibles.
- [Spécifications à compléter](SPECIFICATIONS_A_COMPLETER.md) : 38 domaines de décisions et 16 contradictions/variantes à résoudre.
- [Plan de reprise](PLAN_REPRISE.md) : ordre de réalisation revu ; aucune implémentation n’est lancée par cet audit.

## Étendue et sources

Lecture de **neuf PDF, soit 102 pages**. Les quatre premiers contiennent **56 maquettes numérotées 1 à 18 et 33 à 70**. Le nouveau volume 5 contient **10 maquettes complémentaires**, identifiées ici **V5-C01 à V5-C10**. Après le volume 5 : 66 occurrences et 59 images distinctes. Avec les volumes 6 à 9 : **93 occurrences, correspondant à 63 images distinctes**. Les identités et doublons sont vérifiés par SHA-256 des images intégrées. Parmi les 27 occurrences des quatre derniers volumes, 23 reprennent des images déjà reçues et quatre sont nouvelles, toutes dans le volume 8.

Le volume 5 avait apporté trois écrans nouveaux : **V5-C01, fiche détaillée bureaux ; V5-C05, dashboard Bureaux360 ; V5-C08, approbation détaillée d’un devis syndic**. Le constat initial « références bureaux manquantes » est donc résolu. Leur implémentation reste absente. Les identifiants 19 à 32 restent non fournis : la nouvelle numérotation complémentaire ne permet pas de les leur attribuer. Ce trou de numérotation ne prouve pas à lui seul l’absence de quatorze fonctions distinctes.

| Code source | Document | Localisation |
| --- | --- | --- |
| F | SPECIFICATION_COMPLETE_FINALE_PROJET.pdf | Une page, sections 1 à 7 ; périmètre et priorités de référence |
| G | TOUT_EN_UN_MAQUETTES_GRANDES.pdf | 19 pages ; M1–M18 aux pages 1–18 ; résumé en page 1 |
| V3 | MAQUETTES_UNE_PAR_PAGE_VOLUME_3.pdf | 17 pages ; M33–M48 aux pages 2–17 |
| V4 | MAQUETTES_UNE_PAR_PAGE_VOLUME_4.pdf | 23 pages ; M49–M70 aux pages 2–23 |
| V5 | MAQUETTES_UNE_PAR_PAGE_VOLUME_5_MANQUANTES.pdf | 11 pages ; complémentaire 1–10 aux pages 2–11 ; identifiants V5-C01–C10 |
| V6 | MAQUETTES_UNE_PAR_PAGE_VOLUME_6.pdf | 7 pages ; 6 images complémentaires, toutes déjà reçues |
| V7 | MAQUETTES_UNE_PAR_PAGE_VOLUME_7.pdf | 9 pages ; 8 images locales, toutes déjà reçues |
| V8 | MAQUETTES_UNE_PAR_PAGE_VOLUME_8.pdf | 9 pages ; 8 images, dont quatre nouvelles en pages 4/6/7/8 |
| V9 | MAQUETTES_UNE_PAR_PAGE_VOLUME_9_FINAL.pdf | 6 pages ; 5 images finales, toutes déjà reçues ; aucune primauté fonctionnelle explicite |
| U | Instructions du propriétaire | Stripe, base dédiée, refus du style IA générique, conformité aux références, back-offices, audit avant nouvelle reprise du code |

Tous les fichiers API, Auth, domaine, migrations, RLS et tests ont été lus, ainsi que le composant principal de **5 274 lignes**, le CSS, les points d’entrée et les documents de suivi. Le dépôt contient **15 fichiers API**, une route de confirmation Auth, une page de récupération de mot de passe, **20 tables SQL** et **27 fonctions SQL personnalisées**. Ces nombres décrivent des fichiers et modèles présents, pas un taux d’achèvement fonctionnel.

Les sources sont hiérarchisées : le propriétaire et les règles du projet prévalent pour ses décisions ; la spécification finale prévaut sur les variantes de périmètre. Les maquettes donnent des structures et des fonctions, mais leurs marques, coordonnées, chiffres, délais, prix et lignes multi-métiers ne deviennent pas des engagements commerciaux. Le diagnostic photo IA V3 n’est pas interdit par le refus d’un style visuel IA.

## État réel des services et preuves

Contrôles **en lecture seule pendant cet audit** :

- `vercel env ls` : aucune variable applicative dans le projet Vercel courant.
- `supabase projects list` : aucun projet dédié de dépannage identifié dans la liste. La base existante « site électricité » n’a pas été utilisée, conformément au choix explicite d’une base séparée.
- Le refus de création Supabase pour facturation est un **constat historique documenté**, pas une nouvelle tentative faite pendant l’audit. Aucune création, migration, action financière ou consultation de secret n’a été exécutée.

Les **11 tests métier**, **13 groupes PostgreSQL isolés** et les parcours navigateur consignés dans QA sont des preuves **antérieures**. Ils ne sont pas présentés comme relancés pour cet audit. La CI actuelle ne prouve ni une connexion à Supabase réel, ni l’envoi d’emails, ni Storage, ni une transaction Stripe. L’attribution concurrente n’a pas encore été testée avec deux connexions distantes simultanées.

## Les espaces à distinguer explicitement

| Espace | Références | Couverture actuelle | Manque essentiel |
| --- | --- | --- | --- |
| Client particulier | F §2 ; M5/7/12/18/39/47/61/62 | Demande, liste, détail, devis, simulation paiement/avis, profil simple | Parcours connecté complet, contact, rendez-vous, notifications, documents commerciaux, retours de paiement |
| Artisan opérationnel | M14/34/35/36/44/49/60/64/65/67 | Offres, acceptation, devis, début/fin, profil simple et Connect | Espace métier distinct, candidature, disponibilités/planning, refus, contacts, justificatifs, rapports et finances |
| Entreprise cliente / syndic / partenaire B2B | F §2–4 ; M4/13/16/50/55/56/57/66 ; V5 | Types de sites, budgets simples, seuil d’approbation, contrats texte, registre et CSV | Back-office complet, équipes/délégations, fiches verticales, contacts, SLA, facturation et supervision multisites |
| Exploitant plateforme / Super Admin | M43 ; blueprints M6/52/69 | Rôle admin, approbation/suspension artisan et garantie | Tableau global et fonctions transverses artisans/clients/entreprises/interventions/finance/avis/messages/paramètres |
| Entreprise prestataire employant plusieurs artisans | M65 ; blueprints M6/52/69 | Pas de modèle dédié d’équipe prestataire | Sens d’entreprise à clarifier, dirigeant/dispatch/techniciens, organisation du travail et facturation ; périmètre à spécifier |

L’expression « super back-office entreprise » doit donc être reliée au bon acteur. Un administrateur d’entreprise cliente ne doit pas recevoir les pouvoirs du super-administrateur de la plateforme. Une entreprise prestataire n’est pas non plus automatiquement une organisation cliente B2B.

## Lecture de la matrice

- **Partiel** : interface ou commande présente, mais sous-ensemble du besoin seulement.
- **Codé, non intégré** : chemin présent sans preuve de fonctionnement avec les services réels.
- **Absent** : aucun écran ou modèle spécialisé trouvé dans le dépôt inspecté.
- **À cadrer** : périmètre/règle à préciser ; la source ne permet pas une décision arbitraire.
- Les capacités dépendant d’Auth, de la base, de Storage, de Realtime ou de Stripe restent **globalement non vérifiées en réel**, même si une ligne dit codée.
- **P0** : garde avant activation réelle ; **P1** : boucle client/artisan et fidélité ; **P2** : B2B et exploitation ; **P3** : extension avancée. Ce sont des priorités de reprise proposées, pas une réécriture silencieuse des versions F §7.
- Les références BE-* et FE-* renvoient aux annexes backend et frontend. M* renvoie au catalogue des maquettes.

## Matrice consolidée des manques

### Public et entrée dans le service

| ID | Besoin | Couverture actuelle | Source | Preuve | Manque à traiter | Priorité |
| --- | --- | --- | --- | --- | --- | --- |
| PUB-01 | Accueil et identité | Partiel | F §6 ; M11/41/51 | FE-P01 ; renderPublic/Brand | Composition et identité provisoire réinterprétées ; choisir les variantes et reprendre les structures, sans copier de marques tierces. | P1 |
| PUB-02 | Pages tarifs et barème | Absent | F §6 ; M38 | FE-P03 ; BE-05 | Fourchettes fixes dans le formulaire seulement ; manque page et barème métier validé, incluant unités, taxes et règles. | P1 |
| PUB-03 | Couverture géographique | Absent | M59 ; F §4 | FE public ; BE-06 | Pas carte/listes des zones réellement desservies ni règles d’éligibilité par territoire. | P1 |
| PUB-04 | Contact, rappel et assistance | Absent | F §6 ; M11/42/64/70 | BE-51 ; Help | Pas formulaire traité, ticket, coordonnées réelles ou circuit de rappel ; une FAQ n’assure pas ce service. | P1 |
| PUB-05 | FAQ et explication du service | Partiel | F §6 ; M46/70 | Help | Accordéons présents ; contenu non finalisé avec délais, prix, territoire et garanties validés. | P1 |
| PUB-06 | Garantie : page et conditions | Partiel | F §4/6 ; M45 | FE-P04 ; BE-29 | FAQ et dossier de suivi ne remplacent pas couverture, exclusions, attestation et processus complet. | P1 |
| PUB-07 | Recrutement et confirmation artisan | Absent comme parcours métier | M60/64/65 | FE-P02 ; AuthForm | Entrée renvoie au même signup ; pas page complète, dossier à étapes et écran de confirmation candidature. | P1 |
| PUB-08 | Mentions et informations commerciales | Absent comme contenu réel | M63 ; F §6 | Help | Identité de l’exploitant, contacts et documents commerciaux réels à renseigner ; textes d’exemple non réutilisables tels quels. | P0 |
| PUB-09 | À propos : mission, exploitant et équipe | Absent comme page dédiée | V8-C03 | renderPublic / Help ; complément V8-G01 | Prévoir la page et ses contenus réels ; ne pas inventer une histoire, une équipe, des avis, chiffres ou engagements pour reproduire les exemples. Aucun CMS n’est imposé par cette maquette. | P1 |
| PUB-10 | Confidentialité et choix des utilisateurs | Absent comme page/parcours défini | V8-C05 | renderPublic / Help ; BE-49 ; complément V8-G02 | Politique propre au produit, date/contact, préférences et traitement des demandes à définir ; le gabarit anglais YourCompany n’est pas un texte publiable validé ni une autorisation d’ajouter des traceurs. | P0 |

### Client particulier

| ID | Besoin | Couverture actuelle | Source | Preuve | Manque à traiter | Priorité |
| --- | --- | --- | --- | --- | --- | --- |
| CLI-01 | Demande structurée | Partiel | F §2/7 ; M5/15/55 | RequestForm ; BE-04 | Catégorie/description/adresse/urgence présents ; disponibilité, contact sur place et niveau d’impact non structurés. | P1 |
| CLI-02 | Photos dans la demande | Absent dans ce parcours | M5/15 | FE-C ; BE-15 | Dépôt générique possible après coup dans Documents ; aucun ajout de photos au formulaire de demande. | P1 |
| CLI-03 | Matching et absence d’artisan | Partiel | F §4 ; M9/7 | BE-06 ; available_missions | Liste des 100 offres récentes, sans classement compétences/zone/disponibilité ni solution de repli définie. | P1 |
| CLI-04 | Rendez-vous et changements | Absent | M1/3/9/40/48 ; V8-C07 | BE-09/13 | Pas créneau confirmé, replanification, no-show ou calendrier ; scheduled ne représente pas un rendez-vous. | P1 |
| CLI-05 | Suivi, déplacement, carte et ETA | Partiel | F §2/7 ; M7 ; V8-C07 | BE-13/18 ; Detail | États élémentaires présents ; pas en route/sur place, carte, itinéraire, position ou heure d’arrivée estimée. | P1 |
| CLI-06 | Identité et contact artisan | Absent comme projection autorisée | M7/62 ; V8-C06/C07 ; F §2 | BE-10 ; profiles_read ; workspace | Pas de nom/téléphone de la contrepartie fourni après attribution ; prévoir une projection minimale, pas ouvrir tous les profils. | P1 |
| CLI-07 | Devis complet et accord | Partiel | M34 ; V8-C06 ; F §2 | BE-11/12 ; FE-C09 | Lignes et acceptation présentes ; Refuser est explicitement montré dans V8-C06 mais absent du contrat de commande. Version précise, unités, validité, preuve/signature et avenant restent à développer/définir. | P1 |
| CLI-08 | Historique et documents exacts | Partiel | F §6 ; M18 ; V8-C06/C07 | FE-C10/12 ; BE-48 | Données bornées sans pagination ; ancien devis ouvre le devis actif du dossier ; récapitulatif TXT, pas document commercial complet. | P1 |
| CLI-09 | Profil, adresses et préférences | Partiel | M18 | ProfileForm ; FE-C15 | Nom/téléphone seulement ; adresses multiples, moyens enregistrés et préférences absents ; modalités à cadrer. | P2 |
| CLI-10 | Avis et gestion des retours | Partiel | F §2 ; M47/43 | ReviewForm ; BE-28 | Avis simple présent ; modération, contestation, réponse et calcul de la réputation artisan absents. | P2 |

### Back-office artisan

| ID | Besoin | Couverture actuelle | Source | Preuve | Manque à traiter | Priorité |
| --- | --- | --- | --- | --- | --- | --- |
| ART-01 | Dashboard et navigation dédiés | Absent comme espace conforme | M35/36 ; U | FE-A01/02 ; Overview/nav | Missions du jour, horaires, onglet Devis, navigation basse et tableau de performance manquent. | P1 |
| ART-02 | Candidature : identité et société | Absent au-delà du signup | M65 | FE-A03 ; BE-16 | Entreprise, SIRET, statut juridique, effectif, adresse, site et qualification non modélisés. | P1 |
| ART-03 | Justificatifs et examen du dossier | Partiel | M14/36/43/65 | BE-15/16 ; DocumentManager | Pas catégories de pièces, validité, expiration, remplacement, motif d’examen/refus ni dossier consultable depuis la candidature. | P1 |
| ART-04 | Disponibilités, zones et capacité | Absent | M35/65 ; M6/69 | BE-09 ; ProfileForm | Pas jours/plages, zone, rayon, capacité ou indisponibilité ; la prise de mission ne vérifie aucun planning. | P1 |
| ART-05 | Réception des offres et refus | Partiel | M8/44/67 | FE-A07/08 ; BE-06/08 | Acceptation atomique présente ; aucun refus individuel, expiration, relance ou désistement/réaffectation. | P1 |
| ART-06 | Localisation et contact client | Absent | M44/67 | FE-A09/10 ; BE-10 | Pas distance, trajet, ETA, disponibilité client ou appel autorisé après attribution. | P1 |
| ART-07 | Devis métier et révision | Partiel | M34 | QuoteEditor ; FE-A12/13 | Pas photos/pièces jointes dans l’éditeur, brouillon serveur ni correction depuis quoted malgré la commande SQL possible. | P1 |
| ART-08 | Actions adaptées au rôle | Partiel avec incohérence | M35/66 ; F §2 | FE-A16 ; Requests | L’artisan voit encore Nouvelle demande et des actions client que le serveur refuse. | P1 |
| ART-09 | Compte rendu et clôture terrain | Absent comme rapport structuré | M1/6/52/58/69 | BE-13/52/53 | Pas bon d’intervention, mesures/tests, temps/pièces, photos avant-après, signature sur site ou validation de fin. | P1 |
| ART-10 | Profil professionnel et performance | Absent au-delà du profil simple | M35/36 | FE-A06 ; BE-28 | Pas fiche société, documents vérifiés, réputation, ponctualité, CA mensuel ou statistiques détaillées mesurées. | P2 |
| ART-11 | Règlements, net et versements | Partiel | F §2 ; M35/60 | FE-A15 ; BE-24 | Connect n’est pas un grand livre ; solde, commission, échéance, virement reçu et échecs de reversement ne sont pas suivis. | P1 |
| ART-12 | Entreprise prestataire et techniciens | À cadrer, absent | M65 ; M6/52/69 | BE-31/32 ; absence modèle prestataire | Distinguer dirigeant/dispatch/techniciens et attribution interne ; ne pas confondre avec l’entreprise cliente. | P2 |

### Back-office entreprise cliente et verticales

| ID | Besoin | Couverture actuelle | Source | Preuve | Manque à traiter | Priorité |
| --- | --- | --- | --- | --- | --- | --- |
| ENT-01 | Organisation et espace propres | Partiel | F §1–3 ; M4/66 | FE-B01/08 ; BE-31 | Pas onboarding entreprise complet, identité/facturation, organisation active ou vrai tableau dédié. | P1 |
| ENT-02 | Membres, droits, délégations | Absent comme parcours | M4/13/16/66 ; U | BE-32 ; FE-B08/09 | Table de membres présente mais invitations, rôle, retrait, sites autorisés et transfert de propriété non administrables. | P0 |
| ENT-03 | Portefeuille de sites | Partiel | F §2–3 ; M4/66 | create_site ; SiteForm | Création et budget seulement ; pas édition complète, archivage, hiérarchie groupe/bâtiment/zone ou recherche paginée. | P2 |
| ENT-04 | Fiche site détaillée | Absent | F §3 ; M16/50/57 | FE-B02/03 ; BE-33 | Pas vue détaillée interventions/budget/contacts/documents/alertes, horaires ou consignes d’accès. | P2 |
| ENT-05 | Syndic / copropriété | Partiel | F §2 ; M13/16/55 | BE-34 ; Sites | Type syndic seulement ; parties communes, interlocuteurs, budget par exercice et rapports AG absents ; gestion immobilière globale à délimiter. | P2 |
| ENT-06 | Restauration : dashboard et tickets | Absent comme métier dédié | F §3 ; M50/56 | FE-B04 ; BE-35 | Pas tableau des sites impactés, tickets critiques, état cuisine/froid/éclairage ni mesure SLA exploitation. | P2 |
| ENT-07 | Restauration : équipements | Absent comme inventaire | M50/56 ; F §3 | BE-35 ; FE-B15 | Registre texte générique ; pas équipement identifié, état/criticité, dernier contrôle ou lien au ticket. | P2 |
| ENT-08 | Bureaux : dashboard et maintenance | Absent comme surface dédiée | F §3 ; V5-C01/C05 | BE-36 ; FE-B05 | Références désormais fournies : fiche bâtiment/étages/zones/contacts/documents, dashboard occupation/MWh/budgets/maintenance ; ces écrans et données restent à développer. | P2 |
| ENT-09 | Bureaux : consommation | Absent | F §3 ; V5-C01/C05 | BE-36 | Pas source de mesures, compteurs/unités/périodes ou reporting énergétique. | P3 |
| ENT-10 | ERP : tableau, audits et réserves | Partiel très limité | F §3/7 ; M37/57 | BE-37 ; FE-B06 | Notes d’audit/sécurité ne forment pas un référentiel, calendrier d’audits, suivi des réserves ou moteur de conformité. | P2 |
| ENT-11 | Urgences graduées et SLA | Absent au niveau demandé | F §3–4 ; M50/55/56 | BE-42/56 ; FE-B11 | Deux valeurs urgent/scheduled au lieu des niveaux B2B montrés ; pas horloges, échéances, dépassements ou escalades. | P2 |
| ENT-12 | Approbations et validation des travaux | Partiel | F §2/4/7 ; M6/52/69 ; V5-C08 | BE-38 ; ProfessionalOperations | Un seuil/site et un rôle ; pas dossier détaillé avec validité/pièces jointes, demande de complément d’information, historique acteur/date/commentaire, suppléance ou validation de réception/facture. | P2 |
| ENT-13 | Contrats et grilles tarifaires | Partiel | F §4 ; M50/66 | BE-39/40 ; FE-B13 | Texte libre sans grille calculable, périmètre sites/artisans, documents liés, versions ou application au devis. | P2 |
| ENT-14 | Budgets et alertes | Partiel | F §2–4 ; M13/16/50/57 | BE-41 ; FE-B10 | Budget de référence unique ; pas période, postes/enveloppes, dépassement contrôlé, réservations ou alertes notifiées. | P2 |
| ENT-15 | Reporting et exports | Partiel | F §2–4 ; M4/66 | BE-43 ; FE-B16/17 | CSV financier présent ; pas dashboard consolidé complet, dates/AG/énergie, planification ; filtres de site ne portent pas tous les panneaux. | P2 |
| ENT-16 | Factures, payeur et intégrations | Partiel / absent | M6/52/66/69 ; F §2/4 | BE-21/26/55 | Pas facturation/avoirs/relances/ERP ; payeur limité au créateur exact, pas délégation financière définie. | P2 |

### Super-administration de plateforme

| ID | Besoin | Couverture actuelle | Source | Preuve | Manque à traiter | Priorité |
| --- | --- | --- | --- | --- | --- | --- |
| ADM-01 | Tableau global et KPI | Absent | M43 | FE-S01 ; Admin | Pas CA HT mensuel/annuel, tendances, tableau des interventions globales ou validations documentaires détaillées. | P1 |
| ADM-02 | Artisans : annuaire et candidature | Partiel | M43/65 | BE-46 ; ArtisanAdministration | Liste nom/date/booléen uniquement ; dossier, recherche, compétences, zones, pièces et motifs manquent. | P1 |
| ADM-03 | Interventions, dispatch et escalades | Absent | M43 ; M6/52/69 | BE-54 ; FE-S03 | Pas affectation manuelle, réattribution, gestion d’indisponibilité ni tableau d’urgences opérateur. | P1 |
| ADM-04 | Clients, entreprises et contacts | Absent comme gestion | M43/66 | FE-S05 ; BE-46 | Pas fiches client/organisation, recherche globale, équipes et historique opérateur. | P2 |
| ADM-05 | Devis, factures et finance | Absent comme back-office | M43 ; M6/69 | FE-S04 ; BE-25/26 | Pas vues commerciales complètes, commissions nettes, remboursements, avoirs, rapprochement ou litiges. | P1 |
| ADM-06 | Avis et notes | Absent comme administration | M43 | FE-S06 ; BE-57 | Pas recherche, modération, contestation, traitement ou suivi des performances. | P2 |
| ADM-07 | Messages et assistance | Absent comme centre opérateur | M43 ; M6/58/69 | FE-S07 ; BE-51 | Messagerie des dossiers ne remplace pas une boîte support/tickets/escalades et attribution aux équipes. | P2 |
| ADM-08 | Paramètres plateforme | Absent | M43 | FE-S08 ; BE-57 | Pas administration des tarifs, secteurs, règles, commissions, abonnements ou notifications ; droits à cadrer. | P2 |
| ADM-09 | Rôles et traçabilité sensibles | Partiel | M43 ; contrôle d’exploitation à cadrer | BE-03/47 ; FE-S10/11 | Rôle admin global sans séparation support/finance ; journaux partiels sans écran de consultation/avant-après. | P0 |
| ADM-10 | Garantie et dossiers liés | Partiel | F §4 ; M45 | BE-29/30 ; WarrantyPanel | Dossier et décision présents ; pas mission corrective, preuves liées, SLA ou vue directe client/artisan/intervention complète. | P2 |

### Paiements et monétisation

| ID | Besoin | Couverture actuelle | Source | Preuve | Manque à traiter | Priorité |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-01 | Checkout et Connect | Codé, non intégré | U Stripe ; F §2/5 | BE-20/21 ; app/api/payments | Clés test, pays/responsabilités, compte artisan et scénarios réels à configurer et vérifier. | P0 |
| FIN-02 | Webhooks, montants et reprise | Codé, non intégré | F §2 ; contrôle technique | BE-22 ; confirm_stripe_payment | Signature/idempotence codées ; événement réel signé, répétition et concurrence à tester en intégration. | P0 |
| FIN-03 | Retour paiement et Auth | Incomplet | Parcours F §2 ; FE-X02/08 | BE-59 ; init CourantApp | Paramètres payment/intervention/connect/auth émis par le serveur mais non consommés par l’interface principale. | P0 |
| FIN-04 | Échec, remboursement et litige | Absent | M1/6/58/69 ; règles à cadrer | BE-25 | État failed peuplé par aucun handler actuel ; refund/dispute/payout non synchronisés. | P0 |
| FIN-05 | Factures et avoirs | Absent | M43/66 ; M6/52/69 | BE-26 | Pas modèle, numérotation, PDF, émetteur/taxes, facture de prestation/commission ou avoir. | P1 |
| FIN-06 | Commission et reversements | Partiel | F §5 ; M35/43/60 | BE-23/24 | Paramètre de commission seulement ; pas historique de taux, suivi net/frais, échéancier ou rapprochement bancaire. | P1 |
| FIN-07 | Abonnements et services premium | Absent | F §5 ; M33 | BE-27 | Offres client/artisan/B2B à définir, puis souscription, quotas, renouvellement, résiliation et impayés à développer. | P3 |
| FIN-08 | Moyens enregistrés et options | À cadrer, absent | M12/18 | FE-C15 ; BE-21 | PayPal, wallets et fractionné sont montrés comme options ; le code autorise Checkout card. Définir ce qui doit être livré avec Stripe. | P3 |

### Fonctions transversales et qualité

| ID | Besoin | Couverture actuelle | Source | Preuve | Manque à traiter | Priorité |
| --- | --- | --- | --- | --- | --- | --- |
| SYS-01 | Base et services réels | Bloqué / non configuré | U base dédiée ; F §1 | Contrôles Vercel/Supabase actuels | Aucune variable applicative ni base dédiée identifiée ; pas preuve de fonctionnement réel d’Auth/Storage/Realtime. | P0 |
| SYS-02 | Isolation du cache et des vues | Risque statique à reproduire | Contrôle de sécurité avant activation | FE-X01 ; logout/onHash/Sites | professional non effacé à la déconnexion et vues hash sans garde de rôle ; risque d’affichage de données précédentes dans la même SPA. RLS serveur reste en place. | P0 |
| SYS-03 | Propriété des dossiers d’entreprise | À cadrer avant gestion des membres | M4/66 ; modèle d’organisation | BE constat offboarding | client_id conserve des droits même après un futur retrait de membre ; définir propriété organisationnelle et révocation effective. | P0 |
| SYS-04 | Chat et notifications | Partiel / notifications absentes | F §4 ; M39/62 | BE-17/19 ; FE-X05/06 | Texte seulement, sans participants nommés, pièces jointes, lu/non-lu ni centre de notifications ; aucune livraison email/SMS/push. | P2 |
| SYS-05 | Temps réel cohérent | Partiel, non intégré | F §4/7 | BE-18 ; FE-X04 | Trois tables seulement ; pas mise à jour pro/garantie/sites ni GPS. Les nouvelles offres non lisibles par RLS nécessitent un mécanisme adapté. | P2 |
| SYS-06 | Documents et archivage | Partiel / automatisation absente | F §4 ; M14/34/50/57/65 | BE-15/44 ; FE-A05 | Pas liens directs site/contrat/audit, catégories, expiration, version/suppression ni archivage automatique ; limite 4 Mo différente de certaines sources 10 Mo. | P2 |
| SYS-07 | Recherche, pagination et indicateurs | Partiel | M4/35/43/66 | BE-48 ; FE-X03 | Fenêtres bornées, compteurs locaux et filtres non homogènes ; pas de chargement de l’historique complet. | P1 |
| SYS-08 | Accessibilité et distribution | Partiel / à cadrer | U ; M35/61 ; DESIGN.md | Annexe frontend a11y | Web uniquement ; tabbar métier absente, menu mobile/focus/états ARIA à vérifier ; pas certification accessibilité ni application native livrée. | P1 |
| SYS-09 | Exploitation, sauvegarde et données | À cadrer / non prouvé | Complément opérationnel, pas détail imposé par F | BE-49/50 ; Q-PDF-36 | Politique de conservation/effacement, sauvegarde/restauration, supervision, support et objectifs mesurables à définir et valider. | P0 |
| SYS-10 | Diagnostic photo IA | Absent | F §4/7 V3 | BE-45 | Fournisseur, données envoyées, évaluation, limites et revue humaine non définis ; aucune sortie simulée ne doit combler ce manque. | P3 |

## Apport précis du nouveau volume 5

| Référence | Page | Apport | Conséquence pour le code et les spécifications |
| --- | --- | --- | --- |
| V5-C01 | 2 | Fiche bâtiment bureaux : étages et zones, caractéristiques, historique, maintenance, énergie/budget, contacts et documents | Remplacer le simple type office par un modèle et une fiche métier ; définir la provenance des mesures et les périmètres de budgets |
| V5-C05 | 6 | Dashboard Bureaux360 : bâtiments, occupation, consommation MWh, interventions, maintenance, budgets et alertes | Reprendre les indicateurs et leur disposition ; préciser sources, unités, périodes et calculs, sans copier les valeurs d’exemple |
| V5-C08 | 9 | Approbation détaillée : référence, fournisseur, propriété, montant/TVA, validité, documents, décisions et historique nominatif | Compléter la règle de seuil avec un véritable dossier de décision et les demandes/réceptions de compléments |
| V5-C02/C03/C04/C06/C07/C09/C10 | 3/4/5/7/8/10/11 | Doublons exacts respectifs de M57/M50/M56/M37/M13/M16/M55 | Ne pas créer sept nouveaux écrans artificiels ni additionner deux fois les exigences |

La pièce jointe a été copiée sans altération dans le dossier du projet. Le nouveau volume complète les références visuelles ; il ne connecte pas le backend et ne remplit pas automatiquement les règles métier manquantes.

## Écarts qui doivent modifier la prochaine reprise

### Avant activation réelle

1. Reproduire et corriger l’isolation du cache professionnel et les autorisations de vues ; conserver les contrôles serveur, ne pas les remplacer par du masquage de menus.
2. Définir les organisations, membres, payeurs et départs de salariés avant d’ajouter des équipes ; vérifier les permissions sur de vrais comptes distincts.
3. Configurer la base dédiée et les services uniquement lorsque les accès le permettent ; ne pas toucher une autre base.
4. Traiter explicitement les retours Auth/Checkout/Connect et les erreurs. Tester paiements, reprises, remboursements et états financiers attendus avant ouverture commerciale.
5. Distinguer les preuves historiques de démonstration, les commandes codées et l’intégration réellement vérifiée.

### Pour respecter les maquettes

1. Reprendre le back-office artisan avec candidature, justificatifs, navigation, missions/planning, devis, rapports et règlements propres au métier.
2. Reprendre le back-office entreprise avec équipes, portefeuille et vraies fiches de sites ; reprendre les surfaces bureaux désormais fournies en V5-C01/C05.
3. Créer une super-administration correspondant à M43 ; ne pas renommer la vue client et la considérer complète.
4. Comparer chaque écran aux références choisies et documenter les adaptations, surtout là où les variantes se contredisent.

### Pour compléter les spécifications

Utiliser le [registre des décisions](SPECIFICATIONS_A_COMPLETER.md). Il couvre notamment les quatre sens de l’entreprise, les plateformes, les rôles, les candidatures, le matching, les rendez-vous, les données privées, les prix/commissions, les factures et paiements, la garantie, les SLA, les verticales, les intégrations et les limites IA. Les 16 contradictions ne doivent pas être résolues en copiant au hasard un écran.

Le périmètre demeure le dépannage électrique. Les exemples plomberie, multi-métiers, comptabilité immobilière globale ou conformité incendie/hygiène ne justifient pas un élargissement automatique. Les besoins assureurs/occupants/entreprise prestataire évoqués dans les blueprints restent explicitement à cadrer.

## Apport des volumes 6 à 9

- **V6 :** 7 pages, 6 occurrences, aucune image nouvelle. **V7 :** 9 pages, 8 occurrences, aucune image nouvelle. **V9 :** 6 pages, 5 occurrences, aucune image nouvelle.
- **V8 :** 9 pages, 8 occurrences ; V8-C03 À propos, V8-C05 confidentialité, V8-C06 devis client et V8-C07 détail intervention sont quatre nouvelles images. Les quatre autres sont des doublons.
- Deux nouvelles lignes de couverture publique sont ajoutées : PUB-09 et PUB-10. Les nouveaux détails client renforcent les lignes CLI existantes plutôt que compter artificiellement une nouvelle fonction pour chaque image répétée. La matrice passe donc de **74 à 76 points**.
- Le refus de devis, le PDF commercial, la fiche artisan, le contact, les photos, l’adresse détaillée, l’historique et la modification de rendez-vous disposent maintenant de références supplémentaires explicites ; leur implémentation reste incomplète ou absente.
- Les histoires d’entreprise, équipes, notes, certifications, promesses de support et coordonnées des images restent illustratives. La politique YourCompany est un exemple générique anglais à remplacer selon le produit réel, pas une politique validée ni une demande d’ajouter des cookies marketing.
- Satisfaction 30 jours et garantie de travaux un an ne sont pas automatiquement la même garantie ; l’annulation gratuite 48 h est un exemple à arbitrer. La timeline À planifier après En cours ne doit pas devenir un graphe d’état incohérent. Les exemples peinture/plomberie n’élargissent pas le périmètre électrique.
- Les mots complémentaires/final et les numéros locaux 1–8 ou 1–5 ne remplacent ni la spécification fonctionnelle ni les numéros initiaux 19–32.

Références et preuves : [volumes 6/7](audit/COMPLEMENTS_VOLUMES_6_7.md), [volume 8](audit/COMPLEMENT_VOLUME_8.md), [volume 9](audit/COMPLEMENT_VOLUME_9.md), et le manifeste des sources dans audit/INVENTAIRE_SOURCES.json.

## Ce qui peut être conservé

- Les types et fonctions de domaine : calcul en centimes, transitions, comparaison des références financières et protection CSV.
- Les commandes SQL d’attribution atomique, de devis, de paiement signé/idempotent, les RLS et les restrictions sur les mutations directes, après les vérifications distantes nécessaires.
- Les contrôles de formulaires et les états existants utiles, la séparation explicite de la démonstration et du réel, les confirmations intégrées et les composants accessibles réutilisables.
- Les API professionnelles déjà présentes comme sous-ensemble, sans les déclarer équivalentes aux fiches et workflows complets.
- Le dépôt, la CI et les outils de preview, avec un découpage plus clair des responsabilités et des preuves.

Conserver ces éléments n’interdit pas de corriger leurs limites. Une reprise visuelle ne doit pas supprimer les protections serveur déjà codées.

## Périmètre de cet audit et suivi

Cet audit est complet sur les fichiers et pages disponibles, pas une garantie qu’aucun besoin futur n’existe. Il ne prétend ni certifier la conformité réglementaire, ni démontrer une faille exploitée, ni revalider chaque service distant. Les risques statiques sont signalés avec leur niveau de preuve ; ils restent à reproduire dans un environnement de test avant activation.

Aucun code applicatif, PDF source, secret, service distant ou déploiement n’a été modifié. Les changements de cette étape sont exclusivement documentaires. Les éléments seront ensuite suivis individuellement comme **à spécifier / à coder / codé / connecté / vérifié / bloqué** ; aucun groupe de fonctions ne doit être marqué terminé sur la seule existence d’un écran.

## Archives de code reçues après les PDF

[Audit des quatre archives](audit/ARCHIVES_CODE.md) : 44 occurrences de fichiers, 16 fichiers distincts dont 12 composants JSX. Les archives 1/2/4 sont des sous-ensembles exacts de la troisième. Elles apportent des bases de composition, sans serveur, Stripe ou Super Admin. Aucun manque de la matrice n’est déclaré résolu ; les comptes PDF et les 76 capacités restent inchangés. Les originaux et empreintes sont conservés séparément.

Cinquième archive analysée : `CODES_CSS_ANIMATIONS`, 17 membres dont 14 identiques, HomePage/styles modifiés et animations.css nouveau. Cumul : 61 occurrences, 17 chemins et 19 contenus distincts. Aucun écran métier supplémentaire ; matrice inchangée. Risques de mouvement et de collisions CSS consignés dans [l’annexe](audit/ARCHIVES_CODE.md).
