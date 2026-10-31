# Inventaire du backend technique

Annexe factuelle de [l’audit consolidé](../AUDIT_COMPLET_SPECIFICATIONS.md). État du code : `46aac2a`, 30 octobre 2026. Lecture des sources et du code ; aucun test live nouveau ni modification applicative. Les lignes sont celles de cet instantané.


Lecture seule, 30 octobre 2026. Racine inspectée : `/Volumes/Stockage/Projets/App application dépannae `. Aucun code, service distant, migration ou déploiement modifié. Le plan de reprise existant a été lu ; sa mise à jour documentaire est suivie séparément. Les états fournisseur ne sont pas recontrôlés par ce sous-agent ; ils proviennent de SETUP/QA/PROGRESS et du contrôle frais de l’agent principal décrit ci-dessous.

## Actualisation des références avec le volume 5

Le code audité n’a pas changé. Les références bureaux auparavant absentes des quatre premiers PDF sont désormais fournies par V5-C01 (fiche) et V5-C05 (dashboard). V5-C08 précise le workflow d’approbation. Leurs fonctions restent non implémentées dans la version inspectée. Lire le [complément volume 5](COMPLEMENT_VOLUME_5.md) et la matrice consolidée pour l’état documentaire courant.

## Sources et méthode

Lus intégralement : AGENTS.md, DESIGN.md, spécification finale PDF (une page, extraction pymupdf), docs/SETUP.md, docs/QA.md, tous les fichiers de `app/api/`, `app/auth/confirm/route.ts`, `app/auth/reset-password/page.tsx`, tous les fichiers de `lib/`, les deux migrations SQL, `supabase/tests/001_rls_test.sql`, `tests/domain.test.ts`, `tests/domain-invariants.test.ts`, `tests/sql-review.mjs`, package.json et `.github/workflows/check.yml`. Inventaire/rg pour corroborer l'absence d'API ou de modèle spécialisé. Pas de lecture de secrets, pas de test réseau ou bancaire, pas de nouvelle exécution de tests lors de cet audit documentaire.

Sources de besoins : PDF final sections 1–7. Les fonctions de profil métier, refus/contact/performances sont également représentées dans les maquettes artisan que la revue complémentaire catalogue ; les numéros de maquettes précis doivent être rattachés à ce catalogue, pas inventés ici. Une partie des besoins opérationnels ci-dessous est une proposition à spécifier et non une exigence explicitement détaillée dans le PDF.

## Contrôle fournisseur frais reçu de l’agent principal

Pendant cet audit, l’agent principal a exécuté en lecture seule `vercel env ls` : aucune variable applicative dans le projet courant. `supabase projects list` réussit mais ne montre aucun projet dédié de dépannage ; le projet « site électricité » reste distinct conformément à la décision de base séparée. Le refus de création pour facturation reste une preuve historique, pas une nouvelle tentative de création. Je n’ai demandé aucune nouvelle création ni consulté les secrets.

## État global

Le backend technique EXISTE : 15 fichiers de routes API Next.js et une route de confirmation Auth, Auth, règles de domaine, 20 tables SQL et 27 fonctions SQL personnalisées. Ce n'est pas une simple simulation pour ces fichiers. Mais leur déploiement de code sans URL/clé Supabase ne constitue pas une base distante fonctionnelle. Les helpers renvoient explicitement 503 si la configuration manque. D'après SETUP/QA, la base dédiée n'a pas été créée (facturation) et Stripe n'est pas configuré. Le navigateur en démo utilise un autre chemin local.

La spécification exprime un produit beaucoup plus étendu que les modèles actuels. Les tables permettent un cycle élémentaire demande/devis/intervention/paiement, puis un B2B simplifié. Elles ne permettent pas à elles seules un back-office entreprise complet ni une exploitation complète de marketplace.

## Matrice de capacités et limites

Légende : **codé** signifie chemin serveur présent, pas intégration réelle validée. **Partiel** indique un sous-ensemble fonctionnel. **Absent** signifie aucun modèle/commande/route spécialisé trouvé dans le code inspecté. Les références sans numéro sont des chemins relatifs à la racine ci-dessus.

| ID | Fonction / besoin | État et preuve de code | Ce qui manque / limite réelle |
| --- | --- | --- | --- |
| BE-01 | Comptes, profils, rôles | Codé : lib/supabase/client.ts, server.ts ; trigger create_profile, profils rôle client/artisan/manager/admin | Auth distante et email non vérifiés ; pas de gestion entreprise détaillée, MFA/admin bootstrap ou changement de rôle applicatif |
| BE-02 | Confirmation email et récupération | Codé : app/auth/confirm ; reset-password page échange PKCE/vérification utilisateur/updateUser | Vrais emails, expiration, configuration redirections et reprise réelle à tester ; pas preuve d'intégration par seule présence de page |
| BE-03 | Protection des droits | Codé : RLS sur toutes les tables métier ; révocation mutations directes ; RPC SECURITY DEFINER search_path vide | Matrice distante et charge/concurrence réelle non testées ; rôle admin global sans granularité opérateur ; pas de permissions par site |
| BE-04 | Créer une demande | Codé : POST /api/interventions → create_intervention ; propriétaire serveur, adresse, ville, catégorie, urgence, site | Aucun créneau de rendez-vous, disponibilité contact, latitude/longitude ou équipement concerné structuré |
| BE-05 | Fourchette estimative | Partiel : valeurs fixes dans lib/domain.ts et SQL create_intervention | Pas moteur tarifaire/config admin/contrat/zone/majoration ; données d'exemple non validées commercialement ; duplication des valeurs dans code/SQL |
| BE-06 | Offres et matching | Partiel : available_missions() anonymise ville/code postal, limite100, ordre récent | Pas classement intelligent, secteur artisan, rayon, distance, compétences, disponibilité ou score ; ne pas appeler ceci matching géographique |
| BE-07 | Acceptation de mission | Codé : intervention_action 'accept_mission', artisan approuvé, ligne FOR UPDATE | Preuve isolée de second gagnant refusé séquentiellement ; test à deux connexions simultanées reste absent |
| BE-08 | Refus artisan / réattribution | Absent : aucune action decline/refuse ni table offres refusées | Définir refus individuel, délai, relance/autre artisan, désistement après acceptation et annulation ; ne pas annuler le dossier client à la place |
| BE-09 | Disponibilité et planning artisan | Absent : profils n'ont aucun champ disponibilité, planning ou zone ; intervention n'a pas de date prévue | Calendrier, astreinte, horaires, indisponibilité, créneaux et capacité simultanée manquent ; 'scheduled' est un besoin de planification, pas une réservation |
| BE-10 | Coordonnées du participant affecté | MANQUE CONCRET : profils_read est propriétaire ou admin seulement ; workspace ne retourne que le profil courant | Même après attribution, client/artisan ne reçoit pas via ces API le nom/téléphone de son interlocuteur ; projection de contact autorisée à définir, sans ouvrir tous les profils |
| BE-11 | Devis détaillé | Codé : send_quote, calculateQuote, validation SQL des lignes/TVA ; centimes ; un devis actif | Quantités entières uniquement (pas demi-heure native), pas signature/evidence d'accord détaillée, identité fiscale ou numérotation commerciale |
| BE-12 | Révision et refus du devis | Partiel : ancien devis sent passe rejected lorsqu'un nouveau est émis ; accept_quote est contrôlé | Pas commande de refus client avec motif/négociation ; rejected signifie aussi remplacé, pas décision explicitement tracée ; pas modèle avenant après acceptation |
| BE-13 | Intervention début/fin | Codé : start puis complete, transitions et dates serveur | Pas déplacement/en-route/arrivée, compte rendu structuré, temps passé, pièces réellement utilisées ou validation de fin par le client |
| BE-14 | Annulation | Partiel : propriétaire/gestionnaire autorisé peut annuler requested/assigned/quoted | Pas règle de frais, remboursement ou no-show ; pas désistement artisan ni arbitrage opérateur ; la politique exacte est absente de la spécification |
| BE-15 | Photos/documents | Codé : API documents, bucket privé4MiB, formats contrôlés, liens60s, permission écriture/lecture | Pas catégorie métier (assurance/diplôme/photo avant/après), validité/expiration/statut vérification, version/archivage ou suppression ; aucun lien direct site/organisation/contrat/audit |
| BE-16 | Éligibilité artisan | Partiel : booléen artisan_approved changé seulement par admin, journal de décision | Pas dossier de candidature structuré (entreprise/SIRET/qualification/assurance/zone), workflow d'examen/motif/renouvellement ou contrôle d'expiration |
| BE-17 | Chat | Partiel : messages texte par intervention, réservé aux participants/écrivains autorisés, limite durable | Pas pièces jointes chat, lu/non-lu, modération/signalement, présence, historique paginé ou support de conversation hors intervention |
| BE-18 | Suivi temps réel | Code publication interventions/quotes/messages si publication Supabase existe | Pas GPS ni carte ni ETA ; transport Supabase réellement connecté non vérifié ; ne pas confondre états de dossier et position artisan |
| BE-19 | Notifications multicanaux | Absent : aucun outbox, provider, abonnement push ou table notification | Email/SMS/push, préférences/consentements, retries et suivi de livraison à spécifier/intégrer ; compteur de messages n'en tient pas lieu |
| BE-20 | Stripe Connect | Codé : /api/payments/connect, artisan approuvé, Accounts v2 recipient, idempotence par compte | Activation et responsabilités/pays à confirmer ; aucun scénario Stripe test réel exécuté ; aucun état détaillé de compte stocké/synchronisé |
| BE-21 | Paiement Checkout | Codé : devis accepté + intervention completed + demandeur exact + compte Connect actif ; montant serveur ; idempotence | Seul créateur client_id peut payer, même si un autre membre entreprise est habilité à approuver ; il faut définir payeur entreprise/centralisé. Paiement après fin est le comportement choisi, pas un workflow configurable |
| BE-22 | Confirmation financière | Codé : webhook brut signé + RPC confirm_stripe_payment transactionnelle et événements uniques | SDK/provider/webhook réels non validés ; hors deux événements Checkout payés, tous autres événements sont ignorés |
| BE-23 | Commission | Partiel : PLATFORM_FEE_BPS et application_fee_amount Stripe | Pas modèle montant commission net, historique de taux, règles par contrat ou vue rapprochement ; montant0–100% techniquement permis, fourchette commerciale15–25% reste à décider |
| BE-24 | Reversements artisan | Partiel : destination Stripe configurée dans le paiement | Pas synchronisation payout/transfer, compte-rendu de virement, solde, échéancier, échecs, correction ou rapprochement ; 'paid' signifie client payé, pas argent reçu sur compte bancaire artisan |
| BE-25 | Refus bancaire/remboursement/litige | Absent : schéma a failed mais aucune transition de webhook l'utilise ; pas refund/dispute API/événements | Un paiement remboursé/contesté hors app ne serait pas reflété par les handlers inspectés ; politique et droits de traitement à définir |
| BE-26 | Facturation commerciale | Absent : pas table facture, numérotation, avoirs ou génération PDF | Récapitulatif de devis ne remplace pas la facture réglementaire ; déterminer émetteur, taxes, données entreprise et documents attendus |
| BE-27 | Abonnements/premium | Absent : aucun subscription/plan/customer billing workflow ou webhook associé | Plans, prix, avantages client/artisan, résiliation, impayés, factures récurrentes et rôle Stripe Billing à spécifier |
| BE-28 | Notation et performance | Partiel : avis1–5 unique après dossier paid, auteur propriétaire | Pas agrégation de performance artisan/API KPI, définition période/acceptation/retards, modération ou droit de réponse ; métriques maquettes non prouvées réelles |
| BE-29 | Garantie1an | Partiel : DB réglage service + API env, demandeur propriétaire, paid, dans année de completed_at, un dossier ouvert, décision admin | Pas contrat de couverture, pièces justificatives, mission corrective, SLA/alertes/notification automatique ; date de départ choisie par code à confirmer métier |
| BE-30 | Gestion des états garantie | Partiel : submitted/reviewing/resolved/declined avec résolution texte, audit | Pas graphe de transitions/restriction de réouverture des terminés, ni historique des versions de résolution ; décideur responsable à définir |
| BE-31 | Organisation entreprise | Partiel : organizations et membres ; createsite génère 'Mon organisation' et propriétaire au besoin | Pas création/édition explicite raison sociale, identité, contacts facturation, multi-org ou onboarding complet d'entreprise |
| BE-32 | Membres et délégations | Partiel : table owner/manager/viewer et RLS | Aucune API d'invitation, acceptation, changement de rôle, suppression/révocation, transfert de propriétaire ou restriction à des sites ; les tests insèrent les membres via accès de test privilégié |
| BE-33 | Fiches site | Partiel : nom, type, adresse, budget ; création et modification budget | Pas contacts/interlocuteurs, zones, bâtiment, équipements dédiés, documents directs site, SLA, horaires d'accès, type ERP ou fiche détaillée complète |
| BE-34 | Syndic/multi-immeubles | Partiel : type syndic et plusieurs sites | Pas structure copropriété/immeuble/lot/parties communes, répartition dépenses, autorisations copropriété ou rapport AG |
| BE-35 | Restauration | Partiel : type restaurant et generic compliance kind equipment | Pas registre structuré cuisine/froid/éclairage, criticité, état, équipement lié au ticket, contraintes exploitation ou SLA |
| BE-36 | Bureaux | Partiel : sites budget + fiche échéance maintenance | Pas bâtiments/zones structurés, plan récurrent/ordonnancement, consommation énergétique ou budget par exercice |
| BE-37 | ERP | Partiel : generic audit/maintenance/safety notes et due_on | Pas référentiel réglementaire, checklist, validité/certificat, preuve documentaire liée ou obligations calculées ; aucun moteur de conformité |
| BE-38 | Workflows d'approbation | Partiel : seuil1/site, propriétaire choisit rôle owner/manager ; trigger queue et garde acceptation | Pas paliers multiétapes, suppléants, délais/escalades, plusieurs critères, droits par budget, historique de configuration versionné ; éviter 'moteur configurable complet' |
| BE-39 | Contrats cadres | Partiel : titre/référence/texte/dates/état par organisation | Pas parties, périmètre sites/artisans, signatures, documents liés, version/renouvellement, approbation ou moteur tarifaire |
| BE-40 | Grilles tarifaires | Absent comme données calculables : texte libre contracts.terms seulement | Pas lignes/prestations/prix/conditions/priorité de tarification appliqués au devis |
| BE-41 | Budgets et alertes | Partiel : budget_cents/site + totaux acceptés/payés SQL | Pas période/exercice, sous-budgets, engagements réservés, règles de dépassement, alertes notifiées ou journal d'alertes |
| BE-42 | SLA | Absent : aucun champ échéance contractuelle/horloge/statut de dépassement | Délais réponse/affectation/intervention, calendrier, pauses, gravité, escalades et preuves manquent |
| BE-43 | Reporting consolidé/export | Partiel : RPC SQL sous RLS, montants payés/engagés/devis acceptés, compteur interventions, CSV neutralisé | Pas filtres de période, analytique vertical/KPI, rapports AG, consommation, PDF/programmé ; export au-delà1000sites refuse avec demande de filtre |
| BE-44 | Archivage automatique | Absent : pas job/cron/outbox ou modèle rétention | Archivage manuel contract status n'archive pas automatiquement documents ; stockage et conservation à spécifier |
| BE-45 | Diagnostic photo IA | Absent : aucun provider, route analyse, données résultat/validation | Modèle, entrée image, consentement, sécurité, évaluation, revue humaine et coût à décider |
| BE-46 | Back-office opérateur | Partiel : /api/admin/artisans liste100 + approuve/suspend, warranty décisions, lecture étendue via RLS | Pas gestion clients/entreprises globale, dispatch/réassignation, gestion litiges/remboursements/commissions, configuration tarifaire, opérateurs/rôles, support ou supervision technique/financière spécialisée |
| BE-47 | Audit/traces | Partiel : audit_log et professional_audit append-only côté utilisateurs, acteurs/actions/date | Pas payload avant/après, historique complet identité/fichiers/finance, recherche/exports admin ou observabilité structurée des erreurs ; erreurs génériques sans trace persistante |
| BE-48 | Historique et volumes | Partiel : workspace100jobs,200quotes,500messages ; documents/reviews/payments100 | Pas pagination/cursor/ancien historique ; vieux devis ou conversation peuvent manquer de la vue ; ne pas promettre historique complet |
| BE-49 | Suppression/portabilité compte et rétention | Absent comme parcours/API | À spécifier pour exploitation réelle ; pas explicitement détaillé dans PDF donc décision opérationnelle, pas exigence inventée attribuée au document |
| BE-50 | Sauvegardes/restauration, monitoring | SETUP dit à valider ; aucune automatisation/version de runbook exécutée | Pas preuve backup/restore, métriques métier, alertes de panne, objectifs disponibilité ; ce sont besoins opérationnels à cadrer |
| BE-51 | Formulaire contact et support | Absent : aucune route contact/support ou modèle ticket d’aide | Maquette42 (volume3 p11) montre nom/email/téléphone/sujet/message/envoi ; l’interface d’aide ne remplace pas ce traitement |
| BE-52 | Bon et rapport d’intervention | Absent comme modèle structuré | Blueprints6,52,69 : bon digital, constats, mesures, pièces, photos avant/après et horodatage, synthèse incident ; documents génériques ne portent pas ces rubriques ni validations |
| BE-53 | Signature sur site / validation partenaire de fin | Absente : pas signature, preuve d’acceptation de travaux ou état associé | Blueprints6/52/69 ; simple clic accept_quote avant travaux n’est pas la signature du bon/validation de fin |
| BE-54 | Dispatch / contrôle de plateforme | Absent : admin ne peut pas attribuer, réassigner ou escalader par une commande dédiée | Blueprint52 montre dispatch manuel/auto ; m43 montre supervision interventions ; rôleadmin lecture étendue ne crée pas ces actions |
| BE-55 | ERP / comptabilité / CRM / BI | Absent : aucun connecteur, export de protocole, webhook sortant ou mapping | Blueprints6/52/69 ; destinataires, systèmes et droits sont à préciser, plutôt que présumer une API ERP |
| BE-56 | Urgences professionnelles graduées | Partiel : urgency seulement urgent/scheduled | Maquette55 montre critique/élevé/moyen/faible et impact ; le modèle ne représente ni cette échelle ni son routage/SLA |
| BE-57 | Avis, messages et paramètres opérateur | Absent comme commandes de gestion globale | Maquette43 (volume3 p12) SuperAdmin : Artisans/Interventions/Devis&Factures/Clients/Avis&Notes/Messages/Paramètres + CA mensuel/annuel ; APIadministrative actuelle ne couvre que artisans et décisions garantie |
| BE-58 | Stocks et logistique des pièces | Absent | Blueprint69 cite stockpièces/logistique ; périmètre à réconcilier avec le PDF final électricité, qui ne détaille pas cet axe ; ne pas le déclarer MVP obligatoire par extrapolation |
| BE-59 | Reprise des retours Auth/Checkout/Connect | Défaut d’intégration statique : routes émettent des paramètres que le composant principal ne lit pas | Checkout renvoie `?payment=pending&intervention=…` ou cancelled ; Connect `?connect=refresh/returned` ; auth `?auth=confirmed/expired`. CourantApp ne lit que hash et brouillon, pas URLSearchParams/location.search. Pas d’ouverture ciblée du dossier, de reprise d’onboarding ou de message d’erreur/confirmation associé. Ne pas confirmer le paiement à partir du paramètre : relire l’état serveur. |

## Références visuelles corroborées par le catalogue PDF de la revue complémentaire

Le rapport docs/audit/CATALOGUE_MAQUETTES.md a été lu après sa génération. Il précise notamment : maquette43, volume3 page12, tableau explicite SuperAdmin avec menus Artisans/Interventions/Devis&Factures/Clients/Avis&Notes/Messages/Paramètres, indicateurs CA/interventions et vérification candidatures ; maquette65, volume4 page18, cinq étapes de candidature (personne, société, pièces, zones, disponibilités) ; maquettes6/52/69, blueprints B2B avec bons/rapports/photos/mesures/signatures/factures/avoirs/intégrations/dispatch. Ces éléments rendent certains manques plus explicites qu’une lecture de la seule page de spécification finale. Les exemples de SLA, commissions, délais et certification des images restent à réconcilier avec la référence finale, pas à adopter comme règles validées.

Écart fichier : m65 indique PDF/JPG10Mo alors que l’API limite à4MiB pour l’hébergement actuel. Il faut choisir une stratégie upload direct signé/contrôlé si10Mo est retenu, ou documenter l’adaptation ; ne pas promettre10Mo sur une route qui rejette au-delà4MiB.

## Constats transverses prioritaires, à noter sans coder

1. **Contact affecté manquant** (BE-10). `profiles_read` initiale ligne153 exclut la lecture du profil de l'autre participant ; `/api/workspace` renvoie seulement le profil courant. Corriger nécessite une projection minimale autorisée après attribution ; ouvrir tous les profils serait la mauvaise correction.
2. **Pas de véritable équipe d'entreprise** (BE-32). Le modèle de membre est présent mais seul le propriétaire initial est inséré par un chemin applicatif. Les parcours multi-utilisateurs ne peuvent être configurés depuis l'application.
3. **Responsable payeur trop restrictif pour B2B** (BE-21). La permission d'accepter un devis comprend un membre owner/manager via owns_intervention, tandis que Checkout exige exactement job.client_id===user.id. Un responsable budget ne peut donc pas payer pour une demande d'un collègue. C'est à spécifier, pas nécessairement à ouvrir sans règles.
4. **Départ d'un salarié/gestionnaire à spécifier**. `can_access_intervention`/`owns_intervention` considèrent toujours client_id==auth.uid même pour un dossier rattaché à une organisation. Une future suppression de membre ne retirera pas ce lien de créateur. Définir propriété organisation vs auteur et comportement d'offboarding avant d'ajouter les invitations/révocations. Aucune fuite distante n'est démontrée : aucune base configurée n'a été testée dans cet audit.
5. **Validation artisan binaire sans dossier métier** (BE-16). Approuver le booléen n'atteste pas l'examen de pièces structurées, leur expiration ou leur conformité.
6. **Créneaux et refus absents** (BE-08/09). Ni la temporalité de rendez-vous ni le refus individuel d'une offre ne sont modélisés. Ces écarts sont visibles dès la boucle terrain et ne doivent pas être masqués par des libellés UI.
7. **Règlement client ≠ reversement reçu** (BE-24/25). Le statut paid du dossier ne suit pas les virements ni remboursements/contestations ; modèle financier à compléter avant exploitation.
8. **Fiches verticales génériques** (BE-33–37). Changer le type du site et stocker une note equipment/audit ne couvre pas les fiches métier complètes ni obligations de la spécification.
9. **Pagination et historiques bornés** (BE-48). Le reporting a un garde de troncature et agrège en SQL ; les listes workspace restent des fenêtres sans moyen de charger la suite.
10. **Contrats / workflow / garantie : périmètres limités**. Un texte libre ne constitue pas une grille tarifaire calculable ; une règle de seuil n'est pas multiétape ; un dossier de réclamation n'est pas la garantie1an automatisée annoncée comme produit.

11. **Retours d’intégration non consommés** (BE-59). Sources exactes : Checkout lignes118–119 ; Connect lignes72–73 ; auth/confirm lignes20/28. Dans CourantApp, initialisation lignes748–781 et navigation hash lignes794–803 n’analysent pas ces paramètres. Ce défaut peut être vu avant configuration des services, mais son effet de bout en bout réel n’a pas été testé ici.

## Décisions manquantes DANS la spécification (à traiter comme questions, pas exigences déjà rédigées)

- SP-B01 : distinguer clairement exploitant/super-administration, direction d'entreprise cliente, équipes de gestion, artisan indépendant/entreprise artisanale ; droits et responsabilités exacts.
- SP-B02 : définir plateforme web/mobile native pour chaque acteur et les contraintes de notification/localisation.
- SP-B03 : candidature artisan : champs, justificatifs obligatoires, critères d'examen, expiration, suspension et réactivation ; qui vérifie et sous quel délai.
- SP-B04 : secteur géographique et compétences artisan, disponibilité, algorithme/priorité de matching, distance, refus, temps d'acceptation, relance et réaffectation.
- SP-B05 : réservation, créneaux, rendez-vous, en-route/arrivée, absence, urgence, dépassement de délai et preuve de fin d'intervention.
- SP-B06 : estimation : fourchettes réelles, frais/majorations, taxes, devis payant ou gratuit, conditions de prix et source de validation ; paramètres par contrat.
- SP-B07 : qui peut demander/accepter/payer au nom d'une organisation ; propriété du dossier si le salarié quitte l'entreprise ; accès aux coordonnées après attribution.
- SP-B08 : cycle des devis : versions, refus, modifications, signature/acceptation, avenants et écart au devis une fois le travail engagé.
- SP-B09 : paiement : préautorisation ou paiement après intervention, échecs, expiration, remboursements, contestations, annulation, commissions et responsabilités Connect ; source de vérité et réconciliation.
- SP-B10 : factures/avoirs : émetteur, mentions, numérotation, taxes applicables et documents remis ; questions métier/juridiques à faire valider, aucune conclusion réglementaire ici.
- SP-B11 : abonnements clients/artisans, plans, prix, bénéfices, quotas, souscription, résiliation, impayés et premium.
- SP-B12 : organisation : création/vérification, invitations, approbation des membres, rôles par site, délégation, propriétaire, payeur et multi-organisation.
- SP-B13 : fiches par vertical : contacts, bâtiments/zones, équipements critiques, documents, horaires, récurrences, lectures de consommation et unités.
- SP-B14 : SLA : seuils par gravité, calendrier d'exploitation, début/arrêt/pauses de l'horloge, escalades, notifications, responsabilités et historique.
- SP-B15 : budget : exercice/période, engagement vs payé, devis rejetés/révisés, dépassements, approbateurs, paliers, suppléants et alertes.
- SP-B16 : contrats : parties, rattachement sites/artisans, durée, renouvellement, grilles calculables, priorité entre contrat et tarif standard, versions et preuve d'accord.
- SP-B17 : rapports : destinataires, périodes, définitions des métriques, AG, consommation, formats, fréquence et conservation.
- SP-B18 : garantie1an : point de départ, couverture/exclusions, preuves, bénéficiaire B2B, intervention corrective, délais de traitement, frais et clôture ; le code utilise completed_at mais la source ne le précise pas.
- SP-B19 : conformité ERP : juridiction/type d'établissement, référentiels, périodicité, responsables et preuve ; ne pas confondre suivi documentaire et validation réglementaire.
- SP-B20 : notifications et chat : canaux, événements, opt-in/préférences, livraison/reprise, lu/non-lu, modération et communication de données personnelles.
- SP-B21 : documents : catégories, droits, suppression, version, expiration, archivage automatique et durée de conservation ; sauvegarde/restauration.
- SP-B22 : IA : rôle consultatif ou décisionnel, fournisseur, consentement, risques d'erreur, revue humaine, tests et comportement en cas de panne/danger.
- SP-B23 : exploitation : écrans et droits opérateur, support/litiges, paramètres autorisés, supervision/alertes, environnement test et critères de passage en réel.

## Surfaces opérateur / entreprise / artisan : séparation explicite

- **Backend technique** : les API et SQL ci-dessus ; présent, mais dépend de services non configurés dans l'état documenté.
- **Back-office entreprise cliente** : quelques API B2B et RLS ; pas équipe administrable ni fiche verticale complète ni payeur délégué ; le type global est manager, les rôles d'organisation sont owner/manager/viewer.
- **Back-office artisan** : offres, transitions, devis et Connect ; pas dossier d'entreprise artisanale, disponibilité/planning, refus, distances ou indicateurs de reversements.
- **Super-administration de plateforme** : rôle admin existe, il lit largement sous RLS et peut approuver/suspendre un artisan et statuer sur la garantie. Cela ne signifie pas qu'un back-office d'exploitation complet existe. Les fonctions de dispatch/finance/gestion entreprise détaillée doivent être cadrées ; la section6 du PDF dit admin et la maquette43 précise les menus/KPI/gestion candidatures et interventions ; les droits et règles détaillés restent à écrire.

## Points de réutilisation / snippets exacts

- `lib/domain.ts` : calculateQuote, canTransition, verifyPayment et csvCell ; tests unitaires associés dans les deux fichiers tests .test.ts.
- Migration initiale : create_intervention ligne174 ; available_missions ligne191 ; intervention_action ligne199 ; create_site ligne249 ; send_message ligne268 ; approve_artisan ligne278 ; submit_review ligne286 ; confirm_stripe_payment ligne295 ; grants/RLS lignes137–163 et316–327.
- Migration professionnelle : set_approval_rule ligne96 ; decide_approval ligne114 ; save_contract ligne129 ; save_compliance ligne145 ; set_site_budget ligne162 ; request_warranty ligne173 ; resolve_warranty ligne183 ; professional_report ligne198 ; publication Realtime ligne214.
- `GET /api/workspace` : chargement borné sous RLS ; `POST /api/interventions/[id]/actions` : validation et délégation à RPC ; garder la validation serveur et les erreurs explicites au lieu de remplacer par une simulation.
- `POST /api/payments/checkout` : propriétaire, devis et montant serveur, idempotence et Connect ; webhook : signature sur corps brut avant RPC. Ces fichiers sont des points de départ à vérifier avec les secrets de test, pas des preuves de transactions déjà passées.

Signatures métier personnalisées à préserver / étendre explicitement :
```
create_intervention(p_category text,p_description text,p_address text,p_postal_code text,p_city text,p_urgency text,p_site_id uuid default null)
available_missions()
intervention_action(p_id uuid,p_action text,p_lines jsonb default null,p_tax_rate numeric default20)
create_site(p_name text,p_type text,p_address text,p_budget_cents integer,p_organization_id uuid default null)
send_message(p_intervention_id uuid,p_body text)
update_profile(p_full_name text,p_phone text)
approve_artisan(p_user_id uuid,p_approved boolean)
submit_review(p_intervention_id uuid,p_rating integer,p_body text)
confirm_stripe_payment(p_event_id text,p_event_type text,p_session_id text,p_quote_id uuid,p_amount integer,p_currency text)
set_approval_rule(p_site_id uuid,p_threshold_cents integer,p_required_role text,p_enabled boolean)
decide_approval(p_approval_id uuid,p_decision text,p_note text)
save_contract(p_organization_id uuid,p_title text,p_reference text,p_starts_on date,p_ends_on date,p_terms text,p_status text,p_id uuid default null)
save_compliance(p_site_id uuid,p_title text,p_kind text,p_due_on date,p_status text,p_notes text,p_id uuid default null)
set_site_budget(p_site_id uuid,p_budget_cents integer)
professional_report(p_site_id uuid default null)
request_warranty(p_intervention_id uuid,p_description text)
resolve_warranty(p_case_id uuid,p_status text,p_resolution text)
```

## Ce qui est testé / ce qui ne l'est pas

- Les fichiers unitaires contiennent11 tests sur montants, arrondis, limites, transitions et références de paiement + CSV. CI exécute npm ci puis check (types+unités+build) ; aucun test d'API distante ou SQL n'est inclus dans la commande CI actuelle.
- QA consigne13 groupes PostgreSQL PGlite exécutés antérieurement avec stubs explicites auth/storage et omission pgcrypto ; il ne s'agit pas d'une base Supabase réelle. Les tests couvrent RLS, rôle, attribution séquentielle, devis/paiement idempotent, approbation, reporting et garantie.
- Le fichier pgTAP18 assertions est présent mais son exécution Supabase est signalée en attente dans SETUP. Le double artisan est testé séquentiellement dans les deux stratégies, pas en concurrence à deux connexions.
- Aucun nouveau test n'a été lancé ici ; pas de validation fraîche des comptes cloud, des emails, du stockage, de Realtime ou de Stripe.
- Absents des preuves : tests Route Handlers intégrés, test de signature webhook avec un événement Stripe réel, onboarding Connect/payout/refund, invitations/retrait de membres, contrat/grille réelle, workflow SLA et tests de charge/restauration.

## Confiance et limites

Confiance élevée sur l'inventaire et les écarts de schéma/API lus. Les absences ci-dessus sont des absences dans ce dépôt, pas la preuve qu'un prestataire externe ne pourrait pas les fournir. Les états historiques Supabase/Stripe sont documentés ; l’absence actuelle de variables et de base dédiée a été revérifiée en lecture seule par l’agent principal, pas par ce sous-agent. Les risques d'offboarding et de payeur entreprise sont des écarts métier à cadrer, pas des incidents distants démontrés. Le catalogue visuel du collègue doit confirmer les références des maquettes et les détails UI ; cette mission ne conclut pas à une fidélité graphique. Les ajouts opérationnels non spécifiés dans le PDF doivent rester étiquetés propositions/questions plutôt qu'exigences déjà présentes.


## Références ajoutées par les volumes 6 à 9

Le code inspecté n’a pas changé. Les volumes 6/7/9 sont des reprises exactes d’images déjà reçues ; quatre nouvelles images V8 complètent les sources : À propos, confidentialité, détail devis et détail intervention. Les nouvelles lignes PUB-09/PUB-10 et les références V8-C06/C07 sont intégrées dans la matrice principale, désormais à 76 points.

Ces images confirment notamment les manques de pages publiques propres au produit, de refus de devis côté client, de PDF/version commerciale, de contact participant autorisé, de galerie, d’historique métier et de modification de rendez-vous. La politique YourCompany, les histoires/équipes, les promesses de satisfaction/annulation et les exemples peinture/plomberie ne constituent pas des décisions validées. Voir le complément du volume 8 pour les détails. Aucune nouvelle vérification live ni modification applicative n’est déduite de cet apport documentaire.
