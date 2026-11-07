# CLI-03 / ART-04 — rayon indicatif facultatif

Baseb8d8a96 ; migration CLI `20261107211340_artisan_mission_radius.sql`.

## Contrat UI

`GET /api/artisan/mission-radius`, session artisan réelle :

```json
{"preference":{"version":0,"reference_code":null,"radius_km":null},"options":[{"code":"97209","name":"Fort-de-France"}],"source":{"url":"https://geo.api.gouv.fr/departements/972/communes?fields=nom,code,codesPostaux,centre","retrieved_at":"2026-11-07T21:13:50Z"},"basis":"commune_centres","unknown_postal_policy":"postal_only"}
```

L’extrait options illustre un élément réel ; la réponse fournit les34communes. Version0 signifie aucun réglage. Aucun rayon ni centre n’est présélectionné.

`POST` même route : `{expected_version:0,reference_code:"97209",radius_km:5}` ; deux champs null pour effacer. Rayon entier explicite1–200km (borne technique validée pour cette référence Martinique). Réponse identique au GET avec version augmentée. Session artisan et identité côté SQL ; aucun actor_id accepté.

États401 connexion,403 rôle/dossier artisan manquant,409 version périmée (relire),422 champs invalides,503 lecture indisponible. Après succès, recharger les offres depuis la première page. Après réponse perdue, relire le réglage ; ne pas incrémenter la version au hasard.

Libellé nécessaire : **« Rayon indicatif entre centres de communes »**. Limite visible : **« Les offres dont le code postal ne permet pas d’identifier une commune unique restent soumises à vos zones postales. Ce rayon n’est pas une distance de trajet ni une mesure depuis votre position. »** Une commune choisie est une référence de travail, pas une adresse personnelle. Les options exposent code INSEE et nom seulement, jamais longitude/latitude.

## Source et calcul

Source publique officielle : [API Découpage administratif](https://geo.api.gouv.fr/decoupage-administratif/communes). GET réel HTTP200 le2026-11-07T21:13:50Z :34codes INSEE distincts, centres GeoJSON Point `[longitude,latitude]`, codes postaux. SHA256 du corps brut `82062cf6109f14601417f446f737639756fb6278faf2e8a15f879632c4059ecc`. Snapshot inclus dans la migration, aucun appel fournisseur à l’exécution et aucune coordonnée inventée.

Le code INSEE sélectionne le centre exact de référence. Pour une offre, seul son code postal serveur intervient : s’il correspond à exactement une commune du snapshot, distance géodésique indicative sphérique (haversine, rayon terrestre moyen6371,0088km) entre les deux centres ; exclusion au-delà du rayon choisi. Codes ambigus97218/97222/97250 et inconnus : aucune distance fabriquée, éligibilité postale préexistante conservée. Pas de géocodage d’adresse, nom de ville, GPS, ETA ou classement par distance.

## Autorisations et concurrence

Tables sous schéma privé, RLS active, sans accès direct API même service_role. GET/POST publics uniquement pour rôle authenticated, contrôle du profil artisan dans les fonctions. Écriture verrouille `profiles` puis `artisan_profiles`, comme acceptation et suspension ; aucun verrou de dossier ajouté à la préférence. Version optimiste pour les doubles écritures et changements d’onglet.

`mission_eligible` conserve son OID et tous les prédicats initiaux (rôle, validation, disponibilité, catégorie, zone postale, refus, état et absence d’attribution), puis applique le rayon. Les fonctions de pagination et d’acceptation existantes l’appellent : filtre avant LIMIT51, ordre `created_at,id` et curseur inchangés. Acceptation garde son verrouillage organisation/dossier→profil→dossier artisan et revalide le réglage courant. Aucune modification d’une mission déjà attribuée et aucun nouveau score.

## Preuves et limites

`tests/sql-mission-radius-review.mjs` : toutes migrations isolées PGlite ; source34communes, aucun choix historique, plafonds, centres réels Fort-de-France/LeLamentin, codes ambigus/inconnus, isolation des artisans, retrait, version, tri/pagination avec65offres anciennes exclues et60offres suivantes, **vraie acceptation refusée après réduction du rayon puis acceptée après élargissement**, vrais handlers reliés aux RPC. Vérifie l’ordre de verrous dans la définition SQL. Ce test sérialisé n’est pas une preuve de charge concurrente hébergée.

`tests/mission-radius.test.ts` : vrais handlers injectés, contrat privé sans coordonnées, validation, erreurs et origine. Test historique `tests/sql-artisan-missions-review.mjs` conservé pour l’absence de régression sans préférence.

Pas de nouvelle collecte, changement de couverture commerciale, migration cloud ou preview validée. Cette tranche ne clôture pas toutes les règles de capacité/planning ni un futur matching géographique précis.
