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
| `STRIPE_WEBHOOK_SECRET` | Secret de signature de la destination Stripe plateforme | Serveur uniquement |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Secret distinct de la destination Stripe Comptes connectés, requis pour sa réception | Serveur uniquement |
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

## Stripe en preview TEST

Sur la preview de recette, utiliser une clé serveur Stripe TEST, un compte Connect artisan du même environnement et l’origine HTTPS canonique dans `NEXT_PUBLIC_APP_URL`. Garder `STRIPE_LIVE_PAYMENTS_ENABLED=false` et `GUEST_SETTLEMENT_LIVE_ENABLED=false`. Fixer `PLATFORM_FEE_BPS` à une commission approuvée pour la recette, en points de base entiers de 0 à 9999. Le versement net doit rester positif après arrondi. Les états, le devis, les montants et la capacité `stripe_transfers` du compte Connect sont vérifiés côté serveur. [Clés Stripe](https://docs.stripe.com/keys), [Cartes de test](https://docs.stripe.com/testing).

- **Compte artisan.** `POST /api/payments/connect` crée de façon idempotente un compte Accounts v2 recipient et ouvre l’onboarding hébergé pour un artisan approuvé. Renseigner dans `STRIPE_CONNECT_COUNTRY` le pays juridique du compte au format ISO alpha-2. Valider les responsabilités de frais et de pertes de la plateforme avant activation.
- **Règlement après intervention.** `POST /api/payments/checkout` ouvre Checkout pour le propriétaire du devis accepté après la fin de l’intervention. Le débit avec destination Connect est associé à une commission Stripe. Les tentatives concurrentes utilisent la même référence. Au retour `?payment=pending`, relire le dossier pour vérifier le résultat.
- **Empreinte.** `GUEST_SETTLEMENT_ENABLED=true` ajoute l’empreinte aux options quand la clé, l’origine et la commission permettent la réservation et sa capture ultérieure. Checkout demande une autorisation carte à capture manuelle. Le règlement validé capture le montant du devis, puis crée un transfert distinct vers le compte Connect. Une session déjà liée reste vérifiable et libérable avec la clé correspondant à son mode même si la création de nouvelles empreintes est désactivée. [Autorisation et capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method), [Paiements et transferts distincts](https://docs.stripe.com/connect/separate-charges-and-transfers).
- **Remboursement.** L’exécution automatique est limitée aux règlements Checkout qualifiés avec destination Connect. Elle exige un dossier approuvé, les droits Finance, `PLATFORM_REFUND_POLICY_VERSION`, `PLATFORM_REFUND_REVERSE_TRANSFER` et `PLATFORM_REFUND_APPLICATION_FEE` explicitement configurés. Le retour de la commission exige l’activation du renversement du transfert. Le webhook relit le remboursement chez Stripe et vérifie son association au dossier, sa charge, son montant et sa devise. Le remboursement automatique d’une capture d’empreinte avec transfert distinct reste hors de ce parcours. [Rembourser un paiement avec destination](https://docs.stripe.com/connect/destination-charges#issue-refunds).

### Destinations webhook TEST

Dans Workbench, créer deux destinations HTTPS au format **snapshot** dans le même environnement TEST. Chaque destination a un secret de signature différent, à stocker côté serveur dans la configuration de cette preview. Pour une recette via Stripe CLI, utiliser le secret de la session d’écoute correspondante. [Réception des événements Stripe](https://docs.stripe.com/webhooks), [Webhooks Connect](https://docs.stripe.com/connect/webhooks).

| Source | URL sur la preview | Secret serveur | Événements à abonner |
| --- | --- | --- | --- |
| Votre compte | `/api/payments/webhook` | `STRIPE_WEBHOOK_SECRET` | Checkout, remboursements, transferts, commissions et litiges ci-dessous |
| Comptes connectés | `/api/payments/webhook?source=connect` | `STRIPE_CONNECT_WEBHOOK_SECRET` | Versements bancaires et litiges des comptes connectés ci-dessous |

| Famille | Événements reconnus | Traitement |
| --- | --- | --- |
| Checkout plateforme | `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `checkout.session.async_payment_failed` | Vérifie l’identité du devis, la session, le montant et la devise. Enregistre le paiement confirmé ou l’échec selon l’état de la session. Les événements d’empreinte sont acquittés à titre de transport et sa vérification se fait par la route de finalisation. |
| Remboursements plateforme | `refund.created`, `refund.updated`, `refund.failed` | Applique l’état courant du remboursement lié à une exécution de la plateforme. Une référence inconnue ou une preuve incohérente retourne une erreur à examiner. |
| Transferts | `transfer.created`, `transfer.updated`, `transfer.reversed` | Trace le transfert et l’associe à la capture d’empreinte lorsqu’une preuve concordante existe. Une inversion ou une preuve inattendue passe en revue. |
| Versements bancaires | `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`, `payout.reconciliation_completed` | Conserve l’observation du versement agrégé et sa provenance pour revue. |
| Commissions | `application_fee.created`, `application_fee.refunded`, `application_fee.refund.updated` | Conserve l’observation de commission ou de remboursement de commission. |
| Litiges | `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated` | Conserve l’observation de litige pour le rapprochement. |

La route vérifie `Stripe-Signature` sur le corps brut et compare `livemode` au mode de la clé Stripe. La destination plateforme reçoit les événements de la plateforme. La destination Connect exige un identifiant de compte connecté dans l’événement et n’accepte que les familles d’observations financières. Une signature, une provenance ou un mode invalide retourne `400`. Une configuration manquante ou un traitement temporairement indisponible retourne `503`. [Vérification de la signature](https://docs.stripe.com/webhooks/signature).

Vérifier les tentatives HTTP dans Workbench, onglet **Event deliveries**. Configurer une alerte sur les livraisons échouées et sur les `5xx` de cette route dans l’hébergement de recette. Corriger la cause avant d’utiliser **Resend** sur le même événement et la même destination. Contrôler l’absence de deuxième débit ou écriture financière lors d’un rejeu et vérifier les résultats même si les événements arrivent dans un ordre différent. Consigner les identifiants masqués et codes HTTP, sans clés, signatures ni corps complets. [Diagnostic des livraisons et rejeu](https://docs.stripe.com/webhooks#debug-webhook-integrations).

Pour la recette financière, relever en centimes le devis accepté, la capture, la commission, le net Connect et le remboursement. Contrôler en TEST l’expiration de l’empreinte, le retour navigateur, la capture, le règlement différé et des remboursements partiel et intégral sur des règlements Checkout éligibles. Distinguer dans Workbench le transfert vers le solde Connect et le versement bancaire. Consigner la preuve Workbench ou le blocage d’accès au fournisseur.

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
