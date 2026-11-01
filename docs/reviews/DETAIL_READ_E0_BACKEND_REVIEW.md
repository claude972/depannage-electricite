# Revue indépendante backend DETAIL-READ — e0eeee4

SHA : e0eeee4da3310b40e49164f214d9dbf8bacf870c, branche codex/detail-read. Checkout auteur propre à la première inspection ; publication confirmée deux fois par git ls-remote origin refs/heads/codex/detail-read au même SHA. Source figée via git archive dans /var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-detail-e0eeee4-review-ov56ejmk. Contrat docs/DETAIL_READ_CONTRACT.md (690da9f) et rapport auteur lus ; diff backend/workspace/types/tests examiné. Aucune modification source, credential, installation, cloud ou migration.

Verdict : aucun P1/P2 concret identifié dans le périmètre relu. Backend raccordable après les autres contre-revues ROOT/Claude ; ce résultat ne ferme pas le parcours cap100 tant que consommateur et recette réelle ne sont pas vérifiés. Aucun résultat RLS réel déduit de ces tests.

## Vérification source

- GET authentifie avant validation UUID, puis utilise uniquement authenticatedClient().db. Aucun adminClient/service_role/RPC available_missions sur cette route. UUID invalide, tableau vide du parent absent ou invisible donnent le même404 ; 401/404/200/503 ont private,no-store ; erreur primaire transport/base/schema/identité donne503 + Retry-After2 sans détail technique.
- Projections fermées identiques à l’annexe ; schémas stricts des lignes et de l’enveloppe. Dates/champs/états relus face aux migrations001/003/015. Métadonnées documentaires sans pathStorage, paiements sans sessionStripe. Import WorkspaceLimits est type-only, nouveau champ workspace optionnel.
- Lectures dépendantes bornées par intervention_id, site_id puis organization_id ; none si pas de site, hidden sur vrai tableau vide RLS, error si requête/structure malformée. Pas de recherche privilégiée pour contourner un hidden. Les erreurs liées restent des statuts élémentaires, sans faux « aucun ».
- Après toutes dépendances, seconde lecture RLS du parent (117–119) : disparition =>404, changement client/artisan/site/status/updated_at =>503. Il s’agit d’un recheck observé, sans transaction globale ni garantie de révocation après la dernière lecture. Aucune exigence de linéarisation nouvelle ajoutée.
- Paiements : scope indépendant des20devis affichés, count exact avec plafond200IDs ; validations du compte et de la longueur/UUID/unicité ; count>200 => incomplete vrai ; erreur => statuserror et aucune requête paiements fondée sur scope inconnu. Paiements limit21 puis retour20 et limited exact ; quote_id étranger à ce scope refusé comme erreur.
- Workspace : lectures101/201/101/51, retour100/200/100/50 ; N=L false et N=L+1 true ; extra dossier exclu des rendez-vous. Les offres artisan demeurent anonymisées et ne modifient pas limited des dossiers lisibles. Validation historique compatible avec absence de limits. Les autres chemins d’erreur historiques du workspace restent hors changement de contrat.

## Contrôles réellement exécutés

1. node node_modules/tsx/dist/cli.mjs --test tests/detail-read-backend.test.ts tests/workspace-limits.test.ts depuis l’export exact, dépendances existantes reliées en lecture seule : 13tests PASS,0FAIL,0SKIP,24.71s. Journal /tmp/depannage-detail-e0-tests.log. Les tests chargent les vraies routes et le vrai SupabaseClient, avec fetch simulé : 404 refusés simulés,401,503malformé/transport,none/hidden/error,limitesL+1,paiements hors20/scope201,projections et recheck révocation/réaffectation.
2. Repro indépendant /tmp/depannage-detail-e0-adversarial.ts : 9cas supplémentaires PASS, journal /tmp/depannage-detail-e0-adversarial.log. Quatre dépendances null => statuterror, quatre changements tardifs du parent (updated_at/client/site/status) =>503 sans ancien détail, scope de devis dupliqué => payments.error et aucune lecture payments.

Aucune passe780tests globale ni typecheck auteur répétés ; leurs résultats ne sont pas revendiqués comme exécutés par ce reviewer. Les cas simulés ne prouvent pas les politiques du Supabase dédié ni les refus entre vrais comptes. Pas de build, déploiement, capture UI ou preuve fournisseur réalisés.
