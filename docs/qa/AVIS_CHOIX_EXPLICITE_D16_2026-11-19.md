# D16 — Choix explicite de la note

La recette web avait relevé une note de 5/5 présélectionnée dans le formulaire d’avis (O5). Le formulaire débute désormais sans note, demande de choisir une valeur et désactive l’enregistrement tant que ce choix manque. Le groupe radio est obligatoire et verrouillé pendant l’envoi ; le gestionnaire refuse également une note absente ou un envoi déjà occupé. L’affichage d’un avis existant reste conservé.

Vérification du composant réellement monté sous Chrome, aux largeurs 390 et 1280 : aucune sélection initiale, soumission sans choix refusée, choix 3/5 transmis exactement, saisie verrouillée pendant envoi, aucune erreur JavaScript. TypeScript racine réussi. Preuves : `review-explicit-d16-ui-20261119.log`, `review-explicit-d16-tsc-20261119.log`. Vérification en ligne à terminer après publication de recette.

## Régression responsive détectée avant promotion

Le candidat miupzl34h a révélé un débordement à 390 px : l’aide ajoutée à l’intérieur du fieldset participait à sa ligne flex et poussait la note 5 hors écran. L’alias est resté sur D15. La vérification montée initiale couvrait le comportement sans charger le CSS global ; elle ne prouvait donc pas l’absence de débordement.

Correction : déplacer l’aide avant le fieldset. Le contrôle monté avec le CSS global réel reproduit d’abord le débordement, puis réussit à 390 et 1280 après correction (choix explicite, refus vide, valeur exacte, verrou busy et largeur de page). Preuves `review-explicit-d16-layout-before-20261119.log` et `review-explicit-d16-layout-after-20261119.log`. Revalidation preview à effectuer sur ce complément avant promotion.
