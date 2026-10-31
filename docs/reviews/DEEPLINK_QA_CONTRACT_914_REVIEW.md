# Contre-revue contrat amendé — 914cfae

Document exact `docs/CLAUDE_DEEPLINK_QA_CONTRACT.md` auSHA914cfae, diff contre6fb13ad relu. Aucun codeapp/harnais/SQL/cloud/credential modifié ou exécuté. À la demande expliciteROOT seulement, petitcontrôle localChromium+serveur127.0.0.1 réalisé pour la faisabilité APIWebSocket ; tous deux fermés.

**Verdict : pas encore GO global du harnais. D4négatif est fermé contractuellement ; Auth devient une proposition réaliste sousconditionsB1 ; deux restesP2 sur l’oracleWebSocket et les causespréfenêtre.**

## P2-1 — oracle WS encore inexécutable par l’API annoncée

A2 exige page.on(websocket).close puis codeobservé4000. Les typesinstallés Playwright**1.64.1** (`/tmp/depannage-web-pwa-qa/node_modules/playwright-core/types/types.d.ts:23946`) définissent closecallback(WebSocket), sanscode. Surtout, l’interceptionmock peut ne produire AUCUN événementpage.websocket.

Repro réel local `/tmp/depannage-deeplink-ws-api-review.mjs` :

- Sansroute : serverupgrades1, pageWebSockets1, pageCloses1, argumentobjet sanscode ; nativeCloseEvent.code4001 et1frame.
- Avec routeavantnavigation etawaitclose4000 : hits1, closeRésolu1, serverupgrades0, **pageWebSockets0/pageCloses0**, nativeCloseEvent.code4000,0frame.

A2bloquerait donc un blocage réellement effectif en attendant un événementinexistant. Remplacementréaliste : hit exact + awaitroute.close résolu + aucun connectToServer de cettecible ; preuve native du code dans le contrôletestlocal, et événementsPage seulement facultatifs lorsqu’ils existent, pas condition obligatoire côtéapp. Le testlocal négatif sansroute prouve sonoracle. Erreurhandler/close nonrésolu/hit0 demeureBLOCKED, aucun payload enregistré.

Préciser aussi la normalisation de l’origine : credentialsSupabase est HTTPS, socket est WSS. Comparer les origins brutes ne peut pas matcher ; dériver explicitemement HTTPS→WSS etHTTP→WS (host/port conservés) avant égalité origin+path. À tester enlocal avec la même fonction deconstruction et enpur surWSS distant.

## P2-2 — une seconde de calme ne draine pas un timerfocus déjàarmé

L’addendum corrige bien départs/règlements, bootstrap et événementsdansfenêtre. Reste un fauxFAIL possible sansaucun focusDANSfenêtre : schedulerdernierrefreshterminé t0 ; focus t7 arme soncooldown àt15 ;1s de calme puisfenêtre t8..18 ; deeplink àt8 fait sa lecture, timer t15 en fait uneautre légitime. L’oracledéclare2parcause alors que le produit respecteA4. Le scheduler n’est pas un polling15s : ses timers antérieurs doivent aussi être isolés.

AvantGO, préciser soit attente d’une plage complète depuis dernièrecausefocus/visibility avec règlement+calme ensuite, soit historique descauses antérieures permettant de classer fenêtrepolluéeNONPREUVE/BLOCKED plutôt que FAILproduit. Le marqueur/observer doit être installé assez tôt pour voir lescausespréfenêtre. Ajouter ce scénario négatif au testoffline. La barrièreinflight D2 est désormais pertinente ; conserver de vrais clics et lesconditionsdisabled sans remplacer par un appel interne/API.

## P2-3 — D4 absence corrigée

(e)/(f) ajoute bien UUIDjamaisseedé :1lecture200 complète→introuvable, retourmêmeIDcontexte→0. Ce cas distingue correctement leloadednégatif ducachepositif. (g) dansuneautrepage prouve seulement uneautreinstance de mémoire ; ne pas le présenter comme preuve d’un reset de périmètre dans le même document. La garantiecontextes reste aussi couverte par les testsproduit dédiés.

D2sous--onlyD2 doit encore nommer son dossier témoin connu AVANTsession (ouêtreBLOCKED faute de témoin) : une listevide ne prouve pas que503/profilseul préserve desdonnées. Ce point peut être réglé dans l’amendement despréconditions.

## P2-4 — Auth générique acceptable sousséquencement, pas « déjà importé »

A2 reconnaît correctement que cleanup-proof.mjs n’existe pas encore et proposeB1 séparé avantB2 : cela ferme le flou d’API au niveauconception, sous réserve de **choisir B explicitement**. ROOT l’a indiqué préférable. Réserver filename/owner deB1 dansMISSIONS avantcode ; extraction par le workerTrackingexistant, pas unnouveauowner implicite. B2reste sansGO tant que SHA/APIB1 livré, revu et testé.

Le refactor paramétré doit conserver résultats/audit/manifest.cleanup_attempt/openintents et sa récupérationAuth, injection runCleanupFn etsettleSideEffects sans modifier les comportementsA7–A10. Exécuter réellement les testsTracking existants + adaptateur générique + caslostresponse/persistencefailed/crashrecovery/absenceinconnu. ManifestAuthETprofiles récupérés durables avantDELETE, pas seulementauth_users ; reprise froide recharge intents existants sansconstructeurquiécrase, chemin de commande reprise doit viser le bonrunnerdeeplink.

La sémantique annoncée est bonne : emailcanonique avantlookup, foundIDpersisté avantdelete, schémaAuth/404strict, absence ne fermejamaisintent, unknown/undrained→INCOMPLETE3. La versionexacte du futurmodule doit être épinglée ; les résultats A10 de son ancienSHA ne sont pas un PASS du refactorB1. Pas de permission d’éditer le helperCodexA7 ou sharedcleanup implicitement déduite de cette proposition.

Aucun testproduit distant, Realtimeefficacité ou liveworkspace revendiqué. Le contrôle local a lu uniquement les sources/typesinstallés et a émis des connexions127.0.0.1 ; aucune API externe, cookie, credential, fixture distante ou package installé.
