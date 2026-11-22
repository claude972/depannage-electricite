# ENT-16 — Payeur B2B délégué explicite

Lot backend depuis e541656, sans fournisseur configuré ni UI livrée.

## Contrat UI

`GET /api/interventions/<id>/payer` retourne :

```ts
{
  intervention_id: string;
  payer_id: string | null;
  version: number | null;
  can_manage: boolean;
  can_checkout: boolean;
  delegate_current: boolean;
  external_session_pending: boolean;
  link: string; // /#detail/<id>, sans jeton ni URL Stripe
}
```

Lecture réservée au propriétaire courant de l’organisation, au créateur ou au payeur désigné, à condition d’avoir toujours accès au site. Elle ne crée aucun droit de lecture sur les dossiers ou documents. Les listes de membres et périmètres existantes servent à choisir un compte ; le serveur vérifie le choix.

`POST /api/interventions/<id>/payer` :

```ts
{ command_id: string; payer_id: string | null; expected_version: number | null }
```

Le propriétaire canonique courant de l’organisation (également membre owner) attribue explicitement un membre ayant accès au site. Aucun rôle owner/manager/viewer ne confère, à lui seul, le paiement des dossiers d’autrui. Le créateur conserve les droits préexistants, dont l’exigence du périmètre courant. La délégation ajoute un payeur ; elle ne supprime pas le créateur.

Première attribution : version null. Remplacement/révocation : version GET. Révocation : payer_id null. UUID stable avant soumission, identique lors d’un retry réseau ; réponse `{intervention_id,payer_id,version,replayed}`. Même UUID et contenu différent : 409. Après conflit, recharger ; un reçu rejoué prouve la commande historique, pas l’état actuel : recharger le GET.

Paiement : `POST /api/payments/checkout` existant avec `{quote_id}` uniquement. Ni montant, ni artisan destinataire, ni commission ne sont acceptés du navigateur. `can_checkout` indique l’autorisation, pas qu’une banque est configurée ou qu’un règlement est exigible. Le checkout exige le devis accepté, les travaux terminés et tous ses contrôles préexistants.

## Retraits et sessions déjà émises

Le retrait du membre ou de son accès au site annule le mandat et incrémente sa version. Réintégrer le membre ne le rétablit pas. Le mandat est lié au site du dossier lors de l’attribution. Chaque session déléguée conserve la version du mandat de création : une nouvelle délégation ne permet pas de récupérer une ancienne session.

Les lectures privées de session, la qualification, la liaison et la restitution de l’URL réévaluent les droits. Une URL Stripe déjà remise ne peut pas être annulée par une simple modification SQL : elle peut rester valide chez le fournisseur. `external_session_pending` signale un checkout non soldé/non expiré, y compris une préparation dont la réponse fournisseur est incertaine. Ne pas présenter la révocation applicative comme une annulation bancaire ; ne pas ouvrir un paiement concurrent. La réconciliation/expiration fournisseur reste nécessaire. Aucun appel Stripe réel dans ce lot.

Un webhook authentifié correspondant à la session et au montant figés reste comptabilisé après révocation grâce à l’historique du mandat ; un retrait ne transforme jamais un débit réel en échec. Le navigateur ne confirme aucun règlement.

## Frontières conservées

Aucun changement aux règles guest, card-hold, reçus historiques, attribution artisan, montants et droits RLS de lecture. Une réservation téléphone/invitée ou un ancien règlement direct ne peut recevoir ce mandat. Le prédicat original utilisé par les empreintes reste inchangé ; le checkout emploie un prédicat distinct. Le lien GET ci-dessus ne contient aucun secret ; les endpoints de statut/reçus conservent leurs droits existants. Pas d’envoi externe ni de création de facture fictive.

401 session absente ; 403 autorité refusée ; 404 objet non accessible ; 409 version/état/tentative incompatible ; 422 validation ; 429 limite ; 503 vérification indisponible. Réponses privées sans cache. Les tables de mandat, commandes, événements et liaisons checkout sont inaccessibles directement aux clients et au rôle service.

## Preuves

Tests des vrais handlers avec fournisseur simulé, SQL complet sous PGlite avec Auth/Storage/cron simulés, et TypeScript. Les scénarios de concurrence sont des interleavings séquentiels, pas une charge multi-connexion. Recette hébergée et clés Stripe différées.
