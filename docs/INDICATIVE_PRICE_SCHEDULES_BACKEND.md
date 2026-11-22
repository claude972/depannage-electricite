# PUB-02 / ADM-08 — versions préparées, publication inactive

**Ce lot n'active aucun tarif.** V1 recopie exactement les cinq fourchettes déjà présentes dans `CATEGORIES`, `create_intervention_before_site_access` et `prepare_phone_booking` : outage15000–25000, panel15000–35000, socket8000–18000, lighting8000–20000, diagnostic12000–28000 centimes EUR. Ce sont des estimations indicatives existantes, pas des prix garantis, ni des choix commerciaux nouveaux.

## Contrats

`GET /api/public/indicative-prices`, sans paramètres :

```ts
{version:number,currency:'eur',ranges:{
 outage:{min_cents:number,max_cents:number},panel:{min_cents:number,max_cents:number},
 socket:{min_cents:number,max_cents:number},lighting:{min_cents:number,max_cents:number},
 diagnostic:{min_cents:number,max_cents:number}
},indicative:true,publication_available:false,source:'existing_baseline'|'operator_version'}
```

`GET /api/admin/indicative-prices`, Super Admin courant uniquement : `{active:<public>,latest_version:number,staged:null|{version,ranges,reason,created_at},publication_available:boolean}`. La lecture montre la dernière proposition ; les versions antérieures restent immuables dans le journal privé, sans pagination publique ni exposition d'acteur.

`POST /api/admin/indicative-prices`, même origine obligatoire : `{action:'stage',command_id:UUID,expected_version:number,ranges:<cinq catégories exactes>,reason:string}`. Motif 10–1000 caractères. Montants entiers positifs, maximum ≥ minimum, bornes de stockage int32 ; ce plafond technique n'est pas un prix recommandé. Réponse `{version,replayed,active_version:number,publication_available:false}`. Le libellé UI doit être « Préparer une version », jamais « Publier ».

401 session absente ; 403 rôle/origine ; 409 commande réutilisée autrement ou version périmée ; 422 validation ; 503 résultat invérifiable. Toutes les projections sont strictes et sans cache.

## Cohérence et limite assumée

Versions immuables privées sous RLS, acteur/commande/version précédente/motif/date dans chaque ligne d'audit. Verrou profile puis contrôle unique ; CAS sur dernière version, rejeu exact retrouvé même après une autre proposition, vérification du rôle actuel avant rejeu. Aucun opérateur finance/support ne reçoit ces droits. La migration de publication ajoute une commande derrière une gate DB indépendante OFF par défaut et une gate serveur OFF ; aucun acteur applicatif ne peut activer la gate DB. Tables et fonctions privées inaccessibles au client.

Le serveur réserve désormais une version immuable lors de la création privée et de la préparation téléphone. Les lectures publiques suivent maintenant la version active. Le raccordement des formulaires et de la confirmation UI reste requis avant toute ouverture des gates. Aucun appel Stripe modifié et aucune publication exécutée.

Tests locaux : cinq plages SQL/canoniques, propositions v2/v3, version précédente conservée, CAS/rejeu/conflit, refus client/artisan/manager/opérateur et rôle révoqué, immutabilité, activation impossible ; réservation card_hold réellement préparée avant proposition puis relue/rejouée sans modification du plafond ; cinq nouvelles interventions via le RPC réel gardent leurs valeurs initiales. Route réelle avec DB injectée et TypeScript. Aucun cloud, montant réel configuré ni recette fournisseur.

## Raccordement serveur des snapshots — publication toujours bloquée

Migration suivante `20261107222548_reserved_indicative_estimates.sql` :

- `interventions.indicative_price_version` : version pour les nouvelles demandes ; null pour les anciens dossiers, dont aucun montant n'est modifié.
- `phone_booking_requests.indicative_price_version` et `expected_min_cents` : snapshot complet avec `expected_max_cents`. Les réservations legacy reçoivent minV1 et version1, en conservant leur maximum exact et toutes leurs preuves d'autorisation.
- `current_range` prend un verrou SHARE du contrôle puis lit la version immuable. Création normale : wrapper de site/verrous inchangé, puis sélection et insertion atomique. Préparation guest : verrous acteur/nonce existants, puis sélection. La sélection ne verrouille aucun site depuis le contrôle.
- Finalisation : contrôles d'identité, fraîcheur Stripe, montant autorisé/currency, statut et nonces conservés. La création privée prend les trois valeurs déjà réservées, sans relire la version active ni accepter de montant de l'API. Le ledger d'idempotence garde le payload normalisé existant ; rejeu de la commande de création retrouve le même dossier.
- Snapshot d'une réservation et estimation d'un nouveau dossier protégés contre modification ; les devis acceptés ne sont pas modifiés. La réautorisation d'empreinte reste un mécanisme distinct.

DTO additionnel réel des réponses `/api/bookings/status` et des créations/finalisations projetées par `bookings.ts` : `estimate:{version:number,min_cents:number,max_cents:number,currency:'eur'}`. Présent pour les réservations préparées migrées/nouvelles et les nouveaux dossiers versionnés ; absent sur les anciens dossiers confirmés sans version. Le handler valide le plafond et, pour un dossier confirmé, les deux montants contre les champs existants. L'absence est acceptée pour compatibilité de déploiement et ne signifie pas zéro. Le retour d'ouverture de Checkout reste son contrat URL existant ; relire le statut pour le snapshot.

Le raccordement pending est décrit ci-dessous. Le remplacement des lectures client de `CATEGORIES`, la confirmation de version et la recette de tous les consommateurs UI restent nécessaires **avant** toute ouverture des gates de publication.

Vérification : vraie préparation card_hold legacy avant migration, conservation des anciens dossiers, réservations rejouées puis finalisation après une activation future simulée uniquement dans une transaction de test annulée ; vraie preuve SQL fournisseur injectée et plafond inchangé, reprise du ledger, créations privées et téléphone des cinq catégories ; viewer de site refusé, manager admis, site archivé refusé. Les tests PGlite vérifient les interleavings et la présence du verrou, pas une preuve de contention multi-connexions réelle. Aucun cloud/provider.

Revue corrective : `20261107223002_indicative_estimate_authorization_order.sql` rétablit l'autorisation avant la validité de catégorie dans la fonction interne historique. Tests : artisan + catégorie invalide →42501, client autorisé + catégorie invalide →22023. Le seul INSERT synthétique direct identifié dans les tests historiques est celui de `sql-pending-booking-review.mjs`, installé volontairement jusqu'à022/023 seulement ; ses colonnes d'époque sont conservées. Le même scénario est maintenant exercé sur le schéma courant avec snapshot V1 explicite dans `sql-reserved-estimates-review.mjs`. Aucun default permissif ni backfill affaibli. Projection HTTP : clés supplémentaires rejetées dans `estimate`, autres données internes non transmises par les projections explicites.

## Reprise pending raccordée

`GET /api/bookings/pending` ajoute au seul objet `pending` non null `estimate:{version,min_cents,max_cents,currency:'eur'}` ; le maximum doit égaler `expected_max_cents`. Le schéma pur `lib/features/guest/estimate-snapshot.ts` est commun à pending et aux réponses bookings. Pendant un déploiement mixte, absence tolérée ; null, clés supplémentaires, devise inattendue et maximum divergent refusés. La fonction SQL conserve le contrôle LIMIT2 : deux tentatives non closes restent une erreur55000, jamais une sélection silencieuse. Migration additive `20261107223132_pending_booking_estimate.sql` ; aucun ancien test historique modifié.

## Garde serveur de version revue (implémentée, publication toujours inactive)

Les deux corps HTTP de création `/api/interventions` et `/api/bookings` acceptent `reviewed_estimate_version?:number` (entier1–2147483647), sans accepter de montants du navigateur. La confirmation UI du catalogue actif reste à raccorder. Pour toute nouvelle commande, après identité/site/nonces et sous le même verrou SHARE du contrôle : V1 admet encore un champ absent ; au-delà de V1 une version présente égale à la version active est obligatoire, sinon409 sans créer ni réserver. La publication doit prendre le verrou exclusif correspondant. Toutes les entrées publiques de création, y compris les anciennes signatures, appliquent ce contrôle une fois active_version>1.

Un nonce déjà existant est traité d'abord : contrôler identité, accès courant et payload normalisé, puis retrouver son snapshot sans comparer à la version actuellement active. Une version explicitement différente de celle déjà réservée est un conflit ; son absence peut rester admise pour la reprise exacte des anciennes commandes. La finalisation d'une réservation existante garde son helper interne réservé et son plafond. Les anciens endpoints sans version ne doivent plus pouvoir créer après activation ; ils peuvent uniquement reprendre une commande exacte existante. Les interleavings lecture/activation/création sont exercés en SQL isolé ; intégration UI et recette multi-connexions restent nécessaires avant ouverture des gates. Aucune activation dans ce lot.

Migration `20261107223324_reviewed_estimate_guard.sql` : RPC distincts `create_intervention_reviewed`, `create_intervention_once_reviewed`, `prepare_phone_booking_reviewed` et `create_on_site_booking_reviewed`, tous avec argument final `p_reviewed_estimate_version integer` explicite (nullable). Aucune surcharge PostgREST. Les anciens noms conservent leurs signatures/grants et délèguent avec null ; ils ne permettent donc pas de création sans revue en V2. Les routes HTTP choisissent les nouveaux noms et extraient ce champ du payload métier avant le ledger. La finalisation d'un snapshot déjà réservé ne change pas.

Tests : V2 simulée uniquement dans rollback, anciennes entrées sans version refusées, version périmée refusée même avec quota déjà saturé (P0001 avant53300), aucune nouvelle réservation/demande persistée ; revue exacte V2 admise pour les cinq catégories, rejeux exacts V1 et anciens dossiers conservés, version explicite incompatible avec une réservation existante refusée. Test de vraie route : refus SQL de version → aucun appel `openCardHold`. Le contrôle de configuration fournisseur peut précéder cette vérification, mais n'effectue aucune opération Stripe.

## Commande de publication — codée, gates OFF, jamais invoquée sur une base distante

Migration `20261107223931_indicative_price_publication.sql`. `POST /api/admin/indicative-prices/publication`, même origine et session obligatoires : `{command_id:UUID,expected_active_version:number,expected_latest_version:number,reason:string}`. Aucun montant ni catégorie accepté. Réponse `{published_version:number,active_version:number,replayed:boolean}` : sur rejeu ancien, published_version décrit la commande retrouvée et active_version peut être plus récente ; aucun retour en arrière.

Deux gates indépendantes : env serveur `INDICATIVE_PRICE_PUBLICATION_ENABLED` doit être exactement `true` (sinon503 avant RPC) et table privée `indicative_price_private.publication_gate.enabled` doit être true (false en migration, aucun RPC d'activation). Un appel SQL authentifié direct reste refusé si la gate DB est OFF. Les droits admin courants sont revérifiés avant toute reprise. Une gate désactivée refuse également la reprise de publication ; relire le catalogue reste possible et **conserve la version active**, jamais V1 par défaut. UI/publication en production sont des étapes séparées.

Verrous : profil admin SHARE, gate SHARE, puis contrôle FOR UPDATE. Les créations prennent ce même contrôle FOR SHARE. CAS sur active et dernière version proposée ; publier une proposition remplacée, déjà active, ou une ancienne version est refusé. Journal privé immuable avec acteur, commande, versions source/cible, motif/date ; changement du pointeur actif sans événement correspondant refusé par trigger. Une version proposée n'est jamais exposée par le GET public. Les propositions restent immuables et stage ne change pas le pointeur.

GET public : `source='existing_baseline'` pour1, `source='operator_version'` au-delà ; `publication_available:false` reste un champ public sans droit de publication. GET admin : `publication_available` est la conjonction des gates DB/env, `staged:null` si aucune version plus récente que l'active. Les reçus stage donnent l'active actuelle sans publier.

Borne technique du plafond d'empreinte de chacune des cinq catégories à publication : **50..99 999 999 centimes EUR**, positive/entière. Minimum EUR0,50 vérifié dans [Stripe currencies](https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts), et borne conservatrice huit chiffres explicitement documentée par [PaymentIntent create amount](https://docs.stripe.com/api/payment_intents/create#create_payment_intent-amount), consultés le7 novembre2026. La page currencies autorise davantage selon réseau : nous ne prétendons pas que huit chiffres est la limite universelle des cartes. Ces contrôles ne garantissent pas l'acceptation banque/réseau ni les paramètres de règlement du compte réel, toujours à vérifier en recette. Le minimum indicatif n'est pas une charge ; c'est le maximum réservé qui est testé. Aucun tarif commercial proposé par le code.

Tests : publication uniquement en transaction synthétique annulée ; faux compte/opérateur/refus direct DB, CAS des deux versions, commande étrangère, bornes refusées et extrêmes acceptés, immutabilité/audit obligatoire, reprise après publication plus récente, gate désactivée sans retourV1. Réservation card_hold V1 finalisée après publicationV3 d'un plafond différent : min/max V1 conservés. Rollback final vérifie gatefalse/active1/journal vide. PGlite démontre les interleavings, pas une contention multi-connexion ni un appel fournisseur réel.
