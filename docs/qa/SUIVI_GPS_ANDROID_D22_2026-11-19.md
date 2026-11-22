# Suivi GPS Android — D22 — 19 novembre 2026

## Périmètre et décision

Fixture dédiée INT-D0FA86, compte artisan synthétique, émulateur Android API36. Destination et position fictives à Fort-de-France ; aucun appareil physique, paiement ou déplacement réel. Vérifier permission, partage, cloisonnement, arrêt et péremption ; ne pas assimiler ces contrôles à une recette complète carte/ETA ou iOS.

## Défaut et correction

Après la permission Android, Expo affichait une seconde fenêtre demandant la précision améliorée réseau. Cette fenêtre désactivait l’écran et déclenchait l’arrêt prévu du partage. Le premier harnais ne traitait pas cette fenêtre : son délai dépassé ne prouvait pas à lui seul une panne serveur. Le candidat intermédiaire a permis d’observer cette cause et n’est pas déclaré validé.

L’acquisition utilise désormais la précision GPS High sans ouverture automatique du dialogue de réglages réseau (`mayShowUserSettingsDialog: false`). L’autorisation foreground reste obligatoire. Les gardes de focus/activité sont synchronisées dès les événements, et un retour hors écran après autorisation donne une erreur explicite au lieu d’un retour silencieux. L’arrêt en arrière-plan demeure actif.

## Preuves

- Refus de permission : message explicite, aucun partage ni départ enregistré (contrôle préalable).
- Nouveau binaire D22, permissions retirées puis accordées « Only this time » : bouton d’arrêt présent, position synthétique fraîche relue côté client, tiers refusé 404.
- Passage HOME : partage arrêté, position inaccessible côté client.
- API recette : démarrage par le client refusé 403 ; point synthétique daté de 50 secondes d’abord frais puis périmé et masqué ; rejeu d’un point après arrêt refusé 409. État final arrêté. Preuves `tracking-server-guards-d22-20261119.json` et `.log`.
- TypeScript mobile et compilation Android réussis.

Preuves externes : `android-tracking-share-d22-v2-20261119.log`, `android-tracking-shared-d22-20261119.json`, `android-tracking-background-stop-d22-20261119.json`. Les journaux des essais intermédiaires restent conservés.

## Limites

La carte, l’itinéraire IGN et l’ETA n’ont pas encore été vérifiés dans ce passage. Le binaire n’est pas distribué aux stores. Aucun service de précision réseau n’a été activé pour passer le test.

## Complément iOS APFS

Compilation D22 et connexion artisan réussies. Autorisation de localisation préaccordée par simctl, coordonnées fictives identiques : le test ne prétend donc pas avoir joué la fenêtre de permission iOS. XCTest `ios-tracking-share-d22-v2-20261119` réussit : bouton de partage puis arrêt présent, passage HOME. La relecture API concomitante confirme position fraîche, tiers 404 puis partage arrêté et position masquée. Preuves `ios-tracking-fresh-d22-20261119.json`, `ios-tracking-stopped-d22-20261119.json`, `ios-tracking-api-d22-20261119.log`. Le premier harnais glissait sur une marge sans faire défiler la page ; geste corrigé sans changement applicatif supplémentaire.

## Itinéraire fournisseur

Appel réel de l’API de recette avec position et destination synthétiques : HTTP 200, source IGN Géoplateforme / BD TOPO, session et séquence concordantes, 360,643 m / 84,628 s, sans trafic temps réel. Le partage de cette session API a été arrêté après le contrôle. Preuve `tracking-route-d22-20261119.json`. Cela vérifie le calcul fournisseur ; la carte et son rendu restent une preuve distincte.

## ETA visible côté client iOS

`ios-client-eta-d22-v3-20261119` réussit : estimation IGN présente et `isHittable` vrai, puis disparition de l’estimation et message d’indisponibilité après arrêt de la session synthétique productrice. Aucun partage n’est laissé actif. La position de ce contrôle est émise par le harnais API artisan, pas par un appareil réel.

Le premier essai vérifiait seulement l’existence dans l’arbre et une fenêtre de sauvegarde de mot de passe masquait l’écran : il n’est pas retenu comme preuve visuelle. Le deuxième essai, fenêtre refusée, n’a pas reçu l’ETA dans les 45 secondes ; un appel de diagnostic a confirmé le quota applicatif 429. Le troisième utilise des points synthétiques espacés de 30 secondes et attend jusqu’à 80 secondes, puis vérifie aussi le retrait. Cela valide le rendu nominal et son retrait, pas la disponibilité permanente sous quota. Preuves : `ios-client-eta-d22-v3-20261119.redacted.log`, `ios-eta-fixture-d22-v3-20261119.log`.
