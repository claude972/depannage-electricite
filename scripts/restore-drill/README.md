# SYS-09 — exercice local de restauration

Depuis la racine, avec le runtime PGlite installé pour les tests SQL :

```sh
PGLITE_MODULE=/chemin/absolu/node_modules/@electric-sql/pglite/dist/index.js node --test tests/restore-drill.test.mjs
```

Le test construit une base **en mémoire neuve**, applique les migrations du checkout avec les stubs explicites Auth/Storage/pg_cron du harnais existant, puis crée deux comptes synthétiques et une demande d'effacement par le véritable RPC. Il exporte une archive PGlite et la restaure réellement dans une autre base mémoire ; aucun argument cible, accès cloud, suppression, secret, fichier de données ni URL de connexion n'est utilisé.

Avant ouverture : manifeste exact versionné, périmètre synthétique, empreinte et taille de l'archive, empreinte des noms/contenus de toutes les migrations. Limites techniques : archive 128 Mio, 10 000 lignes par table. Après ouverture : comparaison des empreintes des données de toutes les tables applicatives et du catalogue (colonnes, contraintes, index, fonctions/ACL, RLS, politiques, rôles, schémas, vues, définitions des séquences et triggers). Le test exerce ensuite la reprise idempotente de la demande, le maintien de `execution_state:not_started`, le ticket exact et les refus d'un compte étranger. Altération d'archive, manifeste invalide, mauvaises migrations et résultat restauré différent doivent échouer.

La sortie contient uniquement les compteurs et empreintes de cette fixture. Le manifeste est un contrôle d'intégrité **issu de ce processus de confiance**, pas une signature d'origine ni un mécanisme d'acceptation d'archives externes. L'outil n'est pas un importeur de sauvegardes de production. Runtime exercé : PGlite 0.5.13 ; pas de garantie de restauration entre versions.

## L06 · Exercice Supabase local avec Auth et Storage

L’exercice PGlite ci-dessus simule Auth, Storage et pg_cron. Pour L06, le script suivant utilise deux instances Supabase locales avec des services Auth, PostgreSQL et Storage actifs. Il crée deux comptes confirmés et un dossier synthétiques sur la source, puis rattache une image privée par le RPC de l’application.

Depuis la racine du checkout d’intégration, avec Docker et Supabase CLI installés, préparer une nouvelle cible à côté de la source de recette `../qa/plan-lancement-db`. Ces commandes correspondent aux noms et ports de l’exercice du 12 novembre 2026.

```sh
set -eu
umask 077
source_dir=../qa/plan-lancement-db
target_dir=../qa/plan-lancement-restore-db
mkdir "$target_dir"
mkdir "$target_dir/supabase"
sed -e 's/domdepannage-launch-qa-20261112/domdepannage-restore-qa-20261112/g' \
  -e 's/594\([0-9][0-9]\)/595\1/g' \
  "$source_dir/supabase/config.toml" > "$target_dir/supabase/config.toml"
cp -R "$source_dir/supabase/migrations" "$target_dir/supabase/"
if [ -d "$source_dir/supabase/templates" ]; then
  cp -R "$source_dir/supabase/templates" "$target_dir/supabase/"
fi

export DOCKER_CONTEXT=colima-release-auth-qa
supabase --workdir "$target_dir" start --exclude vector,logflare,studio,postgres-meta,edge-runtime \
  > ../qa/plan-restore-target-start.private.log 2>&1
supabase --workdir "$source_dir" status -o json > ../qa/plan-local.private.json \
  2>> ../qa/plan-restore-target-start.private.log
supabase --workdir "$target_dir" status -o json > ../qa/plan-restore-target.private.json \
  2>> ../qa/plan-restore-target-start.private.log
node scripts/restore-drill/supabase-local.mjs 20261112 \
  ../qa/plan-local.private.json ../qa/plan-restore-target.private.json \
  > ../qa/plan-restore-local-proof.json
```

Les fichiers de statut et le journal de démarrage contiennent des clés locales et restent privés. La source doit déjà tourner sur les ports 59421 et 59422. La cible utilise les ports 59521 et 59522 et applique les migrations au démarrage. Le script compare les versions appliquées, vérifie les ports et s’arrête si la cible contient déjà des comptes, dossiers, documents ou objets Storage.

Le script exporte en mémoire les lignes ciblées des tables `auth.users`, `auth.identities`, `public.profiles`, `public.interventions` et `public.documents`. Il les réinsère en une transaction et compare leurs valeurs avant d’ouvrir de nouvelles sessions. Il exporte et restaure séparément les octets de l’image via l’API Storage. La preuve JSON contient les compteurs, les empreintes et les temps mesurés. Elle confirme les connexions par e-mail et mot de passe, la présence du dossier et de la pièce, l’empreinte identique de l’image et les refus d’accès d’un client tiers et d’un visiteur anonyme à cette image.

## Restauration hébergée à vérifier

L06 porte sur les lignes d’une fixture et un seul objet privé. Les sessions et jetons existants, le contenu des autres tables, pg_cron, les copies hébergées et la restauration complète des buckets restent à vérifier. Les mesures locales commencent avec les piles en fonctionnement. Un objectif RPO ou RTO nécessite un exercice hébergé et une validation opérationnelle.

Pour cet exercice hébergé, relever l’heure de la sauvegarde et des copies Storage, restaurer dans une cible isolée, puis vérifier la connexion, les dossiers, les métadonnées des pièces, leurs empreintes et les refus d’accès avec des comptes de recette. Mesurer le délai jusqu’à la reprise vérifiée et consigner la période de données effectivement récupérée. Les fichiers Storage sont à exporter et restaurer séparément de la sauvegarde de la base. [Documentation Supabase sur les sauvegardes](https://supabase.com/docs/guides/platform/backups)

Sources consultées le 7 novembre 2026 : [API PGlite dumpDataDir/loadDataDir](https://pglite.dev/docs/api), [sauvegardes Supabase et limite Storage](https://supabase.com/docs/guides/platform/backups). Ancrage projet : `docs/AUDIT_COMPLET_SPECIFICATIONS.md` SYS-09, `docs/BLUEPRINT.md` sauvegarde/restauration avant lancement. `RESTE_A_LIVRER_ACTUEL.md` est un inventaire historique : export personnel et demandes d'effacement ont depuis leur code serveur ; clôturer un ticket n'exécute toujours aucune suppression.
