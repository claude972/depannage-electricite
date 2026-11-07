# Refund-execution — contrat à valider AVANT code

Base e6aa35a ; owner Codex backend unique. **PLAN SEULEMENT, aucun GO d’implémentation reçu.** Première tranche complète : émission et suivi d’un remboursement d’une demande opérateur approuvée. Dispatch application_fee/transfer/payout reste OPEN séparé : ces objets n’ont pas de ledger de correction/soldes ou de liaison fiable par paiement ; aucune sortieHTTP ne vaut un virement bancaire.

## Sources vérifiées et décision d’exploitation

Code : webhookCheckout seul ; SQL014 platform_request_refund/decide_refund/settle_refund ; ledger immuable ; checkout.ts crée une destinationcharge avec application_fee_amount et transfer_data.destination. Les demandes approuvées ne sont pas encore émises. Le règlement existant connaît une sessionCheckout mais ne fige ni PaymentIntent ni Charge.

Stripe : [refunds](https://docs.stripe.com/refunds), [create](https://docs.stripe.com/api/refunds/create), [destinationcharges](https://docs.stripe.com/connect/destination-charges?platform=web&ui=stripe-hosted), [idempotence](https://docs.stripe.com/api/idempotent_requests), [webhooks](https://docs.stripe.com/webhooks). La rétrocession du transfert et le remboursement de la commission sont deux choix financiers distincts. **Aucun choix implicite** : exiger une politique serveur explicite versionnée (reverse_transfer boolean, refund_application_fee boolean ; refund_application_fee=true implique reverse_transfer=true). Policy absente/Stripe absent/live non autorisé =>503 configuration_required avant intent et provider. Le code/test peut être terminé sans choisir cette politique ni raccorder Stripe.

## Ownership proposé (autorisation ROOT nécessaire)

- nouveaux lib/features/refund-execution/** ; POST+GET app/api/platform-operations/finance/refund-requests/[id]/execution/route.ts ; app/api/payments/webhook/route.ts dispatch refund seulement ; tests dédiés ; nouvelle migrationSQL ; MISSIONS claim.
- Migration : executions privées + RPC étroites ; protection annulation platform_decide_refund pendant émission ; durcissement platform_settle_refund pour exiger bindingexact + ledgerunique par demande/providerrefund, sans réécrire SQL014. Petit garde professional_report sur contradiction qualifiée =>503 au lieu de publier un net devenu douteux.
- Aucun components/types/shared, nouvelle dépendance, cloud/credentials, invitation, fournisseur réel ni modification des anciennes migrations. Checkout existant reste en lecture seule, hors besoin de refactoring strictement discuté ROOT.

## HTTP / autorité

POST{id, body:{command_id:UUID,expected_version:int}} sous origine+JWT+finance_write actuels. Corps strict ; pas montant, devise, bénéficiaire, compte, taux ni flags de politique navigateur. GET sous finance_read, aucun appel bancaire ni mutation : request_status + execution_status + available/reason, aucun secret/PII. No-store toutes réponses ;401/403/404,422 syntaxe,409 version/conflit/qualification,503+RetryAfter2 configuration/transport ; jamais200 payé. POST renvoie202 émis/pending/requires_action ou200 replay terminal qualifié. Le résultatHTTP Stripe ne marque JAMAIS settled : seule confirmation webhook contrôlée le permet.

## Machine / idempotence / sécurité

1. Sous verrou payment puis request, JWT validé, approved/version exacte, payment methodstripe/statuspaid/paid_at, quote/session/ledgercohérents, bornes somme des demandes réservées. Créer execution durable avant mutation provider, une par request ; UUIDcommande lié au contenu/acteur, replayexact avec droitsactuels ; demande/amount/devise/policyversion figés. Etat preparing, aucun faux débit.
2. Lecture fournisseur injectée session+PaymentIntent+latestCharge. Vérifier mode/livemode, sessionquote+ledger id, montantdevise exacts, PI succeeded, Charge paid/captured/refundability, destination et fee EXACTS au ledgerCheckouthistorique. Figer PI/charge/destination/fee ; jamais utiliser le compte artisan actuel pour reconstruire le passé. Ancienne session sans snapshot suffisant =>409 needs_review, pas devinette.
3. Revalider sous verrou avant émission et interdire toute annulation de demande tant que l’exécution peut exister chez Stripe (preparing/submitted/pending/unknown/needs_review). Refund amount issu de la demande approuvée seulement, refundsur Chargeplateforme, metadata IDs internes seuls ; aucun motiftextePII transmis. IdempotencyKey=platform-refund:<executionUUID>, toutes reprises mêmes paramètres/policy. Politique figée avant provider.
4. Après réponse perdue, garder unknown/réservation. Rejouer même clé dans fenêtre conservatrice23h ; après limite, aucun nouveauPOST : récupérationREAD par provider_id lié ou découverte paginée bornée Charge.refunds avec metadataexacte. Persister providerrefundID avant progression ; découverte incomplète/multiple/absente ne prouve pas absence =>needs_review. Aucune nouvelleUUID ne contourne une demande déjà émise. Echec confirmé ne déclenche pas de deuxième émission automatique.
5. Etats distincts preparing/submitted/pending/requires_action/failed/canceled/succeeded/needs_review. Ne pas libérer réservation au timeout ni retourHTTP ambigu. Réponseprovider immédiate succeeded reste submitted jusqu’au webhook. Demande reste approved jusqu’au settlement ; failed/canceled qualifiés sont lisibles, nouvelle tentative à traiter explicitement, jamais boucle silencieuse.

## Webhook / montants / ordre

Signaturebodybrut et taille existantes, secretabsent503 ; contrôle livemode et contexte plateforme (destinationcharges : pas event.account d’un autre compte). Dispatch refund.created/refund.updated/refund.failed, objetrefund individuel ; charge.refunded agrège plusieurs remboursements, ne jamais créditer son amount_refunded comme celui d’une demande. Checkout demeure inchangé. Autres familles encore OPEN, aucun faux succès de leur métier.

Lier refundID + metadataexecution/request/payment + Charge/PI + currency+amount EXACTS au binding durable. Cas webhook arrivé avant réponseprovider : lier par intentmetadata uniquement après qualification complète, sinon503 retry nonconsommé. Lire l’état courant du même refund via adapter pour neutraliser événements en retard ; jamais trier par event.created. Clé événement + unicité providerrefund + unique ledgerrequest protègent doublons même avec nouveaux eventIDs ; payload contradictoire=>409/quarantaine, pas deuxième débit. Pending/failed/canceled ne règlent pas la demande. Succeeded qualifié => transaction SQL unique binding+requestsettled+ledgerrefund+stripe_events.

Un failed/canceled réellement courant APRÈS succeeded impose needs_review + incident durable, sans effacer ni réécrire le ledger historique ; professional_report du périmètre concerné refuse503 tant que les fonds ne sont pas rapprochés. Aucune compensation/transfert bancaire inventé. Cette anomalie reste visible ; pas de remboursement net déclaré fiable. Les remboursements partiels multiples restent des demandes/refunds individuels dont total ne dépasse pas le paiement confirmé. Aucun avoir/facture généré automatiquement.

## Vérification prévue

Handlers réels avec providerinjecté : configurationabsente=>0provider/0intent ; scope/foreign/version/strictbody ; pending/succeededHTTPjamaissettled ; secret/signature/account/livemode/montant/PI/destination divergents ; responseperdue/mêmekey/23h/récupération paginée ; webhookavantbind ; doubleevent/doubleID ; terminalcontraire, partialrefunds, checkout régression. SQLPGlite : verrousordre, annulationbloquée, droitsrévoqués, plafondpartiels, ledgerunique, replayexact/conflit, historiquepréservé et reportrefusé sur incident. Auth/Storage/cron simulés explicitement ; aucune preuveStripe/cloud ni concurrence réseau réelle héritée.
