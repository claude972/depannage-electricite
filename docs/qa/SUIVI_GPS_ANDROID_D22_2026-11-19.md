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

La carte, l’itinéraire IGN et l’ETA n’ont pas encore été vérifiés dans ce passage. Ce binaire n’a pas été testé sur iOS, ni distribué aux stores. Aucun service de précision réseau n’a été activé pour passer le test.
