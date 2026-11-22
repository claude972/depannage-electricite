# Plan de livraison intégrale de la plateforme de dépannage électrique

## Objectif principal

Un particulier, un artisan, une entreprise cliente ou un syndic et un opérateur de la plateforme peuvent effectuer toutes les actions prévues pour leur rôle et reprendre un dossier après une erreur. La Web/PWA est prête à être autorisée à l'issue d'une recette en ligne couvrant les 76 capacités. Stripe et Vonage sont raccordés au dernier lot de recette. La distribution native suit la validation Web/PWA.

Le plan couvre toute l'application. Le premier jalon est le parcours client–artisan stabilisé, suivi des autres lots avant le verdict intégral. Chaque lot se termine avec une preuve et un statut. Le bilan de fin de journée indique les capacités closes et les écarts restants. Les dates de livraison sont fixées après mesure des premiers lots et des délais d'activation fournisseur.

## Phase 0 — Références et état de départ

*Cette phase rattache chaque besoin à une source et à une vérification, afin de distinguer une fonction intégrée d'un écran déjà dessiné.*

- Base examinée le 7 novembre 2026 en Martinique. Intégration poussée **002de1a** et [CI en échec sur le scénario SQL avancé de remboursement](https://github.com/claude972/depannage-electricite/actions/runs/42372169705). Dernière [preview recettée](https://depannage-electricite-7u0f47efr-brafas-projects.vercel.app) **46708c7**. Elle a couvert 18 actions authentifiées et 12 contrôles publics. Les preuves ne se transfèrent pas automatiquement à une autre version.
- Le formulaire du client connecté **5e7f217**, la correction du panneau de remboursement **b5f7959** et son câblage **4c7852c** sont à revoir avant intégration. Le remplacement d'empreinte **19992a9** désigne une branche de contrat, dont l'implémentation reste à vérifier ou à réaliser. Le backend de remboursement et sa migration sont déjà intégrés. Voir l'[état courant](ETAT_LIVRAISON_COURANT.md) et l'[inventaire des écarts](RESTE_A_LIVRER_ACTUEL.md).
- Lire [AGENTS.md](../AGENTS.md), [DESIGN.md](../DESIGN.md), [MISSIONS.md](../MISSIONS.md), la [spécification finale et l'audit consolidé](audit/REAUDIT_CONSOLIDE.md), puis les décisions actualisées. Les états d'audit anciens sont une base de couverture. Les décisions récentes priment. Le [Figma mobile B](https://www.figma.com/design/hec6XdQ7IbOFVeFhq6KPDw?node-id=7796-9) définit la direction et les parcours à raccorder, avec thèmes clair et sombre et sans nom de marque imposé.
- Les points d'entrée à réutiliser sont les routes Next.js existantes, les opérations SQL transactionnelles sous l'identité de l'utilisateur, Supabase Auth pour générer et vérifier l'OTP et Stripe Checkout/Connect pour l'encaissement. Les signatures et événements sont relus dans la documentation officielle avant intégration fournisseur. Voir [Supabase Auth par téléphone](https://supabase.com/docs/guides/auth/phone-login), [Stripe Connect en test](https://docs.stripe.com/connect/testing) et [Stripe Webhooks](https://docs.stripe.com/webhooks).
- **Répartition Fastsplit.** Astra prend les contrats, les données, les permissions et la revue backend. Fable reprend les écrans et les maquettes dans la session Claude existante, avec Opus comme relais si Fable est indisponible. Le pilote tranche, intègre, applique les migrations de test et mène la recette hébergée. Un responsable par lot et un seul auteur par fichier partagé. Publier dans MISSIONS.md le périmètre et les tests avant chaque réalisation. Garder les secrets et le cloud sous la responsabilité du pilote.
- **Suivi.** Pour chaque ID de l'annexe, relever le responsable, la règle retenue, le commit, la preuve, la preview et le statut. Valeurs de statut proposées **à développer**, **intégré**, **vérifié en ligne**, **en attente de décision**, **en attente de raccordement**. Une dépendance retient les seuls IDs qu'elle concerne.

## Ordre de travail et dépendances

Démarrer par le socle et la demande. Une fois les contrats d'accès et de dossier stabilisés, avancer catalogue et attribution, réseau artisan, B2B et administration sur des fichiers disjoints. Lier les sites et les droits avant les verticales. La finance réutilise les versions de devis acceptées et attend la définition du payeur B2B. La garantie réutilise le dossier clôturé. L'IA et la préparation des tests PWA peuvent avancer indépendamment. Réserver un seul créneau d'intégration par groupe de fichiers communs.

La recette Web/PWA exige les lots 1 à 8. Le raccordement fournisseur du lot 9 intervient après cette préparation. Le lot 10 reprend les mêmes contrats pour les applications natives après validation Web/PWA. La décision d'ouvrir le service public est enregistrée au lot 11.

## Phase 1 — Socle, demande et intervention

*Ce lot rend utilisable le dossier commun, depuis le choix d'une panne jusqu'à la remise des documents de l'intervention.*

- **Astra** rétablit la CI SQL en conservant la protection qui refuse de solder sans exécution qualifiée. Revoit l'assemblage client et remboursement au commit près. Vérifie les écritures idempotentes, la séparation de session et l'accès au stockage privé. Prendre appui sur [le scénario SQL](../tests/sql-adv-rollback-review.mjs), [l'API bookings](../app/api/bookings/route.ts) et [les actions d'intervention](../app/api/interventions/).
- **Fable** reprend l'accueil, les fiches de panne et la confirmation déjà câblée. Conserve la prestation du premier clic au récapitulatif. Vérifie la barre de confirmation, urgence et disponibilités, prénom et nom, saisie d'adresse avec proposition géolocalisée, présélection d'adresse préférée, photos, choix du règlement après l'adresse et retour arrière. Raccorde les écrans client et artisan à leurs dossiers et documents exacts.
- **Sortie.** CI verte et preview du commit exact. Depuis une fiche de panne sur mobile, créer un seul dossier malgré une réponse perdue, le retrouver, le faire accepter, proposer puis accepter ou refuser le devis, envoyer un avenant, clôturer et ouvrir le bon PDF. Répéter avec session client existante et avec le chemin sans compte jusqu'à la limite SMS. Vérifier le refus entre dossiers, deux identités dans le même navigateur, et reprise des photos après un retour qui a perdu les fichiers en mémoire.
- **Garde-fou.** Un nouveau clic ne doit pas générer une nouvelle clé après une émission incertaine. Un devis accepté conserve sa version. Le dossier privé reste protégé pendant l'attente de l'OTP.

## Phase 2 — Catalogue, attribution, rendez-vous et carte

*Le client comprend le prix indicatif, sait si sa zone est desservie et suit l'intervention jusqu'au rendez-vous.*

- **Astra** complète le barème versionné, l'éligibilité géographique, la disponibilité et capacité, les offres paginées, le classement selon la règle validée, le refus individuel, l'expiration, l'absence d'artisan et la réaffectation. Reprend [l'API missions](../app/api/artisan/missions/route.ts), [le planning](../app/api/planning/route.ts) et [le suivi](../app/api/interventions/).
- **Fable** relie fiches, catalogue, FAQ et zone desservie aux données réelles. Termine la carte avec attribution, l'adresse confirmable et l'heure d'arrivée estimée avec état de fraîcheur. Rend clairs les créneaux modifiés, la panne fournisseur et le refus de localisation.
- **Sortie.** Une zone éligible et une zone refusée, offre masquée avant attribution, deux acceptations concurrentes avec un seul gagnant, créneau changé et ancien artisan privé des actes réservés. Sur deux terminaux, contrôle du partage GPS avec consentement, arrêt et expiration, itinéraire réel, plus secours lorsque la carte ou le réseau est indisponible.
- **Garde-fou.** Une estimation ne garantit pas le prix, le délai ou la distance. Le code ne présente pas une position simulée comme une position physique.

## Phase 3 — Réseau artisan

*Le professionnel peut déposer son dossier, répondre aux décisions et opérer avec les droits correspondant à son entreprise.*

- **Astra** complète l'examen par justificatif avec motif, historique et expiration. Cadre entreprise prestataire, techniciens, planificateur, délégations, attribution interne et bénéficiaire des règlements. Vérifie la révocation et la source des indicateurs. Réutilise [les routes artisan](../app/api/artisan/) et [la candidature administrée](../app/api/admin/artisans/route.ts).
- **Fable** termine la candidature, la confirmation, la correction de pièces, le tableau et les écrans équipe. Rend les permissions et les statuts lisibles dans les deux thèmes.
- **Sortie.** Candidature → pièce rejetée → remplacement → décision motivée → offre. Un technicien ne peut agir que dans le périmètre qui lui est confié. Toute décision encore nécessaire sur le modèle prestataire reste attachée à ART-12.

## Phase 4 — Entreprise, syndic et verticales

*Chaque organisation gère ses propres sites, décisions, travaux et dépenses avec les droits appropriés.*

- **Astra** complète création, édition, archivage et pagination des sites, horaires et consignes, accès par site, invitations, retrait, délégations et approbations. Ajoute le lien intervention–équipement–zone, historique, grilles contractuelles versionnées, budgets, alertes, consolidation énergie et reporting/export. Définir la délégation de payeur avec le lot finance. Repartir des [API sites](../app/api/sites/), [organisations](../app/api/organizations/), [opérations de site](../app/api/site-operations/route.ts) et [rapports](../app/api/reports/route.ts).
- **Fable** rend la chronologie claire selon le statut du dossier. Une approbation mène à la planification, puis aux travaux, puis à la réception. Terminer les écrans de chaque verticale, l'accès lecture seule et les exports.
- **Sortie.** Quatre recettes distinctes. **Syndic** avec parties communes, AG et appel de fonds documentaire. **Restauration** avec équipement critique, ticket et délai contractuel. **Bureaux** avec zone, maintenance et énergie comparable par période. **ERP** avec audit, réserve et preuve de levée. Tester deux organisations, retrait de membre, approbateur et lecteur. Réconcilier les totaux entre écran et export.
- **Garde-fou.** Une note ERP ne vaut pas certification, un appel de fonds documentaire ne vaut pas encaissement et un SLA dépend du calendrier réel.

## Phase 5 — Administration, notifications, données et site public

*La plateforme peut soutenir les clients et les artisans et traiter les incidents tout en limitant l'accès aux informations privées.*

- **Astra** complète l'annuaire, le dispatch, les escalades, le support, la modération, les paramètres et l'audit. Met en place les notifications email/push, les relances planifiées et la déduplication avec reprise. Définit export, effacement, archivage, conservation et restauration testée. Réutilise [les routes admin](../app/api/admin/), [support](../app/api/support/), [notifications](../app/api/notifications/) et [messages](../app/api/messages/route.ts).
- **Fable** raccorde les menus, les bons dossiers et l'historique des actions. Termine contact/rappel, présentation de l'exploitant, mentions et préférences de confidentialité. Corrige les destinations Figma connues pour notifications, documents, finance et ERP dans les lots concernés.
- **Sortie.** Matrice d'accès avec support, finance, modération et administration distincts. Ticket assigné et escaladé. Une notification réelle par événement attendu, échec et reprise observables. Export personnel et demande de suppression testés selon la politique validée. Sauvegarde restaurée dans un environnement isolé.
- **Garde-fou.** L'activation permanente du premier Super Admin appartient au propriétaire. Les recettes de permissions utilisent le cadre de test autorisé. Les contenus, engagements et coordonnées proviennent de l'exploitant.

## Phase 6 — Finance complète, prête avant les clés

*Chaque acteur voit la différence entre une somme estimée, autorisée, débitée, remboursée ou reversée.*

- **Astra** termine le remplacement d'empreinte, Checkout et Connect, les confirmations signées, les montants autorisés, le rapprochement des frais/commissions/transferts/versements, les remboursements et litiges, les factures et avoirs. Prépare abonnements et moyens enregistrés selon offre et consentement définis. Réutilise [les routes paiement](../app/api/payments/), [le remboursement opérateur](../lib/features/refund-execution/) et [les factures](../app/api/invoices/).
- **Fable** complète l'empreinte expirée ou insuffisante, le paiement après intervention par lien ou QR, les justificatifs, le tableau artisan et les rubriques finance admin. Distingue débit, transfert, versement, litige et remboursement.
- **Sortie avant raccordement.** Tests avec réponses injectées. L'empreinte de remplacement ne devient active qu'après preuve que l'ancienne n'est pas encaissée et a été libérée. Un retour navigateur seul ne crée aucun statut payé. Une notification Stripe répétée ou désordonnée ne crée qu'un effet qualifié. Paiement annulé et reprise du bon dossier. Avenants acceptés inclus, facture et avoir cohérents, payeur B2B non habilité refusé.
- **Garde-fou.** L'encaissement passe par la plateforme. L'entreprise de l'artisan émet les documents de prestation. La commission est distincte et sa règle doit être configurée. Un état en attente n'est jamais présenté comme une confirmation bancaire.

## Phase 7 — Garantie et diagnostic photo

*Le client peut traiter un problème après travaux et joindre des éléments utiles au diagnostic dans un cadre défini.*

- **Astra** complète l'activation de la garantie, la version des conditions, les exclusions, la demande et la mission corrective reliée. Pour le diagnostic photo IA, prévoir consentement, données privées, évaluation, résultat incertain, indisponibilité et validation humaine. Prendre appui sur [l'API garantie](../app/api/warranty/route.ts) et [les documents](../app/api/documents/route.ts).
- **Fable** lie les conditions publiques à la version appliquée au dossier, les étapes de demande et les états de diagnostic à leur résultat réel.
- **Sortie.** Demande éligible, refus motivé, traitement et correction reliés à l'intervention d'origine. Pour l'IA, jeu évalué, refus explicite ou reprise manuelle si le service ne conclut pas. Fournisseur, conditions et preuves restent visibles dans le suivi du lot.

## Phase 8 — Maquettes, Web/PWA et préparation native

*Chaque rôle retrouve ses actions sur téléphone et ordinateur, avec la même logique et des parcours qui reprennent après interruption.*

- **Fable** vérifie la correspondance Figma–application par rôle, statut et taille. Teste clair/sombre, navigation, clavier, focus, CTA, erreurs, vides et chargement. Vérifie que devis, rapport et facture ouvrent leurs propres écrans, et que les liens de prototypage reflètent les actions réelles.
- **Pilote** rejoue installation et mise à jour PWA, reprise réseau et confidentialité des caches sur appareils cibles. Hors ligne, vérifier la reprise du brouillon et l'information à l'utilisateur lorsque l'action nécessite le serveur. Le chantier iOS/Android est planifié après validation Web/PWA, avec choix de la stack, builds de test, permissions et GPS sur appareils, Auth/Stripe et liens retour. La publication en boutique est une décision de mise en service séparée.
- **Sortie.** Recettes 360/390 et desktop, plus appareils iOS/Android pour la PWA. Aucun chevauchement des actions essentielles, brouillon récupérable et aucune donnée privée d'une session exposée à la suivante. La preuve native est enregistrée séparément de la preuve PWA. Voir [Plan de reprise](PLAN_REPRISE.md).

## Phase 9 — Raccordements Stripe et Vonage, puis recette finale

*Le propriétaire reçoit une application vérifiée en ligne et peut décider de la mise en service à partir des résultats réels.*

- Quand la preview est stable, **le propriétaire prépare les accès à cette étape**. Stripe Connect de test, secret API et secret de signature du webhook associé à la preview. Vonage API, expéditeur conforme et mobile +596 vérifié. Secrets saisis dans les configurations serveur Vercel/Supabase. Voir [tests Connect](https://docs.stripe.com/connect/testing) et [test Vonage](https://api.support.vonage.com/hc/en-us/articles/204014853-How-do-I-add-test-numbers-during-my-Vonage-API-trial).
- **Pilote** lance l'OTP sur un mobile autorisé, teste code valide, mauvais code, expiration, session, absence de fuite et recherche des interventions. Sur Stripe de test, exécute l'empreinte, le débit après travaux, le paiement différé, échec/annulation, webhook signé, rejeu, facture, remboursement et rapprochement selon les règles configurées. Vérifie que l'argent et le statut sont associés au dossier et au bénéficiaire attendus.
- Rejouer les contrôles croisés en ligne sur le **même commit**, vérifier les migrations et la CI, puis nettoyer les données de test. Le dossier de livraison contient URL, version, preuves par rôle, écarts, procédure de reprise et décision de mise en service. Les tests réels de production et de publication en boutique nécessitent leur autorisation propre.
- **Clôture intégrale.** Les 76 lignes doivent avoir une preuve correspondant au périmètre retenu. Une décision explicite de périmètre est nécessaire pour retirer une capacité. Un échec ou une dépendance ouverte est signalé avec son impact et son responsable.

## Phase 10 — Applications iOS et Android

*Les clients et artisans peuvent utiliser une version installée sur leurs appareils avec les mêmes données et règles que sur la Web/PWA.*

- **Fable** adapte navigation, formulaires, captures photo et états de reprise aux appareils. **Astra** réutilise Auth et les contrats serveur et vérifie que les sessions et les droits restent isolés entre comptes et organisations. Le pilote choisit la stack native selon le code réutilisable, puis prépare les builds de test iOS et Android et leur distribution interne.
- **Sortie.** Tester sur appareils l'installation, la mise à jour, les liens vers un dossier, les permissions photo/GPS, le retour de paiement et la perte de réseau. Vérifier séparément le comportement de suivi en arrière-plan avant d'en faire une promesse produit. Documenter les variantes de rôle supportées et les écarts par plateforme.

## Phase 11 — Validation de lancement et remise

*Le propriétaire peut ouvrir le service au public après avoir contrôlé les parcours, les données de référence et la reprise en cas d'incident.*

- **Pilote** consolide le registre de preuves et les rapports des builds. Rejoue le scénario de restauration et de retour à la version précédente, vérifie les migrations en attente, l'accès du propriétaire, les alertes et les états fournisseur. Compare les paramètres commerciaux et publics avec les décisions de l'exploitant.
- **Sortie.** Une version identifiée par environnement, un lien de test par plateforme, les preuves par rôle et capacité, les écarts éventuels et le dossier de mise en service. Après autorisation, planifier l'ouverture de la production et les publications en boutique séparément. Vérifier les premières opérations et la surveillance sur la version réellement ouverte.

## Décisions à collecter pendant les travaux

- **Exploitant et fonctionnement public** — identité, coordonnées, zone, barème et règles de TVA, disponibilité, urgence et annulation. Cela débloque les contenus et le fonctionnement tarifaire.
- **B2B et réseau** — responsables, pouvoirs de payer, seuils d'approbation, suppléance, sites, techniciens, calendriers et conditions de SLA.
- **Finance** — règles de commission et de frais, reversements, remboursements, litiges, abonnements, moyens enregistrés et justificatifs. Distinguer ces décisions des clés fournisseur.
- **Après-vente et données** — conditions de garantie, correction, traitement des photos, diagnostic IA, conservation et effacement, choix des canaux de notification et accès exploitant. À relever au fil des lots sans suspendre les tâches indépendantes.

## Annexe — Registre des 76 capacités

Une ligne correspond à une capacité d'origine. La colonne « preuve à fournir » reprend le contrôle d'origine, sous réserve des décisions récentes et des critères détaillés du lot. Aucun statut de livraison n'est déduit de ce registre. Voir [le référentiel source](audit/COUVERTURE_PLAN.csv).

| ID | Capacité | Lot principal | Preuve à fournir |
|---|---|---|---|
| PUB-01 | Accueil et identité | 1 | Navigation accueil vers demandes et comptes sur mobile/desktop |
| PUB-02 | Pages tarifs et barème | 2 | Tarif issu du barème versionné et estimation correctement qualifiée |
| PUB-03 | Couverture géographique | 2 | Zone desservie et non desservie donnent le résultat prévu |
| PUB-04 | Contact, rappel et assistance | 5 | Demande contact reçue et reprise après échec |
| PUB-05 | FAQ et explication du service | 2 | FAQ correspond aux règles réelles sans promesse d’exemple |
| PUB-06 | Garantie : page et conditions | 7 | Conditions de garantie affichées identiques à celles appliquées |
| PUB-07 | Recrutement et confirmation artisan | 3 | Candidature sauvegardée, corrigée puis examinée |
| PUB-08 | Mentions et informations commerciales | 5 | Identité et contacts réels renseignés sans placeholders |
| PUB-09 | À propos : mission, exploitant et équipe | 5 | Page et équipe réelles sans chiffres inventés |
| PUB-10 | Confidentialité et choix des utilisateurs | 5 | Préférences et demande utilisateur traitées selon parcours défini |
| CLI-01 | Demande structurée | 1 | Demande valide persistée et champs invalides refusés |
| CLI-02 | Photos dans la demande | 1 | Photos liées à la demande et privées après reconnexion |
| CLI-03 | Matching et absence d’artisan | 2 | Éligible reçoit offre, hors zone/indisponible ne la reçoit pas |
| CLI-04 | Rendez-vous et changements | 2 | Créneau modifié avec droits et historique conservé |
| CLI-05 | Suivi, déplacement, carte et ETA | 2 | Carte/ETA avec source, fraîcheur et panne ou refus de localisation explicites |
| CLI-06 | Identité et contact artisan | 2 | Coordonnées minimales visibles seulement après étape autorisée |
| CLI-07 | Devis complet et accord | 1 | Version expirée refusée ; accord et refus portent sur le bon devis |
| CLI-08 | Historique et documents exacts | 1 | Ancienne version ouverte exacte au-delà des fenêtres de chargement |
| CLI-09 | Profil, adresses et préférences | 1 | Adresse et préférences conservées sans exposition à un tiers |
| CLI-10 | Avis et gestion des retours | 5 | Avis réservé à intervention éligible, modération tracée |
| ART-01 | Dashboard et navigation dédiés | 1 | Navigation missions/devis/profil propre artisan aux deux tailles |
| ART-02 | Candidature : identité et société | 3 | Dossier société créé et récupéré après reconnexion |
| ART-03 | Justificatifs et examen du dossier | 3 | Pièce expirée/remplacée revue avec motif et droits |
| ART-04 | Disponibilités, zones et capacité | 2 | Indisponibilité/zone changent les offres éligibles |
| ART-05 | Réception des offres et refus | 2 | Deux acceptations concurrentes : un seul gagnant ; refus individuel |
| ART-06 | Localisation et contact client | 2 | Contact autorisé et distance issue de source identifiée |
| ART-07 | Devis métier et révision | 1 | Brouillon et révision persistent sans modifier version acceptée |
| ART-08 | Actions adaptées au rôle | 1 | Actions client absentes et refusées serveur pour artisan |
| ART-09 | Compte rendu et clôture terrain | 1 | Rapport/photos/accord reliés à la bonne intervention |
| ART-10 | Profil professionnel et performance | 3 | Jeu connu : réputation, ponctualité, CA par période et source recalculés |
| ART-11 | Règlements, net et versements | 6 | Payé/transféré/versé distincts avec frais et échec rapprochés |
| ART-12 | Entreprise prestataire et techniciens | 3 | Planificateur et technicien testés avec accès limité, attribution interne et retrait des droits. |
| ENT-01 | Organisation et espace propres | 4 | Organisation active choisie sans contexte hérité |
| ENT-02 | Membres, droits, délégations | 4 | Invitation acceptée et membre retiré perd droits définis |
| ENT-03 | Portefeuille de sites | 4 | Site créé/édité/archivé dans organisation correcte |
| ENT-04 | Fiche site détaillée | 4 | Fiche site conserve contacts/documents/équipements autorisés |
| ENT-05 | Syndic / copropriété | 4 | Scénario syndic parties communes et rapport AG selon périmètre |
| ENT-06 | Restauration : dashboard et tickets | 4 | Ticket restaurant critique visible avec échéance correcte |
| ENT-07 | Restauration : équipements | 4 | Équipement identifié lié à ses tickets et contrôles |
| ENT-08 | Bureaux : dashboard et maintenance | 4 | Bâtiment/étage/zone et maintenance bureau persistants |
| ENT-09 | Bureaux : consommation | 4 | Mesures énergie avec unité/période/provenance vérifiables |
| ENT-10 | ERP : tableau, audits et réserves | 4 | Réserve audit créée puis levée avec preuves, sans fausse certification |
| ENT-11 | Urgences graduées et SLA | 4 | Horloge SLA pause/reprise/dépassement selon calendrier défini |
| ENT-12 | Approbations et validation des travaux | 4 | Seuil bloque accord et historique des compléments/décisions conservé |
| ENT-13 | Contrats et grilles tarifaires | 4 | Grille versionnée calcule devis sans réécrire passé |
| ENT-14 | Budgets et alertes | 4 | Engagé/réalisé/restant par exercice calculés sur jeu connu |
| ENT-15 | Reporting et exports | 4 | Filtres et export donnent les mêmes totaux sur historique complet |
| ENT-16 | Factures, payeur et intégrations | 4 | Payeur délégué autorisé, tiers refusé et facture reliée |
| ADM-01 | Tableau global et KPI | 5 | KPI globaux concordent avec données de référence paginées |
| ADM-02 | Artisans : annuaire et candidature | 3 | Dossier artisan et pièces consultables avec décision motivée |
| ADM-03 | Interventions, dispatch et escalades | 5 | Réaffectation retire actes non autorisés à ancien artisan |
| ADM-04 | Clients, entreprises et contacts | 5 | Recherche client/entreprise et accès opérateur bornés |
| ADM-05 | Devis, factures et finance | 6 | Facture/remboursement/commission rapprochés sans double effet |
| ADM-06 | Avis et notes | 5 | Modération avis avec motif et historique consultables |
| ADM-07 | Messages et assistance | 5 | Ticket support attribué et escaladé avec permissions |
| ADM-08 | Paramètres plateforme | 5 | Paramètre changé par rôle habilité avec effet versionné |
| ADM-09 | Rôles et traçabilité sensibles | 5 | Support ne modifie ni finance ni droits ; actions tracées |
| ADM-10 | Garantie et dossiers liés | 7 | Garantie reliée à dossier et mission corrective selon décision |
| FIN-01 | Checkout et Connect | 6 | Checkout test et bénéficiaire Connect vérifiés |
| FIN-02 | Webhooks, montants et reprise | 6 | Signature invalide rejetée et événement répété sans double effet |
| FIN-03 | Retour paiement et Auth | 6 | Retour annulé/pending/reçu relit le serveur et bon dossier |
| FIN-04 | Échec, remboursement et litige | 6 | Échec/remboursement/litige synchronisés et reprise prouvée |
| FIN-05 | Factures et avoirs | 6 | Numéro/version/montants facture et avoir cohérents |
| FIN-06 | Commission et reversements | 6 | Net/frais/commission/transfert/versement rapprochés sur jeu connu |
| FIN-07 | Abonnements et services premium | 6 | Offres validées, souscription, renouvellement, résiliation et impayé vérifiés. |
| FIN-08 | Moyens enregistrés et options | 6 | Consentement, liste, retrait et reprise des moyens de paiement retenus. |
| SYS-01 | Base et services réels | 1 | Comptes et fichiers réels persistants avec refus intercomptes |
| SYS-02 | Isolation du cache et des vues | 1 | A logout puis B et réponse A tardive ne montrent aucune donnée A |
| SYS-03 | Propriété des dossiers d’entreprise | 4 | Membre retiré perd droit malgré ancien client_id selon règle |
| SYS-04 | Chat et notifications | 5 | Message reçu autorisé et notification sans doublon, lu/non-lu réel |
| SYS-05 | Temps réel cohérent | 2 | Changement autorisé visible sans rechargement, tiers non notifié |
| SYS-06 | Documents et archivage | 1 | Expiration/version/rétention et visibilité du document respectées |
| SYS-07 | Recherche, pagination et indicateurs | 4 | Recherche au-delà fenêtres et agrégats complets concordants |
| SYS-08 | Accessibilité et distribution | 8 | Clavier, mobile et PWA vérifiés. Recette native séparée après la Web/PWA. |
| SYS-09 | Exploitation, sauvegarde et données | 5 | Restauration démontrée et erreur observable avec procédure de reprise |
| SYS-10 | Diagnostic photo IA | 7 | Évaluation documentée, panne et reprise manuelle, accès privé et validation humaine. |
