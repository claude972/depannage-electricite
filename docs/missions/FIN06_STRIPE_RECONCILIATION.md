# FIN-06 — Rapprochement complémentaire Stripe Connect

Astra propriétaire backend unique, branche codex/stripe-financial-reconciliation depuis e4dd8e1. AGENTS/DESIGN et skills fastsplit/Supabase appliqués. Docs Stripe officielles Connect webhooks, Event types, Transfer/Payout consultées le 7 novembre 2026. Aucun Stripe réel, clé, transaction ou cloud.

Plan : recevoir les familles financières signées hors Checkout dans un registre privé d’observations. Rapprocher uniquement les transferts dont identifiant, charge source, compte destinataire, montant et devise correspondent au ledger existant de règlement capturé. Événements sans cette preuve (notamment payouts agrégés, commissions et litiges) conservés à examiner. Paiement client, transfert et versement bancaire restent distincts. Rejeu strict, revue opérateur versionnée avec nouvelle tentative d’association automatique, aucun rattachement forcé par metadata.

Vérification : vraie route webhook et routes opérateur, refus signature/compte/montant, SQL replay/scopes/historique, aucune mutation paiement/remboursement ; TypeScript. Contrat UI et push pour revue groupée.

## Résultat

Contrat : `docs/STRIPE_FINANCIAL_RECONCILIATION_BACKEND.md`. Événements signés transférés vers un registre privé d’observations ; association automatique uniquement du transfert déjà lié avec charge/compte/montant/devise exacts, autre famille conservée à examiner. Revue opérateur versionnée, audit et rejeu sans écriture dans les paiements/remboursements/solde.

Preuves : 45 contrôles SQL rapprochement sur 58 migrations PASS ; 10 tests handlers rapprochement/Checkout PASS ; 13 tests remboursement PASS ; 37 contrôles SQL remboursement PASS ; TypeScript PASS. Fournisseur, Auth/Storage/cron simulés ; aucun cloud, clé ou opération Stripe réelle ; concurrence multi-connexion non prouvée.
