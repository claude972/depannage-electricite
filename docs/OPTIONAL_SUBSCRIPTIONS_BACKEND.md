# FIN-07 — première tranche serveur, fermée par défaut

Baseb760367 ; migration CLI `20261107212619_optional_subscriptions.sql`. Worktree propre existant réutilisé, branche `codex/optional-subscriptions`.

## Portée vérifiable

Catalogue explicite vérifié auprès de Stripe, Customer Billing personnel lié durablement au compte/mode, création Checkout **subscription**, puis relecture attestée Session→Subscription→Price et observations historiques privées. Aucun tarif, avantage, périodicité, produit ou offre seedé. Aucun droit MVP retiré et aucun droit premium créé. Les tables/flux des devis, paiements de prestation, cartes enregistrées et webhooks existants ne sont pas modifiés.

**Non livré dans cette tranche :** portail Billing et résiliation libre-service, endpoint webhook Billing signé, traitement automatisé en l’absence de lecture, facturation/taxes métier avancées, changement de formule, prorata, coupons, essai et avantages. Les transitions fournisseur sont reflétées lors d’une relecture authentifiée, pas annoncées comme temps réel. **Ne pas ouvrir la souscription aux utilisateurs avant le parcours de gestion/résiliation et sa recette.**

## Contrat UI

`GET /api/subscriptions` :

```ts
{
 available:boolean,
 offers:Array<{id:string;version:number;label:string;role:'client'|'artisan';amount_cents:number;currency:string;interval:'day'|'week'|'month'|'year';interval_count:number;tax_behavior:'inclusive'|'exclusive'|'unspecified'}>,
 checkout_pending:boolean,
 subscription:null|{
  status:'incomplete'|'incomplete_expired'|'trialing'|'active'|'past_due'|'canceled'|'unpaid'|'paused';
  cancel_at_period_end:boolean;current_period_start:number;current_period_end:number;
  observed_at:string;offer:/* mêmes champs publics d’offre */object;
 }
}
```

Les périodes sont les timestamps Unix Stripe de l’unique ligne d’abonnement, pas un calendrier reconstitué. `amount_cents` correspond au montant unitaire du Price configuré, **pas à une facture effectivement encaissée** ; aucun statut n’est une confirmation bancaire. L’absence de clé/configuration donne503 ; avec configuration mais portes fermées, `available:false`, offres vides. Un compte vérifié conserve la lecture de son abonnement même quand la porte est fermée. Un artisan non approuvé ne peut plus souscrire ; sa propre lecture reste disponible, sans nouveaux droits métier.

`POST /api/subscriptions` : `{action:'checkout',offer_id,offer_version,command_id,consent:true}` → `{url}`. Conserver l’UUID de commande avant appel et après503. Un abonnement/Checkout encore non terminal interdit une deuxième commande. Le retour `/?subscription=returned#profile` et l’annulation `/?subscription=cancelled#profile` signalent seulement de relire GET. Le navigateur n’envoie jamais Customer, Subscription, montant, intervalle ou statut.

401 connexion,403 compte/rôle inéligible,409 offre/version/commande ou preuve périmée à relire,422 validation,503 indisponibilité. Aucun endpoint n’accepte de corps événementiel comme une preuve Stripe.

## Configuration opérateur explicite

`POST /api/subscriptions/offers` sous scope courant `finance_write` : `{command_id,id:null|uuid,expected_version,label,role,active,price_id}`. Mode déduit du secret serveur courant, jamais du navigateur. Le serveur récupère **ce Price exact**, confirme livemode et schéma récurrent simple, puis dérive montant entier, monnaie, intervalle et nombre d’intervalles ainsi que tax_behavior. Offre créée/modifiée à version optimiste et commande durable ; un rejeu divergent est refusé. Maximum50offres par mode, aucune valeur commerciale par défaut. Response `{offer:<DTO public>,active}`.

Seuls les Price récurrents `per_unit`, `licensed`, quantité1, montant entier, sans transformation ni montant personnalisable sont pris en charge dans cette tranche. Les autres formes exigent un lot dédié. Label fourni explicitement par l’opérateur ; aucun texte d’avantage inventé. Les snapshots des tentatives existantes ne changent pas quand le catalogue évolue.

La porte SQL `subscription_private.control.enabled` est **false**, sans endpoint d’activation. Il faut également `SUBSCRIPTIONS_ENABLED=true` et une configuration Stripe valide ; live exige `STRIPE_LIVE_PAYMENTS_ENABLED=true`. Ce lot ne configure rien sur Stripe, ne crée pas de Price et n’active aucune porte.

## Autorisation et preuves

Compte Auth non anonyme, e-mail confirmé, rôle personnel client ou artisan ; nouvelle souscription artisan seulement avec validation professionnelle courante. Les managers/organisations/guests n’héritent d’aucun droit. Catalogue de souscription filtré par rôle et mode. Le Customer Billing est séparé du Customer de cartes personnelles, sans inférence par e-mail ni partage de coordonnées.

Schéma privé avec RLS et sans accès direct API. Les RPC de preuve/configuration sont service-only et revérifient l’acteur courant. Les entrées métier sont persistées avant mutation fournisseur : Customer et Checkout utilisent des clés stables et une fenêtre conservatrice23h. Au-delà, aucune création aveugle. Customer/Session IDs recoupés avec compte/mode et marqueurs opaques de liaison. Session Checkout en mode subscription, Customer exact, une ligne Price vérifiée, quantité1, pas de montant ou périodicité libre. Origine de retour serveur validée ; URL Checkout HTTPS exacte avec fragment opaque préservé.

Lecture : relecture du Customer et de la session liée. Une session complète doit fournir l’identifiant exact de l’abonnement, dont Customer, mode, marqueur, ligne, quantité, monnaie et Price sont recoupés avec le snapshot ; le Price est aussi relu séparément. Aucun objet tiers n’est rattaché par une seule metadata. `open`/`expired` ne créent pas un abonnement fictif. Les états renouvellement, impayé, annulation programmée et résiliation proviennent exclusivement de cette relecture.

Chaque lecture alloue une séquence SQL. L’observation ne s’applique que sur la tentative encore courante et cette séquence non consommée. Une réponse antérieure, une période reculant, un changement de Subscription ID ou une réactivation d’état terminal sont refusés. Les observations acceptées restent dans une table privée. Aucun secret/identifiant Stripe privé ni détail de facturation n’est retourné au client.

## Preuves et suite

`tests/sql-subscriptions-review.mjs` : migrations complètes PGlite, portes, rôles/ACL, catalogue explicite, reprises de commandes, modes/comptes, séquences et états terminaux, conservation des snapshots et retrait d’éligibilité.

`tests/subscriptions.test.ts` : vrais handlers avec Stripe injecté, création/rejeu et réponses perdues, prix/mode/Customer étrangers, état attesté après retour, erreurs et origine. Tests locaux uniquement, aucune preuve hébergée ou Stripe réelle.

Prochaine tranche : portail privé avec configuration fournisseur explicitement choisie/testée (notamment résiliation), gestion des comptes devenus non éligibles, puis événement Billing sur une **route distincte** avec signature, compte/mode et association recoupés, déduplication et ordonnancement. Conserver la relecture serveur comme arbitre des événements décalés. L’évaluation fiscale/commerciale et la recette complète précèdent toute activation.

Sources primaires consultées : [abonnements Checkout](https://docs.stripe.com/billing/subscriptions/build-subscriptions), [Price](https://docs.stripe.com/api/prices/object), [Subscription](https://docs.stripe.com/api/subscriptions/object), [portail Billing](https://docs.stripe.com/customer-management/integrate-customer-portal). Aucun portail n’est créé dans cette tranche.
