# Paiement natif Stripe TEST — 19 novembre 2026

## Parcours exécuté

Le dossier synthétique **INT-44B1D4** (`44b1d49b-0a8a-46ba-bc79-05019b830587`) a été créé et réalisé sur Android : attribution, devis accepté, déplacement, compte rendu avec photos avant/après, clôture et signature client. Voir `RECETTE_NATIVE_ROLES_2026-11-19.md` pour les preuves de cette première partie.

Sur le simulateur iOS, le même client a retrouvé ce dossier par sa référence, ouvert le Checkout de test affichant **108,50 €**, renseigné uniquement les données synthétiques et la carte de test Stripe 4242, puis soumis le paiement. Aucune carte enregistrée, aucun Apple Pay, aucun paiement LIVE.

## Confirmation serveur

Lecture du dossier et de `/api/payments/status` après paiement :

- paiement `71707f77-4ef0-4152-810b-11de52b7340c`, devis `4f8499c0-cf4b-4525-8900-26bbdd270e45` ;
- statut `paid`, méthode `stripe`, montant **10850 centimes EUR** ;
- `paid_at` : **2026-11-19T13:12:29.595953+00:00** ;
- **une seule tentative**, `5a60d738-52da-4649-88d5-119568e7733d`, elle aussi payée, aucun code d’échec.

Le retour Web affiche un lien vers l’application mobile et une connexion Web indépendante. Après fermeture manuelle du navigateur, l’application iOS affiche **« Règlement confirmé par la plateforme · 108,50 € · 19 nov. 2026 à 09:12 »**. Ce constat UI est complété par la lecture serveur, et non déduit du retour navigateur.

## Défaut D14 corrigé et vérifié sur iOS

Le lien de retour vers l’application est cliqué, mais le navigateur Safari intégré reste au premier plan dans le binaire D12. La fermeture manuelle permet de retrouver le dossier payé. Un correctif écoute le lien du dossier pendant l’ouverture du Checkout et ferme la feuille iOS ; il ne modifie aucun statut de paiement. Les liens d’un autre dossier et les liens ne portant pas le retour attendu ne ferment pas cette feuille. Le listener est retiré à la fermeture ou à l’échec d’ouverture. Vérification ciblée : 3 tests passent et TypeScript mobile passe. Compilation iOS réussie. Sur INT-A9155E, ouverture du Checkout TEST puis abandon par le retour marchand et clic sur le lien mobile : la feuille se ferme et le dossier exact est visible, sans fermeture manuelle. XCTest `ios-d14-cancel-return-20261119` réussi. Relecture serveur : une seule tentative en attente, `paid_at` nul. Le retour ne crée donc pas de fausse confirmation. Le premier essai d’ouverture a rencontré le dialogue système « Ouvrir dans DomDépannage » après réinstallation ; après son ouverture, le parcours réussit.

## Preuves sur disque externe

Dans le dossier `preuves/` frère du clone de finalisation :

- `native-payment-paid-readback-20261119.json` : données serveur minimales, sans clé ni URL de Checkout ;
- `ios-stripe-test-fill-20261119.redacted.log`, `ios-stripe-test-submit-20261119.redacted.log` ;
- `ios-stripe-filled-20261119.png`, `ios-stripe-after-submit-20261119.png` ;
- `ios-stripe-return-20261119.png` : retour Web avec lien mobile ;
- `ios-stripe-native-return-20261119.redacted.log` : clic, ne prouve pas la fermeture ;
- `ios-paid-dossier-read-20261119.redacted.log` : confirmation visible après fermeture manuelle, test réussi.

## Limites

Le rapprochement de la preuve fournisseur et de la commission figée est demandé dans la session de recette Web, encore à documenter. Le formulaire Stripe Android n’a pas été exécuté (premier lancement de Chrome bloqué sur son acceptation de conditions) ; le paiement a été terminé sur iOS. Cette preuve croisée ne vaut pas validation de tous les parcours natifs, ni validation de production.

## Contrôle supplémentaire et binaire D14

L'artisan affecté relit le paiement paid et une seule tentative ; le compte client tiers reçoit 404 sur le même devis. Preuve `native-paid-isolation-readback-20261119.json`. Ce contrôle ne transforme pas un paiement client en preuve de versement bancaire artisan. SHA-256 du bundle iOS D14 : `cd1e4bdf4b0862d61a8c9e9998f02fc704b87820980cf57d5ac5586aa5a70ede`.
