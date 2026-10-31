# Plan de réalisation révisé après audit consolidé

## Primary goal
Livrer une plateforme de dépannage électrique où client, artisan, entreprise cliente et exploitant accomplissent leurs tâches dans des espaces distincts et fidèles aux références, avec données privées persistantes et cycle demande → devis → intervention → paiement Stripe démontré en ligne.

**Statut courant : réalisation Web/PWA autorisée, en cours.** La rédaction initiale était une préparation ; le propriétaire a ensuite autorisé l’exécution autonome split et demandé iOS/Android après le Web/PWA. Ce plan conserve ses critères ; [WEB_PWA_DELIVERY.md](WEB_PWA_DELIVERY.md) décrit les checkpoints, preuves, blocages et le relais Claude de minuit. Lire [l’audit consolidé](audit/REAUDIT_CONSOLIDE.md), la [matrice des 76 capacités](AUDIT_COMPLET_SPECIFICATIONS.md) et le [registre des décisions](SPECIFICATIONS_A_COMPLETER.md).

## Périmètre, ordre et méthode

- Sources : 9 PDF / 102 pages / 93 occurrences / 63 images distinctes ; 5 archives / 61 membres / 17 chemins / 19 contenus distincts. Les 12 JSX de base ne remplacent pas les maquettes métier ; les numéros initiaux 19–32 restent non identifiés.
- Stack conservée : Next.js/React/TypeScript, Supabase Auth/Postgres/Storage/RLS, Stripe Checkout/Connect, Vercel. Versions dans package-lock.json. Web responsive actuel ; une distribution native reste un lot explicite après décision, avec expo-overview si Expo est retenu.
- Distinguer entreprise cliente, société prestataire employant des techniciens et Super Admin de la plateforme. Le rôle d’owner B2B n’accorde aucun droit plateforme.
- Commencer par les droits et les contrats de données, puis le serveur et les interfaces. Un back-office opérateur minimal arrive avant le cycle terrain ; son extension complète reste obligatoire dans le plan, pas repoussée hors périmètre.
- Découper chaque phase en lots livrables : migration additive revue, commande serveur validée, écran de référence, erreurs/vide/chargement, refus d’accès, preuve en ligne. Aucune phase n’est close par une démonstration localStorage.
- MVP/V2/V3 restent les priorités de la spécification. Le plan couvre l’ensemble demandé ; un lot avancé reporté demeure ouvert. Aucune fonction n’est supprimée pour réduire la difficulté.
- Un environnement de test isolé peut être provisionné pendant les lots préparatoires quand l’accès est disponible ; aucune ouverture réelle avant les contrôles de sécurité. L’ancien refus Supabase pour facturation n’est pas réputé encore actuel sans nouveau contrôle.
- Skills d’exécution : do pour les lots lorsqu’ils seront demandés ; frontend-design et vercel-react-best-practices pour les interfaces ; autres skills uniquement selon besoins réels. Les règles AGENTS.md et DESIGN.md s’appliquent à chaque lot.

## Phase 0 — Sources, décisions et contrats d’écran

**How this serves the primary goal:** chaque tâche future possède une référence, des règles et une preuve de fin identifiables.

**À produire.** Reprendre le catalogue et les manifestes vérifiés ; choisir une maquette maîtresse par écran. Écrire la matrice rôle/action/objet/étape, le graphe des états, les règles de visibilité des contacts et le propriétaire des dossiers B2B. Établir les contrats de commande manquants avant d’écrire leurs interfaces. Le registre de décisions distingue ce que le développeur peut choisir de ce qui demande une donnée commerciale réelle.

**Décisions par dépendance.** Avant droits : responsabilités des acteurs et départ des membres. Avant onboarding : pièces et validité. Avant devis : émetteur, version, refus/avenants, taxes et prix. Avant Stripe : commission, pays, responsabilité financière, bénéficiaire/payeur, remboursement. Avant publication : exploitant, territoire, horaires et conditions. Une inconnue n’empêche pas les lots indépendants ; elle bloque seulement les fonctions qui en dépendent.

**Références à lire.** AGENTS.md, DESIGN.md, SPECIFICATIONS_A_COMPLETER.md, CATALOGUE_MAQUETTES.md, ARCHIVES_CODE.md, la spécification finale sections 1–7 ; documentation technique listée plus bas. La collecte déléguée de cette révision figure dans les trois rapports REAUDIT_*.

**Preuves de fin.** Chaque ID des 76 capacités est affecté au tableau de couverture ci-dessous ; chaque écran indique source, acteur, données, commandes et états. Chaque décision ouverte indique lot bloqué et responsable ; les trois back-offices ont leurs menus et fiches inventoriés.

**Garde-fous.** Ne pas faire des exemples des tarifs réels, de la marque d’un comparateur l’identité finale, ou des animations jointes une dérogation au design.

## Phase 1 — Isolation des comptes et fondations de droits

**How this serves the primary goal:** changer de compte ou d’organisation ne révèle pas les données d’un autre utilisateur.

**À réaliser.** Reprendre le pattern authenticatedClient + validation + RPC existant ; reproduire puis corriger le cache professionnel conservé à la déconnexion, les vues hash sans garde et les réponses réseau tardives lors d’un changement de session. Gérer expiration/renouvellement et changement d’utilisateur. Définir puis appliquer propriété organisationnelle, droits par site, révocation, séparation admin/support/finance et projection minimale des coordonnées après attribution. Renforcer les tests de refus côté API et SQL avant d’ajouter les invitations.

**Références.** components/courant-app.tsx (logout, refreshProfessional, onHash et rendu) ; lib/supabase/server.ts ; RLS can_access_intervention/owns_intervention/profiles_read et is_org_member dans 202610310001_initial.sql ; tests d’accès existants ; rapports frontend/backend révisés.

**Preuves de fin.** A → déconnexion → B, session expirée, retour arrière, hash saisi directement et réponse A arrivant après connexion B ne montrent aucune donnée A. Un membre retiré perd les lectures/écritures B2B définies ; un compte non habilité ne s’attribue aucun rôle. Tests serveur conservés même si les boutons sont cachés.

**Garde-fous.** Aucun élargissement global de profiles pour obtenir un téléphone ; aucune correction limitée au menu ; ne pas annoncer une fuite distante prouvée sur le seul constat statique.

## Phase 2 — Base dédiée et intégration authentifiée

**How this serves the primary goal:** les comptes, demandes et pièces existent réellement après reconnexion et restent privés.

**À réaliser.** Vérifier en lecture seule l’accès fournisseur et les environnements. Créer seulement la base dédiée déjà demandée ; revoir les deux migrations et les compléments de phase 1 en base de test. Configurer Auth, emails, URLs autorisées, Storage privé, variables Vercel par environnement et comptes de recette. Réutiliser serverClient/browserClient, auth/confirm et reset-password. Préparer journaux, sauvegarde/restauration, procédure de retour arrière et données de test identifiées. Traiter le retour Auth principal avec restauration du seul contexte autorisé, en conservant la récupération de mot de passe existante.

**Références.** SETUP.md, lib/supabase/client.ts/server.ts, app/auth, supabase/migrations, supabase/tests/001_rls_test.sql ; documentation officielle Supabase SSR/RLS/Storage.

**Preuves de fin.** Confirmation et récupération depuis une URL de preview autorisée ; session persistante sur deux navigateurs ; création puis relecture du dossier ; document privé inaccessible à un tiers ; migrations appliquées dans l’environnement dédié ; test de restauration documenté avant production.

**Garde-fous.** Ne jamais utiliser « site électricité » comme solution de repli. Pas de secret dans Git/client/logs. Accès indisponible = phase bloquée explicitement, poursuite des seuls lots indépendants.

## Phase 3 — Structures visuelles et premier back-office opérateur

**How this serves the primary goal:** chaque acteur reconnaît son espace et l’exploitant peut préparer les artisans et les interventions nécessaires à la recette.

**À réaliser.** Extraire progressivement les vues du composant monolithique, avec modèles partagés utiles et gardes par rôle. Reprendre composition/navigation par acteur ; artisan mobile M35, entreprise M4/M66, Super Admin M43. Créer d’abord le dossier de candidature opérateur, sa décision motivée et le tableau des interventions. Préparer les autres menus admin avec leur lot de réalisation explicite ; un menu vide ne vaut pas une fonction livrée. Centraliser tokens et états.

**Sources à reprendre.** DESIGN.md ; M43 V3 p12 ; M35 V3 p4 ; M66 V4 p19 ; éléments pertinents des 12 JSX. Choisir une seule version styles.css ; le projet n’a pas Tailwind installé. Adapter dans la stratégie CSS existante ou justifier une introduction contrôlée, jamais copier @apply dans le CSS actuel comme s’il était compilé. Réduction du mouvement, absence de boucle décorative, délais de fade corrigés.

**Preuves de fin.** Comparaisons source/capture sur preview à 360 px et desktop, navigation clavier, focus et états ARIA ; aucun accès inter-rôle via URL ; dossier de candidature lisible et décision persistante. Chaque action déclarée livrée a un effet serveur vérifié.

**Garde-fous.** Pas de style IA générique ; pas de même tableau renommé pour les trois métiers ; pas de nouvelle marque imposée. Conserver la structure métier, pas seulement la couleur.

## Phase 4 — Candidature et travail artisan

**How this serves the primary goal:** un artisan autorisé reçoit et gère les missions adaptées à son activité.

**À réaliser.** Identité/société, justificatifs typés, validité/remplacement, examen/correction/suspension, profil, zone/compétences et disponibilité. Offres éligibles, absence d’offre, acceptation concurrente, refus individuel, expiration et réattribution opérateur selon règles de phase 0. Vue mission, contact après attribution, planning et actions métier propres. Préparer le suivi des règlements sans fausse promesse de virement. Sous-lot performance : réputation/avis, ponctualité et chiffre d’affaires avec formule, période et source ; dépendances aux phases 5/6/8.

**Sources à reprendre.** M14 ; M34–36 ; M44 ; M60/64/65/67 ; ArtisanMission/ArtisanDashboard en références simplifiées ; approve_artisan(), available_missions(), intervention_action(), routes profil/documents/admin existantes. Ajouter des commandes documentées pour les capacités absentes.

**Preuves de fin.** Dossier incomplet/non approuvé/suspendu ne prend pas une mission ; deux sessions concurrentes n’obtiennent jamais la même attribution ; refus d’une offre n’annule pas la demande du client ; disponibilités et zone changent réellement l’éligibilité ; aucun téléphone complet avant l’étape autorisée. Chaque indicateur de performance est recalculé sur un jeu connu, avec bonne période et distinction CA/net/encaissé.

**Garde-fous.** Pas de distance inventée ni de statut disponible purement décoratif ; le sélecteur de rôle de démo n’authentifie personne. Le statut de vérification doit décrire les pièces réellement examinées.

## Phase 5 — Parcours client, devis et preuves terrain

**How this serves the primary goal:** le client et l’artisan peuvent terminer une intervention réelle avec un devis et des preuves cohérents.

**À réaliser.** Demande/photos, estimation configurable, prise en charge ou absence d’artisan, rendez-vous/replanification, en route/sur place, coordonnées autorisées, messages et historique. Sous-lot localisation : fournisseur et droits choisis, carte/itinéraire, position et ETA avec source/fréquence/horodatage et état indisponible ; distinguer estimation et mesure. Devis avec unités, validité, brouillon, versions, pièces, PDF de la version sélectionnée, accord/refus et avenant. Compte rendu : tests, mesures, pièces/temps, photos avant/après, signature/preuve d’accord et validation de fin selon les règles fixées. Avis éligible et profil client.

**Sources à reprendre.** M5/7/15/18/34/47/62, V8-C06/C07 ; blueprints M6/M52/M69 ; RequestForm, Detail, QuoteEditor, MessageCenter, DocumentManager, ReviewForm ; calculateQuote/canTransition ; routes interventions/actions/messages/documents/reviews. Les commandes refus/replanification/rapport sont à spécifier puis ajouter : elles n’existent pas dans l’enum actuel.

**Preuves de fin.** Cycle client A/artisan approuvé avec persistance réelle ; fichier conservé après échec de soumission ou reprise explicite ; ancien devis ouvre sa version exacte ; accord périmé/version remplacée refusé ; rapport lié à la bonne intervention ; annulation/refus respectent les règles. Carte et ETA vérifiés avec positions/créneaux connus, donnée périmée ou refus de localisation visibles sans délai inventé. Reprise réseau et session expirée testées.

**Garde-fous.** `scheduled` n’est pas un rendez-vous, un TXT n’est pas une facture, un clic accepter n’est pas automatiquement une signature avancée. Ne pas élargir à plomberie/peinture à partir des exemples V8.

## Phase 6 — Stripe test, factures et règlements

**How this serves the primary goal:** le règlement correspond au devis et les deux parties comprennent ce qui est payé, remboursé ou versé.

**À réaliser.** Configurer Stripe test et Connect selon pays/responsabilités retenus. Préserver montant serveur, idempotence et corps brut signé du webhook. Traiter retours Checkout/Connect/Auth par relecture des données, échec/annulation, événements différés/doublons/désordonnés, remboursement et litige selon règles. Modéliser factures/avoirs, émetteur/numérotation, commissions historisées, frais, transferts et versements avec états distincts. Écrans client, artisan et opérateur finance.

**Sources à reprendre.** app/api/payments/{checkout,connect,webhook}/route.ts ; lib/supabase/stripe.ts ; confirm_stripe_payment() ; SETUP.md ; docs officielles Accounts v2/Checkout/webhooks/destination charges. Le code utilise stripe.v2.core.accounts et accountLinks : ne pas substituer un exemple ancien sans revue de compatibilité.

**Preuves de fin.** Paiement test complet sur preview ; montant/devise/destinataire exacts ; webhook sans signature rejeté, événement répété sans double effet ; retour URL ne marque jamais payé ; confirmation asynchrone visible ; remboursement et litige traçables ; facture/avoir exacts ; statut payé distingué du virement bancaire. Les tests réels restent hors de ce lot.

**Garde-fous.** Clés live bloquées ; aucun taux commercial inventé ; pas d’acceptation d’un montant client ; aucun succès de paiement simulé en mode réel. Ne pas se limiter aux deux événements de succès actuels.

## Phase 7 — Back-office entreprise cliente complet

**How this serves the primary goal:** les organisations clientes gèrent leurs équipes, sites, validations et finances sans mélanger leurs données.

**À réaliser.** Onboarding organisation, sélecteur actif, invitations/acceptation/retrait/délégations, rôles et droits par site ; identité/facturation/payeur. Portefeuille et fiches avec contacts, accès, documents, équipements, budgets par exercice et alertes. Demande préremplie par site, approbations avec historique/complément/refus, contrats et grilles versionnées, reporting consolidé paginé et exports correctement filtrés. Relier aux factures et au cycle Stripe avec payeur autorisé.

**Sources à reprendre.** M4/M66 ; M13/16/55 ; V5-C08 ; ProfessionalOperations, Sites ; create_site(), is_org_member(), fonctions professionnelles et professional_report() ; routes sites/professional/reports. Le modèle de membres existe mais aucune API d’invitation/retrait n’est livrée.

**Preuves de fin.** Deux organisations, deux sites chacune ; owner/manager/lecteur/payeur testés ; un lecteur n’écrit pas ; membre retiré perd l’accès selon politique ; aucune sélection implicite organizations[0] ; approbation obligatoire non contournable ; export et totaux identiques aux données de référence au-delà des fenêtres de chargement actuelles.

**Garde-fous.** Ne pas considérer un filtre type comme une verticale complète ; aucun droit plateforme hérité d’un owner B2B ; modification d’un contrat ne réécrit pas rétroactivement un devis accepté.

## Phase 8 — Super back-office plateforme complet

**How this serves the primary goal:** l’exploitant pilote tous les dossiers et les opérateurs disposent des commandes de leur responsabilité.

**À réaliser.** Compléter tous les menus M43 : dashboard/KPI, artisans/candidatures, interventions/dispatch/réaffectation/escalade, clients/entreprises, devis/factures/finance, avis/modération, messages/support, paramètres. Dossiers de garantie et mission corrective ; recherche, pagination, filtres cohérents, historique avant/après et motifs. Administration des permissions séparée du support et de la finance ; actions financières raccordées au lot Stripe.

**Sources à reprendre.** M43 V3 p12 ; blueprints M6/M52/M69 ; ADM-01–10 et annexe BACKEND ; patterns authenticatedClient/validation/RPC ; approve_artisan/resolve_warranty et journal existant comme bases seulement. Les nouvelles commandes admin seront spécifiées, pas supposées présentes.

**Preuves de fin.** Chaque menu mène à liste, fiche et actions persistantes attendues ; opérateur support interdit de modifier finance/droits ; réaffectation empêche l’ancien artisan de poursuivre ; action sensible tracée avec auteur/objet/motif ; KPI définis et calculés sur tout le périmètre autorisé, pas les seules lignes chargées.

**Garde-fous.** Deux panneaux d’approbation et garantie ne suffisent pas ; pas de lecture globale de messages personnels sans règle support explicite ; pas de statut conforme/certifié calculé à partir d’une simple note.

## Phase 9 — Verticales et automatisations prévues

**How this serves the primary goal:** syndic, restauration, bureaux et ERP disposent des fonctions qui justifient leur espace métier.

**À réaliser par sous-lots.** Syndic : parties communes, priorités et rapports AG dans le périmètre retenu. Restauration : équipements électriques critiques, tickets et engagements de délai. Bureaux : bâtiments/étages/zones/plans, maintenance, énergie/occupation avec source de mesure. ERP : audits, réserves, suivi sécurité et preuves. Ajouter règles SLA, notifications/préférences et reprises, temps réel cohérent, archivage/expiration et garantie selon conditions réelles.

**Sources à reprendre.** M13/16/37/50/55/56/57 ; V5-C01/C05/C08 ; F sections 3–4/7 ; routes professional/reports/warranty et publication Realtime existante. Lister les fournisseurs de carte/notifications/mesures retenus avant appel réseau.

**Preuves de fin.** Un scénario complet par verticale, sources/unités/périodes des KPI identifiées ; alertes franchissant réellement leur seuil ; un événement ne produit pas de doublons de notification ; panne fournisseur visible et reprise ; pièces expirées et garantie reliées au bon dossier ; lecture autorisée uniquement.

**Garde-fous.** Aucun MWh inventé, aucune conformité réglementaire auto-attribuée. Un rapport administratif ou immobilier global n’est pas implicitement un module électrique ; décision de périmètre explicite pour chaque extension.

## Phase 10 — Extensions conditionnelles sans oubli de périmètre

**How this serves the primary goal:** les extensions prévues sont suivies sans compromettre le cycle opérationnel déjà validé.

**À réaliser après décision, en lots distincts.** Entreprise prestataire : dirigeant/planificateur/techniciens, attribution interne et propriété des règlements, si ce modèle est retenu. Abonnements/premium, moyens de paiement supplémentaires, intégrations CRM/ERP/comptabilité/BI, diagnostic photo IA évalué et éventuelle application native. Chaque sous-lot possède fournisseur, coût, données, responsabilité, critères de succès et refus d’accès.

**Sources.** ART-12, FIN-07/08, SYS-10 ; Q-PDF-02/32–35 ; spécification finale sections 4–5/7 ; M65 et blueprints. Les API externes exactes seront relues dans la documentation du fournisseur retenu et dans les types épinglés avant toute implémentation.

**Preuves de fin.** Décision de chaque sous-lot : retenu/reporté/exclu avec motif. Un sous-lot retenu démontre son cycle complet, erreur et retour arrière ; aucune fonction reportée n’est marquée terminée. Le diagnostic IA distingue suggestion et décision humaine ; l’application native fait l’objet d’une vraie distribution de test.

**Garde-fous.** Ne pas confondre société prestataire et client B2B ; aucune obligation d’abonnement ou fournisseur IA déduite d’un exemple ; ne pas appeler native la version web mobile.

## Phase 11 — Vérification et livraison par périmètre

**How this serves the primary goal:** la livraison est vérifiable et décrit exactement les fonctions utilisables et les limites restantes.

**À exécuter.** Relire les API officielles et les contrats utilisés ; vérifier les anti-patterns (rôle démo en mode réel, secret client, montant navigateur, succès depuis URL, fausses métriques, liens inertes). Exécuter npm run check, tests SQL en environnement dédié, concurrence réelle à deux sessions, tests Auth/Storage/Stripe et isolation des organisations ; comparer toutes les captures aux références maîtresses. Vérifier restauration, supervision, erreurs réseau et accessibilité.

**Références.** Matrice des 76 capacités, tests métier/SQL, AGENTS.md, DESIGN.md, QA.md, preuves de chaque phase et documentation fournisseur. Les anciens 11 tests et 13 groupes SQL ne constituent pas une recette de toutes les fonctions.

**Preuves de fin.** Commit poussé, contrôles CI et preview Vercel vérifiés à chaque lot important ; captures et parcours datés, comptes de test identifiés sans secret, résultats et limites consignés. Pour chaque capacité : absent/partiel/codé/connecté/vérifié, jamais un pourcentage déduit du nombre de fichiers. Ouverture commerciale uniquement après fermeture des contrôles bloquants et données commerciales réelles disponibles.

**Garde-fous.** Aucun lancement commercial ou débit réel impliqué par ce plan. Si un service reste inaccessible, indiquer les lots vérifiés et le blocage ; ne pas annoncer l’application entière terminée.

## Documentation technique et patterns autorisés

Pages officielles relues pour cette révision ; relire la section correspondant au SDK installé au début de chaque lot :

| Besoin | Pattern existant à préserver | Documentation |
| --- | --- | --- |
| Auth serveur | createServerClient, cookies getAll/setAll, authenticatedClient et auth.getUser ; ne pas autoriser via le seul user de getSession | [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs) |
| Isolation | auth.uid(), politiques USING/WITH CHECK, fonctions métier contrôlées ; droits et signatures relus dans les migrations | [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) |
| Paiement | stripe.checkout.sessions.create, clé d’idempotence ; montants issus du devis serveur | [Destination charges / Checkout](https://docs.stripe.com/connect/destination-charges?platform=web&ui=stripe-hosted) |
| Événement | request.text(), stripe.webhooks.constructEvent, RPC transactionnelle et identifiant d’événement | [Stripe webhooks](https://docs.stripe.com/webhooks) |

APIs projet déjà disponibles : GET /api/workspace ; POST /api/interventions ; POST /api/interventions/[id]/actions avec accept_mission/send_quote/accept_quote/start/complete/cancel ; routes profile/sites/messages/documents/reviews/admin/artisans/professional/reports/warranty ; paiements checkout/connect/webhook. Lire verbes et schémas exacts dans chaque fichier avant copie. Les signatures détaillées et emplacements sont dans REAUDIT_BACKEND et REAUDIT_FRONTEND. Refus de devis, RDV, équipe, dispatch et facturation ne sont pas des commandes actuelles : elles sont proposées dans les phases, à spécifier et tester.

## Couverture et reprise d’une session

Le tableau [COUVERTURE_PLAN.csv](audit/COUVERTURE_PLAN.csv) affecte les 76 capacités aux phases principales et complémentaires ; l’appartenance à une phase ne signifie pas livraison. Une session d’exécution lit ce plan, les décisions du lot, sa source PDF, le code concerné et les docs officielles ; réalise un seul lot cohérent ; consigne commit, preview, contrôles et blocages. La phase dépendante ne démarre qu’après ses prérequis.
