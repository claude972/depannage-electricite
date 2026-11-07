# ENT-16 — Payeur B2B délégué

Propriétaire backend unique : Astra. Branche codex/delegated-payer depuis e541656. Aucun cloud ni UI.

Plan : délégation explicite par dossier B2B, attribuée/révoquée par le propriétaire courant de l’organisation ; membre courant et périmètre du site vérifiés sans élargir la lecture. Version, commande stable et audit. Réutiliser strictement le checkout plateforme, conserver montants/webhooks/guest/card-hold. Refuser reprise après retrait ; distinguer une session bancaire déjà émise et nécessitant réconciliation de l’autorisation applicative.

Vérification : SQL nominal/refus/retrait/rejeu, vrais handlers, régression checkout et TypeScript. Contrat UI consommable avant assemblage ; recette hébergée différée.
