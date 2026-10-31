# Recheck Gateway révocation — 83fdad9

SHA exact `83fdad9a1bcfcf827d83bb3d0e9eac9d072e4ce4`, checkout backend propre, identique avant/après lecture. Corrections9219dcc (chaîne distante),31b1b0f (objet exact) et83fdad9 (fin de listage Auth) relues contre13b68c3. Tests exécutés dans snapshot git archive exact, sans lire de WIP.

**Verdict : ancien P1 REVOKE-REVIEW-001 fermé ; listage plein à la borne fermé ; aucun nouveau P1/P2 identifié dans ce recheck. Accord borné à root pour revoke-prepare après verify et nettoyage complet du bail6466. Aucun avis d’exécution d’un lot SQL rendu avec UUID réels avant sa revue distincte.**

## Corrections vérifiées

- `scripts/qa-gateway/lib.ts:1643–1689` et `:1692–1741` : cohérence état/manifeste/claims puis preuve Auth des deux seuls comptes QA. Ces comptes sont enregistrés durablement avant autre réseau. Les entités sont ensuite relues par service : organisation exacte du propriétaire QA, membre gestionnaire exact ; site exact de cette organisation avec nom du run ; dossier exact rattaché au site et au demandeur QA avec description du run. Chaque ID doit figurer dans created du manifeste. Une lecture inconnue, erreur, absence ou divergence empêche l’enregistrement de cette entité et de ses enfants, empêche l’upload et produit un reliquat. Les entités non prouvées ne sont pas transmises au plan de suppression. Les parents déjà prouvés et comptes QA peuvent faire l’objet du nettoyage borné ; des FK peuvent alors laisser des reliquats, ce qui ne constitue pas un succès propre.
- `scripts/qa-gateway/run.mjs:300–305,335` : diagnostics unverifiedEntities conservés au rapport/leftovers et sortie3 explicite ; pas de verdict propre malgré cleanup des seuls IDs prouvés. L’orchestrateur utilise un nouveau created vide pour live puis les seuls recordValidated, sans importer les IDs bruts du manifeste source dans son nettoyage.
- `scripts/qa-gateway/lib.ts:1270–1300` et `run.mjs:365–374` : listage Auth par pages de1000, maximum50. Une page pleine à la borne sans fin prouvée retourne ok:false et aucune liste partielle. Page courte ou total annoncé cohérent prouvent la fin ; erreur/exception/page trop grande/total incohérent refusent. Les préflights prepare/live refusent un résultat UNKNOWN avant création ou enregistrement. La garde demeure conservatrice contre d’autres comptes qa-gw et nécessite toujours la vérification root no-other-writer.
- `scripts/qa-gateway/sql/revoke-live-observe.sql:7–21` : une observation SQL fournit simultanément timestamp DB, backend, bloqueurs directs, nombre exact d’objets sous le seul UID QA et nom uniquement si count1. Le préfixe sert à découvrir ; il ne vaut pas preuve. `lib.ts:1414–1427,1465–1479` refuse incohérences/multi-lignes et impose count1 + nom identique au chemin découvert, UUID enfant sous managerUID et chemin enregistré par le harnais. Fenêtre DB et batchPID directement bloqueur exigés.
- Parseur batch `:1384–1412` conserve run/projet/tousIDs exacts, rôle authenticated et UID propriétaire exact, horodatages ordonnés, pause bornée et relecture post-commit selected/zero grants. Upload absent/503/transport conserve UNKNOWN, et l’orchestrateur active toujours réconciliation avant cleanup ; interrompre le CLI ne prouve pas l’arrêt distant. Aucun changement au bail6466.

## Vérifications exécutées

Snapshot : `/var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-revoke-83fd-review-azsxoe2w`.

- Tous les tests existants `tests/qa-gateway*.test.ts` : **74 PASS,0 échec**. Inclus vrais helpers prepare/live avec faux réseau/horloge, cas adverses organisation étrangère/autre propriétaire, membre invalide, site étranger/autre organisation, dossier autre client/site/run, erreurs de lecture et absence created ; pas d’upload ni ID non prouvé dans le plan. Nominal : chaîne distante avant record puis upload ; ordre FK préservé.
- Cas listage : page pleine à borne et erreur refusent ; page suivante vide ou total cohérent acceptent ; prepare crée zéro compte et live enregistre zéro ID en cas UNKNOWN.
- Matrice d’observation : zéro/multiples lignes, count/nom incohérents, mauvais UID/nom/manifeste et mauvaise fenêtre refusés.
- `node --check scripts/qa-gateway/run.mjs` : PASS.
- TypeScript ciblé strict lib + tests revoke, cache existant, `--types node` : PASS. Premier appel de configuration isolée sans typesnode explicites refusait les imports node ; configuration corrigée sans modification de source.

Aucune installation, cloud, DB, credential, bail, compte ou source modifiée.

## Limites avant le vrai essai root

Expiry verify+cleanup doit finir avant prepare ; ne pas supprimer un bail pour faire passer la garde. PREPARED n’est pas PASS. Root doit relire les UUID/acteurs/SQL des fichiers rendus, puis obtenir la vraie observation unique pendant blocage, résultat final post-commit et readbacks/cleanup sans inconnus. Les74 tests sont des preuves de logique locale ; aucune fenêtre de concurrence réelle n’est exercée. Une issue distante inconnue reste à réconcilier, sans assimiler timeout ou arrêt local à arrêt serveur.
