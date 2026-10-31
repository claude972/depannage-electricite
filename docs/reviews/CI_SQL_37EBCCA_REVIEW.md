# Revue indépendante correction CI SQL

SHA exact `37ebcca401881a429724716f325cd5b6779b5801`, basec7c27bf, contrat51ad6bf lu, worktree propre avant/après. **Aucun P1/P2 trouvé ; acceptable pour intégration.** Aucun code/migration/package/browser/cloud modifié par le reviewer.

Le SHA256 entier020 `76d5517d31ef01ca0b17f5172e48a6ebb5671b0026ed275bdf51e4cf54355acf` correspond exactement aux octets de la020 revuea658087. L'adaptateur valide nom+pin AVANT de créer le stub, refuse dérive puis découpe seulement le bloc d'installationnative délimité par les deuxmarqueurs uniques. Prefixe/suffixe, purge/ACL/jobguard/advisory et autresmigrations sont conservés ; aucune substitutiongénérique de SQLenvironnant. Annonce STUB explicite et erreurinstallstub propagée.

Diff des douzeadaptateurs revu : imports + chargements de migrations seuls ; aucune assertionhistorique retirée ou condition de réussite assouplie. Tracking réutilise désormais ce helperstrict plutôt que sa substitutionlocale. Les suites document013/015 volontairementbornées avant020 restent inchangées. Aucun diff app/components/lib/supabase/package.

Workflow : étape obligatoire020 sans continue-on-error/if, avant les historiques, exécutant le refus natif quand pg_cron absent et tests dédiés RLS/SELECTonly/ACL/collision/purge sous stub ; puis cinq testsduhelper. Le glob retire seulement le doublon020 déjà exécuté. RuntimePGlite reste épinglé horsapp. Le stub importé ne lance pas main lors d'importation, aucunworkerhoraire caché.

Contrôles indépendants réellement exécutés :

- `node --test tests/sql-isolated-migrations.test.mjs` : **5PASS**.
- `PGLITE_MODULE=<cache>/dist/index.js node tests/sql-tracking-retention-review.mjs` : **PASS** refus natifabsence ; stub explicite sous installateur non-super SELECT-only avec vraieRLS, collisions/owner et purge1000/fresh/donnéesmétier.
- Même commande sur `tests/sql-support-review.mjs` historique : **PASS complet**, annonce020STUB visible ; vérifie intégration d'un ancien loader et assertionsexistantes.
- Deuxnouveauxmodules syntaxiquementvalides ; comparaison020bytes et diff/scope vérifiés ; HEAD37ebcca propre.

Les15suites annoncées auteur n'ont pas été rejouées toutes : aucun changement supplémentaire ne le justifie. Tests locauxisolés ne sont ni CIhébergée PASS ni preuve d'un vraischeduler/cloud. La preuve opérationnellecron faite par ROOT reste séparée de cette correctionCI.
