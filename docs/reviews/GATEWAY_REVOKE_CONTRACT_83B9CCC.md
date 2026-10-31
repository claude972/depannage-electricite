# Révocation pendant upload — revue contrat83b9ccc

Source exacte :83b9ccc, docs/CLAUDE_GATEWAY_REMAINING_QA_CONTRACT.md, §2v3. Comparaison RPC sur intégration be17b24adbc0035d1ba82347c09f9045bac03d71 : migrations009_site_access et013_document_finalization. Lecture seule ; aucun SQL exécuté, compte/cohorte/bail/Storage/cloud touché, aucun code ou harnais écrit. Le bail expiry6466 reste volontairement intact.

## P2 à corriger AVANT code/exécution : ACL de table temporaire après SET ROLE

§2.4 crée qa_rv sous le rôle racine puis passe SET LOCAL ROLE authenticated. Les INSERT t_before_revoke et t_revoked/rpc_ok sont alors faits directement par authenticated, sans aucun grant sur cette table temporaire appartenant au rôle créateur. Les privilèges de tables ne sont pas acquis par SET ROLE ; le lot ne doit pas compter sur des default privileges de projet non établis. Par défaut, le premier INSERT échoue permission denied et annule la transaction avant le RPC ; le scénario n’exerce pas la révocation.

Amendement minimal : après CREATE TEMP TABLE, sous le rôle créateur, GRANT INSERT ON TABLE pg_temp.qa_rv TO authenticated ; qualifier les accès pg_temp.qa_rv. Aucun grant sur table persistante, aucun ALTER DEFAULT PRIVILEGES global. Le rôle racine lit la ligne finale après RESET ROLE/COMMIT. Variante possible : mesures root avant/après un bloc d’appel sous rôle vérifié, mais ne pas déplacer la révocation hors de sa transaction verrouillée.

## Exécutable et sérialisation

/Users/claudebrafa/.local/bin/supabase existe ; commande db query --help lue uniquement : --file, --project-ref et --linked (Management API) disponibles, version annoncée2.117.0. Aucun appel DB effectué. Le lot unique est nécessaire : transaction/verrou/pause/révocation/commit ne peuvent pas être répartis entre deux invocations CLI. Le contrat prévoit correctement une seule ligne JSON finale plutôt que dépendre de plusieurs jeux de résultats. La source substituée complète et le format exact de sortie CLI restent à revoir avant exécution ; le DO de garde est encore un schéma avec ellipse, pas un fichier exécutable livré.

## Verrous et acteur

009/set_organization_member_site_access verrouille l’organisation, exige is_org_owner, refuse la cible propriétaire, verrouille le membre, valide scope/grants, puis retire/réinsère les grants. 013/finalize_document_upload verrouille la même organisation avant dossier FOR SHARE et relecture owns_intervention/is_admin/artisan_id ; l’objet est déjà présent et seulement ensuite les métadonnées sont insérées. Le membre manager choisi (ni owner/client/artisan/admin) perd donc bien la voie d’accès attendue lorsque scope selected/grants vide est commité. Aucun UPDATE direct n’est nécessaire.

Précision de preuve recommandée au lot exact : après SET ROLE et set_config, vérifier puis stocker dans qa_rv auth.uid()=ownerQA et current_setting('role')='authenticated'. La claim role dans JSON seule ne prouve pas le rôle SQL ; current_user vu dans une fonction SECURITY DEFINER serait son propriétaire. Les deux réglages request.jwt.claim.sub et request.jwt.claims proposés sont cohérents avec l’identité désirée. Ne pas journaliser un JWT brut ni des claims réels hors cohorte.

## Observation et garde

La requête unique combine pg_stat_activity, pg_blocking_pids et existence du chemin Storage exact. Exiger une seule ligne, Lock, blocage direct par batch_pid, objet visible et horodatage dans la pause empêche de transformer une simple absence ou un fichier local en preuve. Si permissions sur pg_stat_activity masquent la requête/PID, la fenêtre est non exercée ; ne pas élargir les privilèges pour obtenir un PASS. L’observateur peut rester racine et ne renvoyer que ces champs bornés.

Garde complète requise sur tous UUID/e-mails du manifeste et liens org/site/dossier, cible manager selected/1grant, propriétaire distinct, aucun autre qa-gw hors run. Cette dernière condition REFUSERA volontairement pendant le bail expiry6466 : blocage attendu de concurrence, à attendre jusqu’au verify/nettoyage normal, jamais supprimer le bail ni enlever le garde. --no-other-writer reste une attestation du pilote, pas une preuve SQL d’absence de toute écriture.

## Délais et commit

Pause<=3s, lock_timeout2s et statement_timeout8s sont compatibles avec le principe ; la fenêtre inclut néanmoins plusieurs latences CLI/Edge/Storage et n’est pas garantie. Tous acteurs/JWT/fixtures doivent être prêts avant verrou ; aucune création/login au milieu. Le code devra lancer l’upload/observation pendant la pause sans attendre le fichier de résultat post-commit ; ces fichiers sont consommés pour le verdict final, pas comme condition préalable empêchant l’upload pendant la pause.

L’ordre DB t_lock<=t_observed<=t_before_revoke<=t_revoked<t_after_commit, readback selected/0grant et réponse403/objet exact absent/documents absents est correctement exigé. t_after_commit est une borne supérieure, pas l’instant exact du commit. 201=course perdue documentée,503/57014/transport=issue inconnue ; arrêt CLI ne prouve pas rollback : préserver manifeste et réconciliation/drain, pas suppression sur minuteur. Ne jamais faire passer la durée ou l’absence isolée pour une preuve.

Verdict : corriger l’ACL temporaire et préciser la preuve d’identité dans le contrat avant implémentation ; protocole de verrou/observation borné cohérent ensuite. Aucun feu cloud donné ; source SQL exacte/gardes et futur code encore à revoir. Le bail actif n’est pas un défaut et reste intact.
