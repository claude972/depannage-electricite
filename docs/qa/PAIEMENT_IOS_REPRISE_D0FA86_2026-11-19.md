# Paiement iOS : refus et reprise — INT-D0FA86

## Cadre

Recette exclusivement Stripe TEST, dossier et identités synthétiques, 108,50 EUR (devis de fixture 100 EUR HT + TVA de test 8,5 %). Aucun taux commercial décidé et aucun paiement LIVE. Binaire iOS source 0c11a1a, incluant le retour navigateur D14 et la correction de réception iOS.

Les cartes interactives de refus générique et de succès proviennent de la [documentation de test Stripe](https://docs.stripe.com/testing#declined-payments), consultée le 19 novembre 2026. Aucune carte réelle n’est utilisée.

## Contrôles déjà vérifiés

- Checkout ouvert depuis le dossier natif ; domaine checkout.stripe.com, bannière « Environnement de test », montant 108,50 EUR. Une ligne de paiement pending dans INT-D0FA86.
- Carte de refus générique : Checkout affiche « Votre carte a été refusée. Essayez une autre carte bancaire. ». Le dossier reste completed, l’unique ligne de paiement reste pending, paid_at nul.
- Le premier harnais échouait sur une énumération d’éléments pendant le chargement, puis un essai de saisie sans focus ; ces échecs de conduite ne sont pas attribués à l’application. Les captures et la relecture serveur confirment l’ouverture effective.

Preuves externes : `ios-checkout-before-receipt-20261119.png`, `ios-checkout-pending-d22-20261119.json`, `ios-stripe-decline-d22-v2-20261119.redacted.log`, `ios-stripe-declined-d22-20261119.png`, `ios-stripe-declined-state-d22-20261119.json`.

## Reprise et retour vérifiés

- Même Checkout repris avec la carte de succès fictive. Une première tentative du harnais a été bloquée avant clic par le clavier ; après fermeture du clavier et clic effectif, Stripe a confirmé le succès.
- Relecture serveur : dossier `paid`, exactement une ligne de paiement `a7a69f49-95a8-419d-bbec-e639d93aa3c1`, 10 850 centimes, `paid_at` = `2026-11-19T15:41:57.292463+00:00`. La ligne est celle qui était pending avant et après le refus : aucun deuxième paiement créé.
- XCTest `testSuccessfulNativeReturnD22` réussi : lien « Revenir à mon dossier dans l’application mobile », disparition de la vue navigateur et présence de « Numéro de commande · INT-D0FA86 ». Le retour succès D14 est donc vérifié sur le binaire 0c11a1a.

Preuves : `ios-stripe-success-submit-visible-v2-20261119.redacted.log`, `ios-stripe-success-d22-20261119.json`, `ios-stripe-success-return-d22-20261119.redacted.log`.

## Limites

Le rapprochement opérateur de ce nouveau paiement et sa commission ont été contrôlés séparément, avec rejeux sans doublon : voir `RAPPROCHEMENT_INT_D0FA86_2026-11-19.md`. Aucun paiement LIVE, reversement bancaire, remboursement, carte réelle ni scénario Android Checkout supplémentaire n’est revendiqué.
