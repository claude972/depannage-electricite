# SYS-09 — exercice local de restauration

Depuis la racine, avec le runtime PGlite installé pour les tests SQL :

```sh
PGLITE_MODULE=/chemin/absolu/node_modules/@electric-sql/pglite/dist/index.js node --test tests/restore-drill.test.mjs
```

Le test construit une base **en mémoire neuve**, applique les migrations du checkout avec les stubs explicites Auth/Storage/pg_cron du harnais existant, puis crée deux comptes synthétiques et une demande d'effacement par le véritable RPC. Il exporte une archive PGlite et la restaure réellement dans une autre base mémoire ; aucun argument cible, accès cloud, suppression, secret, fichier de données ni URL de connexion n'est utilisé.

Avant ouverture : manifeste exact versionné, périmètre synthétique, empreinte et taille de l'archive, empreinte des noms/contenus de toutes les migrations. Limites techniques : archive 128 Mio, 10 000 lignes par table. Après ouverture : comparaison des empreintes des données de toutes les tables applicatives et du catalogue (colonnes, contraintes, index, fonctions/ACL, RLS, politiques, rôles, schémas, vues, définitions des séquences et triggers). Le test exerce ensuite la reprise idempotente de la demande, le maintien de `execution_state:not_started`, le ticket exact et les refus d'un compte étranger. Altération d'archive, manifeste invalide, mauvaises migrations et résultat restauré différent doivent échouer.

La sortie contient uniquement les compteurs et empreintes de cette fixture. Le manifeste est un contrôle d'intégrité **issu de ce processus de confiance**, pas une signature d'origine ni un mécanisme d'acceptation d'archives externes. L'outil n'est pas un importeur de sauvegardes de production. Runtime exercé : PGlite 0.5.13 ; pas de garantie de restauration entre versions.

## Limites qui restent ouvertes

Ce test ne prouve ni sauvegarde hébergée, ni restauration Supabase, ni fonctionnement réel Auth/cron/Storage, ni disponibilité ou délai de reprise. Les fichiers Storage ne font pas partie d'une sauvegarde DB Supabase : leur stratégie et leur restauration doivent être vérifiées séparément. Politique de conservation/effacement, périmètre légal, objectifs RPO/RTO et configuration d'infrastructure restent à décider ; aucune durée n'est inventée et aucune demande d'effacement n'est exécutée.

Sources consultées le 7 novembre 2026 : [API PGlite dumpDataDir/loadDataDir](https://pglite.dev/docs/api), [sauvegardes Supabase et limite Storage](https://supabase.com/docs/guides/platform/backups). Ancrage projet : `docs/AUDIT_COMPLET_SPECIFICATIONS.md` SYS-09, `docs/BLUEPRINT.md` sauvegarde/restauration avant lancement. `RESTE_A_LIVRER_ACTUEL.md` est un inventaire historique : export personnel et demandes d'effacement ont depuis leur code serveur ; clôturer un ticket n'exécute toujours aucune suppression.
