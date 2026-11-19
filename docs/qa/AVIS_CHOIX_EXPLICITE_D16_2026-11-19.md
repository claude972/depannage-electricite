# D16 — Choix explicite de la note

La recette web avait relevé une note de 5/5 présélectionnée dans le formulaire d’avis (O5). Le formulaire débute désormais sans note, demande de choisir une valeur et désactive l’enregistrement tant que ce choix manque. Le groupe radio est obligatoire et verrouillé pendant l’envoi ; le gestionnaire refuse également une note absente ou un envoi déjà occupé. L’affichage d’un avis existant reste conservé.

Vérification du composant réellement monté sous Chrome, aux largeurs 390 et 1280 : aucune sélection initiale, soumission sans choix refusée, choix 3/5 transmis exactement, saisie verrouillée pendant envoi, aucune erreur JavaScript. TypeScript racine réussi. Preuves : `review-explicit-d16-ui-20261119.log`, `review-explicit-d16-tsc-20261119.log`. Vérification en ligne à terminer après publication de recette.

## Régression responsive détectée avant promotion

Le candidat miupzl34h a révélé un débordement à 390 px : l’aide ajoutée à l’intérieur du fieldset participait à sa ligne flex et poussait la note 5 hors écran. L’alias est resté sur D15. La vérification montée initiale couvrait le comportement sans charger le CSS global ; elle ne prouvait donc pas l’absence de débordement.

Correction : déplacer l’aide avant le fieldset. Le contrôle monté avec le CSS global réel reproduit d’abord le débordement, puis réussit à 390 et 1280 après correction (choix explicite, refus vide, valeur exacte, verrou busy et largeur de page). Preuves `review-explicit-d16-layout-before-20261119.log` et `review-explicit-d16-layout-after-20261119.log`. Revalidation preview à effectuer sur ce complément avant promotion.

## Candidat final et promotion

Commit distant 65d2b78b, candidat hbqmw2992 (`dpl_GRTVMnRGoduvNRXB1UheT88t8P4e`) READY ; alias vérifié indépendamment par le connecteur Vercel le 19/11. Non-régression web distante : 16/16 D1–D5/D15, zéro erreur Leaflet sur six essais, panneau D13 présent. CI 227 entièrement réussie.

Sur le premier candidat, une note 4 a été délibérément choisie et enregistrée une seule fois malgré un double clic ; tiers 403. Sur le candidat final, le dossier n’affiche plus le formulaire puisque l’avis existe. La page est vérifiée à 390/1280, mais la preuve du formulaire avec ses cinq options sur cette dernière version reste le montage local avec le CSS réel ; ne pas la présenter comme un rejeu connecté du formulaire final.
