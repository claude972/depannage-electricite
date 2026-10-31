# Contrat correction CI SQL pg_cron

Base c7c27bf ; branche codex/ci-sql-cron, worktree isolé. Propriété : helper tests/sql-isolated-migrations.mjs, adaptateurs des tests SQL historiques qui exécutent020, tests du helper et .github/workflows/check.yml. Aucun codeapp/package/migration changé.

Le CI échoue parce que les suites historiques chargent désormais020 dans PGlite sans pg_cron natif. Adapter uniquement la migration de nom exact202610310020_tracking_retention.sql : remplacer le seul bloc installationnative balisé par le stubcron déjà revu, annoncer explicitement la simulation, exécuter tout le reste020 et toutes les autres migrations sans saut ni retrait d’assertion. Refuser un bloc malformé/inattendu au lieu de remplacer largement.001–019 gardent le traitementpgcrypto existant.

Ajouter une étape CI obligatoire dédiée rétention020 avant les suites historiques : test de refus natif indisponible et testsSQL RLS/ACL/collisions/idempotence/purge sous stub explicite. La retirer seulement du glob ultérieur pour éviter doublon. Test réel scheduler/SKIPLOCKEDinterconnexion reste gate root, aucune preuve cloud depuisPGlite.

Validation : tests purs du helper, toutes les suitesSQL existantes avec runtimecache, syntaxe/diffcheck ; pas installation/buildapp/cloudDB. Commit/push cohérents, SHA final remis à root pour revue avant intégration.
