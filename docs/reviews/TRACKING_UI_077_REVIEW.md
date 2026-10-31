# Revue UI GPS — 22dd419 + 0778532

Source finale exacte `0778532de64240149aa7e29a4119990d78208041` (feuilles `22dd419` incluses), checkout shared initialement propre. Snapshot git archive figé : `/var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-tracking-ui-077-review-wi2o4vn9`. Aucune source app/test modifiée ; aucun navigateur, cloud, GPS, compte, installation ou build.

**Verdict : corrections requises avant feu intégration ; trois P2 actionnables.**

## P2 TRACKING-UI-001 — start en attente peut démarrer le GPS après masquage

`components/features/tracking/model.ts:445–449` retourne immédiatement si aucun watch/session local n’existe encore. Pendant l’await du start serveur, ces deux champs sont précisément absents ; hidden ne change donc pas la génération. La réponse du start est ensuite acceptée et appelle watchPosition même si la page est restée masquée. Le branchement réel visibilitychange de `artisan-tracking-panel.tsx` utilise cet interrupt.

Reproduction indépendante exécutée sur le vrai ShareController du snapshot : start suspendu → interrupt("hidden") → résolution start → `{watchesAfterHidden:1,watching:true,commands:["start"]}`. Script `/tmp/depannage-tracking-077-hidden-repro.ts`. Corriger l’annulation/génération pour tout start en vol, gérer l’arrêt au mieux d’une session créée tardivement et empêcher un nouveau watch tant que la page est masquée. Test barrière start/hidden/résolution ; aucune collecte ni reprise cachée.

## P2 TRACKING-UI-002 — polling relance l’itinéraire trop vite et ignore le backoff

`components/features/tracking/tracking-card.tsx:88–102` : recompute dépend de snapshot entier, et l’effet qui dépend de recompute appelle immédiatement ce callback. Chaque réponse du polling15s crée un nouveau snapshot/callback et relance l’effet, même si session/versions/seq sont identiques. La minuterie30s est ainsi réinitialisée et n’impose pas un intervalle minimal : demandes aux environs0/15/30s au lieu d’au plus une/30s. Le retry_after_s du provider est seulement affiché (`:84`/model.routeFailureMessage), sans échéance de blocage ; un quota60s peut être redemandé au polling suivant ou par le bouton.

Corriger avec une échéance réelle et un garde partagé automatique/manuel, une seule demande en vol, dépendances de contexte stables ; conserver la règle409 nouvel état seulement. Tests avec horloge/polling d’objets identiques et503 retry60 : zéro nouvel appel avant échéance. Ce constat est établi par les dépendances et les effets source ; aucun test de hooks montés n’a été exécuté.

## P2 TRACKING-UI-003 — zoom minimum empêche de cadrer les marqueurs sur mobile

`components/features/tracking/model.ts:fitView` (boucle MIN_ZOOM11 et retour forcé au dernier tour), `tracking-map.tsx` zoom-out désactivé au minimum. Un trajet dépassant le cadre au zoom11 reste hors champ et l’utilisateur ne peut pas dézoomer pour le voir. Reproduction exécutée avec deux points QA `[-61.07,14.60]`/`[-60.87,14.47]`, viewport288×220 : zoom11, marqueurs x=-1.6356 et289.6356 ; même leurs centres débordent, marge40 ignorée.

Permettre un zoom adapté à l’étendue des points ou un minimum plus bas, préserver marge et espace des contrôles. Tester un trajet long à360 et les coordonnées projetées de chaque marqueur dans la zone utile.

## Éléments conformes vérifiés

- watchPosition seulement après clic de consentement et succès start ; refus/null ne créent pas de watch. Stop/arrived/dispose après watch actif coupent localement la géolocalisation et invalident les callbacks. Partage sans file offline ; précision250m, ancienneté60s, seq et intervalle5s.
- Reprise après rechargement : stop ancien identifiant/version, consentement, puis start nouveau ; refus stop relit sans start automatique.
- Position stale/stopped sans coordonnées affichées ; route visible seulement si état fresh et session/control_version/point_seq/destination_version identiques. Arrivée calculée exclusivement à partir de calculated_at+duration_s du provider.409 bloque le même état puis relit ; aucun ETA de secours inventé.
- Destination manuelle validée ; candidat jamais choisi automatiquement ; consentement avant mutation, avertissement d’arrêt du partage, controls absents en lecture seule. Carte sans onPick lorsque readonly. Droits issus du snapshot serveur ET autorité coque.
- Raccordement : client tracking par dossier lié au propriétaire de bundle capturé à construction. Ancien bundle refuse avant requête et résultats périmés null ; leaf key identité/organisation/site/dossier. Capacité JSON404/503 avec reason indique seulement contrat présent, ne crée pas de droit. API conserve reason/retry_after_s borné. Mode démo client refuse tout appel et données sans route dans trackingDemo.
- Carte : tuiles seulement intersectant le cadre, URL OSM fixe, pas de bulk/offlinecache, attributions OSM et itinéraire visibles, annonce schéma si toutes tuiles échouent, marqueurs/tracé SVG. Captures fournies tracking-card-360 et tracking-artisan-360 ouvertes : contenu lisible et attribution visible. Elles portent sur fixtures feuilles ; leur ETA de démonstration ne prouve pas le raccordement077 ni un provider réel.

## Contrôles exécutés et limites

`tsx --test tests/ui/tracking-model.test.ts tests/ui/tracking-wiring.test.ts tests/ui/identity.test.ts tests/ui/features.test.ts` : **50 PASS,0 échec**. `tsc --noEmit --incremental false` : **PASS** sur snapshot. Reproductions indépendantes hidden/start et projection ci-dessus. Les50 tests couvrent helpers/contrôleur/clients ; ils ne montent pas les effets React, d’où les défauts d’ordonnancement non détectés. Les455 tests annoncés par l’auteur n’ont pas été rejoués et ne sont pas revendiqués.

Aucun parcours navigateur intégré, permissionGPS physique, veilleOS, app mobile, provider, quota partagé ou recette backend réelle exercé. La revue ne remplace pas les gates SQL019/020, scheduler ou recette en ligne root.
