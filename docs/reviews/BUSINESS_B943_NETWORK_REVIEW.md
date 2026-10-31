# Revue fenêtres réseau Business — b943b45

SHA exact `b943b458e1edc0ac9cdac1a380935d1b96a82ad0`, contrat§20a815881 antérieur au code. Snapshot figé `/var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-business-b943-review-g0ilsy_6`. Aucun cloud ni fichier app/test auteur modifié.

**Verdict : correction du fauxFAIL driver confirmée, mais P2 restant sur la preuve d’absence d’émission UI ; garde de contexte de fenêtre également à ajouter.**

## P2 BUSINESS-NETWORK-001 — un POST UI en vol est invisible

`scripts/qa-business/lib/network.mjs:29–32` ne regarde que h.network. Le vrai newPage (`scripts/qa/lib/browser.mjs:52–63`, lu sans modification) n’y ajoute les requêtes qu’à response ou requestfailed, pas lors de request. Une mutation réellement émise pendant la fenêtre mais dont la réponse arrive après l’assertion est donc comptée zéro et la preuve est marquéePASS. Le statut ne doit pas intervenir dans une assertion «aucune émission» ; une requête encore sans statut doit déjà la faire échouer.

Reproduction indépendante sur le VRAI newPage, avec seulement un navigateur/context/page EventEmitter simulé sans réseau : baseline0 ; événementrequest POST/api/site-operations ; assertNoUiWrites renvoie `{window_from:0,observed:0}` (PASS). L’événementresponse403 du même POST ajouté ensuite fait enfin lever AssertionError. Script `/tmp/depannage-business-b943-network-repro.mjs`.

Attendu : observer les émissions de requêtes de la page pendant cette fenêtre (dans le helper propre au lot si browser partagé demeure RO), et refuser immédiatement toute méthode mutante/appAPI sans attendre sa réponse. Garder le traitement séparé des sondesdriver déjà terminées. Testbarrière requestUI puis réponse retardée : refus avantla réponse, pour403/200/échec également.

## Contexte de fenêtre non validé — footgun reproduit

La baseline ne contient qu’un index sans propriétaire, et assertNoUiWrites ne contrôle ni provenance, ni bornes, ni index présent. Une baseline issue d’un autrehandle de log3GET utilisée avec un log1POST200 donnePASS `{window_from:3,observed:-2}` ; `{}` avec logvide donnePASS avecobservedNaN (JSONnull). Ce n’est pas un problème dans le flux lexical des deuxcallers actuels, qui réemploient le mêmeh, mais le helper accepte une preuve sans contexte/une faussefenêtre contrairement au contrôle demandé.

Lier chaque fenêtre au handle/page/log d’origine et refuser une fenêtre absente, étrangère ou dont l’index n’est pas un entier compris entre0 et la longueurcourante. Ajouter les tests explicites ; ne pas présenter une fenêtre invalide commePASS. Même script de reproduction.

## Éléments conformes

- Driver403/404 et0événement métier restent assertés avantbaseline ; aucun changement de droitserveur ni d’attente de refus.
- settledBaseline attend l’apparition de toutes les réponses mutantesdriver attendues avant de figer l’index ; l’événementdriver tardif testé est bien placé avantfenêtre. Extra mutation durant cettephase provoque échec ; observationdriver manquante finit en anomalie, jamaisPASS.
- Indexretourné est gelé, et les méthodes mutantes présentes dans le logaprèsindex échouent quel que soit leurstatut. Filtre b2bstatus!=403 supprimé.
- Callersdocs/b2b créent la fenêtre après sondes et avantnavigationUI ; client/lecteur démarrent aprèsconnexion, sanssondesdriver. Variableswindow null ne sont pas utilisées après une étape échouée : le scénario se termine.

## Vérifications

`QA_BUSINESS_4C_HTML=/tmp/depannage-public-4c-home-private.html tsx --test tests/qa-business.test.ts` : **53PASS,0échec,0SKIP**, dont vraiHTML4c déjà privé surdisque, gardehorloge précédente et deuxnouveaux tests driver/UI. Syntaxe network.mjs : PASS. Reproductions supplémentaires ci-dessus montrent les lacunes, non comptées commePASS.

Aucun navigateur réel, fetch, cloud, compte, credential, modification desrésultats historiques ou sourcepartagée. Le13PASS/1FAIL précédent demeure historique ; cette revue ne requalifie ni ceFAIL ni son cleanup.
