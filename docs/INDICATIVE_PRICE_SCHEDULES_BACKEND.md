# PUB-02 / ADM-08 — versions préparées, publication inactive

**Ce lot n'active aucun tarif.** V1 recopie exactement les cinq fourchettes déjà présentes dans `CATEGORIES`, `create_intervention_before_site_access` et `prepare_phone_booking` : outage15000–25000, panel15000–35000, socket8000–18000, lighting8000–20000, diagnostic12000–28000 centimes EUR. Ce sont des estimations indicatives existantes, pas des prix garantis, ni des choix commerciaux nouveaux.

## Contrats

`GET /api/public/indicative-prices`, sans paramètres :

```ts
{version:1,currency:'eur',ranges:{
 outage:{min_cents:number,max_cents:number},panel:{min_cents:number,max_cents:number},
 socket:{min_cents:number,max_cents:number},lighting:{min_cents:number,max_cents:number},
 diagnostic:{min_cents:number,max_cents:number}
},indicative:true,publication_available:false,source:'existing_baseline'}
```

`GET /api/admin/indicative-prices`, Super Admin courant uniquement : `{active:<public>,latest_version:number,staged:null|{version,ranges,reason,created_at},publication_available:false}`. La lecture montre la dernière proposition ; les versions antérieures restent immuables dans le journal privé, sans pagination publique ni exposition d'acteur.

`POST /api/admin/indicative-prices`, même origine obligatoire : `{action:'stage',command_id:UUID,expected_version:number,ranges:<cinq catégories exactes>,reason:string}`. Motif 10–1000 caractères. Montants entiers positifs, maximum ≥ minimum, bornes de stockage int32 ; ce plafond technique n'est pas un prix recommandé. Réponse `{version,replayed,active_version:1,publication_available:false}`. Le libellé UI doit être « Préparer une version », jamais « Publier ».

401 session absente ; 403 rôle/origine ; 409 commande réutilisée autrement ou version périmée ; 422 validation ; 503 résultat invérifiable. Toutes les projections sont strictes et sans cache.

## Cohérence et limite assumée

Versions immuables privées sous RLS, acteur/commande/version précédente/motif/date dans chaque ligne d'audit. Verrou profile puis contrôle unique ; CAS sur dernière version, rejeu exact retrouvé même après une autre proposition, vérification du rôle actuel avant rejeu. Aucun opérateur finance/support ne reçoit ces droits. `active_version=1` est contraint en SQL ; aucun RPC d'activation. Tables et fonctions privées inaccessibles au client.

Les interventions nouvelles et anciennes conservent les sources de prix existantes. Les réservations en attente conservent `expected_max_cents` et leurs preuves fournisseur. La publication future devra raccorder d'un seul ensemble : lecture publique/formulaires, création privée, préparation téléphone et création différée après autorisation, avec snapshot immuable au début et conservation des limites d'autorisation déjà prises. Une publication partielle ferait diverger ces sources : elle n'est pas proposée ici. Aucun code booking ni appel Stripe modifié.

Tests locaux : cinq plages SQL/canoniques, propositions v2/v3, version précédente conservée, CAS/rejeu/conflit, refus client/artisan/manager/opérateur et rôle révoqué, immutabilité, activation impossible ; réservation card_hold réellement préparée avant proposition puis relue/rejouée sans modification du plafond ; cinq nouvelles interventions via le RPC réel gardent leurs valeurs initiales. Route réelle avec DB injectée et TypeScript. Aucun cloud, montant réel configuré ni recette fournisseur.
