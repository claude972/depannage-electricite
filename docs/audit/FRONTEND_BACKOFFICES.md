# Inventaire des interfaces et back-offices

Annexe factuelle de [l’audit consolidé](../AUDIT_COMPLET_SPECIFICATIONS.md). État du code : `46aac2a`, 30 octobre 2026. Lecture des sources et du code ; aucun test live nouveau ni modification applicative. Les lignes sont celles de cet instantané.


Date du contexte utilisateur : 30 octobre 2026. Aucun code applicatif modifié pendant la collecte ; aucun déploiement ni test de compte réel exécuté pendant cet audit.

## Actualisation des références avec le volume 5

Le code audité n’a pas changé. Les références bureaux auparavant absentes des quatre premiers PDF sont désormais fournies par V5-C01 (fiche) et V5-C05 (dashboard). V5-C08 précise le workflow d’approbation. Leurs fonctions restent non implémentées dans la version inspectée. Lire le [complément volume 5](COMPLEMENT_VOLUME_5.md) et la matrice consolidée pour l’état documentaire courant.

## Sources consultées et étendue

- AGENTS.md et DESIGN.md intégralement.
- components/courant-app.tsx intégralement (5 274 lignes), app/globals.css intégralement (4 424 lignes).
- app/page.tsx, layout.tsx, error.tsx, loading.tsx, not-found.tsx ; app/auth/confirm/route.ts, app/auth/reset-password/page.tsx et son CSS.
- app/api/workspace/route.ts, app/api/admin/artisans/route.ts, app/api/reviews/route.ts ; inventaire de toutes les routes (l'audit détaillé serveur est délégué à la revue complémentaire).
- docs/QA.md ; spécification finale PDF (une page) : texte complet extrait et lu.
- Images PDF rendues et inspectées : volume 3 pages 3/4/5/6/12/13 (maquettes 34/35/36/37/43/44), volume 4 pages 3/18/19/20 (maquettes 50/65/66/67). D'autres références présentes dans le contexte hérité ne sont pas présentées ici comme nouvellement inspectées.
- Aucun accès cloud/facturation/secrets revérifié pendant cet audit. Les blocages distants sont l'état documenté, pas une preuve nouvelle.

## État général

La page app/page.tsx ne fait que rendre CourantApp. Les espaces sont des vues conditionnelles d'une SPA avec hash (#overview, #missions...) et non des parcours indépendants /artisan, /entreprise, /admin. Une coque commune, un tableau commun Overview(), une liste commune Requests(), un détail commun Detail() et un profil commun sont adaptés par quelques conditions de rôle. Le rôle live vient du profil serveur ; le sélecteur de rôle est uniquement en démo.

Le découpage par rôle ne suffit donc pas à appeler ces vues des back-offices complets. L'absence de connexion distante concerne toutes les capacités live, y compris celles dont l'interface existe. L'audit distingue ces deux limites.

## Inventaire exhaustif des menus / vues

### Public

- En-tête : accueil via marque, Comment ça marche → Help, Vous êtes artisan ? → même AuthForm signup, Se connecter → même AuthForm login.
- Accueil : CTA demande, démonstration, cinq catégories (coupure, tableau, prise/interrupteur, éclairage, diagnostic), explication en trois étapes, entrée démo professionnelle.
- Footer : aide et informations, nom de travail et service en préparation.
- Vues accessibles : accueil, new, auth, help. Les autres hashes retombent sur l'accueil en mode public.
- Pas de pages publiques séparées tarifs, garantie, contact, recrutement détaillé, zones d'intervention, mentions légales/conditions.

### Client

- Vue d'ensemble ; Mes demandes (compteur dossiers actifs) ; Messages (compteur nombre total de messages) ; Documents.
- Bas de navigation : Aide et informations, Mon profil, Se déconnecter / quitter démo.
- Actions secondaires : nouvelle demande, détail, formulaire avis après état paid, suivi après intervention.
- Historique via filtre Terminées/Past, pas d'entrée dédiée.

### Artisan

- Exactement la coque précédente ; Mes missions remplace Mes demandes, Overview remplace CTA Nouvelle demande par Voir les missions.
- Pas d'onglet Devis dédié malgré maquette 35 ; devis consultables par dossiers/Documents.
- Pas de menu disponibilités, calendrier, performances, règlements/historique financier, justificatifs métier dédiés.
- La liste Requests() conserve un bouton Nouvelle demande et son état vide propose Créer une demande, alors que le serveur refuse create_intervention aux artisans (référence donnée à l'agent backend).
- Profil générique nom/téléphone avec statut approuvé et bouton Connect, pas profil entreprise artisan complet.

### Professionnel / entreprise

- Coque commune et menu client + Mes sites.
- Mes sites : filtre type (tous/syndic/restaurant/office/ERP), filtre site, cartes génériques, budget, compte de dossiers, accès liste interventions et demande, ajout site.
- Pilotage ajouté sous les cartes : Approbations, Contrats cadres, Audits et maintenance, rapport CSV.
- Pas de menu équipes/artisans/contacts/SLA/facturation/commandes/paramètres d'organisation ; pas de sélection d'organisation active.

### Administrateur plateforme

- Coque commune et menus client + Administration.
- Administration contient uniquement ArtisanAdministration et WarrantyPanel : liste approbation/suspension artisans et suivi des dossiers de garantie.
- Les listes de dossiers accessibles par les autres vues ne constituent pas un outil d'exploitation global : mêmes limites, mêmes filtres client, pas de recherche par client/entreprise/artisan, pas d'affectation/réaffectation.
- Le « super back-office entreprise » (administration d'un groupe/organisation) et la super-administration de plateforme ne sont pas distingués dans le modèle UI.

## Matrice fonctionnelle frontend

Statuts : PRESENT PARTIEL = interface/actions existent avec périmètre limité ; ABSENT = pas d'écran/action trouvé ; DEMO = simulation locale ; BLOQUE = dépendance externe documentée. Aucun statut ne vaut validation live.

### Client et service public

| ID | Besoin / source | État observé / manque précis | Preuve code |
|---|---|---|---|
| FE-P01 | Accueil | Présent, mais nouvelle composition/identité Courant et panneau d'étapes ; pas de photographie métier de certaines maquettes | renderPublic 1172–1345 ; Brand457 |
| FE-P02 | Recrutement artisan (maquette65) | Absent comme parcours ; simple inscription avec choix rôle | renderPublic1200 ; AuthForm3715 |
| FE-P03 | Tarifs (spec6) | Page absente ; fourchettes d'exemple visibles seulement lors demande | RequestForm3160 ; Help2560 |
| FE-P04 | Garantie (spec6) | FAQ et suivi après paiement, pas page de couverture/conditions détaillée | Help ; WarrantyPanel4826 |
| FE-P05 | FAQ (spec6) | Sept accordéons présents, aucun moteur de recherche ; ce dernier est une amélioration possible, pas exigence explicite | Help2560 |
| FE-P06 | Contact (spec6) | Informations futures uniquement ; aucun formulaire de contact/ticket/message transmis | Help2628 |
| FE-P07 | Mentions / conditions | Texte annonçant publication future ; opérateur et coordonnées absents | Help2628 |
| FE-P08 | Zones desservies | Aucun écran / moteur zone ; ville/postal libres ; couverture réelle non définie | RequestForm3068 |
| FE-C01 | Demande / estimation | Formulaire trois étapes, catégorie+description, lieu/urgence, récapitulatif ; estimate indicatif correctement nommé | RequestForm2966–3273 |
| FE-C02 | Photos pendant demande | Absent dans RequestForm ; upload possible plus tard par Documents uniquement | RequestValues2956 ; RequestForm ; DocumentManager3944 |
| FE-C03 | Créneau / disponibilités | Seulement urgent ou scheduled ; aucun jour/heure/créneau à réserver ni contact sur place | RequestValues ; urgency-options3110 |
| FE-C04 | Rattachement site | Select possible ; bouton Demande d'une carte site ne préremplit pas le site, donc risque d'erreur de contexte | Sites2365 ; newRequest945 |
| FE-C05 | Brouillon demande | sessionStorage 30min avant Auth ; valeurs préservées entre étapes. Pas de brouillon serveur | init760 ; NewRequest1669 |
| FE-C06 | Matching | Liste et état d'attente ; aucun choix, classement, carte, distance, ETA ou progression de recherche | Overview ; Detail1960 |
| FE-C07 | Suivi | Timeline états + abonnement Realtime interventions/quotes/messages ; pas suivi GPS/en route/arrivé | useEffect807 ; Detail1791 |
| FE-C08 | Artisan assigné | Aucun panneau identité/qualifications/coordonnées de l'artisan dans Detail | Detail1730–2073 |
| FE-C09 | Devis | Lignes, HT/TVA/TTC et acceptation présents ; pas refus explicite/contre-proposition, signature ou révision client | Detail1830 |
| FE-C10 | Documents devis | Télécharger récapitulatif TXT uniquement, pas devis PDF/facture ; anciens devis listés mais clic choisit le dossier et recharge le devis actif, pas la version sélectionnée | Detail1889 ; Documents2120 ; currentQuote903 |
| FE-C11 | Paiement | CTA Stripe après completed, démo explicite séparée ; pas écran/état dédié retour success/cancel, query paiement ignorée | checkout1081 ; Auth/init ; Detail2018 |
| FE-C12 | Historique | Filtres active/all/past + recherche locale dans données bornées ; pas pagination ni recherche serveur ; annulés rangés avec terminés | Requests1581 |
| FE-C13 | Avis | Notes1–5/commentaire après paid ; pas modification d'avis ou signalement abus/contestation | ReviewForm3877 |
| FE-C14 | Garantie | Saisie/états/réponse présents, bloque commercial hors démo ; pas automatisation garantie/statut date affichée/conditions rattachées | WarrantyPanel4826 |
| FE-C15 | Compte | Inscription/login/reset ; profil nom/téléphone seulement. Pas changement email/password connecté, suppression/export compte ou préférences | AuthForm3715 ; ProfileForm3644 |

### Artisan

| ID | Besoin / source | État observé / manque précis | Preuve |
|---|---|---|---|
| FE-A01 | Dashboard métier (35) | Dashboard client adapté ; pas missions du jour/créneaux, note moyenne, CA mensuel, évolution/performance | Overview1386 |
| FE-A02 | Navigation dédiée mobile (35/36) | Sidebar masquée + hamburger sous760px, aucune tabbar basse Dashboard/Missions/Devis/Messages/Profil | nav914 ; CSS2523 |
| FE-A03 | Candidature complète (65) | Nom/email/password/rôle uniquement ; pas société/SIRET/statut/nombre salariés/site/certifications/adresse pro/qualification/zone/disponibilité | AuthForm3715 |
| FE-A04 | Confirmation candidature (64 cité contexte) | Simple message signup/email confirmation, pas écran ni dossier de candidature complet | Auth2660 |
| FE-A05 | Documents assurance métier (36/65) | Dépôt générique personnel/dossier ; pas type KBIS/RCPro/diplôme, date validité, statut par document, dossier approbation | DocumentManager3944 ; ProfileView2480 |
| FE-A06 | Profil performance (36) | Avatar initiales, nom/téléphone/statut seulement ; pas raison sociale, réputation, satisfaction, ponctualité, ancienneté ou stats détaillées | ProfileForm3644 ; ProfileView2480 |
| FE-A07 | Offres disponibles / réception | Filtre requested présent ; pas notification push/timer/prise de contact dédiée ; offres et missions attribuées partagent même liste et indicateurs | Requests1581 ; active896 |
| FE-A08 | Refus mission (44/67) | Pas de bouton Refuser ni logique de masquage individuel. UI seulement Accepter | Detail1990 |
| FE-A09 | Localisation / distance / ETA (44/67) | Absent ; adresse masquée avant acceptation live ; pas carte/itinéraire | Detail1774 |
| FE-A10 | Appeler client (44/67) | Aucun lien tel ni contact client accessible dans le détail | Detail1730 |
| FE-A11 | Disponibilité / secteur (65) | Aucun réglage disponibilité/jours/plage/zone d'intervention | ProfileForm3644 |
| FE-A12 | Création devis (34) | Fonctionnelle basique lignes/quantité entière/PU/TVA ; pas photos/documents dans l'éditeur, pas draft serveur ou section typée pièces | QuoteEditor3275 |
| FE-A13 | Révision devis | RPC serveur peut recevoir send_quote en quoted mais UI éditeur affiché seulement assigned ; pas corriger/renvoyer depuis quoted | Detail1920 |
| FE-A14 | Intervention | Démarrer/Terminer présents ; pas rapport d'intervention signé/photos avant-après/temps réel travail/compte rendu | Detail1995 |
| FE-A15 | Règlements | Bouton onboarding Connect dans profil ; pas liste payouts, net/commission, factures ou rapprochement des versements | ProfileView2530 |
| FE-A16 | Mauvaises actions client | Nouvelle demande visible dans Requests et état vide, catégories quick-start aussi pour artisan ; parcours que le serveur ne permet pas | Requests1600 ; requestList1160 ; Overview1521 |

### Entreprise / syndic / B2B

| ID | Besoin / source | État observé / manque précis | Preuve |
|---|---|---|---|
| FE-B01 | Dashboard par vertical (spec3) | Seul Overview générique et filtre type site ; pas quatre tableaux dédiés | Overview1386 ; Sites2186 |
| FE-B02 | Fiche détaillée site (spec3) | Aucune vue/route détail site, seulement cartes. Pas onglets interventions/budget/contacts/documents/alertes par site | Sites2186–2477 |
| FE-B03 | Contacts site (50) | Aucun contact/responsable/horaires/tel/mail ni action contacter | Site type69 ; SiteForm3557 |
| FE-B04 | Restaurant (50/spec3) | Type/restauration et texte Équipements critiques ; pas états cuisine/froid/éclairage, inventaire équipements, panne critique ou SLA exploitation | Sites ; ProfessionalOperations4710 |
| FE-B05 | Bureaux (spec3) | Registre échéance générique ; pas bâtiments/zones, consommation énergétique, maintenance récurrente | ProfessionalOperations4660 |
| FE-B06 | ERP (37/spec3) | Registre audit/maintenance/sécurité générique ; pas établissements détaillés/typeERP, score de conformité, obligations, audits datés structurés, signaux prioritaires/planning | ProfessionalOperations4660 |
| FE-B07 | Syndic (spec2) | Sitesmulti-immeubles et budget possible ; pas immeuble détaillé/lots/contacts/rapports AG | Sites ; SiteForm |
| FE-B08 | Membres et organisation | Aucun sélecteur organisation ou gestion des membres/invitations/délégations ; contrats créés sur organizations[0].id implicitement | ProfessionalOperations4579 |
| FE-B09 | Droits lecteur/manager/owner | Le profil ne contient que rôle global manager, pas capacité membre. Tous les boutons pro visibles quel que soit droit org ; serveur peut refuser | Profile type ; Sites ; ProfessionalOperations |
| FE-B10 | Budget | Budget référence + sommes devis chargés, explicite partiel ; pas périodes/enveloppes/alertes budgétaires et pas écran consolidé analytique | Sites2255 ; BudgetEditor5085 |
| FE-B11 | SLA | Aucun écran niveau service/délai garanti/escalade/alertes | Sites footer2464 ; spec4 |
| FE-B12 | Approbations | Seuil TTC par site +required roleowner/manager+note/décision ; pas graphe multi-étapes, délégation, délais, historique UI, compteur réellement pending seul | ProfessionalOperations4399 |
| FE-B13 | Contrats | Liste/details/créer/archive/réactiver ; contenu libre conditions/grille, pas tarif structuré lié devis, pièces jointes ni circuit signature | ProfessionalOperations4498 |
| FE-B14 | Registre échéances | Création et marquer terminé présents ; pas édition générale/replanification/occurrence récurrente/alertes/attachment | ProfessionalOperations4670 |
| FE-B15 | Types équipement/contrat registre | Backend modèle permet kind equipment/contract mais selectUI seulement maintenance/audit/safety ; pas écran inventaire | Type de suivi4753 |
| FE-B16 | Reporting | Export CSV interventions chargées (estimations) + bouton Rapport ; live rapport finances, démo rapport échéances DIFFERENTS ; pas écran consolidé graphique, plage dates/AG/énergie | exportCsv1094 ; report4306 |
| FE-B17 | Filtres cohérents | Filtrevertical/site ne scope pas ProfessionalOperations ni ses arrays/rapport ; nombre3sitesnonfiltré, rapportsglobaux. À expliciter plutôt que laisser supposer filtre global | Sites2197–2244 ; ProfessionalOperationsprops |
| FE-B18 | Gestion site | Ajout et budget ; pas modifier nom/adresse/type, archiver/supprimer, détail, contact ou documents liés site | SiteForm3557 ; SiteActions2360 |

### Super-administration / backoffice opérateur

| ID | Source / besoin | État observé / manque précis | Preuve |
|---|---|---|---|
| FE-S01 | Tableau admin (43) | Aucune vue KPI interventions/mois/en cours,CAmois/année,évolution/date ; Overview client et compteurs bornés | Admin2703 ; Overview1386 |
| FE-S02 | Gestion artisans (43) | Liste nom/date/approved uniquement ; confirmer approuver/suspendre. Pas recherche,fiche,qualification/assuranceconsultableparcandidat,origine/catégorie/actionvérifierdossier | ArtisanAdministration4100 ; APIadmin.artisansGET |
| FE-S03 | Interventions (43) | Pas tableau global opérateur, recherche client/artisan/site, urgences, assignation/réassignation, supervision | Admin2703 ; Requests1581 générique |
| FE-S04 | Devis & factures (43) | Pas vue opérateur finance/factures/commission/remboursement/payout/litige | Admin2703 |
| FE-S05 | Clients / entreprises (43) | Aucun menu ou gestion clients/organisations/membres | nav914 ; Admin2703 |
| FE-S06 | Avis & notes (43) | Aucun outil avis/modération/contestation | Admin2703 |
| FE-S07 | Messages/support (43) | Chat client commun, pas inbox support global/tickets/assignation/escalade | MessageCenter3439 |
| FE-S08 | Paramètres (43) | Aucun écran paramètres opérateur tarifs/zones/commissions/garantie/SLA/abonnements/notification | nav914 |
| FE-S09 | Garantie | Traitement administrative dossier présent ; pas lien direct dossier→client/artisan/intervention/documents dans la liste admin | WarrantyPanel4826 |
| FE-S10 | Audit opérationnel | Backend fournit audit pro mais ProfessionalData ne contient pas audit ; aucun écran journal | ProfessionalData111 ; ProfessionalOperations |
| FE-S11 | Niveaux administrateur | Un seul roleadmin ; pas opérateur/support/comptabilité/group-admin ni matrice précise. À spécifier, pas automatiquement considéré absentdemandé | Role7 ; nav914 |

## Défauts transversaux / risques de comportement observables statiquement

1. **FE-X01 cache et droits des vues — prioritaire** : onHash accepte toute View (787–795), dispatcher rend Sites/Admin sans vérification de rôle (2925/2929). logout (874–888) efface Workspace mais pas professional. Après un compte manager puis déconnexion/connexion d'un autre rôle dans la même session SPA, l'ancien état contrats/approbations peut rester accessible via #sites malgré RLS réseau. C'est un risque statique à reproduire, pas un exploit live démontré dans cet audit. Effacer tous les caches par utilisateur et protéger la vue indépendamment des seuls menus.
2. **FE-X02 retour intégrations sans UX** : aucune lecture des paramètres `payment`, `intervention`, `connect`, `auth` dans CourantApp. Les redirections serveur Stripe/auth existent mais n'ouvrent pas le dossier/état de retour ni n'expliquent un token expiré. Deep-link #detail perd selected au rechargement et affiche Sélectionnez une intervention.
3. **FE-X03 compteurs et pagination** : API workspace borne jobs100,quotes200,sites100,msg500/docs100 ; UI aucun load-more. Les KPI sont comptes locaux, donc pas des totaux globaux fiables à grande volumétrie. Sitecard indique correctement calculsurlesdossierschargés, dashboard ne l'indique pas.
4. **FE-X04 temps réel partiel** : channel sur interventions/quotes/messages uniquement (807) ; professional ne recharge que lors initmanager/save/refreshmanuel. Approbations/contrats/sites/warranty ne sont pas synchronisés entre sessions via ce code. loadProfessional ne présente pas de loading dédié et peut laisser des arrays vides signifiant « aucun » avant réponse, ou anciennes valeurs après échec.
5. **FE-X05 notifications** : cloche ouvre Messages et son point repose sur messages.length>0 ; aucun non-lu/lu, centre de notifications ou multi-canal. Ce n'est pas la maquette d'une liste notifications.
6. **FE-X06 messagerie** : contrepartie est « Client » siroleartisan, sinon « Artisan », même si auteur est un autre membre pro/admin. Pas identification réelle ou participants, heure/envoi/lecture/pièces jointes, signalement/blocage. Backend peut autoriser plusieurs personnes d'une organisation : rôleduparticipantsàrésoudre.
7. **FE-X07 plusieurs devis** : Documents présente toutesversions mais ouvre uniquementintervention ; le tri currentQuote privilégie active latest. L'ancien devis ne peut pas être sélectionné comme document distinct. Démo permet accept_quote de marquer tous les devis dudossieraccepted, ce qui n'imite pas strictement SQL.
8. **FE-X08 erreur/auth** : init catch masque absenceconfig pour laisser public (intentionnel), mais aucune notification pour une session expirée ou `auth=expired` ; pas d'onAuthStateChange ni accès compte suppression/export/preferences.
9. **FE-X09 CSV** : frontend exportCsv et reportdemo utilisent leur regex locale `^[=+@-]`, moins complète que csvCell backend testé (qui tient compte espacesinitiaux). Ne pas supposer que le test backend couvre les deux exports navigateur. Nettoyageformules à centraliser/vérifier.
10. **FE-X10 afficheurs de devise** : money(cents||0) transforme valeurNaN/undefined en0 ; utile de ne pas masquer données manquantes dans un étatfinancier. À tester/choisirmétier ; pas automatiquement une faille serveur.
11. **FE-X11 falsedemo/liveparité** : données demo parprofil commun, refus/révisions/stats/documentsupload/Stripe ne sont pas équivalents ; la démo protège les vrais envois, mais ses réussites ne valident pas la vraiefonction.

## Accessibilité et responsive — lecture du code, pas nouvelle certification

Présents : html langfr, viewport, skiplink, focus-visible, labelsmajoritaires, boutons44px fréquents, rôles alert/status, reducedmotion, confirmations intégrées, layoutsreflow <760. Les premières petitespolices7–10px sont en grande partie surchargées en finCSS ; ne pas rapporter ces premièresdéclarations comme tailles calculées finales. Le constat historique360sansoverflow appartient à QA.md, pas à un test nouveau fait ici.

À vérifier/corriger :
- Menu mobile translateX(-100%) reste dans DOM sans hidden/inert/aria-hidden ; focusclavier peut atteindre desliens horsécran. Bouton Ouvrir menu sans aria-expanded/aria-controls ; overlay pas focus-trap ni restitutionfocus/Escape prévue.
- Catégories buttons state onlyclassselected et tabs filters sans aria-pressed/aria-selected ; stepper sans aria-current ; sidebaractive sans aria-current.
- La quatrième statistique Sites suivis est display:none sous430px, donc information cachée plutôt que reflow.
- Plusieurs boutons essentiels deviennent fontsize0 sousmobile (welcome CTA, ajoutsite, Rapport, étatconnexion). Le texte reste parfois accessible, mais visibilité et affordance à vérifier ; ciblemobilemenu32pxlarge et closebuttonpetits, malgréobjectif44.
- Skiplink pointe #main mais reset-password/page.tsx main n'a pas idmain.
- Field placehint dans label, sans aria-describedby ni association explicite des erreurs avec champ ; descriptionspeuventpolluer nomaccessible desselects.
- Les couleurs/contrastes, zoom200/400%, lecteurd'écran et tousbreakpoints n'ont pas été évalués danscet audit.

## Écarts visuels directement vérifiés aux images PDF

- Maquette35 (V3p4) : tableauartisandédié avecblocbleunuit illustré, missionsaujourd'hui avec horaires, performance note/CAévolution et tabbarbasse cinqentrées. Aucun équivalentcomplet dans Overview commun.
- Maquette36 (V3p5) : entrepriseartisan, avis, badgevérifié, Documents&Assurances validés3/3, sixindicateurs, actionsprofildétaillé/stats et tabbar. Profil actuel deuxchamps ne couvre pasceséléments. Les valeursfictives de lamaquette sont desexemples, pas à recopiercommevraies.
- Maquette34 (V3p3) : devis typé déplacement/main-d'œuvre/pièces + photos/documents et envoiclient. Éditeur actuel lignesgénériques sansattachement.
- Maquettes44/67 (V3p13/V4p20) : nouvellemission avecdistance/tempsestimé, acceptation/refus, appelclient, matérieldispo détails. Refus/appel/distance/disponibilités absents. Les maquettes exposent adresseavantacceptation ; la versionserveurmasque pourconfidentialité : décisionmétier à résoudre plutôtque copierinconsidérément.
- Maquette65 (V4p18) : parcourscandidature cinqétapes personnel/société/documents/zones/disponibilités, KBIS/RCPro/diplôme, SIRET/statut/salariés, joursdispo. Simple signup n'est pas l'équivalent.
- Maquette50 (V4p3) : restaurantfichedétaillée cuisine/froid/éclairageétats, budget, SLAetcontrat, contacts sursite, documents, interventionsonglets. Simplecarte type n'est pas l'équivalent.
- Maquette37 (V3p6) : dashboardERPétablissements/conformité/audits/signalements/rapports/documents, tableau, diagrammesetplanning. Pas équivalentaufiltreERP.
- Maquette43 (V3p12) : véritable dashboardadministrateur, menusArtisans/Interventions/Devis&Factures/Clients/Avis&Notes/Messages/Paramètres, KPI etlistesvérification. Adminactuel seulementapprobation+garantie.
- Maquette66 (V4p19) : partenaire desktopmenustableaude bord/interventions/artisans/sites&contrats/devis&commandes/facturation/rapports/messages ; filtres/recherche/périodes/pagination. Coque actuelleneconserve pasceparcours.
- Plusieurs maquettes contiennentplomberie/climatisation/maçonnerie ; la spécificationfinale limite leproduit àl'électricité. Cesexemples visuels necréent pasdesnouvellesverticales de métiers.

## Manques de spécification à distinguer des absences de code

La spécification finale annonce des domaines sans définir toutes leurs règles. À noter comme pointsàpréciser, sans fabriquerdesexigences :
- Définition « super back-office entreprise » : adminorganisation/groupe vs opérateurplateforme ; responsabilités, rôlesetvisibilité.
- Webmobile vsapplicationnative, distributioniOS/Android et calendriers/notificationsattendus.
- Disponibilitéartisan, calendrier/créneau, rayon/zone, offrespousséesvsouvertes, refus/réattribution/annulation et révélationcoordonnées.
- Piècesobligatoiresartisan, validité/expiration, revue et suspension, référentiels dequalification.
- Règlesdevis : brouillon/révision/refus/signature/preuve, TVAetfrais/commission, annulationaprèsacceptation, facture et remboursements.
- Dates/SLA/urgences, indicateursperformance/formulesetpériodes, garantiesdépart/conditions/preuves.
- Modèleorganisation/membres/invitations et droitsparsite/délégation ; grille tarifaire et applicationauxdevis.
- Modèleéquipements/restauration, consommationbureaux, obligations/auditsERP, rapportsAG, alertesetconformité.
- Notificationspréférences/consentement/canaux/fournisseur, archivage/rétention, contact/support/modération desavis.
- CritèresqualitédiagnosticIA, responsabilitéetlimites, donnéestransmises, fournisseur, évaluation.

## Réutilisation / sources copy-ready

Conserver les contrats request/action existants, calculateQuote/canTransition/verifyPayment, QuoteEditor, formulairesvalidés et séparationexplicitedemo/live. Réutiliser sanscloner la coque parchaquerôle ; extrairedesvuesdédiéesavecautorisation/cachesassociésaucompte.

Points de reprise précis : nav914 ; Overview1386 ; Requests1581 ; Detail1730 ; Sites2186 ; ProfileView2480 ; Auth2644 ; Admin2703 ; RequestForm2966 ; QuoteEditor3275 ; MessageCenter3439 ; SiteForm3557 ; ProfileForm3644 ; AuthForm3715 ; ReviewForm3877 ; DocumentManager3944 ; ArtisanAdministration4100 ; ProfessionalOperations4239 ; WarrantyPanel4826 ; ConfirmAction5021 ; BudgetEditor5085 ; ApprovalDecision5165 ; WarrantyResolution5226. CSSnavigation512+, mobil2523+, override3330+, professionnelles3980+.

Confiance élevée sur l'inventaire de code et les écrans PDF ci-dessus. La conformité visuelle complète des56maquettes requiert le catalogue de la revue complémentaire ; aucune comparaisonpixeln'est prétendue. Confiance limitée sur les servicesexternes car leurétat n'a pas été recontrôlé. Les risques statiques doivent être reproduits avant d'être qualifiés de défautsexploités. Aucun code modifié.
