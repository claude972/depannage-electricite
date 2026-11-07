# FIN-06 — preuve privée d’une Charge Checkout

Base `44c35f2`, branche `codex/checkout-charge-proof`, migration CLI `20261107215006_checkout_charge_proof.sql`. Ce lot n’altère pas le webhook, les DTO historiques du rapprochement, le statut d’un dossier/paiement, le ledger, les remboursements ou les transferts. Aucune mutation Stripe : seulement des méthodes `retrieve`, désactivées par défaut.

## Qualification opérateur

`POST /api/platform-operations/payments/[payment_id]/charge-proof`, corps strict `{command_id:uuid}`. Session courante avec `finance_read` et `finance_write`, vérifiés avant les lectures puis après. La commande est enregistrée avant le réseau et lie l’acteur, le paiement, le mode et le snapshot exact. Une réponse perdue reprend le même UUID ; seules des lectures fournisseur sont répétées. Une preuve existante ne peut être remplacée par un autre PI, Charge, mode, date ou snapshot.

Deux portes indépendantes : SQL `charge_proof_private.control.enabled=false` et env `STRIPE_CHARGE_PROOF_ENABLED=true`. Live exige également `STRIPE_LIVE_PAYMENTS_ENABLED=true`. Aucun endpoint d’activation, aucun paramétrage fournisseur effectué. La configuration détermine le mode attendu ; celui-ci est attesté par chacun des objets Stripe, jamais inféré d’un montant ou d’un metadata.

Le paiement local doit être `paid`, méthode Stripe, et posséder un `platform_checkouts` payé correspondant exactement au quote/session/montant/EUR. La qualification vérifie :

1. Session exacte déjà liée, mode payment, complète et payée, montant total/devise et références quote/Checkout.
2. PaymentIntent identifié par cette session, réussi, même mode, montant reçu exact, même quote/Checkout, destination Connect et commission figées.
3. Charge identifiée par `latest_charge`, même PI/mode, réussie, payée et capturée pour le montant exact, EUR, même compte destination et même commission.

Dates de création Session/PI/Charge bornées et enregistrées ; date d’attestation serveur séparée. Les données de carte, coordonnées, documents, metadata libres et corps fournisseur ne sont pas conservés. Un remboursement ultérieur ne supprime pas cette preuve historique de capture ; elle ne mesure pas un solde disponible ou le montant net restant.

La fonction SQL de persistance revérifie les droits sous verrou, les références figées et le snapshot de la commande avant insertion. Le schéma est privé, RLS activée et sans accès direct pour anon/authenticated/service_role. Les RPC de qualification sont service-only. L’immutabilité des Checkout existants est préservée et testée. La preuve est unique par paiement et par mode/Charge ou mode/PI ; un conflit reste un refus, jamais une réaffectation.

## Lecture et lien des observations de litige

`GET` sur la même route, `?after=evt_…` facultatif. Scope courant `finance_read`. Ne contacte jamais Stripe, même si la qualification est désactivée.

```ts
{
 proof:null|{
   payment_id:string;live:boolean;
   source:{payment_id:string;checkout_id:string;quote_id:string;intervention_id:string;
     session_id:string;amount_cents:number;fee_cents:number;destination_account:string;
     currency:'eur';paid_at:string};
   payment_intent_id:string;charge_id:string;
   session_created:number;intent_created:number;charge_created:number;verified_at:string
 },
 dispute_observations:Array<{
   event_id:string;observation_version:number;dispute_id:string;observed_status:string|null;
   disputed_amount_cents:number;currency:'eur';observed_at:string
 }>,
 next_after:string|null
}
```

POST renvoie cette même lecture, sans créer un nouveau type dans les contrats historiques. `proof:null` signifie absence de preuve conservée, pas absence de paiement.

Le lien d’une observation exige une observation authentifiée déjà persistée, famille dispute, compte source plateforme (aucun account connecté), même mode, `source_charge` exactement égal à la Charge prouvée, identifiant `du_`, EUR et montant contesté positif ne dépassant pas la capture. Un montant atypique, une devise différente ou une référence manquante reste à examiner dans le registre existant. Le montant contesté peut être partiel et reste distinct du montant payé.

La page contient au plus 50 observations exactes, ordonnées par event_id. Chaque statut décrit cette observation datée ; aucun « dernier statut du litige » n’est déduit de l’ordre de livraison. La lecture ne change ni `stripe_financial_observations.result` ni sa version/historique. Les deux vues sont donc compatibles : l’ancien résultat peut encore indiquer référence non liée, tandis que ce nouvel endpoint expose la preuve complémentaire. Une revue future pourra adopter explicitement ce contrat.

## Limites assumées

La suite commission décrite ci-dessous est désormais incluse. `fee_refund` sans parent attesté, allocation des payouts agrégés et transfert automatique Checkout restent hors qualification ; aucune répartition n’est inférée.

Qualification fournisseur et données de test restent injectées. Tests SQL réels isolés (Auth/Storage/cron simulés) : permissions/retrait, snapshot payé, rejeu/conflit de mode, immutabilité, litige partiel exact, refus compte/mode/devise/montant/Charge étrangers et absence de mutation financière. Tests des vrais handlers : chaîne des références, erreurs fournisseur, réponse de persistance perdue, portes et revalidation d’accès. Aucune recette hébergée ou transaction réelle.

Sources primaires consultées : [Charge](https://docs.stripe.com/api/charges/object), [Dispute](https://docs.stripe.com/api/disputes/object), [Application Fee](https://docs.stripe.com/api/application_fees/object). Un litige peut porter sur une partie du montant ou différer ; les cas hors du contrat conservateur sont laissés à examiner.

## Complément commission — migration `20261107215452_checkout_fee_proof.sql`

`GET|POST /api/platform-operations/payments/[payment_id]/charge-proof/fees/[eventId]`. POST strict `{command_id:uuid}`, scopes finance_read + finance_write, mêmes portes SQL et `STRIPE_CHARGE_PROOF_ENABLED` désactivées. GET exige finance_read et ne contacte jamais Stripe. Réponse `{qualification:null|{event_id,payment_id,source,provider_amount_refunded_cents:number|null,provider_refunded:boolean,fee_created:number,provider_observed_at:string,qualified_at:string}}`.

`source` contient uniquement `{payment_id,event_id,live,fee_id,charge_id,connected_charge_id,destination_account,amount_cents,currency:'eur',observation_fingerprint,observation_created}`. `charge_id` est la Charge plateforme prouvée ; `connected_charge_id` est la Charge portée par l’événement signé. Ces identifiants peuvent être différents et ne sont jamais confondus.

La qualification exige une preuve Charge déjà fixée et une observation persistée `application_fee.created` ou `application_fee.refunded`, source plateforme, même mode, Fee ID, montant total de commission et EUR exacts. Une commande durable lie ce contexte avant toute relecture. Le serveur récupère uniquement cette Fee par `applicationFees.retrieve(id)` et valide objet, id, mode, EUR, `account=destination_account`, `amount=fee_cents`, `charge=connected_charge_id` et `originating_transaction=charge_id`. La persistance SQL répète ces égalités et les habilitations courantes ; ni metadata ni note opérateur ne remplacent une preuve.

`amount_refunded` est lu à l’instant fournisseur de qualification, et non attribué à la date de l’événement historique. Une valeur nulle reste inconnue. Un montant présent doit être entre zéro et le montant de commission, cohérent avec l’indicateur de remboursement intégral. Le premier enregistrement de chaque événement reste immuable : une réponse perdue retourne cet enregistrement sans relecture fournisseur ; des appels concurrents conservent la première qualification validée. Un événement ultérieur de la même Fee peut conserver une nouvelle observation datée, sans écraser l’ancienne. **Ne pas additionner ces observations cumulatives** pour fabriquer un montant remboursé.

Le registre signé et ses résultats historiques restent inchangés. Ce lien supplémentaire n’atteste pas un solde bancaire, un remboursement déclenché par l’application ou une écriture de ledger. Aucune méthode de mutation Stripe n’est appelée. L’endpoint n’accepte pas `application_fee.refund.updated` : le parent Fee n’est pas déduit de ce seul événement.

Sources : [objet Application Fee](https://docs.stripe.com/api/application_fees/object), notamment originating_transaction et remboursement partiel, et [relecture de la Fee](https://docs.stripe.com/api/application_fees/retrieve). Tests injectés sans accès fournisseur ; SQL isolé vérifie la séparation des charges, les égalités, le rejeu, deux observations datées, les refus de modes/scopes et le maintien des paiements.

Le rapprochement borné du payout automatique lui-même, sans allocation aux dossiers, est décrit dans [AUTOMATIC_PAYOUT_PROOF_BACKEND.md](AUTOMATIC_PAYOUT_PROOF_BACKEND.md).
