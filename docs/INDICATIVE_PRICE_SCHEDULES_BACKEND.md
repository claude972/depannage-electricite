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

Le serveur réserve désormais une version immuable lors de la création privée et de la préparation téléphone. La publication future doit encore raccorder lecture publique/formulaires et activation opérateur en un ensemble cohérent. Aucun appel Stripe modifié et aucune publication disponible.

Tests locaux : cinq plages SQL/canoniques, propositions v2/v3, version précédente conservée, CAS/rejeu/conflit, refus client/artisan/manager/opérateur et rôle révoqué, immutabilité, activation impossible ; réservation card_hold réellement préparée avant proposition puis relue/rejouée sans modification du plafond ; cinq nouvelles interventions via le RPC réel gardent leurs valeurs initiales. Route réelle avec DB injectée et TypeScript. Aucun cloud, montant réel configuré ni recette fournisseur.

## Raccordement serveur des snapshots — publication toujours bloquée

Migration suivante `20261107222548_reserved_indicative_estimates.sql` :

- `interventions.indicative_price_version` : version pour les nouvelles demandes ; null pour les anciens dossiers, dont aucun montant n'est modifié.
- `phone_booking_requests.indicative_price_version` et `expected_min_cents` : snapshot complet avec `expected_max_cents`. Les réservations legacy reçoivent minV1 et version1, en conservant leur maximum exact et toutes leurs preuves d'autorisation.
- `current_range` prend un verrou SHARE du contrôle puis lit la version immuable. Création normale : wrapper de site/verrous inchangé, puis sélection et insertion atomique. Préparation guest : verrous acteur/nonce existants, puis sélection. La sélection ne verrouille aucun site depuis le contrôle.
- Finalisation : contrôles d'identité, fraîcheur Stripe, montant autorisé/currency, statut et nonces conservés. La création privée prend les trois valeurs déjà réservées, sans relire la version active ni accepter de montant de l'API. Le ledger d'idempotence garde le payload normalisé existant ; rejeu de la commande de création retrouve le même dossier.
- Snapshot d'une réservation et estimation d'un nouveau dossier protégés contre modification ; les devis acceptés ne sont pas modifiés. La réautorisation d'empreinte reste un mécanisme distinct.

DTO additionnel réel des réponses `/api/bookings/status` et des créations/finalisations projetées par `bookings.ts` : `estimate:{version:number,min_cents:number,max_cents:number,currency:'eur'}`. Présent pour les réservations préparées migrées/nouvelles et les nouveaux dossiers versionnés ; absent sur les anciens dossiers confirmés sans version. Le handler valide le plafond et, pour un dossier confirmé, les deux montants contre les champs existants. L'absence est acceptée pour compatibilité de déploiement et ne signifie pas zéro. Le retour d'ouverture de Checkout reste son contrat URL existant ; relire le statut pour le snapshot.

L'endpoint pending historique, ses champs et les DTO UI sont conservés. Leur raccordement au snapshot, le remplacement des lectures client de `CATEGORIES`, la lecture publique active dynamique et une commande de publication sûre restent nécessaires **avant** de retirer la contrainte `active_version=1`.

Vérification : vraie préparation card_hold legacy avant migration, conservation des anciens dossiers, réservations rejouées puis finalisation après une activation future simulée uniquement dans une transaction de test annulée ; vraie preuve SQL fournisseur injectée et plafond inchangé, reprise du ledger, créations privées et téléphone des cinq catégories ; viewer de site refusé, manager admis, site archivé refusé. Les tests PGlite vérifient les interleavings et la présence du verrou, pas une preuve de contention multi-connexions réelle. Aucun cloud/provider.

Revue corrective : `20261107223002_indicative_estimate_authorization_order.sql` rétablit l'autorisation avant la validité de catégorie dans la fonction interne historique. Tests : artisan + catégorie invalide →42501, client autorisé + catégorie invalide →22023. Le seul INSERT synthétique direct identifié dans les tests historiques est celui de `sql-pending-booking-review.mjs`, installé volontairement jusqu'à022/023 seulement ; ses colonnes d'époque sont conservées. Le même scénario est maintenant exercé sur le schéma courant avec snapshot V1 explicite dans `sql-reserved-estimates-review.mjs`. Aucun default permissif ni backfill affaibli. Projection HTTP : clés supplémentaires rejetées dans `estimate`, autres données internes non transmises par les projections explicites.
