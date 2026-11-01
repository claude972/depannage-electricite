# Contre-revue backend a44ca07

SHA exact a44ca07d4525bb33886ae12a8a1acf0e464f3fbc ; push origin/codex/detail-read confirmé par ls-remote. Source git archive isolée : /var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-detail-a44-review-3jhl52l9. Diff e0eeee4..a44ca07 borné aux3fichiers annoncés (helper/schema, tests ciblés, rapport). Aucun cloud, credential, installation, modification auteur, fullsuite ou typecheck répétés.

Verdict : correctif Claude P2 extras/chaînes numériques fermé dans le périmètre relu ; aucun nouveau P1/P2 identifié. Backend raccordable sous les autres gates ROOT. Le parcours front cap100 reste distinct.

quoteLine.strip supprime les clés supplémentaires des lignes, sans les renvoyer ; les colonnes du devis restent strictes. storedInteger n’accepte que des chaînes décimales signées/exposant bornées ; son calcul BigInt vérifie la divisibilité exacte avant conversion, sans arrondir une fraction proche d’un entier. La conversion n’accepte qu’un entier sûr, puis les schémas imposent quantité1–1000 et prix0–10000000. Null/bool/objets/Infinity ne sont pas coercés ; les vrais nombres non finis restent refusés par Zod. Aucun changement des routes, projections, RLS, droits ou autres dépendances.

Vérifications réellement exécutées :
- 14tests ciblés PASS,0FAIL,0SKIP,22.12s : tests/detail-read-backend.test.ts et tests/workspace-limits.test.ts, vrais clients Supabase avec fetch simulé. Journal /tmp/depannage-detail-a44-tests.log.
- 21cas indépendants du schéma PASS : /tmp/depannage-detail-a44-numeric-repro.ts, journal .log du même préfixe. Bornes1/1000 et0/10M, décimales/exposants exacts, extras secrets retirés ; fractions numériques et chaînes presque entières, horsbornes, null/bool, vrais Infinity/NaN, hex et séparateur numérique refusés.

Les résultats ne sont pas des preuves de politiques RLS réelles. Les780tests/typecheck auteur ne sont pas revendiqués comme rejoués ici. Rapport backend e0eeee4 antérieur conservé : /tmp/depannage-detail-e0eeee4-backend-review.md.
