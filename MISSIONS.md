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

## FIN-07 — optional-subscriptions (Astra, exclusive)
Baseb760367, worktree propre réutilisé. Tranche serveur courte : catalogue explicite sans seed, Price Stripe attesté/mode/rôle, commande durable Checkout subscription, réconciliation par relecture serveur exacte et refus de preuve périmée. Gate SQL+env OFF ; aucun droit MVP modifié, aucune règle premium. Portail et endpoint événementiel Billing restent hors de cette première tranche s’ils ne sont pas entièrement vérifiables. Tests SQL/handlers injectés, aucun cloud ni fournisseur réel.

## FIN-07 — gestion hébergée et événements Billing (Astra exclusive)
Depuis bf3cdc8, même branche. Ajouter commandes durables de portail avec configuration explicite/mode/Customer et accès courant, sans état déduit du retour ; route signée distincte, événement dédupliqué et relecture fournisseur liée puis CAS. Aucun droit premium, porte OFF, aucune configuration réelle. Tests handlers injectés et SQL : rejeu, retard, refus intercompte et absence de session navigateur pour webhook.

## FIN-07 — contre-revue EUR et service désactivé (Astra)
Correctif court : catalogue et snapshots EUR exclusivement, Adaptive Pricing désactivé explicitement, GET désactivé sans fournisseur avec état indisponible distinct de non-abonné. Vérification SQL/handlers/TypeScript et sources Stripe officielles ; aucun appel fournisseur.
