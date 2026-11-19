# Validation Checkout en français — observation O12

La route exposait le message Zod par défaut en anglais pour un corps mal formé. Elle utilise désormais un message français uniforme pour les erreurs de champs : « La demande de paiement est invalide. Réessayez depuis le devis concerné. »

L'utilitaire de validation accepte un message facultatif ; les autres routes gardent leur comportement. Aucun droit, montant, état ou appel fournisseur modifié.

16 tests Checkout/refus réussis. Le nouveau test vérifie objet absent, devis absent ou invalide, option native incorrecte et montant injecté : 422 en français et aucun appel financier. TypeScript réussi. Vérification en ligne attendue sur une nouvelle preview.
