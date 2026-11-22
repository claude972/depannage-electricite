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

Le correctif est déployé en recette depuis le commit Claude `ed22f0a5` (les neuf sources du manifeste correspondent au code revu et publié par Codex). Build Vercel **READY**, `dpl_9qgdnBYFk6brxrFd7XoAEUGmAssm`, [preview 5zggqivyj](https://domdepannage-recette-20261112-5zggqivyj-brafas-projects.vercel.app). L’[alias de recette](https://domdepannage-recette-20261112.vercel.app) résout ce déploiement, vérifié indépendamment par le connecteur Vercel. Migration versionnée appliquée et enregistrée dans la base de recette.

La reprise via le nouveau bouton a répondu **HTTP 200**. Le relevé SQL en lecture seule après reprise et rejeu constate :

- paiement TEST `6f496d43-041b-4208-93c3-6aa9e2d64be0` / INT-5B12D9 : **13 020 c**, liaison `linked`, `livemode=false` ;
- charge `ch_3UdIpeDtnDJqPYEI1ahRJxcc`, transfert `tr_3UdIpeDtnDJqPYEI1VfS3p3Z`, destination `acct_1UcWCTDtnDk5Qn8R` ;
- Fee `fee_1UdIpiDtnDk5Qn8R8RI1PqO5` : **une seule** écriture `commission_withheld`, **2 213 c** ;
- observation Fee `matched / linked_checkout_fee`, version 2 ; observation Transfer `matched / linked_checkout_transfer`, version 3 ; deux réassociations historisées ;
- deux règlements `payment_settled` inchangés : 13 020 c et 10 850 c, total **23 870 c** ;
- porte des anciennes preuves `charge_proof_enabled=false`.

Les preuves privées expurgées sont conservées sur disque externe dans `preuves/correctif-checkout/` du dossier de finalisation Codex ; notamment `etat-avant.json` et `etat-apres.json`. Aucun nouvel encaissement Stripe n’a été effectué. Les réponses HTTP expurgées confirment `commission=recorded` puis `commission=existing`, sans nouvelle réassociation. Droits en ligne : particulier refusé HTTP 403 sur reprise et détail d’observation ; sans session, reprise refusée HTTP 401. La capture du résultat du bouton montre « commission déjà inscrite (aucun doublon) ; observations réassociées : 0 ». Les captures restent dans la livraison privée.

La capture `observations-liste.png` confirme visuellement les deux associations. Les versements bancaires agrégés et un transfert de test antérieur non lié restent à examiner : ils ne sont pas confondus avec le paiement cible ni artificiellement répartis entre dossiers. Le correctif ne constitue pas une preuve de réception bancaire.
