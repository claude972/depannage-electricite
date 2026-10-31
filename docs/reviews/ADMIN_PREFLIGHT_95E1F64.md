# Revue admin preflight

Source exacte `95e1f64057bcf7690598e36fd6832f8551ff6bf9`, worktree depannage-claude-qa constaté propre. Diff exact inspecté ; aucun cloud/credential/install/build/édition.

## Verdict borné

Aucun P1/P2 identifié dans cet ajout. La suite administrative peut être exécutée par root seulement après activation et vérification de son vrai SuperAdmin et absence d'un autre rédacteur QA. Sans administrateur extérieur à la cohorte, la suite est BLOCKED avant tout seed, jamais PASS.

- adminPreflight exécute un seul HEAD count exact profiles role=admin, avec exclusion des profiles/admin_profiles présents dans le manifeste. Count non entier/inconnu jette avant seed ; count0 => report.blocked puis retour avant fixtures.createUser.
- Le count ne lit pas les noms/emails des autres administrateurs et ne les modifie pas. Il ne prouve pas, à lui seul, qu'un administrateur extérieur au manifeste est un humain plutôt qu'une autre cohorte QA : l'absence d'autre run actif et le vrai compte propriétaire vérifié restent des préconditions opérateur.
- Le QA admin est temporaire, conservé dans auth_users/profiles/admin_profiles ; aucun admin permanent nouveau n'est introduit par ce diff. La garde014 reste active ; si le dernier admin réel disparaissait pendant la recette, le refus de nettoyage doit rester INCOMPLETE, jamais contourné.
- Nettoyage existant par identifiants de manifeste ; aucun ID réel d'admin ajouté au manifeste par le count. admin_profiles est un marqueur, pas une étape de suppression supplémentaire.
- BLOCKED est compté et rendu séparément. Son code0 est explicitement conservé par le contrat ; root doit lire summary.blocked et ne jamais assimiler ce code à un parcours admin exécuté/réussi. Aucun changement caché de rôle/acteur dans les fonctions backend.

## Vérification

`node --test scripts/qa/tests/*.test.mjs` : **65 PASS, 0 échec**. Les tests de suite établissent réellement que count0 ne crée rien et que count1 atteint la première création simulée. Aucun parcours navigateur ou Supabase réel exécuté par cette revue.
