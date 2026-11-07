# FIN-06 — preuve de rapprochement d’un payout automatique

Complément de `codex/checkout-charge-proof` depuis `2e7172c`, migration CLI `20261107220009_automatic_payout_proof.sql`. Aucun webhook, fournisseur, compte Stripe ou paramètre cloud modifié. Aucune écriture bancaire ou répartition entre dossiers.

## Contrat exact

`GET|POST /api/platform-operations/stripe-observations/[event_id]/payout-proof`.

POST accepte uniquement `{command_id:uuid}`. L’événement existe déjà dans le registre signé ; aucun compte, payout, montant ou liste de transactions libre n’est accepté du navigateur. Scopes courants finance_read **et** finance_write pour qualifier, finance_read pour lire. GET n’ouvre jamais Stripe.

```ts
type Line = {
 id:string;amount_cents:number;fee_cents:number;net_cents:number;currency:'eur';
 type:string;source_id:string|null;created:number;available_on:number;
 status:'available';allocation:'unallocated';
};
type Response = {
 qualification:null|{
  event_id:string;
  source:{event_id:string;account_id:string;artisan_id:string;payout_id:string;
    live:boolean;amount_cents:number;currency:'eur';
    observation_fingerprint:string;observation_created:string};
  proof:{payout_id:string;live:boolean;currency:'eur';amount_cents:number;
    status:'paid';automatic:true;reconciliation_status:'completed';payout_created:number;
    debit:Line;components:Line[];own_debit_included:boolean;page_count:number;
    listed_count:number;net_components_cents:number;provider_observed_at:string;
    bank_receipt_confirmed:false};
  qualified_at:string;
 }
};
```

`qualification:null` signifie absence de preuve enregistrée. `status:'paid'` est le statut Stripe relu à `provider_observed_at`, **jamais une attestation de réception bancaire**. L’observation signée source peut être plus ancienne ; les deux dates restent séparées. Plusieurs événements du même payout peuvent conserver des observations distinctes : ne pas additionner leurs montants.

## Source et portes

L’observation doit être de famille payout, en EUR et comporter un compte Connect source explicitement identifié. Ce compte doit correspondre au `stripe_account_id` d’un profil artisan déjà enregistré. La commande fige l’identité de ce profil et la source signée ; SQL les revérifie avant la persistance. Un compte inconnu, une source plateforme sans compte ou une liaison retirée refuse toute qualification. La preuve historique reste consultable par finance_read.

Porte SQL existante `charge_proof_private.control.enabled=false` et porte dédiée `STRIPE_PAYOUT_PROOF_ENABLED=true`. Live exige aussi `STRIPE_LIVE_PAYMENTS_ENABLED=true`. Aucun endpoint d’activation. La porte Charge seule n’active pas les lectures de payout.

## Vérification fournisseur et arithmétique

Toutes les requêtes utilisent exactement `{stripeAccount:source.account_id}`. Le serveur relit le payout exact et vérifie id, mode, EUR, montant signé, automatic=true, method=standard, reconciliation_status=completed, statut Stripe paid et absence de transaction d’échec. Les autres variantes sont hors du contrat actuel.

Il récupère séparément `payout.balance_transaction`. Ce débit propre doit référencer le payout exact, être de type payout et valoir `amount = net = -payout.amount`, `fee=0`, en EUR et disponible. Un débit avec frais propres non nuls exige un contrat ultérieur et est refusé ici.

`balanceTransactions.list({payout,limit:100,starting_after?}, {stripeAccount})` parcourt toutes les pages : au plus cinq et 500 lignes. Aucun filtre de type/devise ne masque des éléments. `has_more` doit devenir false ; sinon rien n’est enregistré. Doublons, continuation vide, ordre de création incohérent, lignes non disponibles, devise étrangère, montants hors borne technique ou incohérence `net = amount - fee` sont refusés. Les signes des montants et frais sont conservés, sans valeur absolue appliquée aux composants.

Le débit propre peut être présent ou absent de la liste filtrée. S’il est présent, seul son **identifiant exact**, recoupé avec l’objet relu séparément et tous ses champs projetés, permet de le retirer des composants. Aucun retrait générique des montants négatifs ou des lignes de type payout n’est effectué. Un autre débit payout dans les composants est refusé. La somme signée des nets des composants doit être exactement le montant du payout ; le débit propre est conservé séparément.

Le payout est relu après la dernière page et doit conserver les propriétés vérifiées. La commande est durable avant les lectures. SQL répète les contrôles de source, droits, projection bornée, références, doublons, signes, sommes et dates. La première qualification validée d’un événement reste immuable. Après une réponse perdue, un rejeu terminé retourne la preuve conservée sans requête fournisseur.

## Confidentialité et attribution

Tables privées sous RLS sans grants directs. Aucun compte bancaire, destination bancaire, description libre, metadata, coordonnées ou corps fournisseur n’est stocké. Seules les références financières opaques autorisées sont conservées ; un type de source non pris en charge échoue au lieu d’introduire de nouvelles données. Les bornes de montants sont techniques, sans règle commerciale ajoutée.

Toutes les lignes restent `allocation:'unallocated'`. Les preuves Charge/Fee existantes ne figent pas encore l’identifiant précis de chaque BalanceTransaction : aucune attribution de transaction à un dossier n’est déduite d’un montant, d’un artisan ou de la composition globale. Le résultat historique `aggregate_payout_unallocated` reste inchangé. Les payouts manuels/instantanés, rapprochements incomplets et sources non prises en charge restent à examiner.

## Preuves

Tests SQL isolés : compte source connu, refus source plateforme/compte inconnu/mode, arithmétique et débit, rejeu, retrait du compte et scopes, projection sans effet sur paiement/observation. Tests des vrais handlers injectés : options stripeAccount exactes sur chaque appel, pagination et curseur, débit présent/absent, signes, réponse perdue, changement du payout et plafond de pages. TypeScript strict vérifié ; aucun appel réel ou recette hébergée.

Sources primaires : [rapprochement API](https://docs.stripe.com/payouts/reconciliation), [filtre payout et pagination](https://docs.stripe.com/api/balance_transactions/list), [signes et net des BalanceTransactions](https://docs.stripe.com/api/balance_transactions/object), [payout automatique et balance_transaction](https://docs.stripe.com/api/payouts/object). Ces sources distinguent les composants du payout et son propre mouvement de débit ; l’invariant de somme exclut uniquement ce débit exactement prouvé.
