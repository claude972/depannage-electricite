# Installation et exploitation

## État vérifié le 30 octobre 2026
- Dépôt : https://github.com/claude972/depannage-electricite (privé).
- Projet Vercel : `brafas-projects/depannage-electricite`, relié au dépôt GitHub.
- Aucune variable applicative configurée dans le projet Vercel lors du contrôle `vercel env ls`.
- Création Supabase dédiée demandée avec `supabase projects create depannage-electricite --org-id <organisation> --region eu-west-3 --db-password <secret>` : refus fournisseur, code de sortie 1. Motif retourné : factures en retard dans les organisations du compte ; régularisation requise avant nouvelle création. Aucun projet existant n'a été modifié et le mot de passe généré pour cette tentative a été supprimé.
- L'interface de démonstration et le serveur non configuré ne prouvent pas le fonctionnement d'une base distante ou de Stripe. Les API réelles doivent renvoyer une indisponibilité explicite si les secrets manquent.

## Prérequis et commandes
Node.js 24, npm, Supabase CLI et Vercel CLI. Versions applicatives verrouillées dans `package-lock.json` ; installer avec `npm ci`, sans mise à jour implicite.

```sh
npm ci
npm run check
npm run dev
```

`check` exécute TypeScript strict, les tests métier, puis le build de production. Les tests locaux complètent une vérification de la preview en ligne. La CI GitHub lance le même contrôle sur chaque push de main et chaque pull request.

## Configuration
Copier `.env.example` vers `.env.local` pour le développement. Ne pas publier ce fichier, ni partager de secret dans le chat. Pour Vercel, utiliser les variables d'environnement du projet pour Preview et Production, puis redéployer. Les noms sont :

| Variable | Usage | Visibilité |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL de la base dédiée | Publique |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clé publiable Supabase | Publique, autorisation par RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Traitements serveur contrôlés | Serveur uniquement, contourne la RLS |
| `STRIPE_SECRET_KEY` | Stripe Checkout / Connect | Serveur uniquement |
| `STRIPE_WEBHOOK_SECRET` | Validation de signature webhook | Serveur uniquement |
| `NEXT_PUBLIC_APP_URL` | Origine canonique de l'application | Publique |
| `PLATFORM_FEE_BPS` | Commission commerciale, si explicitement validée | Serveur uniquement |
| `STRIPE_CONNECT_COUNTRY` | Pays juridique des comptes artisans, ISO alpha-2 | Serveur uniquement |
| `STRIPE_LIVE_PAYMENTS_ENABLED` | Activation explicite des clés live, `false` par défaut | Serveur uniquement |

Ne pas renseigner une commission ou une TVA au hasard. La clé Stripe doit être de test tant que le parcours, le compte Connect et les conditions commerciales ne sont pas validés. Ne jamais réutiliser une clé de service comme clé publiable.

## Provisionner une base séparée
1. Régulariser le blocage de facturation Supabase dans le compte propriétaire.
2. Créer un projet dédié `depannage-electricite`, région choisie selon les utilisateurs ; ne pas sélectionner un projet existant pour contourner le blocage.
3. Récupérer l'URL, la clé publiable et la clé serveur dans les réglages du nouveau projet et les stocker via les canaux de secrets prévus.
4. Lier uniquement cette base, après avoir confirmé son identifiant :

```sh
supabase link --project-ref <identifiant-de-la-base-dediee>
supabase db push --dry-run
supabase db push
```

La commande de migration doit être exécutée après revue de `supabase/migrations/` et contre la seule base dédiée. Vérifier les tables, les fonctions métier et la RLS après application. Ne pas lancer de réinitialisation ou de migration destructive sur une base contenant des données.

5. Configurer les URL de redirection Supabase Auth pour l'origine Vercel et les domaines autorisés. Activer la confirmation email et un fournisseur email adapté avant ouverture aux utilisateurs.
6. Vérifier avec au moins deux comptes clients et deux artisans que les dossiers, photos et documents sont cloisonnés ; tester deux acceptations concurrentes sur la même mission.

## Stripe et mise en service
L'intégration exige Stripe Checkout et, pour les reversements de marketplace, Stripe Connect. Créer des comptes artisans de test via le parcours Connect et vérifier leur capacité à recevoir des paiements. Les montants, devis acceptés et destinations sont contrôlés côté serveur ; le retour navigateur ne confirme jamais un paiement.

Routes implémentées :
- `POST /api/payments/connect` : création idempotente d’un compte **Accounts v2 recipient**, puis lien d’onboarding hébergé ; artisan approuvé uniquement. `STRIPE_CONNECT_COUNTRY` doit être explicitement défini sur le pays juridique approprié (ISO alpha-2). Les responsabilités de frais et de pertes de la plateforme doivent être validées avant activation.
- `POST /api/payments/checkout` avec `{ "quote_id": "uuid" }` : demandeur propriétaire, devis accepté, intervention terminée, montant serveur et capacité `stripe_transfers` active. `PLATFORM_FEE_BPS` est obligatoire, entre 0 et 10000 ; le choix commercial reste à valider. Les tentatives concurrentes partagent une clé d’idempotence Stripe.
- `POST /api/payments/webhook` : endpoint Stripe snapshot, événements **`checkout.session.completed`** et **`checkout.session.async_payment_succeeded`**. Le corps brut et `Stripe-Signature` sont vérifiés avant toute lecture métier ; les événements non payés sont acquittés sans mutation. Les autres types sont ignorés. La RPC `confirm_stripe_payment` vérifie session, devis, montant, devise et état puis inscrit l’événement et le règlement dans la même transaction. Un échec n’inscrit pas l’événement traité, afin de permettre les retries.

Configurer un endpoint HTTPS de test à `<origine-vercel>/api/payments/webhook`, copier son secret dans `STRIPE_WEBHOOK_SECRET` et sélectionner les deux types ci-dessus. En développement, Stripe CLI peut transférer ces événements vers la même route locale. Fixer `NEXT_PUBLIC_APP_URL` à l’origine canonique autorisée. Le retour `?payment=pending` exige de relire le dossier ; il ne signifie jamais « payé ». Une annulation ne modifie pas le devis en payé. Les cartes sont le moyen Checkout autorisé initialement.

`STRIPE_LIVE_PAYMENTS_ENABLED=false` bloque explicitement les clés live. Ne passer à `true` qu’après validation commerciale, pays, commission, fiscalité, responsabilités Connect et tests de paiement, signature, retry et réconciliation. Aucun test bancaire n’a été exécuté sans secrets Stripe. Les versions Stripe sont celles de `package-lock.json` ; aucune version d’API n’est inventée manuellement.

Contrôles base à exécuter après provisionnement : `supabase test db` pour `supabase/tests/001_rls_test.sql` dans une base de test isolée ; 18 assertions couvrent le cloisonnement, l’escalade de rôle, les offres anonymisées, l’acceptation et le refus du second artisan. Ce test séquentiel ne remplace pas un test réellement concurrent à deux sessions. Les fonctions métier `create_intervention`, `intervention_action`, `create_site`, `send_message`, `update_profile`, `approve_artisan` et `submit_review` sont les seuls chemins applicatifs de mutation utilisateur. Les écritures directes des tables sont révoquées. Les limites durables par minute sont de 5 demandes, 30 actions de dossier, 30 messages, 10 sites et 10 uploads par compte. Les documents sont privés, limités à 4 Mo (sous la limite de corps des fonctions Vercel, en tenant compte du multipart) et aux formats PDF/JPEG/PNG/WebP dont la signature binaire est contrôlée.

Les clients Supabase serveur sont instanciés par requête dans les Route Handlers ; `auth.getUser()` vérifie la session et le handler réécrit ses cookies rafraîchis. Aucun contenu authentifié n’est rendu dans les Server Components publics ni mis en cache partagé. Si une future route SSR authentifiée est ajoutée, intégrer le Proxy de rafraîchissement officiel avant son activation.

## Vercel et retour arrière
Le dépôt est relié au projet Vercel. Un push peut déclencher un déploiement : ne pousser que les lots contrôlés. Pour une preview explicite après validation : `vercel deploy`. Vérifier le résultat en ligne (HTTP, scénarios et responsive) et conserver le lien avec le commit dans `docs/PROGRESS.md`.

Pour revenir à une version applicative antérieure, redéployer un déploiement Vercel identifié comme stable. Les migrations sont additives ; un rollback d'interface ne doit pas supprimer des données ou annuler aveuglément le schéma. Valider les sauvegardes et la procédure de restauration du projet Supabase avant exploitation réelle.

## Espaces professionnels et garanties
La seconde migration ajoute les règles d’approbation par site, décisions auditées, contrats, échéances/équipements/signalements, budgets et dossiers de garantie. `POST /api/professional` accepte des commandes validées (`set_approval_rule`, `decide_approval`, `save_contract`, `save_compliance`, `set_site_budget`) ; les vues sont cloisonnées par organisation. Une règle dépassée crée une demande d’approbation et bloque l’acceptation du devis ; seul le rôle autorisé peut la décider. Modifier une règle réinitialise les approbations des devis encore en attente concernés. Le workflow livré est un seuil par site avec autorité propriétaire/gestionnaire, pas un moteur multiétape arbitraire.

`GET /api/reports` fournit les sommes des devis acceptés sur interventions réellement payées et les engagements non payés. `?format=csv` exporte ces données ; `site_id` filtre un site. L’agrégation est une requête SQL cohérente sous RLS et un comptage exact détecte toute limite de lignes du fournisseur. Les estimations ne sont jamais comptabilisées comme chiffre d’affaires. Les cellules CSV sont protégées contre l’injection de formules.

Le suivi de garantie n’accepte une réclamation que pour le demandeur d’une intervention payée, dans l’année suivant sa fin, avec un seul dossier ouvert à la fois. Il ne statue pas automatiquement sur sa prise en charge. Après validation des conditions commerciales, activer **les deux** contrôles : `WARRANTY_REQUESTS_ENABLED=true` côté serveur et la valeur JSON `true` pour `app_settings.key='warranty_requests_enabled'` dans la base via un accès de service autorisé. La table de configuration n’est pas modifiable par les comptes applicatifs. Les décisions restent réservées à l’administration.

Les messages récents sont chargés dans une fenêtre bornée et les tables interventions/devis/messages rejoignent la publication Supabase Realtime si elle existe. La présence du code de souscription ne prouve pas sa connexion au cloud tant que la base dédiée n’a pas été créée.

Limites fonctionnelles à conserver dans le suivi : le matching livre des offres anonymisées par localité et une acceptation atomique, sans score intelligent ni calcul de distance GPS ; les contrats stockent les termes, dates et statut, sans moteur de grilles tarifaires négociées ; les dossiers ERP sont des suivis saisis, pas des certifications réglementaires ; le diagnostic photo IA n’est pas activé sans fournisseur ni évaluation. Les abonnements, SMS/email/push et l’invitation des membres d’organisation nécessitent des intégrations et parcours complémentaires avant d’être annoncés comme opérationnels.
