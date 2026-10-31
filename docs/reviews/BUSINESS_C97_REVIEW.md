# Revue Business QA — c97a018

SHA exact `c97a018378d49cbe66f268f3d7a034bc5343288e`, brancheclaude/web-qa-business propre à l’ouverture. Revue source figée dans `/var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-business-c97-review-lcmvn2q_`. Aucun cloud/credential/compte/build ni source auteur modifiée. Les résultats historiques947 restent des échecs/nonpreuves, jamais réécrits.

**Verdict : correction nominale de stop confirmée, mais deux P2 résiduels avant feu de relance live.**

## P2 BUSINESS-STOP-001 — timeout de drain laisse commencer les suppressions avec producteurs en vol

`run.mjs:178–190` utilise createLifecycle avec drainTimeoutMs=options.timeoutMs, sans garde supplémentaire. `scripts/qa/lib/lifecycle.mjs` attend le drain mais, si pending>0 à la borne, logue puis appelle quand même cleanup ; il ne fait que marquer le résultat incomplet après les suppressions. La fermeture navigateur dans makeRunCleanup ne termine pas nécessairement une création Auth/service déjà partie. Une création suspendue peut donc aboutir et écrire un ID pendant/après la collecte et les suppressions, précisément le chevauchement que cette correction doit éviter.

Reproduction indépendante avec le vrai lifecycle exact du snapshot : un producteur enregistré non résolu et drainTimeout5ms donnent `[{cleanupWhilePending:1},{drainTimedOut:true,cleanupOk:false}]`. Script `/tmp/depannage-business-c97-drain-repro.mjs`. Ce n’est pas une mutation cloud ; le résultat prouve l’ordre local.

Corriger dans la propriété business : si drain incomplet, fermer/arrêter ce qui peut l’être, conserver manifeste et état incomplet, **ne pas lancer de suppression** tant que les producteurs ne sont pas prouvés terminés. Ajouter un test de timeout avec création tardive, zéroDELETE et manifeste conservé. Ne pas modifier le lifecycle partagé sans ownership. Le test ajouté couvre seulement la résolution avant timeout.

## P2 BUSINESS-STOP-002 — RPC direct démarre après stop si le token était encore lu

`scripts/qa-business/suites/b2b.mjs:355–360` vérifie le gate au début du step, puis attend sessionAccessToken, puis lance directement userRpc(save_site_equipment) sans nouveau gate.check. Si SIGINT arrive durant la lecture du cookie, le POST mutateur démarre après stop. Il contourne post(), guardWrites et la promesse que tout mutateur vérifie le gate immédiatement avant appel. Le fait que ce probe attende42501 ne justifie pas de le lancer pendant arrêt.

Ajouter gate.check immédiatement après récupération du token et avant userRpc, ou injecter un wrapper mutateur commun. Test barrière lecturetoken→stop→résolution : zéroRPC. Il s’agit d’un chemin source explicite ; aucune requête distante exécutée pendant la revue.

## Corrections confirmées

- guardReport refuse un nouveau scénario une fois stopping, vérifie chaque début de step et enregistre la promesse complète du scénario dans le gate. Au stop nominal, le scénario courant termine au prochain step ; les scénarios suivants ne démarrent plus et la boucle de suites s’arrête. Créationsfixtures déjà enregistrées, serviceclient mutateur guardWrites, probesPOST et boutons qui soumettent les mutations ajoutent des vérifications locales. Le drain normal attend le scénario avant cleanup unique ; anomalieStopRequestedError ne devient pasPASS.
- Navigation client documents corrigée : ouvre le dossier puis clique le vrai bouton Consulter/Voir le devis ; attend et vérifie EXACT #quote/<quoteId> avant de retourner le panneau Documents du devis et avenants. Pas de deep link employé pour remplacer ce parcours nominal ; les liens tiers directs restent probes de refus. Acceptation passe par le bouton et confirmation visibles ; aucune route de paiement introduite.
- Diagnostics du premier step en échec capturés avant propagation/finally de fermeture : screenshot etJSON privés0600, texte main borné/redacté, URL sansquery, réseau méthode/path/status ; FAIL conservé. Une erreur de capture ne masque pas le défaut.
- La correction4edf de validation email cohorte/Auth et cleanup durable n’est pas modifiée ; ses tests adverses restent verts dans la suite complète. Aucun nouvel élargissement de sélectionDELETE dans ce checkpoint.

## Vérifications réellement exécutées

Snapshot exact, caches existants : `tsx --test tests/qa-business.test.ts` **35PASS,0échec**, dont stop nominal, diagnostics privés, protections intent/cohorte/cleanup/PDF précédentes. Syntaxe `node --check` des quatreJS modifiés : PASS. Un premier lancement de snapshot incomplet manquait tests/documents/harness ; dépendance de test copiée depuis le mêmeSHA puis suite exécutée avec succès, sans changement de source. Repro drain timeout ci-dessus.

Aucun build ou recette navigateur distante. La sonde initiale1a77 n’était pas reconstruite selon root : ne pas relancer sur l’ancien build et attribuer un résultat au nouveau code. La nouvelle navigation/présence du panneau et les contrôles réels restent à vérifier par root après rebuild et correction des deux points. Les captures/diagnostics ne remplacent ni preuve de SHA servi ni readbacks0 au cleanup.
