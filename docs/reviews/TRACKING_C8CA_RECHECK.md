# Recheck GPS/ETA — c8ca4cc

Source exacte **c8ca4cc31c0157f246531769cd9f45cd47b464fe**, diff depuis8366c05 (http.ts, tests, contrat seulement). Checkout constaté propre au début ; tests et typecheck effectués sur un snapshot gitarchive figé hors checkout pour éviter le travail concurrent. Aucun cloud, credential, GPS physique, compte, installation ou édition source.

## Verdict borné

**TRACKING-REVIEW-001 fermé ; aucun P1/P2 restant identifié dans le correctif.** Acceptable pour intégration/revue pilote du backend. Ce n'est pas une autorisation implicite d'appliquer019 ni une preuve de concurrence ou de GPS réel.

- Route : après claimSQL, nouveau snapshot sous le JWT avant external/providerJson ; contexte intervention/lecteur/artisan/session/controlversion/seq/destinationversion doit correspondre et la position doit encore être fraîche. Le fournisseur utilise le snapshot ready autorisé, pas l'ancien avantclaim.
- Géocodage : nouveau snapshot aprèsclaim exige encore can_confirm_destination et même intervention/artisan/session/controlversion/destinationversion ; aucun point GPSactif n'est imposé à une recherche de destination explicite.
- Les contrôles après fournisseur et cachehit restent présents, ainsi que le refus de mettre en cache une réponse rendue périmée. Les quotas SQL et leurs droits serviceonly, les commandes/RLS/purges019 et le fournisseur inchangés conservent les résultats de revue précédents.
- Le contrat reconnaît explicitement que lecture finale et émission HTTP vers IGN ne sont pas une transaction atomique ; aucune révocation rétroactive d'une requête déjà partie n'est promise. Le correctif ferme l'attente évitable du quota identifiée par la revue.

## Vérifications effectuées

**15/15 unités PASS** dans le snapshot exactc8 avec cache existant. Les deux nouvelles unités utilisent les vrais loaders et une barrière asynchrone dans claim ; après révocation/stop/nouveaupoint (route) et révocation/retraitpermission/changementversion (geocode), **providerCalls=0** et refus404/403/409 attendus. Parcours nominal géocodage sans GPS, cacheisolement, postprovider revoke, SSRF/validation/timeout/stream et routes strictes restent verts.

**Typecheck ciblé snapshot exact PASS** avec config externe/cache existant, incrementalfalse et aucun fichier dépôt généré. Pas de répétition SQL isolée : aucun SQL modifié ; la revue8366 avait exécuté avec succès la matrice19migrations/RLS/triggers/pacing/rollback et son test de critère volontairement cassé. Aucun de ces tests ne prouve les courses à deux connexions, quotas réellement multiinstances, lecture de GPSmatériel, fondcarto UI, veille/background ou appel fournisseur applicatif déployé.

Rapport précédent : /tmp/depannage-tracking-8366-review.md.019 reste à relire/appliquer par root dans son propre processus de validation et après revue croisée Claude.
