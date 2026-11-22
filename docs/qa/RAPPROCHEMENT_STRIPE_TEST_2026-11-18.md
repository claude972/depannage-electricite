# Rapprochement du paiement Stripe TEST — 18 novembre 2026

Dossier `INT-5B12D9`, recette uniquement. Opérations exécutées le 19 novembre UTC (soir du 18 en Martinique), via les parcours administrateur existants, sans changement de code applicatif ni nouvelle transaction Stripe.

## Résultats vérifiés

- Capture de **13 020 centimes EUR** qualifiée par la chaîne Checkout → PaymentIntent → Charge ; preuve persistée, réponse HTTP 200.
- Commission de **2 213 centimes EUR** qualifiée via la Fee Stripe, son paiement connecté et sa transaction d’origine. Aucun remboursement observé. Le taux figé du Checkout reste inchangé.
- Bouton « Rapprocher les règlements » exécuté : deux règlements synthétiques en attente inscrits dans `platform_ledger_entries`, dont **13 020 centimes** pour ce dossier et **10 850 centimes** pour un autre dossier de recette. Aucun règlement en attente après exécution.
- Rejeu des qualifications et du rapprochement : une seule preuve par objet, deux écritures de règlement au total, aucun doublon.
- Transfert signé de 13 020 centimes : comparaison en lecture avec la charge qualifiée, le compte destinataire, le mode test et la devise ; concordance constatée, sans annulation. Note de revue enregistrée via l’interface : observation passée de version 1 à 2, résultat historique conservé `needs_review / unlinked_transfer`.

## Portée comptable

La preuve de commission n’est pas une écriture `commission_withheld`. Aucune écriture de commission n’a été fabriquée ni aucun taux global ajouté. Le rapprochement ne crée pas d’estimation de commission sans paramètre serveur configuré.

Le matcher historique ne rapproche les transferts que par `guest_settlements` et classe les frais en `fee_reference_not_bound`. Les observations historiques peuvent donc rester `needs_review` malgré les preuves complémentaires. Aucun statut `matched` n’a été forcé. Ce contrôle manuel ne prétend pas corriger le rapprochement automatique Checkout, ni attester un versement bancaire.

## Activation temporaire et restauration

Les deux portes de qualification étaient fermées : contrôle SQL à false et variable preview absente. Activation temporaire, redéploiement du candidat (206 sources identiques), qualification via le compte administrateur synthétique existant, puis contrôle SQL refermé, variable preview supprimée et alias restauré vers `bswte5fe6`. Aucune modification de MFA, des scopes ou du mode live.

Contrôle indépendant Codex après restauration : alias et candidat répondent HTTP 200, mêmes 17 scripts. Preuve locale : `preuves/alias-apres-rapprochement.json` dans le dossier de livraison Codex.

## Validation locale

Après installation conforme au lockfile, 14 tests ciblés passent : `checkout-charge-proof.test.ts` et `checkout-fee-proof.test.ts`. Ils couvrent références exactes, montant/mode/destination erronés, permissions, origine, révocation et reprise sans doublon. Ils complètent les observations hébergées ci-dessus.
