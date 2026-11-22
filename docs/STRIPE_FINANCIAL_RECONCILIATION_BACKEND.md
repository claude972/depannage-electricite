# FIN-06 — Observations Stripe Connect et rapprochement opérateur

Lot backend depuis e4dd8e1. Aucun appel Stripe, clé, transaction ou déploiement réalisé. Références officielles consultées le 7 novembre 2026 : [webhooks Connect et compte source](https://docs.stripe.com/connect/webhooks), [types d’événements](https://docs.stripe.com/api/events/types), [transferts](https://docs.stripe.com/api/transfers/object), [versements bancaires](https://docs.stripe.com/api/payouts/object).

## Ce qui est effectivement rapproché

Le registre `guest_settlements` conserve déjà un identifiant de transfert et sa charge source, le compte destinataire et le montant net. Les événements signés `transfer.created`, `transfer.updated`, `transfer.reversed` peuvent donc être associés **uniquement** si ces cinq références correspondent exactement, avec EUR et capture déjà enregistrée. L’événement doit provenir du compte plateforme (pas d’enveloppe connected-account). Aucun metadata ou transfer_group ne suffit.

`matched / linked_transfer_observation` signifie **association de cette observation au transfert enregistré**, pas paiement bancaire effectué, disponibilité de fonds ou versement reçu par l’artisan. Une reprise totale ou partielle reste `needs_review / transfer_reversal`, avec le lien prouvé au dossier conservé.

Les transferts automatiques du Checkout ne sont pas associés par supposition : leur identifiant n’est pas actuellement figé dans ce registre. Les commissions et litiges reçus sont conservés à examiner sans rattachement automatique. Un payout, même paid, reste `aggregate_payout_unallocated` : son montant agrégé n’est jamais réparti entre dossiers. Aucun paiement, transfert, remboursement ou écritures de soldes ne sont créés par ce rapprochement.

## Réception authentifiée

La route existante `POST /api/payments/webhook` vérifie toujours la signature sur le corps brut et le mode test/live configuré. Elle persiste les nouvelles familles avant d’accuser réception. Le contexte du compte source est conservé ; l’absence de compte dans les événements plateforme ne masque pas un contexte explicitement connecté.

Familles couvertes : transfer.created/updated/reversed ; payout.created/updated/paid/failed/canceled/reconciliation_completed ; application_fee.created/refunded/refund.updated ; charge.dispute.created/updated/closed/funds_withdrawn/funds_reinstated.

Les références utiles sont normalisées et bornées ; aucun document, email, coordonnées bancaires, description, metadata libre ou corps Stripe intégral n’est stocké. L’empreinte SHA-256 du corps authentifié et l’événement normalisé imposent le rejeu exact. Un événement déjà enregistré ne peut être remplacé par un corps différent, y compris pour le compte source. Les contrôles Checkout et remboursements signés restent sur leur chemin existant ; un événement connected-account ne peut les contourner.

Les observations ne remplacent jamais l’état courant d’un objet Stripe : un événement plus ancien reçu après un plus récent reste une observation séparée. Aucun ordre de livraison n’est supposé.

## Contrat opérateur

Types partagés : `lib/features/stripe-reconciliation/contract.ts`.

- `GET /api/platform-operations/stripe-observations?after=<event_id>&state=matched|needs_review` : `{records,next_after}`, 50 maximum, ordre stable par identifiant (pas un solde ni un ordre bancaire). Droit finance_read courant.
- `GET /api/platform-operations/stripe-observations/<event_id>` : `{record,history,history_limited}` ; 50 dernières revues avec acteur/date/note/version/résultat. Les résultats avant et après sont conservés dans le journal privé.
- `POST /api/platform-operations/stripe-observations/<event_id>` : `{command_id,expected_version,note}` ; droits finance_read **et** finance_write courants. Recalcule l’association avec les références déjà enregistrées et conserve la note. Il n’existe aucune saisie manuelle de dossier, montant ou état pour forcer un rapprochement.

`record` : `{event,result,version,received_at}`. `event` contient id/type/family/livemode/source_account/created et l’objet normalisé (identifiant, montant/devise, charge, destination, montant repris et état observé selon famille). `result` : `{state,reason,settlement_id,intervention_id,quote_id}` ; les trois liens sont null sans preuve suffisante.

Réponse POST : `{event_id,version,result,replayed}`. UUID choisi avant soumission et conservé lors d’une reprise réseau ; la version est celle affichée. Un reçu rejoué décrit la revue passée : recharger le détail. La révocation d’un droit finance empêche aussi le rejeu. La revue peut maintenir needs_review : une note n’est pas une preuve bancaire.

Motifs : unexpected_source_account, unlinked_transfer, transfer_proof_mismatch, transfer_reversal, linked_transfer_observation, aggregate_payout_unallocated, fee_reference_not_bound, dispute_reference_not_bound. Tous doivent être présentés en langage clair, sans assimiler observation et règlement.

Réponses privées sans cache. 401 session ; 403 droits ; 404 événement absent ; 409 révision/rejeu incohérent ; 422 saisie ; 429 limite ; 503 persistance ou projection non vérifiable. Une erreur de stockage du webhook reste une erreur, pour permettre sa nouvelle livraison.

## Vérification et reste

Tests des vrais handlers avec signature/fournisseur simulés et SQL réel dans PGlite (Auth/Storage/cron simulés). Aucun événement bancaire réel ni validation hébergée ; concurrence testée par interleavings séquentiels. Les associations Checkout/commissions/litiges exigent encore un futur contrat de références immuables, les payouts une décomposition bancaire vérifiable. L’UI et la recette fournisseur restent à assembler.
