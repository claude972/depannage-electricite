# Recheck SHARED004 / SHARED005

Verdict : fermeture bornée recommandée pour les correctifs a09f39aa58352e5ca05b933be6bdf20ea64b759a et 381bac170736787811870a642be3a886bdf05cf2. Aucun blocant nouveau établi dans ces deux diffs.

Lecture exacte git show des commits, contrôleur et route GET planning ; les fichiers testés sont identiques à 381bac1 au HEAD actuel 5e443a0. Modification non commise de package.json ignorée. Aucun fichier applicatif/test modifié, aucun cloud exécuté.

Vérification : ./node_modules/.bin/tsx --test tests/ui/features.test.ts : 13 PASS / 0 échec.

SHARED004 : planningProbeRange utilise weekRange et toIsoWithOffset avec le fuseau contractuel. Le contrôleur ne transmet plus deux dates calendaires identiques. Le test utilise le vrai schéma isoInstant du lot et vérifie un intervalle positif sous la borne maximale, aux frontières de semaine/année. Le GET serveur impose effectivement ces mêmes contraintes.

SHARED005 : owned capture une génération à la construction de chaque client live. bound vérifie cette génération avant de lancer task, puis après succès/échec ; le callback conservé d’une ancienne identité n’émet donc rien après changement de génération. Le test exerce un client individuel et un bundle, lecture et commande, affirme l’absence de nouvelle requête, puis vérifie qu’un bundle frais fonctionne. Les trois guard.bump du contrôleur sont accompagnés d’un identityEpoch ; le useMemo du bundle dépend de cet epoch et profile.id. Aucun changement d’identité dépendant uniquement d’un objet guard stable n’a été trouvé dans ce contrôle ciblé.

Limites : le test de bundle est pur et ne monte pas le contrôleur React ; l’actualisation useMemo a été vérifiée par source. Pas de parcours navigateur entre deux comptes, pas de verdict global sur interfaces, ancres, autres lots ou déploiement.
