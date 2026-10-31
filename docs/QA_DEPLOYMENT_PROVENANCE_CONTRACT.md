# Contrat QA : provenance d’une preview distante

Statut : contrat avant implémentation. Base4c398e8393026598c5b629d3912cf80285acc2f5. Propriété exclusive confirmée par ROOT pilote, lead informé avant code : scripts/qa/lib/deployment-proof.mjs ; scripts/qa/tests/deployment-proof.test.mjs ; ce document docs/QA_DEPLOYMENT_PROVENANCE_CONTRACT.md. Les workers Business et Tracking gardent leurs runners/configs ; aucun changement de fixture, navigateur, produit, secret ou API cloud par ce module.

Implémentation autorisée après publication du contrat1e5f808 et réservation A7f629d49. Module prêt pour revue ; raccordement des runners et exécution distante restent à leurs propriétaires et ROOT.

## Problème et périmètre

Deux builds du même SHA peuvent avoir des BUILD_ID différents. En REMOTE, attribuer la page à un BUILD_ID local est incorrect. Une recherche html.includes sur du Flight échappé est également incorrecte. La preuve distante combine une attestation privée root capturée depuis les métadonnées Vercel et une identité de build réellement extraite du document reçu par le runner. LOCAL conserve ses contrôles actuels sans modification implicite.

## Reçu privé strict

Objet JSON exact, sans champs supplémentaires : schemaVersion=1 ; origin ; projectId ; teamId ; deploymentId ; readyState="READY" ; target="preview" ou null ; gitSource objet exact {type:"github",repoId,ref:"integration/web-pwa",sha} ; servedBuildId ; capturedAt. Les identifiants sont des chaînes non vides bornées et formatées (prj_,team_,dpl_) ; repoId entier positif sûr ; sha40 caractères hexadécimaux minuscules ; servedBuildId conforme BUILD_ID_RE existant. Aucun null sauf target ; aucune coercition. capturedAt est ISO UTC canonique fini, à moins de15minutes du préflight et au plus30secondes dans le futur. Horloge injectable uniquement pour tests déterministes, aucune option pour désactiver la borne.

origin est une origine HTTPS canonique seule, sans identifiants, port explicite, chemin, query ni fragment, sur un hôte de déploiement unique *.vercel.app. Il doit égaler l’origine exacte attendue par le runner et provenir du champ URL unique du deploymentID attesté, jamais d’un alias production/domaine personnalisé ou de branche. ref=main et target=production sont refusés. L’attestation root confirme que l’URL est celle du deploymentID ; ce module sans API ne prétend pas déduire cryptographiquement cette relation du nom DNS.

Le pilote collecte le reçu juste avant recette, via sa CLI authentifiée et la page publique. Aucune réponse API brute, clé, cookie, JWT, secret de partage ou token bypass ne figure dans ce reçu ni dans Git. Le module ne contacte aucun service.

## API publique courte

- validateDeploymentProof(receipt,{expected,nowMs}) : validation pure, résultat normalisé gelé ou erreur à code stable sans réimprimer les données reçues.
- loadDeploymentProof({receiptPath,expected,nowMs}) : lecture locale bornée puis validation ; receiptPath absolu, ouverture O_NOFOLLOW du fichier final, fichier régulier, UID courant, mode exactement0600, un lien physique, taille positive≤16KiB, vérification fd avant/après lecture et taille effectivement lue. Le parent /tmp canonique macOS est permis ; le fichier final symlink ne l’est pas. Tout refus précède les fixtures.
- verifyRemoteDeployment({proof,html,expected,nowMs}) : revalide preuve et horloge, appelle servedBuildIdentity(html) existant, exige source="flight", identité non ambiguë, un seul candidat égal à proof.servedBuildId ET expected.servedBuildId ; sinon refuse. Retourne une preuve compacte avec mode:"remote", origine/SHA/deploymentId/buildID/capturedAt et provenance:"root-receipt+served-flight" ; aucune valeur html ou reçu arbitraire.

expected exige les huit valeurs indépendantes : origin,projectId,teamId,deploymentId,repoId,ref,sha,servedBuildId. Le runner les reçoit de sa configuration root explicite, pas de la page testée ou du reçu seul. Les constantes de projet ne sont pas codées dans ce module réutilisable. Tout champ différent refuse.

Réutilisation : import lecture seule de servedBuildIdentity depuis ../../qa-business/lib/preflight.mjs au SHA4c. Ce fichier est déjà un parseur pur ne faisant aucun appel automatique. Ne pas le déplacer/dupliquer/éditer. Sa présence à l’intégration devient dépendance explicite pour les deux runners ; ceux-ci importent le nouveau helper après revue sans changer leur mode LOCAL. Pas de nouvel appel navigateur, package, installation ou dépendance.

## Vérification et limites

Tests Node existants/ciblés sans cloud : receipt nominal ; chaque champ nul/manquant/supplémentaire/mal typé ; divergence de chaque valeur attendue ; refmain/production/URL personnalisée/port/query/credentials ; expiration/futur/date non finie ; fichier symlink/mode/UID/non régulier/taille excessive ; Flight réel échappé, chunks fragmentés, mauvais BUILD_ID, ambiguïté et absence ; preuve expirée au moment du verify. Les tests doivent utiliser le vrai parseur importé, pas le remplacer par un stub.

Les workers raccordent explicitement REMOTE avant leurs premières fixtures, conservent LOCAL existant et publient leurs tests/revue séparés. Un PASS du module ne prouve ni métier, ni permissions, ni build reproducible, ni scheduler, ni GPS physique. L’attestation root est une entrée de confiance opérateur à durée bornée, pas une signature du déploiement. Root exécutera la recette distante réelle après revue au SHA exact.

## Livraison et vérification ciblée

Commande : `node --test scripts/qa/tests/deployment-proof.test.mjs` ; syntaxe : `node --check scripts/qa/lib/deployment-proof.mjs` et `node --check scripts/qa/tests/deployment-proof.test.mjs`. Les tests utilisent le parseur Business réel, y compris le HTML public4c capturé par ROOT dans son fichier privé hors Git (test optionnel explicitement SKIP si absent ailleurs). Aucun HTML complet n’est copié dans le dépôt. La vérification UID simule uniquement une identité runtime différente pour exercer le refus, sans chown ni accès à des fichiers utilisateurs. Les tests de fichiers créent uniquement leurs propres répertoires temporaires puis les nettoient.

Le reçu hors Git est vérifié via son parent canonique et `git rev-parse --show-toplevel`, avec locale C et refus sur toute erreur autre que « not a git repository ». L’ouverture finale refuse les symlinks et les fichiers non réguliers ; une lecture bornée et les statistiques fd avant/après détectent les modifications observables. Cette protection ne prétend pas résister à un opérateur malveillant disposant du même UID. Le module refuse aussi les appels Flight syntaxiquement mal formés au lieu de les ignorer quand un autre appel serait valide.


## Revue et propriété ROOT

ROOT a relu le contrat ; réservation dans MISSIONS.md sur missions/web-pwa AVANT code. Vérifier fichier hors Git (chemin canonique) en plus de O_NOFOLLOW/UID/mode. Aucun changement aux fichiers Business/Tracking/coreFixtures dans ce lot ; leurs owners raccordent après revue SHA. Leur mode LOCAL conserve son sens (SHA local et BUILD_ID réellement servi), pas une fausse égalité avec BUILD_ID distant. Le contrôle substring naïf Tracking est un défaut séparé à corriger par son owner avec le parseur strict. Aucun token de partage ni cookie requis : la preview4c est désormais publique par exception de déploiement autorisée explicitement par le propriétaire.
