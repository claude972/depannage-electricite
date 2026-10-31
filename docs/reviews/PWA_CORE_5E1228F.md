# Recheck PWA/core QA 5e1228f

SHA exact 5e1228f0e1616844f299d7904fca963facbbbd23, checkout QA propre. Diff depuis d97049f lu, source des helpers/runner/suite quote et tests examinés. Aucun serveur/cloud/credential ni source/test modifié.

Tests exécutés : node --test tests/qa-pwa-lifecycle.test.mjs scripts/qa/tests/*.test.mjs —79 PASS/0 échec (60 core,19 PWA).

## PWA

- REV001 fermé dans le périmètre : start re-vérifie le gate après await portListening et immédiatement avant spawn ; nouveau test suspend le probe pré-spawn, déclenche arrêt+cleanup, puis libère et exige zéro spawn. Test readiness suspendue après spawn exige aussi arrêt de l’enfant avant succès.
- REV002 fermé par source : témoin Cache Storage créé à l’étape5 avant registration.update et activation ; présence/contenu lus avant puis après activation à l’étape8, seul le témoin est supprimé. Aucun cycle navigateur réellement exécuté ici.
- REV003 fermé dans le périmètre : pageerror échoue quelle que soit la phase, test TypeError offline négatif ; erreurs réseau offline attribuées à l’origine testée et séparées des autres erreurs.
- Point supplémentaire stopAll encore ouvert : boucle entries old→new inchangée. Si old sorti et new actif, stop(old) constate le port occupé par new et rapporte stopped=false ; stop(new) libère ensuite le port, mais every(steps.stopped) conserve false. L’interruption peut donc rapporter faussement nettoyage incomplet malgré arrêt de tous les enfants. Arrêter en ordre inverse ou distinguer exit de chaque PID et contrôle global du port après tous les arrêts. Ajouter test old déjà sorti +new actif, stopAll =>tous PID sortis/port libre/ok true. Ce défaut ne permet pas un kill de PID étranger ; il empêche une preuve d’arrêt honnête.

Verdict PWA : trois findings initiaux fermés, pas encore de clôture de readiness complète tant que le quatrième cas n’est pas corrigé. Aucun run réel recommandé par cette revue.

## QA-QUOTE-001

Feu pour relance core quote contrôlée côté revue source. Premier save attend réponse POST200 et vérifie version1+assignment_token ; save obsolète attend409 ; keep mine attend son POST200 puis vérifie version attendue, token inchangé et ligne saisie depuis cette réponse ; comparaison se ferme avant lecture du statut ; le timestamp est formaté comme le vrai dateTime UI (résolution minute prise en compte), puis GET confirme état ; send attend POST200 avant polling DB.

apiResponseMatches impose méthode+chemin exacts+statut demandé ; les nouveaux tests empêchent que GET ou409 satisfasse un waiter POST200. Aucun compteur de statut préexistant ne suffit désormais à prouver keep mine. Les contrôles de version et sélection du devis publié restent présents. Aucun comportement applicatif modifié. Le succès des scénarios connectés reste à obtenir par le pilote.

Limites : pas de browser, signal réel, port réel ou réseau fournisseur exercé ; résultats unitaires ne constituent pas une recette PWA/OS ni paiement. Garder les phases core et PWA séparées dans les résultats du pilote.
