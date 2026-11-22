# Validation Checkout en français — observation O12

La route exposait le message Zod par défaut en anglais pour un corps mal formé. Elle utilise désormais un message français uniforme pour les erreurs de champs : « La demande de paiement est invalide. Réessayez depuis le devis concerné. »

L'utilitaire de validation accepte un message facultatif ; les autres routes gardent leur comportement. Aucun droit, montant, état ou appel fournisseur modifié.

16 tests Checkout/refus réussis. Le nouveau test vérifie objet absent, devis absent ou invalide, option native incorrecte et montant injecté : 422 en français et aucun appel financier. TypeScript réussi. Vérification en ligne réussie : trois requêtes mal formées renvoient 422 avec le message français sur la preview jkqt3t8ze, déploiement dpl_7nvSBppJNAKb2QvDT1K3eRdZeGWU READY, source GitHub c570b1d9228832579262173aa758ff136502dd5c. L’alias de recette conserve nn2dylxph pendant l’audit responsive. Preuve : checkout-french-preview-20261119.json.
