# Recheck contrat v4 ac4eadf

SHA exact ac4eadf7f8daf0fac9a900ba10594628d355cce4, docs/CLAUDE_GATEWAY_REMAINING_QA_CONTRACT.md. Diff depuis83b9ccc lu par git ; aucun code/test/SQL/cloud exécuté, aucune app ni bail6466 touché.

Verdict : P2 ACL fermé ; feu pour CODAGE du §2 selon le contrat v4, jamais feu d’exécution cloud. Aucun nouveau P1/P2 concret établi dans cet amendement.

qa_rv reste propriété du rôle racine ; toutes les écritures de mesures ont été sorties de la période SET ROLE authenticated. Les claims locales sont posées avant le changement de rôle ; t_before_revoke est écrit racine. Sous authenticated, le DO exige current_setting('role')='authenticated' et auth.uid()=ownerQA, sinon exception avant RPC. actor_role/actor_uid sont déposés dans des GUC locales transactionnelles, qui survivent à RESET ROLE ; racine les recopie dans qa_rv avant COMMIT avec t_revoked/rpc_ok. Aucun grant, objet persistant ou privilège global ajouté.

La ligne finale et le verdict doivent refuser acteur manquant/vide/incorrect ; tests négatifs prévus. current_user dans le RPC SECURITY DEFINER n’est plus utilisé comme faux témoin d’acteur. t_before précède le SET ROLE/contrôle et t_revoked suit RESET ROLE : ce sont des bornes compatibles avec l’ordre de preuve exigé, pas des heures de commit exactes.

Verrous009/013, observation SQL unique PID bloqué+objet exact, garde cohortes, pause<=3s/timeout8s, relecture post-commit et issue503 inconnue restent inchangés. La source SQL finale substituée avec DO de garde complet, futur code et tests doivent encore être revus avant toute exécution. Le garde refusera volontairement la coexistence du bail6466 actif ; aucune suppression pour débloquer la recette autorisée ici.

Petite imprécision éditoriale non bloquante : le paragraphe explique que SET ROLE…RESET ROLE ne contient « que » le RPC, alors que l’exemple contient aussi le DO de vérification d’acteur/GUC. L’exemple est cohérent ; préciser la phrase lors de la prochaine édition suffit.
