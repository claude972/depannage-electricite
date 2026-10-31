# Contrat correction CI SQL pg_cron

Base c7c27bf ; branche codex/ci-sql-cron, worktree isolé. Propriété : helper tests/sql-isolated-migrations.mjs, adaptateurs des tests SQL historiques qui exécutent020, tests du helper et .github/workflows/check.yml. Aucun codeapp/package/migration changé.

Le CI échoue parce que les suites historiques chargent désormais020 dans PGlite sans pg_cron natif. Adapter uniquement la migration de nom exact202610310020_tracking_retention.sql : remplacer le seul bloc installationnative balisé par le stubcron déjà revu, annoncer explicitement la simulation, exécuter tout le reste020 et toutes les autres migrations sans saut ni retrait d’assertion. Refuser un bloc malformé/inattendu au lieu de remplacer largement.001–019 gardent le traitementpgcrypto existant.

Ajouter une étape CI obligatoire dédiée rétention020 avant les suites historiques : test de refus natif indisponible et testsSQL RLS/ACL/collisions/idempotence/purge sous stub explicite. La retirer seulement du glob ultérieur pour éviter doublon. Test réel scheduler/SKIPLOCKEDinterconnexion reste gate root, aucune preuve cloud depuisPGlite.

Validation : tests purs du helper, toutes les suitesSQL existantes avec runtimecache, syntaxe/diffcheck ; pas installation/buildapp/cloudDB. Commit/push cohérents, SHA final remis à root pour revue avant intégration.

## Livraison et validation

Helper strict : nom020 exact et SHA256 complet `76d5517d31ef01ca0b17f5172e48a6ebb5671b0026ed275bdf51e4cf54355acf` (source a658087) vérifiés avant créationstub. Remplacement par découpage des deux marqueurs uniques, pas regexlarge. Toute dérive refuse et demande nouvelle revue/pin.11 adaptateurs historiques +tracking utilisent ce helper ; tests013/015 déjà volontairement bornés avant020 restent inchangés. Aucun SQLmétier/ACL/purge/advisory/jobguard retiré.

CauseCI41232307411 vérifiée dans le log : P0001 «pg_cron is unavailable; tracking scheduler was not installed». Correctif ne transforme pas ce refus natif en succès : le test020 dédié continue de l’exiger avant d’utiliser son stubavecRLS/installer distinct. ÉtapeCI obligatoire avant les autres suites, sanscontinue-on-error ; seul doublon ultérieur supprimé du glob.

Exécuté dans ce worktree avec cacheexistant :

-5tests purs helper PASS : conservation préfixe/suffixe, aucune adaptation autre migration, pin/structure/filename refusés avantstub, annonce explicite, erreurstub propagée.
-15/15scriptsSQL PASS : sql-adv-rollback-review, sql-artisan-active-guard-review, sql-document-finalization-review, sql-performance-review, sql-planning-review, sql-platform-operations-review, sql-quote-documents-review, sql-quote-draft-review, sql-review, sql-site-access-review, sql-site-operations-review, sql-support-operators-review, sql-support-review, sql-tracking-retention-review, sql-tracking-review. Logs /tmp/depannage-ci-sql-cron-results/.
-Syntaxe17fichiersSQLharness PASS ; gitdiffcheck PASS. Vérificationindépendante en mémoire : retraitseulsimport/wrapper des11anciensfichiers restitue chaqueoctetdebasec7c27bf, donc assertionshistoriques intégralementconservées.
-Aucun diff migration/app/components/lib/package. Pas installation, buildapplication, compteouDBcloud.

Ces résultats sont SQLisolé/PGlite avec Auth/Storage/cronstubs déclarés. Pasdepreuve workerscheduler réel, GPSmatériel ouSKIPLOCKEDdeuxconnexions. CIhébergée de ceSHA à observeraprès push/intégration parroot ; aucun PASSdistant anticipé.
