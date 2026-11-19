# Correctif du rapprochement Checkout — 19 novembre 2026 UTC

## Problème et comportement corrigé

Les paiements Checkout étaient confirmés, mais le rapprochement des observations Stripe ne savait associer que les règlements invités. La preuve de commission qualifiée séparément ne créait pas l’écriture `commission_withheld`.

Le webhook signé relit désormais Session → PaymentIntent → Charge → Transfer et Application Fee. Le serveur compare ces références, le mode, la devise, le compte destinataire, la capture et les montants avec le Checkout payé et figé. Une transaction privée associe les observations et inscrit une seule commission, identifiée par la Fee, avec historique. Le taux n’est pas inventé ou recalculé depuis un paramètre global.

Les deux ordres d’arrivée, les réponses perdues et les événements dédupliqués reprennent la vérification. Une liaison fournisseur incomplète reste rejouable ; une reprise de transfert ou un remboursement de commission reste à examiner. Les anciennes preuves et les règlements invités conservent leurs contrats.

La reprise est disponible dans Finance → Preuves, par paiement, et depuis la revue d’une observation. Elle exige les droits financiers, revalide la session après les lectures fournisseur et vérifie encore les droits dans la transaction. L’interface protège les changements de cible et d’identité contre les réponses tardives.

## Validation du code

- TypeScript strict : PASS.
- Tests applicatifs ciblés : **45 PASS, 0 échec, 0 ignoré** (chaîne fournisseur, webhooks réellement signés en test, reprises HTTP, contrats et contrôleurs UI, anciennes preuves).
- SQL Checkout : **88 contrôles PASS**.
- SQL indépendant adversarial : **37 contrôles PASS** (références nulles/fausses, modes, montants, permissions, rejeu, remboursement ultérieur et arrivée partielle des preuves).
- SQL historique rapprochement : **45 contrôles PASS**, 133 migrations appliquées en base isolée.
- SQL historique preuves de capture : **78 contrôles PASS**.
- `git diff --check` : PASS.

Les tests SQL utilisent PGlite avec Auth/Storage simulés. Ils ne valent pas vérification cloud. Les scénarios montés Chromium non disponibles sur le Mac Codex ne sont pas comptés comme réussis. La vérification de l’interface déployée reste exigée.

Migration additive : `supabase/migrations/20261119120000_checkout_provider_link.sql`. Aucun backfill aveugle ; les observations existantes changent uniquement par la reprise applicative validée. Aucun paiement, transfert, remboursement ou facture Stripe créé par le correctif.

## Livraison et preuve en ligne

À ce point du journal : code validé localement ; build et déploiement de recette, reprise du paiement INT-5B12D9 et vérification du registre **en cours**. Aucun résultat cloud supplémentaire n’est annoncé ici. Cette section sera complétée avec le déploiement exact et les résultats constatés.
