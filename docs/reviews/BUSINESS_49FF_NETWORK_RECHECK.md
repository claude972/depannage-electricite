# Recheck fenêtres réseau Business — 49ff713

SHA exact `49ff7134197573da2148b81be406a228bb8e4f1c`, contrat02ec5b7 avantcode, checkout propre avant/après.

**Verdict borné : les deux P2 b943 sont fermés ; aucun nouveau P1/P2 identifié. Intégrable pour prochaine recette root.**

- ÉmissionUI : openUiWindow attache page.on(request) de façon synchrone avant retour du jeton et avant navigationUI. Méthode+pathname seulement, filtrage origine exacte fournie par les4callers et prefix/api/. Toute émission mutante est conservée même sansréponse ; assertion exige zéroémission ET zéromutation dans le log de réponses.403/200/statusabsent ne sont plus des filtres. Lescallbacks illisibles ne sont pas avalés en succès.
- Fenêtre : jetonopaque gelé, état privéWeakMap lié au handle d’origine et index interne ; forge/null/autrehandle/indexhorsborne refusent explicitementUiWindowError, jamaisPASS. Baselineattend les réponsesdriver attendues avant listener ; driverPOST déjàémis/settledavantfenêtre ne devient pasémissionUI, l’événementretardé couvert est inclus avantindex.
- Callers gardent les403/404 etzéroévénement métier/assertionsdonnées, pas de relaxation de droit. Aucun produit/RLS/sharedbrowser/helperA7 modifié.

**P3 trace seulement** : les deux scénariostiers conservent `ui_window_from:window.index` alors que le token est désormaisopaque : cettevaleurdevientundefined dans leurdetail. L’assertion retourne elle-même le bonwindow_from ; aucun impact sur la garde ou le verdict. Utiliser cettepreuve retournée pour le diagnostic si la trace doit être complète. Ce point ne bloque pas l’intégration.

Exécuté : `QA_BUSINESS_4C_HTML=/tmp/depannage-public-4c-home-private.html tsx --test tests/qa-business.test.ts` : **55PASS,0échec,0SKIP** ; syntaxenetwork.mjs : PASS. Inclut test portage du vrai newPage, requêteUI enattente, réponse403/200, origineétrangère/cheminhorsAPI, driverresponse tardive, fenêtres étrangères/forgées/horsborne.

Reproduction indépendante sur snapshotexact `/var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-business-49ff-review-5d7_20jh`, script `/tmp/depannage-business-49ff-network-repro.mjs` utilisant VRAInewPage avec contexte/pageEventEmitter :

- UIrequestpending puis403 : AssertionError avant ET aprèsresponse ;
- UIrequestpending puis200 : AssertionError avant ET aprèsresponse ;
- driverPOST403 settledavantfenêtre : fenêtreacceptée,0émissionUI ;
- autrehandle,{} ,null,lograccourci sousindex : UiWindowError.

Il ne s’agit pas d’un navigateur/cloud réel : aucun API, cookie, credential, compte, build ou source modifié. Les résultats historiques13PASS/1FAIL restent inchangés ; nouvelle recette et cleanup indépendant root demeurent requis.
