# Plan de codage — reprise conforme aux documents

## Primary goal
Livrer une application fidèle aux maquettes fournies, avec des espaces client, artisan, entreprise cliente et super-administration réellement distincts, des données enregistrées dans la base dédiée et un cycle demande → devis → intervention → paiement Stripe vérifié en ligne.

Statut : plan seulement, enrichi par l’audit complet et les volumes complémentaires 5 à 9. La demande actuelle n'autorise ni reprise du codage, ni migration, ni déploiement. Le code applicatif n'est pas modifié pendant cette préparation.

## Audit préalable et nouveau document

Lire d’abord [l’audit complet](AUDIT_COMPLET_SPECIFICATIONS.md), [le catalogue](audit/CATALOGUE_MAQUETTES.md) et [les spécifications à compléter](SPECIFICATIONS_A_COMPLETER.md). Les neuf PDF comportent 102 pages, 93 occurrences de maquettes et 63 images distinctes. Les références bureaux existent désormais : V5-C01 et V5-C05. V5-C08 précise le dossier d’approbation syndic. Sept autres images du volume 5 reprennent des écrans déjà fournis. Les volumes 6/7/9 ne fournissent aucune image nouvelle ; V8 ajoute À propos, confidentialité, devis client et détail d’intervention (V8-C03/C05/C06/C07). Les numéros 19 à 32 ne sont toujours pas établis.

La phase 0 a désormais une collecte complète sur les documents disponibles. Il reste à décider les références maîtresses et les règles métier avant implémentation ; les 76 lignes de couverture ne signifient pas que les fonctions sont terminées.

## État de départ et méthode

- Une première interface, des API Next.js et deux migrations Supabase existent. La démonstration fonctionne dans le navigateur ; elle ne prouve pas le fonctionnement des comptes et paiements réels.
- Les blocages Supabase et Stripe sont ceux consignés dans SETUP et PROGRESS ; leur état fournisseur devra être recontrôlé au démarrage, sans considérer l'ancien constat comme une vérification actuelle.
- La reprise conserve Next.js, React, TypeScript, Supabase et Stripe. Aucun changement de stack ni recréation complète du serveur n'est prévu.
- La direction visuelle actuelle est trop éloignée des références. Les ajustements d'accessibilité et de responsive doivent respecter la composition métier, sans nouveau style générique ni nouvelle marque imposée.
- Le choix web responsive / application native artisan doit être explicité avant de promettre une distribution mobile. Le code existant est une application web ; si une application native est retenue, lire d'abord le skill `expo-overview` et créer un lot distinct. Une page web mobile ne sera pas présentée comme une application native.
- Skills : `make-plan` pour ce document et la découverte déléguée ; `frontend-design` pour appliquer les références, `vercel-react-best-practices` pour les composants React, `do` pour l'exécution lorsque le codage sera demandé. Utiliser les autres skills seulement selon les besoins réels.
- Chaque lot est présenté avec son périmètre, ses preuves et ses limites. Une fonctionnalité n'est pas terminée parce qu'un écran existe.

## Phase 0 — Inventaire et correspondance documentaire

**How this serves the primary goal:** chaque écran à coder possède une référence vérifiable et un résultat attendu.

Travail : établir une matrice écran / rôle / PDF et page / maquette / route actuelle / API / données réelles ou démo / écarts / critères de fin. Comparer les captures de l'interface existante aux pages sources. Recenser les écrans absents ; ne pas attribuer de contenu aux maquettes 19 à 32, non fournies.

Références : les neuf PDF d'AGENTS.md ; DESIGN.md ; docs/QA.md ; components/courant-app.tsx ; app/api ; supabase/migrations.

Découverte déjà effectuée pour ce plan :

| Écran / acteur | Référence vérifiée |
| --- | --- |
| Devis détaillé | Volume 3, page 3, maquette 34 |
| Tableau de bord mobile | Volume 3, page 4, maquette 35 |
| Profil, assurances et documents | Volume 3, page 5, maquette 36 |
| Nouvelle mission | Volume 3, page 13, maquette 44 |
| Recrutement | Volume 4, page 13, maquette 60 |
| Confirmation de candidature | Volume 4, page 17, maquette 64 |
| Candidature et justificatifs | Volume 4, page 18, maquette 65 |
| Tableau de bord entreprise cliente / partenaire B2B desktop | Volume 4, page 19, maquette 66 |
| Mission mobile : accepter/refuser/contact | Volume 4, page 20, maquette 67 |

API autorisées à préserver : GET /api/workspace ; POST /api/interventions ; POST /api/interventions/[id]/actions avec les actions existantes ; routes Stripe /api/payments/checkout, /connect et /webhook. Les signatures exactes et les SDK épinglés sont lus avant toute modification. Les fonctions métier SQL sont des fonctions du projet, pas des méthodes supposées de Supabase.

Vérification : toute ligne du périmètre MVP est reliée à un écran, une commande serveur et une preuve attendue ; inconnues et documents manquants explicités.

Garde-fous : ne pas confondre backend technique (API, base, traitements) et interface administrateur ; ne pas remplacer les références par une simple palette de couleurs.

## Phase 1 — Structure et fidélité des interfaces

**How this serves the primary goal:** les utilisateurs retrouvent les écrans et la navigation représentés dans les documents.

Travail : définir les structures propres aux espaces public, client, artisan, professionnel et administration. Ajouter À propos et confidentialité selon V8-C03/C05, avec contenus réels et sans copier le gabarit anglais générique ou ses traceurs d’exemple. Reprendre disposition, hiérarchie, navigation, actions et informations des maquettes ; justifier les seules adaptations nécessaires à l'accessibilité ou à la taille d'écran. Donner à l'artisan une navigation mobile dédiée, puis sa version desktop. Extraire progressivement les vues de components/courant-app.tsx en composants par rôle, en conservant les composants partagés utiles et les règles métier.

Références : DESIGN.md ; maquettes artisan ci-dessus ; fonctions Overview, Requests, Detail, ProfileView et QuoteEditor du composant existant ; skill frontend-design.

Vérification : capture source et capture implémentée comparées écran par écran ; contrôle 360 px et desktop ; libellés lisibles et actions pertinentes pour le rôle. Le tableau artisan ne doit plus être le tableau client renommé, ni afficher systématiquement « Nouvelle demande » à la place d'une action de mission.

Garde-fous : pas de style IA générique, de nouvelle identité imposée, de suppression d'informations des maquettes pour simplifier le développement ou de promesses de certification/performance inventées.

## Phase 2 — Backend réellement connecté

**How this serves the primary goal:** comptes, demandes et documents sont persistants et protégés entre vrais utilisateurs.

Travail : recontrôler le blocage fournisseur ; créer uniquement la base dédiée autorisée lorsque Supabase le permet. Appliquer les migrations après revue et dry-run. Configurer Auth, confirmation/récupération email, stockage privé et variables serveur Vercel. Préparer les comptes de test client A/B, artisan approuvé/non approuvé, gestionnaire et administrateur. Mettre en place l'accès administrateur sans auto-attribution publique.

Références : docs/SETUP.md ; lib/supabase/client.ts et server.ts ; app/auth ; les deux migrations ; supabase/tests/001_rls_test.sql ; documentation officielle Supabase Auth/SSR/RLS/Storage, à relire avec les versions installées.

Vérification : une demande créée par un compte est retrouvée après reconnexion depuis une autre session autorisée ; un compte tiers ne la lit pas. Vérifier aussi les refus d'écriture, les documents privés, les sessions expirées et les rôles.

Garde-fous : aucun projet existant réutilisé pour contourner la facturation ; aucun secret dans le client ou Git ; aucun faux succès si un service n'est pas disponible. Si l'accès reste bloqué, poursuivre seulement les lots indépendants et conserver cette phase ouverte.

## Phase 3 — Espace artisan complet et distinct

**How this serves the primary goal:** un artisan peut accomplir son travail avec son propre compte et les écrans attendus.

Travail : réaliser candidature et justificatifs, attente de vérification, connexion dédiée, tableau de bord, disponibilité, offres éligibles, acceptation/refus, devis détaillé, progression de mission, profil/assurances et suivi des règlements. Créer les capacités manquantes repérées dans la matrice plutôt que des boutons décoratifs. Clarifier la règle métier de refus d'offre avant son implémentation : masquage individuel ne vaut pas annulation de la demande client. Distinguer les statistiques mesurées des exemples.

Références : maquettes 34, 35, 36, 44, 60, 64, 65 et 67 ; QuoteEditor ; lib/domain.ts ; available_missions(), intervention_action() et approve_artisan() dans la migration initiale ; routes documents, profil, administration et paiements existantes.

Vérification : un artisan non approuvé ne prend pas de mission ; une offre non attribuée ne dévoile pas les informations privées ; deux artisans tentant la même acceptation ne deviennent pas tous deux attributaires. Vérifier devis et pièces depuis les comptes réels et les écrans fidèles aux références.

Garde-fous : pas de sélecteur de rôle pour accéder à un vrai compte ; le sélecteur reste exclusivement en démo. Pas de distance, note ou revenu fictif présenté comme réel. Les documents métier du profil nécessitent des règles d'accès explicites.

## Phase 4 — Parcours client connecté de bout en bout

**How this serves the primary goal:** le particulier suit une demande réelle jusqu'à l'intervention et garde la maîtrise de son devis.

Travail : reprendre les écrans client selon la matrice, notamment V8-C06/C07 ; connecter demande/photos/galerie, estimation, attribution, contact artisan, rendez-vous et replanification, suivi horodaté, devis PDF et version exacte, acceptation/refus, historique, messages, documents et avis. Définir les effets du refus et les conditions d’annulation avant d’ajouter les commandes. Conserver les brouillons et afficher les chargements, erreurs et états vides. Séparer estimation indicative, devis accepté et règlement.

Références : PDF grand format et écrans client inventoriés en phase 0 ; RequestForm, Detail, MessageCenter, DocumentManager et ReviewForm ; routes interventions/messages/documents/reviews ; calculateQuote et canTransition.

Vérification : réaliser le cycle avec deux sessions distinctes client/artisan, sans localStorage comme source des données réelles. Vérifier refus du devis ou annulation selon les règles définies, réseau interrompu, session expirée et absence de doublons.

Garde-fous : ne pas annoncer un délai d'attribution, une couverture géographique ou un tarif contractuel non configuré ; ne pas présenter la démonstration comme preuve de persistance réelle.

## Phase 5 — Stripe en environnement de test

**How this serves the primary goal:** le client peut régler le devis accepté et le serveur confirme correctement le paiement.

Travail : configurer Stripe test, Connect et le webhook via les canaux de secrets ; vérifier pays juridique et compte artisan ; renseigner la commission après décision commerciale. Réutiliser les routes existantes et leur modèle de transaction. Intégrer reprise, annulation, paiement refusé et confirmation différée dans les écrans.

Références : app/api/payments ; lib/supabase/stripe.ts ; confirm_stripe_payment() ; docs/SETUP.md ; documentation officielle Stripe correspondant au SDK installé, à revérifier avant exécution.

Vérification : Checkout réellement ouvert avec un compte de test ; transaction test liée au devis ; webhook signé reçu ; montant, devise et destinataire contrôlés ; même événement rejoué sans double effet ; aucune validation depuis la seule URL de retour.

Garde-fous : aucun encaissement réel à cette phase ; aucun tarif ou montant fourni par le navigateur ne fait autorité. Une clé absente doit bloquer explicitement le service, pas déclencher une simulation silencieuse.

## Phase 6A — Back-office entreprise cliente / syndic / B2B

**How this serves the primary goal:** chaque organisation cliente dispose d’un suivi réel multisites adapté à ses responsabilités et à sa verticale.

Travail : créer un espace métier distinct à partir de M4/M66 et des tableaux/fiches par verticale ; pour les bureaux, reprendre V5-C01/C05. Connecter organisation active, équipes/délégations et droits par site, demandes, contacts/documents, budgets, SLA, approbations (dont V5-C08), contrats/grilles, reporting et facturation. Définir le payeur B2B et le départ d’un membre. Un simple filtre de type sur des cartes ne constitue pas ce back-office.

Références : tableaux de bord et fiches de site inventoriés dans les PDF ; ProfessionalOperations, Sites et ArtisanAdministration ; routes professional/reports/sites/admin ; migration professionnelle.

Vérification : deux organisations réellement séparées ; propriétaire, gestionnaire et lecteur testés ; approbation obligatoire non contournable ; totaux calculés sur les devis/paiements et rapport non tronqué ; justificatifs accessibles aux seuls rôles permis.

Garde-fous : un registre de documents ne constitue pas une certification ERP ; un contrat archivé ne constitue pas une signature électronique ; pas de permissions déduites du seul affichage d'un bouton.

## Phase 6B — Super-administration de la plateforme

**How this serves the primary goal:** l’exploitant dispose du pilotage et des commandes transverses représentés dans la maquette 43.

Travail : dashboard global avec KPI définis ; annuaire et dossier de candidature artisan avec pièces/validité ; interventions, dispatch/réaffectation/escalades ; clients et entreprises ; devis/factures/commissions/rapprochement ; avis/notes ; support/messages ; paramètres de la plateforme et journal d’audit. Définir les droits support/finance/admin/super-admin avant les actions sensibles. Ne pas assimiler cette administration à l’owner d’une entreprise cliente.

Références : M43 (V3 page 12), blueprints M6/M52/M69 ; ADM-01 à ADM-10 de l’audit ; routes et commandes existantes à conserver/compléter.

Vérification : chaque menu mène à une liste et une fiche utiles, avec recherche/pagination, permissions serveur, motifs et traces des actions sensibles. Les indicateurs proviennent de données réelles et de formules validées. Un opérateur non habilité ne peut pas déclencher une action financière ni modifier des permissions.

Garde-fous : ne pas présenter la seule approbation artisan et la gestion de garantie comme une super-administration complète ; pas d’accès global attribué depuis un sélecteur de rôle.

## Phase 6C — Entreprise prestataire et équipes artisanales, si retenue

**How this serves the primary goal:** éviter de confondre une société employant des artisans avec un client professionnel ou l’exploitant.

Travail : préciser le périmètre suggéré par M65 et les blueprints, puis, s’il est retenu, définir dirigeant, planificateur et techniciens, disponibilités, affectation interne, matériel/pièces, rapports et règlements au nom de la société. Aucune équipe ou matrice de droits n’est inventée à partir du seul champ effectif.

Références : M65, M6/M52/M69 ; Q-PDF-03/04/32 du registre.

Vérification : décisions documentées ; règles de propriété, accès techniciens et responsabilité financière explicites avant développement. Si cet espace n’entre pas dans le périmètre retenu, le marquer comme tel sans le déclarer livré.

Garde-fous : ne pas réutiliser le rôle manager B2B comme réponse automatique à une entreprise prestataire ; ne pas imposer un module de stocks complet sans décision.

## Phase 7 — Fonctions avancées restantes, après le socle réel

**How this serves the primary goal:** compléter progressivement la spécification sans masquer des fonctions absentes sous des écrans de démonstration.

Travail par sous-lots indépendants : matching géographique et distances ; notifications email/SMS/push avec préférences ; alertes SLA et archivage ; abonnements Stripe et services premium ; grilles contractuelles calculables ; rapports d'AG et suivi de consommation ; diagnostic photo IA si fournisseur et protocole d'évaluation définis. Définir pour chacun données, fournisseur éventuel, coût, droits, critères métier et test avant codage. Respecter les priorités MVP/V2/V3 de la spécification.

Références : spécification finale, sections 3 à 7 ; liste des limites dans QA et SETUP ; skills/documents pertinents à sélectionner seulement après définition du sous-lot.

Vérification : preuves spécifiques par fonction, données sources identifiées, autorisations et échecs de fournisseur testés. Aucun diagnostic ou engagement réglementaire ne doit être inventé.

Garde-fous : ne pas supposer un abonnement, un prestataire de notifications, une règle fiscale, une zone commerciale ou un modèle IA sans décision documentée. Ne pas lancer ces extensions à la place de terminer le parcours client/artisan connecté.

## Phase 8 — Vérification finale et livraison

**How this serves the primary goal:** livrer une application dont l'apparence et le fonctionnement sont démontrés avec leurs limites exactes.

Travail : comparer les écrans aux références de la matrice ; exécuter npm run check, tests d'accès distants et parcours client/artisan/Stripe test sur Vercel. Vérifier mobile, clavier, erreurs, vides, documents et reprises. Corriger les défauts avant de déclarer le lot terminé. Mettre à jour PROGRESS et QA avec une distinction explicite : maquetté, codé, connecté, vérifié, bloqué.

Références : matrice phase 0 ; AGENTS.md ; DESIGN.md ; tests métier/SQL ; plan des phases ci-dessus.

Vérification : un commit poussé et une preview vérifiée après chaque lot important ; captures comparatives et preuves de bout en bout ; aucun secret exposé ; pas de régression des règles serveur conservées.

Garde-fous : ne pas annoncer « application terminée » si la base, les comptes ou Stripe ne sont pas vérifiés. La mise en exploitation commerciale exige aussi identité de l'exploitant, zone de service, tarifs/taxes, conditions, garantie et données de production prêtes.

## Condition de fin d'un lot

Un lot se termine lorsque son écran correspond à la référence retenue, ses actions fonctionnent avec les bonnes permissions, ses états de chargement/erreur/vide sont traités et son résultat est vérifié sur la preview. Les blocages externes sont indiqués comme tels ; ils ne sont pas transformés en succès de démonstration.

## Préparation actuelle

Cette préparation et cet audit ne modifient que la documentation et ajoutent la copie du nouveau PDF source. Aucun code applicatif, aucune base et aucun déploiement ne sont modifiés. Le plan initial reste conservé dans BLUEPRINT.md pour la traçabilité ; ce plan de reprise répond aux écarts visuels et fonctionnels signalés par le propriétaire.

## Sources JSX/CSS complémentaires

Lire [l’audit des archives](audit/ARCHIVES_CODE.md) en phase 0 puis en phase 1. Les 12 composants donnent des bases de composition ; choisir leur correspondance PDF et conserver les besoins détaillés des back-offices. Vérifier la frontière client et la stratégie CSS lors d’une future intégration. Aucun backend ou Stripe n’est livré par ces fichiers ; aucune phase métier n’est accomplie par leur réception.

La cinquième archive `CODES_CSS_ANIMATIONS` fournit une variante HomePage/styles et un animations.css, sans nouvelle page métier. En phase 1, sélectionner une version CSS, traiter les délais de fade, réduire le mouvement et exclure les boucles décoratives ; aucune intégration lancée pendant l’audit. Détails dans la même annexe.
