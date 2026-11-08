# Fastsplit — finition intégrale de l’application

Base reprise : 6c02157 sur integration/web-pwa. Objectif propriétaire : application complète et utilisable ; seules liaisons Stripe et SMS différées. Aucun cron, production, main, stores, achat, promotion d’un compte non identifié ou donnée fictive présentée comme réelle. Conserver WIP et preuves historiques.

## Répartition immédiate

- ROOT Codex : coordination, contre-revue, intégration, tests bout en bout, preview GitSource et bilan honnête. Seul opérateur cloud. Inventaire des 76 capacités actualisé depuis le code ; aucun statut ancien hérité sans preuve.
- Codex backend (un seul worker, deux Codex ROOT inclus) : parcours paiement uniquement plateforme ; owns lib/features/guest/payment-options.ts, bookings.ts, onsite-settlement.ts, app/api/bookings/settlement/onsite/route.ts, migration nouvelle sous supabase/migrations, tests ciblés dédiés. Pas components, pas mutation cloud, pas credentials. Fermer aussi la RPC de déclaration directe, préserver l’historique et l’idempotence des réservations. Contrat HTTP court livré avant branche frontend consommatrice, tests réels des fonctions et refus intercomptes.
- Claude lead réutilisé b4b555f0-67e3-4f63-9671-fc3c14f9e67c : UI/design/frontend, ownership components/** (sauf components/app/types.ts si non nécessaire), app/globals.css/layout.tsx si nécessaire, tests UI associés. Première tranche livrable : thème B sans nom de marque, choix paiement plateforme uniquement, suppression action de déclaration directe, conserver devis et paiements antérieurs honnêtes. Une seule branche writer ; worker existants réutilisables avec fichiers disjoints, pas duplication de lead ni toucher sessions CRM. Pas backend/API/migration ni cloud. Lire fastsplit, AGENTS, DESIGN courants et preuves récentes.

## Suite, sans exclusion de modules

Parcours client complet ; artisan complet ; organisation et verticales B2B ; administration/support/finance ; documents/notifications/permissions ; options avancées du catalogue, puis mobile/web cohérents. Chaque capacité a sa fiche de preuve ou reste ouverte ; pas de faux « terminé ». Aucun compte admin substitut : identité propriétaire toujours à confirmer avant activation réelle.

## Vérification par tranche

Nominal et erreurs principales, loading/error/empty, thème clair/sombre, mobile/desktop, formulaires et reprises sans doublon, droits serveur/RLS sur données privées. Commit/push cohérent ; preview en ligne vérifiée. Paiement/OTP injectés explicitement en test, jamais exposés comme mode de production ni comme succès bancaire réel.

## ENT-09 — suivi énergie, ROOT Codex auteur

Module indépendant à implémenter : consommations réelles saisies par période et compteur/source, aucune mesure inventée et aucun fournisseur énergétique requis. ROOT seul lib/features/energy/**, app/api/sites/[id]/energy/route.ts, nouvelle migration site_energy_periods et tests associés. RLS lecture site / écriture manage-site, sources et unités explicites, dates valides, versions optimistes, rejeu sans doublon, archivage au lieu de suppression, journal des modifications ; aucune dépendance aux fichiers paiement du worker. API sous JWT du demandeur, pas de service key. Frontend à confier à Claude après contrat backend stable. Contre-revue backend indépendante avant merge/cloud.

## ADM-07 — réponse administrateur auditée, ROOT Codex auteur

Ajouter POST /api/admin/messages avec UUID de message stable, intervention et texte ; RPC étroite admin_send_message sous JWT, vérification admin actuelle, verrou du dossier, rejet interrôle, rejeu exact même acteur/dossier/texte, audit sans copie du contenu. Pas de droit d’écriture REST ni élargissement des lecteurs. Vérifier nominal/refus/rejeu/conflit/erreurs serveur et SQL isolé avant câblage Claude ; ROOT seul cloud.

## ADM-04 — dossiers d’un client, ROOT Codex auteur

Compléter le filtre serveur client_id de l’annuaire interventions administrateur ; UUID strict, empreinte curseur incluant le client, comptage et pagination existants conservés, aucune projection privée ajoutée ni droits élargis. Le point de lecture profil existe déjà via /api/admin/directory?kind=clients&id=UUID. Claude raccorde la fiche client à ces deux routes après tests.

## ENT-16 / FIN-05 — lecture privée des factures existantes, claim Codex backend

Base bd5bdcc ; branche codex/customer-invoices, ownership lib/features/customer-invoices/**, GET app/api/invoices/**, migration lecture seule et tests. Réutiliser registre immuable platform_invoices et invoiceDocumentInput/renderInvoicePdf en lecture seule, sans émission/remboursement ou modification routes opérateur/RLS du registre. RPC étroites SECURITY DEFINER nécessaires car registre réservé finance : JWT auth.uid obligatoire, autorisation explicite sur identités IMMUTABLES issuer/recipient ; organisation uniquement destinataire société + can_access_site actuel sur le site du dossier dans cette organisation. Artisan émetteur historique conserve facture de prestation ; commission uniquement artisan destinataire, jamais client/organisation. Aucun accès attribué sur simple nouvelle affectation artisan ou nom/téléphone. Liste paginée/caps/count exact atomiques, filtres site/org/intervention/kind/basis et curseur liés à identité/filtres ; détail/PDF privés à version SHA256 de l’instantané, avoir parent cohérent et autorisé. Requête étrangère404, erreurs fournisseur503 ; aucun service client, aucun secret, pas de fausse facture/paid. Contrat DTO avant câblage Claude ; tests vrais handlers/PDF et SQL PGlite puis tsc et revue ROOT avant cloud/UI.

## PAY-QR — QR du lien de paiement plateforme, claim Claude (lead + worker existant)

Frontend seul, base writer claude/ui-palette-b-full. QR généré LOCALEMENT (qrcode-generator 2.0.4 MIT épinglé, sans dépendance ; jsqr 1.4.0 Apache-2.0 en devDependency pour décoder dans les tests) à partir de l’URL déjà produite et validée par GET /api/payments/link : origine de la page + chemin relatif /#detail/UUID du contrat, rien d’autre. Aucun service d’image, traceur ou jeton ajouté ; jamais d’ouverture automatique de Checkout, jamais de « payé » déclaré ; artisan en lecture (afficher/copier). package.json/package-lock.json : lead seul. Leaf components/role/payment-link.* + tests/ui/payment-link*.test.ts : worker. Backend, rapport professionnel et taux de TVA hors périmètre (ROOT). Tests : décodage du QR = URL exacte, copie, aucun POST.

# ROOT-MISSIONS-PAGE-20261106 — en cours

Responsable : Codex ROOT, un seul auteur backend. Périmètre : nouvelle RPC `available_missions_page` et GET `/api/artisan/missions`, schéma de projection anonyme et tests ciblés. L'éligibilité postale/catégorie/disponibilité et l'acceptation atomique existantes restent l'autorité. Pagination chronologique stable, curseur lié à l'identité, borne 50+1 ; aucune adresse/contact précis avant attribution, aucune distance inventée, aucun compteur exhaustif non prouvé. Backend d'abord puis feuille UI Claude séparée après contrat. Vérification : vrais handlers, SQL avec >100 offres et refus de rôle/éligibilité ; intégration puis preview et recette bornée. Aucune configuration de territoire inventée.

## LIVRAISON-INTÉGRALE — assemblage par lots, recette commune

Référence de travail [plan des 76 capacités](docs/PLAN_LIVRAISON_INTEGRALE.md), base intégrée 002de1a. Coder en parallèle, puis traiter les constats de la revue commune par lot. Le statut livré nécessite la recette sur le commit déployé.

- **Pilote** : intégration sélective du formulaire client et du panneau remboursement déjà écrits. Adaptation de la recette SQL avancée au contrat actuel de remboursement et exécution sur PostgreSQL isolé. Conserver les preuves négatives et le rollback. Aucune duplication de la migration déjà appliquée.
- **Astra** : reprise du WIP existant de remplacement d'empreinte dans la branche codex/hold-reauthorization. Seul auteur des fichiers de ce lot. Terminer tests et contrat sur la base actualisée. Aucun cloud ni accès fournisseur.
- **Claude** : réutiliser la session et les auteurs UI existants. Carte et localisation du dossier client, avec données autorisées et aucun envoi d'adresse privée à un fournisseur tiers sans décision. Ownership de la feuille carte, du câblage UI local et des tests UI ciblés. Développer sans éditer les fichiers de finance, de formulaire et de session en cours d'assemblage.
- **Raccordement final** : Stripe et Vonage restent au dernier lot de recette. Le pilote applique les migrations de test et exécute la recette en ligne. L'identité du premier Super Admin, le lancement public et les boutiques relèvent de leurs décisions existantes.

### Correction du dépôt depuis l’espace client

Le pilote étend le contrat SQL de réservation aux cinq identifiants génériques déjà émis par le formulaire connecté. La catégorie doit correspondre à l’identifiant. Les fiches catalogue, les permissions et les clés de rejeu gardent leurs contrôles. À la modification du brouillon, l’identifiant suit un éventuel changement de catégorie. Le changement de compte invalide les photos en mémoire et les anciennes réponses. Vérifier une création SQL par catégorie, une paire incohérente, le rejeu et le parcours navigateur.

### Conditions de garantie versionnées

Astra fournit le contrat et le serveur dans `codex/warranty-activation`. Un auteur Claude réutilisé raccorde le texte publié côté public et l’éditeur au panneau Garantie. Le panneau sépare sauvegarde, publication et activation explicite. Les droits, versions, commandes persistées et états d’erreur suivent le contrat dans `docs/reviews/WARRANTY_POLICY_BACKEND.md`. Les textes viennent de l’exploitant. Le pilote assemble et recette sur le projet dédié avec le dépôt désactivé.

### Énergie consolidée et rappel de rendez-vous

Un auteur Claude réutilisé raccorde la lecture consolidée à l’espace entreprise depuis la version `610b13f`. Il affiche les sites et dates sélectionnés, les relevés déclarés, les données manquantes et les périodes effectivement comparables. Le contrat se trouve dans `docs/reviews/ENERGY_CONSOLIDATION_BACKEND.md`. Aucun changement serveur ni télémétrie inventée.

Astra réalise le rappel de rendez-vous personnel côté serveur. Le participant autorisé choisit un horaire valide avant un créneau enregistré et peut annuler son rappel. Le traitement réévalue le créneau et l’accès et réutilise les notifications privées. Il reste borné et dédupliqué. Vérifier permissions, changement du créneau, annulation et rejeu. Aucun envoi externe ni mutation cloud par l’auteur.

## ART-03 / ADM-02 — décision individuelle de justificatif

Pilote seul auteur de la migration, API /api/artisan/credentials/[id]/reviews et tests. Historique immuable, motif, version attendue, rejeu par UUID, lecture par l'artisan propriétaire et l'administration actuelle. Une pièce revue garde son type et sa date déclarée, l'artisan peut joindre une nouvelle pièce pour corriger. Une décision sur une pièce ne modifie pas l'approbation globale du dossier. Le contrat UI expose uniquement la pièce, les décisions datées, le droit d'action et le curseur. Vérifier accès croisés, expiration, concurrence par version, zéro double audit et reprise après réponse perdue. Cloud après assemblage et revue.

## Finition du code et préparation de la recette par parcours

Assembler les feuilles énergie, rappels et accessibilité déjà poussées sur la branche de livraison, puis compléter les parcours manquants. Astra est responsable du serveur équipes prestataires (ART-12). Le lead Claude répartit les interfaces entre les auteurs existants, sur des fichiers disjoints. ROOT est responsable de l'assemblage et du serveur de garantie corrective (ADM-10). Réutiliser les transitions et autorisations du dossier existant. Vérifier au fil du code avec les suites ciblées, dont les refus intercomptes. La recette de livraison en ligne se fera ensuite par parcours. Stripe et Vonage restent au dernier lot.

### SYS-09 / PUB-10 — données du compte

ROOT réalise la lecture paginée des données du compte sous la session courante et la demande explicite d'effacement via le circuit d'assistance existant. Les dossiers d'organisation et les messages de tiers sont exclus du téléchargement personnel. Le dépôt ouvre un ticket consultable et garde son identifiant au rejeu. L'effacement effectif et la durée de conservation restent des opérations distinctes à définir. Claude raccorde les actions et leurs états à l'espace connecté. Tests de portée, réponse invalide, pagination et rejeu avant assemblage.

### PUB-03 — vérification de couverture publiée

ROOT implémente la publication versionnée de codes postaux exacts par le Super Admin et la lecture publique d'un seul code. Aucun code prérempli. Le retrait rend la couverture inconnue. La consultation renseigne le territoire publié ; le moteur d'attribution garde son éligibilité existante. Claude raccorde la vérification publique et l'éditeur. Tester retrait, conflit, rejeu et refus de rôle.

### ENT-13 — appliquer une grille publiée au devis

ROOT est seul auteur du serveur. Le propriétaire de l’organisation autorise une grille pour le dossier. L’artisan actuellement attribué peut alors appliquer ses lignes et quantités. Le serveur reprend les prix unitaires publiés et le brouillon versionné existant. Une édition manuelle ultérieure forme une autre version. À l'envoi, le serveur conserve la référence de la grille et refuse une grille devenue inapplicable. L'accord et les totaux restent ceux du moteur de devis. Claude raccordera l'interface du devis après stabilisation du contrat. Tester prix exact, conflits, périmètre, envoi et conservation de l'historique.

- ENT-16 — Astra : propriétaire unique backend payeur B2B délégué, branche codex/delegated-payer base e541656 ; périmètre docs/missions/ENT16_DELEGATED_PAYER.md. Aucun cloud/UI.

- ENT-12 — Astra : serveur des étapes ordonnées, compléments et décisions sur le devis exact. Contrat dans docs/ADVANCED_APPROVALS_BACKEND.md. Claude raccorde le parcours existant sans changer la règle d’acceptation.

### SYS-04 — préparation de la livraison externe

Astra réalise le lot serveur de file privée et de reprise pour les notifications e-mail et push, à partir des préférences explicites et des notifications existantes. Vérifier les accès à l’émission, les doublons, les changements de préférences et la reprise d’une tentative incertaine. Tests isolés avec adaptateur injecté. Aucun fournisseur sélectionné, aucune activation ni modification des parcours SMS.

### SYS-10 — revue manuelle des photos du dossier

ROOT raccorde la section photo du particulier à la conversation du dossier attribué et donne à l’artisan attribué accès aux photos du même dossier par le téléchargement privé existant. Vérifier dossier exact, absence de photo, rôle et refus d’accès. La revue manuelle utilise la messagerie actuelle. L’analyse automatique reste suivie séparément.

Astra réalise la préanalyse d’une image privée après consentement explicite, par un adaptateur OpenAI optionnel. La sortie décrit seulement une catégorie visible et la lisibilité. Elle est montrée au client après décision de l’artisan attribué. Les accès au dossier et au fichier sont revérifiés autour du fournisseur. Vérifier les refus, les changements d’affectation, la réponse incertaine et la continuité de la revue manuelle. Le fournisseur reste inactif jusqu’à validation de la configuration, de la notice et du jeu d’évaluation.

### FIN-08 — cartes enregistrées

Astra réalise le serveur pour un compte particulier vérifié. Liste masquée, consentement explicite puis ajout via Stripe Checkout en mode setup, retrait du moyen prouvé rattaché au client Stripe du compte. L’identifiant client est établi côté serveur, isolé par mode et créé avec reprise bornée. Le retour navigateur déclenche une nouvelle lecture. Claude raccorde le profil à ce contrat. Vérifier la portée intercomptes, le refus sans consentement et la reprise après une réponse incertaine. Les opérations sont testées avec Stripe injecté. Le branchement aux règlements et la recette Stripe restent distincts.

ROOT raccorde les cartes personnelles aux nouveaux règlements Checkout, après activation explicite. Le Customer du même compte vérifié et du même mode est fixé avec le dossier de paiement au premier début. Les comptes entreprise, mandats et commandes existantes restent sur leur trajectoire. Vérifier le mode, le rattachement et le rejeu exact, sans prélèvement automatique ni changement des montants.

### SYS-04 — envoi e-mail configurable

ROOT raccorde un adaptateur Resend optionnel à la file privée. L’adresse courante vérifiée et les paramètres exacts du message sont contrôlés avant chaque tentative. Une empreinte privée empêche la reprise avec un autre destinataire ou contenu. La reprise est bornée à une fenêtre inférieure à celle du fournisseur. Vérifier opt-in, porte, refus des appels non autorisés et réponses fournisseur injectées. Aucune activation ni opération sur le compte fournisseur. La livraison push conserve son propre parcours.

### CLI-03 / ART-04 — rayon indicatif des offres

Astra ajoute un réglage personnel facultatif fondé sur les centres publics des communes de Martinique. L’artisan choisit sa commune de référence et son rayon. Le réglage ne collecte aucune position GPS, conserve les conditions métier actuelles et s’applique avant pagination et lors de l’acceptation. Les zones sans centre déterminable suivent le filtre postal, avec cette limite indiquée. Vérifier absence de réglage, distances connues et inconnues, modification simultanée et confidentialité des offres. Le classement par distance est une étape distincte.

ROOT ajoute le tri facultatif des offres par tranches indicatives de 5 km, puis par ancienneté à l’intérieur d’une tranche. Les offres sans commune unique passent à la fin. Le curseur est lié au compte et à la version du rayon. Vérifier la pagination, le maintien du tri chronologique et l’absence de coordonnées privées.

### SYS-04 — notifications push Web

ROOT raccorde Web Push à la file privée et au service worker existants. L’utilisateur choisit un navigateur destinataire et confirme l’autorisation. Une session Supabase courante, la préférence active et l’accès à la notification sont revérifiés avant un envoi générique. Une tentative dont la réponse est incertaine reste sans rejeu. Vérifier changement de compte, désinscription, absence de données du dossier, protection de l’URL de destination et reprise du service worker. La configuration VAPID et l’exécution du worker restent désactivées pour la recette.

### FIN-07 — reprise et catalogue des abonnements

ROOT raccorde la reprise de la souscription courante après retour ou réponse perdue au même Checkout, à partir du consentement et des identifiants serveur existants. Le catalogue opérateur montre les offres explicites par mode et vérifie le prix fournisseur lors d’un changement. Claude raccorde les boutons aux parcours existants. Vérifier le rejeu, le mode, les droits, les états indisponibles et les offres modifiées. Aucun abonnement ni avantage n’est publié par défaut.

### SYS-07 — recherche des demandes du client connecté

ROOT ajoute une lecture paginée des demandes du compte, hors de la fenêtre de démarrage. Le filtre et la recherche s’appliquent avant pagination. La requête de lecture transporte les termes dans le corps et garde la projection minimale. Claude raccorde « Mes demandes » au même bouton d’ouverture des dossiers. Vérifier plus de 100 demandes, les références anciennes, les recherches littérales et le cloisonnement des comptes.

ROOT ajoute la liste paginée des interventions entreprise et l’export CSV sur le même périmètre, sous RLS et contrôle des habilitations de site. Conserver les filtres et la navigation numérotée. L’export échoue explicitement au-delà de la borne technique de 5 000 dossiers filtrés. Vérifier que recherche et export dépassent la fenêtre de démarrage et excluent tout site révoqué ou étranger.

ROOT complète les compteurs de navigation du particulier dans la lecture de l’espace de travail. Ils comptent ses demandes ouvertes et les messages reçus sous RLS. Masquer un compteur non vérifié et conserver le fonctionnement du reste de l’espace. Vérifier les volumes au-delà des fenêtres de lecture et le changement de rôle.

### PUB-04 — demande de rappel et file d’assistance

ROOT possède le serveur, la migration et les tests. Une demande publique collecte le numéro saisi et le motif sélectionné, avec consentement à ce rappel. Le serveur renvoie un reçu minimal, protège le rejeu et borne les dépôts en base. Seuls les opérateurs d’assistance habilités consultent ou classent la demande. Le classement est tracé sans numéro dans l’audit et ne prouve aucun appel. Claude raccorde le formulaire et la file après publication du contrat. Vérifier dépôt, rejeu, quotas, refus, version et lecture privée. L’activation reste explicite après validation des modalités de traitement.

## ENT — débordement 360 px fiche de site (UI), claim Claude : `.twoCol` mobile et bloc d’approbation avancée en `minmax(0, 1fr)` (branche `claude/enterprise-overflow-fix`, base `a18f507`).

### ENT-15 / ART-10 / ART-07 — lectures au-delà du cache de démarrage

Claude raccorde le rapport entreprise au JSON de `/api/reports`, sur le même périmètre que le CSV. Vérifier les totaux au-delà de 100 dossiers, les états vides et l’effacement au changement d’habilitation. Un second worker Claude raccorde le profil et l’écran performance artisan à la lecture serveur existante. Vérifier les périodes en Martinique, l’erreur de lecture et le changement d’identité.

Astra possède la lecture serveur paginée des devis de l’artisan. Vérifier les anciens dossiers, les révisions et les refus d’accès avant de raccorder l’écran. Garder les lectures sous l’identité réelle et les écritures de devis sur les routes existantes. ROOT intègre et lance la recette sur la version exacte.

### SYS-07 / ENT-04 / ENT-10 — historique et échéances de la fiche site

Astra possède la lecture paginée du site en cours via `GET /api/sites/[id]/records` et les tests de permissions. Le filtre `kind` distingue `open`, `past`, `upcoming`, `completed` et `audits`. Le serveur vérifie le site sous l'identité du membre et conserve la RLS actuelle. Il renvoie les seules colonnes nécessaires et un curseur lié à l'identité, au site et au filtre. Aucun changement des règles métier, des écritures, des migrations ou des accès de l'opérateur.

Claude raccorde la fiche site après publication du contrat. Les onglets d'intervention et les échéances utilisent les lectures paginées et distinguent chargement, vide et échec. Conserver le chemin de démonstration et les actions existantes. Vérifier une intervention au-delà des 100 dossiers, une échéance après 300 enregistrements, un rappel et une fin d'échéance, le changement de site et le refus entre organisations. Les indicateurs et documents encore tirés des dossiers chargés portent leur limite.

## SYS-07 / ENT-04 / ENT-10 — site-records (Astra, mission ROOT44bb56f)
Propriété exclusive route sites/[id]/records, lib/features/site-records, tests et docs/SITE_RECORDS_BACKEND.md. Contrat commit avant code ; lecture manager sous RLS, pages50 date+UUID, aucun droit/migration nouveaux ; preuve dossiers101/échéances301 et scopes. Aucun UI/shared/cloud.

### CLI-05 / SYS-08 — libellés des coordonnées à la confirmation

Claude vérifie la confirmation de réservation. Dans l’éditeur de coordonnées, le message d’erreur placé dans le libellé modifie le nom accessible du champ Téléphone. Réutiliser `Field` pour associer le libellé et le message séparément. Conserver validation, valeurs, apparence et soumission. Vérifier les noms accessibles avant et après correction du téléphone, le focus clavier et l’absence de requête tant que le contact est invalide.

### ADM-03 / ADM-07 — sélection et messages du dossier administrateur

Claude possède `admin-space.tsx` et les composants de ce parcours. Le sélecteur de réaffectation utilise l’annuaire serveur des artisans approuvés et sa pagination. Le fil d’un dossier réutilise la lecture paginée des messages, autorisée par la politique existante qui appelle `can_access_intervention`. Conserver le composeur, la réaffectation et les refus serveur. Effacer la sélection et les données au changement de dossier ou de session. Tester un artisan hors des 100 derniers et un ancien fil avec réponse, état vide, erreur et refus. La vérification locale utilise des données de test. L’activation du compte propriétaire reste différée.

### ENT-12 — retrouver et décider une approbation ancienne

Astra possède les lectures paginée et ponctuelle des approbations d’entreprise, sous RLS, dans `app/api/enterprise/approvals` et `lib/features/enterprise-approvals`. Périmètre organisation et site éventuel, filtre de statut, curseur et projection minimale. La lecture exacte inclut le devis et le site concernés et la règle utile à l’action. Aucune modification des politiques ou de la commande de décision. Vérifier une approbation en attente au-delà de 200, un dossier au-delà de 100, les statuts, le retrait de droit et le cloisonnement des organisations.

Claude possède le raccordement des deux vues entreprise après publication du contrat. Présenter la liste et le détail serveur dans l’organisation active. Conserver l’action existante et relire après décision, avec les états de chargement, vide, refus et reprise. Les droits du serveur gouvernent les actions et les données de démonstration restent isolées.

## ENT-12 — lectures paginées approbations (Astra, ROOT4c14a6d)
Claim exclusif app/api/enterprise/approvals/**, lib/features/enterprise-approvals/**, tests et docs/ENTERPRISE_APPROVALS_BACKEND.md. Contrat publié avant code ; RLS manager/membre/site, pagination50 et point-read exact avec règle. Aucun changement des commandes/approbations avancées/SQL/UI/cloud.

### CLI-08 / ENT-12 / SYS-07 — historique et lien direct des devis

Astra possède la lecture paginée du client et la lecture ponctuelle client/entreprise dans `app/api/quotes` et `lib/features/recipient-quotes`. Publier le contrat court avant le code. Reprendre la pagination et la projection utiles du parcours artisan. Filtrer sous la RLS de l’utilisateur, avec le propriétaire exact du dossier côté client et l’organisation et le site autorisés côté entreprise. La lecture d’une ancienne version indique si elle est encore courante. Conserver les règles d’acceptation, de refus et de paiement. Vérifier plus de 200 devis, plus de 20 révisions, les liens directs, les refus entre comptes et organisations et la reprise après erreur.

Claude possède la liste des devis du client et les vues de détail client et entreprise. Préserver la consultation de l’ancienne version et de son PDF privé, ainsi que le retour vers le dossier et le devis courant. L’écran entreprise résout un identifiant de devis par la lecture dédiée. Effacer le devis affiché au changement d’identité ou de périmètre. La démonstration conserve ses données locales. Intégration et preview par ROOT.

### ENT-13 / SYS-07 — contrats cadres par organisation

ROOT possède la lecture `GET /api/enterprise/contracts` et le détail `GET /api/enterprise/contracts/[id]`. Les deux exigent `organization_id`. La liste accepte un curseur lié au compte et à l’organisation. Elle renvoie 50 lignes au plus, dans l’ordre de création décroissant puis d’identifiant décroissant, avec une référence, un titre, un statut et les dates. Le détail ajoute le texte du contrat. Réutiliser le droit de lecture à l’échelle de l’organisation et la RLS actuelle. Vérifier le refus d’un accès limité à un site, la révocation en cours de lecture et l’accès au-delà de 100 lignes. Aucune nouvelle politique ni nouvelle commande d’écriture.

Claude raccorde l’onglet « Contrats » partagé du portail entreprise dans une branche isolée. Conserver création, activation, archivage et démo, avec un accès au détail de chaque contrat et une relecture après écriture. Le périmètre actif gouverne la liste et le détail. Le raccordement ne modifie pas le lot des liens de devis dans le composant entreprise tant que son responsable le possède.

## CLI-08 / lien devis entreprise — Astra ROOTe05566d
Claim exclusif nouvelles lectures app/api/quotes/route.ts et [id]/route.ts, lib/features/recipient-quotes, tests et docs/RECIPIENT_QUOTES_BACKEND.md. Liste client et détail client/manager exact, versions historiques sans activation, RLS existante. Ne pas toucher approval/contract-grid ni écritures/UI/migrations/cloud.

### ENT-12 — décider sur le devis courant d’un ancien dossier

Astra possède une lecture ponctuelle du contexte de décision d’un devis entreprise. Réutiliser l’autorisation du point devis avec organisation et site explicites. Prouver sous RLS le droit d’écriture actuel, la règle simple applicable, la décision simple de ce devis et sa validité. Ne pas déduire l’absence d’une règle du cache ou de l’état de l’approbation avancée. Publier le contrat avant le code et distinguer absence prouvée, refus et lecture indisponible. Aucune migration ni nouvelle commande métier.

Claude raccorde la décision au détail exact d’un devis entreprise hors de la liste chargée au démarrage. Réutiliser la garde d’approbation avancée, la confirmation, le motif de refus et les commandes existantes avec l’identifiant exact du devis. Exiger le dossier au statut « Devis », la version courante, le droit serveur et les preuves nécessaires avant de proposer l’action. Les versions anciennes restent consultables. Vérifier que le lecteur et le membre révoqué restent bloqués, que l’approbation requise suspend l’acceptation et que le dossier approuvé peut avancer, sans changer d’organisation ni recharger la session.

## Claim Astra — contexte décision entreprise
Branche codex/enterprise-quote-decision depuis d91089a. Ownership route decision-context, lib/features/recipient-quotes, tests et contrat dédié. Lecture seulement ; contrôles RLS existants, aucune migration. Plan et DTO : docs/ENTERPRISE_QUOTE_DECISION_BACKEND.md.

### ADM-10 / PUB-06 — retrouver une demande de garantie au-delà de la première page

Astra possède la lecture de `GET /api/warranty` et ses tests. Conserver `cases` et `enabled`, ajouter `next_cursor`, un filtre `intervention_id` et une pagination stable par `created_at` et `id`. Filtrer avant la limite, utiliser la RLS existante et refuser un dossier ciblé inaccessible. Une demande active doit rester repérable même si l’historique du dossier dépasse une page. Contrat JSON court avant code. Les écritures, l’activation et le rattachement correctif gardent leurs règles.

Claude possède le raccordement des panneaux de suivi et de rattachement correctif. Séparer états vide, erreur et chargement, isoler les réponses par dossier et identité, et proposer la suite de la liste sans perdre l’élément sélectionné. Le formulaire réel n’est proposé que si le serveur confirme que le dépôt est activé et qu’aucune demande active n’existe. Couvrir l’ancien dossier au-delà de 100 entrées, la récupération après erreur et le cloisonnement. ROOT assemble puis vérifie la preview avec des données de test temporaires.

## Claim Astra — garantie historique
Base c14578d ; codex/warranty-history. Ownership GET app/api/warranty/route.ts, lib/features/warranty-history, tests et docs/WARRANTY_HISTORY_BACKEND.md. POST inchangé, aucune migration/activation.

### ART — affecter les interventions au-delà de la première page d’équipe

Claude possède la pagination des interventions, membres, invitations envoyées et invitations reçues dans le panneau Équipe prestataire. Réutiliser les curseurs `next_after` existants. Garder une reprise par section, borner à une lecture par page, maintenir les sélections encore valides et réinitialiser les lectures au changement d’équipe, d’identité ou après une mutation réussie. Le sélecteur d’affectation permet aussi de charger la suite des membres actifs. Conserver les commandes, leurs protections de concurrence et le thème actuel.

Astra vérifie le contrat existant par une recette PostgreSQL isolée dans le test Équipe prestataire. Lire une intervention et un technicien au-delà de 50 entrées, les affecter avec le RPC existant, puis vérifier la révocation. Aucun changement SQL applicatif, appel de fournisseur ou accès cloud par les agents. ROOT assemble, contrôle la preview et distingue les preuves navigateur et PostgreSQL isolé.

### PUB-06 — consulter les conditions enregistrées avec une demande de garantie

Claude possède l'affichage de la version de conditions dans le suivi client et entreprise. Ouvrir à la demande le texte public par `GET /api/public/warranty-terms?version=N`, valider que la version retournée est celle de la demande et conserver le contexte du dossier. Charger, réessayer ou indiquer l'absence de cette version sans lui substituer la publication courante. Pour une demande historique sans version, l'indiquer sans requête. La version enregistrée désigne la publication au dépôt, pas une acceptation ni un droit à la date des travaux. Préserver le texte clair/sombre, le focus, les panneaux existants et l'absence de publication réelle de test. Réutiliser le modèle de lecture et tester les états avec réponses injectées. Aucun changement d'API ni de conditions commerciales.

### PUB / SUP — reprendre un envoi d’assistance sans bloquer ni dupliquer la demande

Claude possède le formulaire de création et ses tests. Séparer le brouillon du contenu validé envoyé, figer l’identifiant, le sujet, le message et le dossier exacts, puis vérifier leur stockage de session avant le premier POST réel. Reprendre cette commande seule après une réponse perdue, une réponse non vérifiable ou un remontage. Empêcher les doubles clics et les reprises sous une autre identité. Préserver les brouillons déjà stockés sans supposer qu’un ancien identifiant a toujours été inutilisé. Un conflit doit proposer de consulter les demandes existantes, avec le texte conservé, sans générer de second ticket automatiquement. Réutiliser les validations et la démo. Tests navigateur de reprise après édition, remontage, stockage indisponible et changement de compte. Aucun changement SQL ou fournisseur.

### PUB / ART / ENT — maintenir la pagination du bon filtre de notifications

Claude possède le centre de notifications et le test navigateur ciblé. Une continuation « Toutes » retenue par le réseau doit être ignorée dès le changement vers « Non lues », y compris son erreur, son curseur et la fin de chargement. Reprendre le bon curseur, borner à une continuation en vol et écarter les réponses après rechargement ou changement de compte. Dans le même panneau, une confirmation de marquage ne doit pas remplacer une liste plus récente par les anciennes lignes capturées avant le réseau. Conserver les commandes, les refus, la démo, le thème et l'API. Vérifier en Chromium les réponses dans l'ordre inverse, un vrai changement de filtre et la reprise correcte.

### ART — conserver le compte rendu pendant l'enregistrement

Claude possède l'éditeur de compte rendu artisan et son test navigateur. Verrouiller les champs, l'ajout ou retrait de contrôles et les doubles soumissions pendant le POST. En cas de refus ou d'échec, garder le résumé, les contrôles et le nom déclaré et permettre la reprise. Fermer uniquement après succès confirmé pour l'éditeur courant. Tester un reçu retenu pendant la saisie et un échec suivi d'une reprise avec la même saisie. Périmètre limité au formulaire, sans changement SQL, statut métier ou paiement.

### SYS-04 / PUB-04 — distinguer canal disponible et réception activée

Claude possède les libellés et leurs tests dans le centre de notifications. Le serveur peut exposer l'e-mail et le push comme disponibles après configuration et autorisation. Le centre doit alors rester exact. Retirer l'affirmation générale qu'aucun canal n'envoie de notifications et afficher « disponible » pour un canal proposé dont la préférence enregistrée est désactivée. Conserver le statut distinct du navigateur pour le push. Vérifier les cas disponible sans opt-in, opt-in confirmé et indisponible. Aucun appel supplémentaire, activation fournisseur ou modification des préférences par le test.

### ENT-10 — conserver la saisie d’un contrôle ERP pendant son enregistrement

Claude possède le formulaire ERP et ses tests ciblés. Pendant l’écriture, empêcher les modifications de la saisie et les soumissions répétées. Après un échec, rendre la main en conservant les champs, le point exact et la version attendue. Vérifier le cas d’une réserve déjà levée dont le constat change, en suivant le contrat de validation existant. Garder distincts le constat, la date de levée déclarée et une éventuelle preuve documentaire. Réutiliser le thème, les permissions, l’API et le journal existants. ROOT vérifie l’ouverture et la levée sur la preview avec un gestionnaire, un lecteur et un tiers. Ce lot ne fixe aucune modalité d’attestation ni de certification.

Contre-revue de `8bd0bfa`. Un 503 du POST ERP transite par le client réel et rend le module entier indisponible, ce qui démonte le formulaire et efface sa saisie. Claude possède aussi la classification de cette commande dans `components/app/features.ts` et ses tests. Garder le formulaire courant et rendre son erreur visible sur un échec transitoire du POST après un chargement réussi. Conserver la détection d’indisponibilité en lecture, les refus et la protection des réponses d’une autre identité. Tester la chaîne avec le client réel et une réponse HTTP injectée. La reprise vérifiée concerne une modification versionnée et un premier POST intercepté avant transmission.

### ENT-07 — relier un dossier de délai au ticket du site

Le formulaire SLA envoie actuellement `intervention_id: null` à chaque modification et efface ainsi un lien existant. Claude possède le formulaire SLA, le câblage de ses options dans la fiche site et les tests associés. Réutiliser la recherche paginée des interventions entreprise, avec organisation et site explicites, liée à l’identité courante. Proposer une sélection facultative dans le formulaire. Conserver le lien existant hors de la page visible ou en cas d’échec de lecture, et ne le supprimer que sur action explicite. Le lecteur peut consulter le dossier lié selon ses accès. L’API existante valide le site, les permissions et la version. ROOT vérifie l’équipement critique lié au ticket, le même ticket relié au délai, la conservation après modification et le calcul avec un calendrier de test.

Contre-revue de `022f2ac`. Le sélecteur reste modifiable pendant un enregistrement du dossier de délai. Verrouiller la saisie du dossier, le choix et le retrait du lien et protéger les soumissions rapprochées. Vérifier la conservation du brouillon après échec et retirer le formulaire si le droit d’écriture est perdu. Garder la référence de ticket cohérente avec celle de l’export entreprise. Afficher l’échéance lorsqu’elle est mesurée, y compris après réponse, afin que le gestionnaire puisse relire l’engagement calculé.

### ENT-09 / ENT-15 — annuler l’export énergie lors d’un changement de contexte

Le panneau énergie est démonté au changement d’organisation ou en quittant Rapports. Sa réponse d’export tardive peut encore déclencher un téléchargement sous la même identité. Claude possède le panneau de consolidation et ses tests. Invalider les réponses de l’instance démontée avant toute sauvegarde de fichier, mise à jour ou programmation de reprise. Préserver le téléchargement du rapport courant et le fonctionnement sous StrictMode. Vérifier un export retenu de A, le passage à B avec le même compte, l’arrivée tardive de A et un export légitime de B. ROOT vérifiera deux périodes comparables, le CSV et les accès sur la preview. Aucun changement d’API ou des règles de mesure.

### ENT-08 — ouvrir la maintenance d’un site actif hors des données initiales

La fiche exacte d’un site absent du chargement initial n’affiche pas le module d’opérations, donc ses plans et visites ne sont pas accessibles. Claude possède ce câblage de `enterprise-space.tsx` et les tests. Réutiliser le module de la fiche normale après la lecture exacte du site dans l’organisation courante, avec le droit du serveur comme plafond et la portée en lecture seule conservée. Éviter les lectures sur un site archivé, inaccessible ou dont l’organisation diffère. Vérifier le plan, sa visite et la navigation d’un site à l’autre, ainsi que les refus du lecteur. ROOT teste un site réellement absent des 100 sites initiaux sur la preview. Aucun changement d’API ni de données métier.

### ENT-05 / ENT-09 — conserver les panneaux de la fiche de site hors chargement initial

La fiche directe omet les relevés du site et, pour un syndic, les assemblées générales et appels de fonds documentaires. Claude possède leur câblage dans la fiche directe et les tests. Monter les panneaux existants après la preuve du site actif dans l’organisation courante, avec une clé d’identité et de site. Les commandes restent gouvernées par les permissions serveur de chaque panneau. Vérifier la lecture, les états vides et d’erreur, la lecture seule et le changement de site, ainsi que l’absence de lecture avant la preuve ou pour un site archivé. La sélection paginée des sites dans l’écran de consolidation reste un lot distinct.

### ENT-09 / ENT-15 — sélectionner un site du portefeuille complet dans Rapports

La consolidation ne propose aujourd’hui que les sites présents dans les données initiales. Claude possède le sélecteur du panneau de consolidation, ses styles locaux et ses tests. Réutiliser la lecture paginée du portefeuille de l’organisation et permettre la sélection explicite d’un site absent des 100 initiaux, actif ou archivé. Conserver les choix lors d’une pagination ou d’un changement de filtre et les réinitialiser au changement de périmètre. Respecter la limite de 50 sites, le chargement et la reprise, la lecture seule et la séparation des organisations. Le rapport et le CSV utilisent exactement les sites sélectionnés. ROOT vérifiera cette sélection dans le navigateur. Aucun changement des calculs ni de l’API.

### ENT-03 — créer une demande depuis une fiche de site chargée directement

Claude possède le câblage de la fiche et du formulaire dans `components/role/enterprise-space.tsx` ainsi que ses tests ciblés. Depuis un site actif du portefeuille, y compris hors des 100 initiaux, ouvrir la demande avec le site et son adresse préremplis. Pour un identifiant absent du chargement initial, réutiliser la lecture exacte et son droit serveur, dans l’organisation active. Préserver le formulaire existant et ses erreurs. Tester le site actif autorisé, le lecteur, le site archivé et le changement de périmètre. Aucun changement d’API, de RLS ou de base. Intégrer le code avant la recette hébergée groupée.

### SYS-04 — déclencher la livraison externe planifiée

Codex assemble le déclencheur de la file privée. Réutiliser les routes e-mail et Web Push existantes et les baux de la file. Définir un job Supabase inactif à l’installation, avec les paramètres dans Vault et les appels bornés aux routes internes. La recette et l’activation suivent la phase 1.

### ENT-04 — historique des documents d’un site

Codex ajoute `site_id` à `GET /api/documents/history`. Réutiliser la projection documentaire et la pagination existantes sous RLS, sans exposer les chemins ni les liens signés. Le filtre est exclusif du filtre dossier. Le curseur d’un site est lié au compte et au site. Claude prend ensuite le panneau et son câblage dans les fiches normale et directe. La recette est réservée à la phase 2.

### ART-05 — refuser une offre dans le flux paginé

Codex raccorde le refus motivé au résumé anonymisé des offres disponibles. Réutiliser la commande `decline_offer` et la confirmation serveur. Le refus conserve le motif en cas d’échec et retire l’offre après confirmation. Acceptation et refus partagent la protection contre les doubles envois. La recette suit la phase 1.

### PUB-10 — publier la politique de confidentialité validée par l’exploitant

Codex ajoute les champs facultatifs `privacy_controller`, `privacy_retention` et `privacy_notice` à l’instantané public versionné et au validateur SQL. Claude possède l’éditeur et la page Confidentialité. Utiliser le brouillon et la publication existants, afficher uniquement les valeurs publiées comme texte et conserver les anciennes versions lisibles. L’exploitant fournit les informations et le texte approuvé. La recette suit la phase 1.

### ENT-14 — signaler les budgets dépassés dans le rapport consolidé

Codex ajoute les alertes de lecture dans Rapports. Comparer le montant des devis acceptés au budget de référence positif de la même ligne du serveur. Afficher l’excédent et un lien vers le site. Le rapport peut couvrir un périmètre partiel, et la comparaison reprend exactement sa période et ses montants. Aucun seuil commercial supplémentaire.
