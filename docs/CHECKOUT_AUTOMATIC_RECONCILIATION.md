# Rapprochement automatique des paiements Checkout de la plateforme

Demande du propriétaire (18/11/2026) : corriger réellement le rapprochement automatique (charges à destination). Correctif réalisé dans le clone Claude, en répartition avec Codex (module serveur, webhook et tests serveur côté Codex ; SQL, contrat, interface et reprise HTTP côté Claude), relu par Codex (`livraison/REVUE-CHECKOUT-CODEX.md`, points 1 à 11b traités).

## Principe
- **Liaison privée immuable** `stripe_checkout_links` écrite uniquement par le serveur, à partir de relectures Stripe (`retrieve` seulement) : Session Checkout → PaymentIntent → Charge plateforme → Transfer + Application Fee. Mode (`livemode`) vérifié sur chaque objet relu et sur l'enveloppe signée.
- **Comparaison exacte** au snapshot local payé (`platform_checkouts` + `payments`) : session, montant, `fee_cents` figé, compte destinataire, charge source, devise EUR. Aucune association sur montant, email ou metadata seuls. Références JSON nulles ou mal typées refusées (22023), incohérences refusées (P0001).
- **Transaction unique** `record_stripe_checkout_link` : verrous dans l'ordre métier de la confirmation Checkout (organisation, intervention, devis, Checkout, paiement), puis objets fournisseur (verrous partagés avec l'ingestion), liaison, observations. Écriture de la commission `commission_withheld` **une seule fois** (clé = Fee, index uniques existants) ; une entrée différente existante est un refus, jamais `ON CONFLICT DO NOTHING`.
- **Deux ordres d'arrivée** : observation avant liaison (ré-association journalisée dans `stripe_financial_rematches`, version +1) ; observation après liaison (associée dès l'ingestion). Liaison partielle `awaiting_provider` si le Transfer/la Fee n'existe pas encore (jamais figée à null) : nouvelle tentative effective, y compris sur événement Checkout déjà dédupliqué.
- **Réserves** : reprise de transfert ou remboursement de commission (au moment de la liaison ou relu plus tard) → état courant `needs_review`, preuve initiale conservée, aucune deuxième commission. Événements de compte connecté, incohérents, de remboursement : à examiner.
- **Commission nulle** : aucune Fee Stripe ; liaison complète avec le seul Transfer, aucune écriture.
- **Transfert BRUT** (13 020 c) distinct de la commission (2 213 c) ; aucun net bancaire annoncé.
- **Compatibilité** : migration additive, sans backfill. Les nouveaux champs (`payment_id` du résultat, `automatic_history` du détail) n'apparaissent que lorsqu'une liaison existe ; le chemin des règlements invités est inchangé et évalué en premier.

## Reprise opérateur (dans le produit)
- **Revue d'observation existante** : après vérification des droits et de la version par `review_stripe_financial_observation` (y compris rejeu après réponse perdue), le serveur relance la même relecture/liaison ; le reçu reste celui de la revue, l'interface relit le détail.
- **Bouton explicite** « Relancer le rattachement (lectures Stripe)… » dans Finance › Preuves (identifiant de paiement), avec confirmation : `POST /api/platform-operations/payments/[id]/checkout-link` `{command_id}`.
- Droits : origine, session, `finance_read` + `finance_write` ; juste avant l'écriture, nouvelle session du même opérateur revérifiée (`beforeRecord`) ; dans la transaction SQL, verrous `FOR SHARE` sur profil et droits puis `authorized(acteur, écriture)`. Le webhook signé utilise `p_actor = null`.

## Fichiers
- `supabase/migrations/20261119120000_checkout_provider_link.sql` (Claude, revu Codex)
- `lib/features/stripe-reconciliation/checkout-link.ts`, `app/api/payments/webhook/route.ts` (Codex)
- `lib/features/stripe-reconciliation/contract.ts`, `lib/features/stripe-reconciliation/http.ts`, `app/api/platform-operations/payments/[id]/checkout-link/route.ts` (Claude)
- `components/features/finance-reconciliation/model.ts`, `reconciliation-panel.tsx`, `components/features/finance-proofs/proofs-panel.tsx` (Claude)
- Tests : `tests/sql-checkout-link-review.mjs` (Claude, 88 contrôles) ; `tests/checkout-link.test.ts`, `tests/checkout-link-http.test.ts`, adaptation de `tests/auth/stripe-reconciliation.test.ts` (Codex). Test adverse Codex `tests/sql-checkout-link-adversarial-review.mjs` (37 contrôles) dans le clone Codex.

## Vérifications
- Claude (mini) : SQL isolé PGlite — nouveau 88/88, historiques `sql-stripe-reconciliation-review` 45/45 et `sql-checkout-charge-proof-review` 78/78 ; `tsc --noEmit` sans erreur.
- Codex (runtime de Codex) : TypeScript PASS ; 45 tests applicatifs ciblés PASS sans saut ; 88 SQL + 37 SQL adverses PASS ; empreintes SHA-256 du code validé dans `livraison/CORRECTIF-REVU-SHA256.json` (vérifiées identiques avant commit).
- Test monté React du bouton (20/11) : `tests/ui/checkout-relink-mounted.test.ts` (Chromium local, StrictMode, composant réel et onglet Preuves réel) — sans droit d'écriture aucun bouton ; rien avant confirmation ; double confirmation ⇒ 1 POST ; reçu affiché seulement si paiement ET commande correspondent ; 503 / réponse perdue / reçu invérifiable ⇒ même commande ; 403 / 409 ⇒ nouvelle commande ; changement d'utilisateur ou de paiement ⇒ requête annulée et réponse tardive jamais affichée ; génération changée sans re-rendu ⇒ réponse ignorée ; 360 px clair/sombre, cibles ≥ 44 px. 2/2 PASS sur le mini ; 4 mutations (garde d'identité, garde synchrone, réutilisation de commande, contrôle de commande du reçu) chacune détectée.
- Non fait : `tests/ui/sql-phase2-lot-a-destination-fee-review` dépend d'un démarrage Next local bloqué sur le mini (binaire natif), à rejouer côté Codex.
