# Tableaux de devis et avenants — 19 novembre 2026

Défaut reproduit sur les parcours de démonstration client et artisan : ouvrir les prestations de l’avenant à 320 px élargissait la page de 21 px. Le tableau est désormais contenu dans une région défilable, nommée et accessible au clavier, avec indicateur de focus. Les montants restent lisibles et le tableau conserve sa sémantique.

Validation locale Chromium avec les vrais composants et styles : deux parcours, largeurs 320, 360, 390, 768, 1024, 1280 et 1440 px ; aucun débordement de page, défilement clavier effectif à 320 px, aucune erreur JavaScript ni appel API. Test `tests/ui/quote-table-responsive.test.ts` réussi ; TypeScript réussi. Cela ne constitue pas une validation en ligne de tous les écrans.

La suite générale sur la base précédente a terminé avec 2 427 réussites, aucun échec et deux contrôles ignorés faute de captures privées historiques (2 429 tests). Le correctif présent a été vérifié séparément après cette suite. Journal local : `../preuves/full-suite-finalisation-v2-20261119.log`.

L’audit responsive général reste en cours avec la session Claude existante : 72 écrans, 576 mesures initiales ; sept défauts distincts annoncés avant corrections. Ces mesures ne remplacent pas la recette des interactions ouvertes ni la vérification de la preview corrigée.
