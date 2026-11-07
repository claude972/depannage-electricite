# FIN-07 — abonnements optionnels, serveur fermé par défaut

Base b760367 ; migration CLI `20261107212619_optional_subscriptions.sql`. Worktree propre existant réutilisé, branche `codex/optional-subscriptions`.

## Portée vérifiable

Catalogue explicite vérifié auprès de Stripe, Customer Billing personnel lié durablement au compte/mode, création Checkout **subscription**, puis relecture attestée Session→Subscription→Price et observations historiques privées. Aucun tarif, avantage, périodicité, produit ou offre seedé. Aucun droit MVP retiré et aucun droit premium créé. Les tables/flux des devis, paiements de prestation, cartes enregistrées et webhooks existants ne sont pas modifiés.

Complément serveur : portail Billing hébergé pour gestion/résiliation et route Billing signée distincte. Aucun changement d’offre autorisé dans le portail. Restent hors périmètre : taxes métier avancées, prorata et changements de formule, coupons, essai et avantages. **Ne pas activer avant configuration explicite et recette fournisseur du cycle complet, dont résiliation et impayé.** Aucune recette Stripe réelle ou hébergée réalisée ici.

## Contrat UI

`GET /api/subscriptions` :

```ts
{
 available:boolean,
 portal_available:boolean,
 offers:Array<{id:string;version:number;label:string;role:'client'|'artisan';amount_cents:number;currency:string;interval:'day'|'week'|'month'|'year';interval_count:number;tax_behavior:'inclusive'|'exclusive'|'unspecified'}>,
 checkout_pending:boolean,
 subscription:null|{
  status:'incomplete'|'incomplete_expired'|'trialing'|'active'|'past_due'|'canceled'|'unpaid'|'paused';
  cancel_at_period_end:boolean;current_period_start:number;current_period_end:number;
  observed_at:string;offer:/* mêmes champs publics d’offre */object;
 }
}
```

Les périodes sont les timestamps Unix Stripe de l’unique ligne d’abonnement, pas un calendrier reconstitué. `amount_cents` correspond au montant unitaire du Price configuré, **pas à une facture effectivement encaissée** ; aucun statut n’est une confirmation bancaire. L’absence de clé/configuration donne 503 ; avec configuration mais portes fermées, `available:false`, offres vides. Un compte vérifié conserve la lecture de son abonnement même quand la porte est fermée. Un artisan non approuvé ne peut plus souscrire ; sa propre lecture reste disponible, sans nouveaux droits métier.

`POST /api/subscriptions` : `{action:'checkout',offer_id,offer_version,command_id,consent:true}` → `{url}`. Conserver l’UUID de commande avant appel et après 503. Un abonnement/Checkout encore non terminal interdit une deuxième commande. Le retour `/?subscription=returned#profile` et l’annulation `/?subscription=cancelled#profile` signalent seulement de relire GET. Le navigateur n’envoie jamais Customer, Subscription, montant, intervalle ou statut.

401 connexion, 403 compte/rôle inéligible, 409 offre/version/commande ou preuve périmée à relire, 422 validation, 503 indisponibilité. Les actions authentifiées n’acceptent aucun corps événementiel comme preuve ; seule la route Billing dédiée vérifie la signature et déclenche une relecture.

## Configuration opérateur explicite

`POST /api/subscriptions/offers` sous scope courant `finance_write` : `{command_id,id:null|uuid,expected_version,label,role,active,price_id}`. Mode déduit du secret serveur courant, jamais du navigateur. Le serveur récupère **ce Price exact**, confirme livemode et schéma récurrent simple, puis dérive montant entier, monnaie, intervalle et nombre d’intervalles ainsi que tax_behavior. Offre créée/modifiée à version optimiste et commande durable ; un rejeu divergent est refusé. Maximum 50 offres par mode, aucune valeur commerciale par défaut. Response `{offer:<DTO public>,active}`.

Seuls les Price récurrents `per_unit`, `licensed`, quantité 1, montant entier, sans transformation ni montant personnalisable sont pris en charge dans cette tranche. Les autres formes exigent un lot dédié. Label fourni explicitement par l’opérateur ; aucun texte d’avantage inventé. Les snapshots des tentatives existantes ne changent pas quand le catalogue évolue.

La porte SQL `subscription_private.control.enabled` est **false**, sans endpoint d’activation. Il faut également `SUBSCRIPTIONS_ENABLED=true` et une configuration Stripe valide ; live exige `STRIPE_LIVE_PAYMENTS_ENABLED=true`. Ce lot ne configure rien sur Stripe, ne crée pas de Price et n’active aucune porte.

## Autorisation et preuves

Compte Auth non anonyme, e-mail confirmé, rôle personnel client ou artisan ; nouvelle souscription artisan seulement avec validation professionnelle courante. Les managers/organisations/guests n’héritent d’aucun droit. Catalogue de souscription filtré par rôle et mode. Le Customer Billing est séparé du Customer de cartes personnelles, sans inférence par e-mail ni partage de coordonnées.

Schéma privé avec RLS et sans accès direct API. Les RPC de preuve/configuration sont service-only et revérifient l’acteur courant. Les entrées métier sont persistées avant mutation fournisseur : Customer et Checkout utilisent des clés stables et une fenêtre conservatrice de 23 h. Au-delà, aucune création aveugle. Customer/Session IDs recoupés avec compte/mode et marqueurs opaques de liaison. Session Checkout en mode subscription, Customer exact, une ligne Price vérifiée, quantité 1, pas de montant ou périodicité libre. Origine de retour serveur validée ; URL Checkout HTTPS exacte avec fragment opaque préservé.

Lecture : relecture du Customer et de la session liée. Une session complète doit fournir l’identifiant exact de l’abonnement, dont Customer, mode, marqueur, ligne, quantité, monnaie et Price sont recoupés avec le snapshot ; le Price est aussi relu séparément. Aucun objet tiers n’est rattaché par une seule metadata. `open`/`expired` ne créent pas un abonnement fictif. Les états renouvellement, impayé, annulation programmée et résiliation proviennent exclusivement de cette relecture.

Chaque lecture alloue une séquence SQL. L’observation ne s’applique que sur la tentative encore courante et cette séquence non consommée. Une réponse antérieure, une période reculant, un changement de Subscription ID ou une réactivation d’état terminal sont refusés. Les observations acceptées restent dans une table privée. Aucun secret/identifiant Stripe privé ni détail de facturation n’est retourné au client.

## Preuves et suite

`tests/sql-subscriptions-review.mjs` : migrations complètes PGlite, portes, rôles/ACL, catalogue explicite, reprises de commandes, modes/comptes, séquences et états terminaux, conservation des snapshots et retrait d’éligibilité.

`tests/subscriptions.test.ts` : vrais handlers avec Stripe injecté, création/rejeu et réponses perdues, prix/mode/Customer étrangers, état attesté après retour, erreurs et origine. Tests locaux uniquement, aucune preuve hébergée ou Stripe réelle.

Complément migration CLI `20261107213524_subscription_billing_management.sql` :

`POST /api/subscriptions/portal` sous session courante, corps strict `{command_id:uuid}` → `{url}`. Aucun Customer/configuration/retour reçu du navigateur. La commande est persistée avant l’appel avec compte, tentative, configuration et retour immuables ; reprise avec même clé dans la fenêtre de 23 h. Les liens de portail sont éphémères côté Stripe : si expirés, ouvrir une nouvelle commande, jamais annoncer une action achevée. Le serveur vérifie avant/après l’accès courant, le Customer, le mode, la configuration active et l’origine exacte `https://billing.stripe.com`. Aucun lien si aucun abonnement courant à gérer. Un artisan suspendu mais conservant son compte personnel vérifié peut gérer sa facturation existante, sans nouvelle souscription.

Les variables `STRIPE_BILLING_PORTAL_CONFIGURATION_TEST` et `STRIPE_BILLING_PORTAL_CONFIGURATION_LIVE` sont séparées. La configuration est récupérée, doit correspondre exactement, permettre la résiliation et interdire la modification d’offre. Les modalités de résiliation sont celles configurées explicitement sur Stripe, aucune durée/méthode n’est imposée par le code. Aucune configuration n’est créée par l’application. Le retour `/?subscription=managed#profile` déclenche seulement GET ; le statut reste celui de la relecture fournisseur.

`POST /api/subscriptions/webhook` est une route indépendante des paiements de devis. Secrets dédiés `STRIPE_BILLING_WEBHOOK_SECRET_TEST` / `_LIVE`, signature SDK sur le corps brut (plafond 256 Kio), compte plateforme uniquement et mode exact. Formats snapshot v1 : `checkout.session.completed` et `customer.subscription.created|updated|deleted|paused|resumed`. Les objets Connect, contextes tiers et signatures invalides sont refusés. Les événements non pris en charge sont acquittés sans projection.

Le seul identifiant signé sert à chercher une Session déjà liée ou une Subscription déjà liée au compte/mode. Aucun rattachement par metadata seul, aucun statut/montant du payload ne projette l’état. Un événement inconnu est consigné comme ignoré ; il ne devient pas valable rétroactivement. Un événement Checkout connu permet la liaison initiale après relecture complète, même sans retour navigateur. Les événements Subscription arrivant avant cette liaison peuvent être ignorés ; Checkout ou une lecture authentifiée rétablit l’état réel.

Reçu privé `(mode,event_id)` et empreinte du corps, bail atomique de 60 s, token renouvelé après expiration, séquence de lecture actuelle. Un rejeu finalisé n’appelle pas le fournisseur ; un concurrent ou une preuve périmée demande une nouvelle livraison. La projection et la finalisation du reçu sont dans la même transaction ; un échec laisse une reprise après expiration du bail. Les retards relisent toujours l’état fournisseur présent et ne rejouent jamais l’état ancien du payload. Une perte d’accès du compte fait échouer la projection ; aucune session navigateur n’est exigée pour un webhook signé. Les portes SQL/env restent OFF, sans planification ni activation.

Validation locale du complément : 14 tests handlers (véritables signatures SDK générées localement, aucun réseau), tests SQL de bail/rejeu/CAS, révocation et portail, TypeScript. La facture n’est pas présentée comme payée à partir d’un statut d’abonnement ; aucun droit premium ne découle des événements.

Sources primaires consultées : [abonnements Checkout](https://docs.stripe.com/billing/subscriptions/build-subscriptions), [Price](https://docs.stripe.com/api/prices/object), [Subscription](https://docs.stripe.com/api/subscriptions/object), [portail Billing](https://docs.stripe.com/customer-management/integrate-customer-portal). Sources additionnelles : [session portail](https://docs.stripe.com/api/customer_portal/sessions/create), [configuration portail](https://docs.stripe.com/api/customer_portal/configurations/object), [webhooks signés et livraisons](https://docs.stripe.com/webhooks). Aucun portail réel ni endpoint fournisseur n’a été configuré.
