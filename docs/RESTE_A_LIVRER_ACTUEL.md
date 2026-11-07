# Reste à livrer — inventaire du code du 6 novembre 2026

Objectif : application entière ; seules liaisons fournisseur Stripe/SMS différées. Inventaire source, pas preuve de panne hébergée et pas reprise des anciens pourcentages. Référence initiale fe4f24c ; interfaces zones et backend copropriété intégrés depuis en3402f64.

## TVA — CLI-07 FIN-05 FIN-06

Les taux acceptés sont0/5.5/10/20 ;2.1/8.5 non représentables. Pas de conclusion sur obligation fiscale individuelle. Fallback20 encore côté actions et ancien formulaire ; draft UI récent commenceNULL.

Sources : `components/role/artisan-quote-draft.tsx:24 TAX_RATES,140 useState(null)`, `components/app/forms.tsx:496 QuoteForm useState(20)`, `app/api/interventions/[id]/actions/route.ts:24,59 tax_rate enum et ??20`, `app/api/quote-amendments/route.ts:18`, `app/api/platform-operations/settings/route.ts:7 commission_vat_rate`, `lib/features/platform-operations/invoice-pdf.ts:20; ledger.ts:16`, `lib/features/quote-documents/snapshot.ts:12`, `supabase/migrations/202610310001_initial.sql:57,214;010_quote_drafts.sql;014_platform_operators.sql;015_quote_documents.sql`.

## REPORT_TOTALS — ENT-14 ENT-15

professional_report somme le devis de base selon statut dossier ; ne prend ni avenants acceptés ni montant des paiements. Risque concret sous-compte quand règlement total inclut avenant. Le snapshot site027 corrigé ne remplace pas ce RPC.

Sources : `supabase/migrations/202610310002_professional.sql:198-209 professional_report`, `app/api/reports/route.ts GET JSON/CSV`, `supabase/migrations/202611010027_accepted_quote_totals.sql site_operations_snapshot`.

## AI_PHOTO — SYS-10

Photos déposées existent, mais aucune route/modèle/adaptateur/moteur de diagnostic IA trouvé dans app/api,lib/features,package. Pas une simple clé à renseigner.

Sources : `app/api/documents/route.ts upload/download only`, `lib/features directories: no diagnosis/AI engine`, `components/app/forms.tsx RequestForm photos only`.

## SUBSCRIPTIONS — FIN-07

Aucun plan, abonnement, droit premium ou cycle renouvellement/résiliation dans routes/modèle. Prix/conditions à définir sans inventer ; liaisonStripe seule ne crée pas ce métier.

Sources : `app/api route inventory: no subscriptions`, `supabase/migrations search: no subscription/entitlement model`, `lib/features/platform-operations/types.ts existing finance DTOs do not model plans`.

## SAVED_METHODS — FIN-08

Pas de catalogue sécurisé des moyens enregistrés ni consentement/suppression/mandat au niveauproduit. Checkout/empreinte existent ; différence avec simple configurationStripe.

Sources : `app/api/payments/{checkout,connect,status,webhook}/route.ts`, `lib/features/guest/card-hold.ts`, `no payment-method attach/list/detach route/model`.

## CARD_HOLD_EXTRA_TOTAL — CLI-07 FIN-01

Si total devis+avenants dépasse empreinte, quote_exceeds_hold refuse honnêtement. Pas de parcours nouvelle autorisation/complément ; checkout différé uniquementon_site ne résout pas card_hold.

Sources : `lib/features/guest/settlement.ts DTO reason quote_exceeds_hold`, `supabase/migrations/202611010024_guest_settlement.sql`, `lib/features/payments/checkout.ts guard begin_platform_checkout excludes held booking`.

## NOTIFICATION_DELIVERY — SYS-04 PUB-04

Notifications in-app/préférences existent. Email etpush n’ont aucun adaptateur ni file de livraison : ADAPTERS=[]. Définir un env ne suffit pas. SMS est explicitementdifféré, pas email/push.

Sources : `lib/features/notifications/channels.ts:30 ADAPTERS=[] and sendExternal`, `app/api/notifications/{route.ts,preferences/route.ts,summary/route.ts}`, `public/sw.js lacks push subscription/notification delivery handler`.

## REMINDERS — ENT-14 ENT-16 SYS-04

Aucun worker/outbox/cron de relance factures,RDV,échéances,justificatifs. Les événements de notification immédiats ne sont pas des rappels planifiés.

Sources : `components/role/enterprise-space.tsx:3304 relances non envoyées`, `supabase/migrations/202610310016_planning_notifications.sql notify triggers/preferences only`, `supabase/migrations/202610310020_tracking_retention.sql only scheduled purge cron`.

## COVERAGE_MATCHING — PUB-03 CLI-03 ART-04

Éligibilité par codepostal/catégorie/disponibilité/refus et acceptation atomique existent. Pas de territoire public configurable, distance/rayon/classement géographique ni pagination des offres au-delà100. Ne pas annoncermatchingabsent intégralement.

Sources : `supabase/migrations/202610310003_web_operations.sql:132 mission_eligible`, `supabase/migrations/202610310008_suspension_governance.sql:68 available_missions limit100`, `components/role/artisan-space.tsx:1314 Distance non calculée`, `app/api/public coverage endpoint absent`.

## PROVIDER_TEAMS — ART-12

employee_count ne représente ni entreprise prestataire ni salariés/techniciens, délégations et affectations internes. Participants dossier existants ne constituent pas annuaire équipe prestataire.

Sources : `components/role/artisan-space.tsx:280 employee_count`, `supabase/migrations/202610310003_web_operations.sql artisan_profiles`, `app/api/organizations/route.ts client organization membership, not provider workforce`.

## CREDENTIAL_REVIEW — ART-03 ADM-02

Dépôt/lien/type/expiration et approbation globale artisan existent ; décision opérateur par justificatif, motif et historique propre ne sont pas modélisés.

Sources : `components/role/artisan-space.tsx:2396 explicit comment individual review not modelled`, `app/api/artisan/route.ts link_credential only`, `app/api/admin/artisans/route.ts reads dossier; approve_artisan global`.

## SITE_MANAGEMENT — ENT-03 ENT-04 SYS-07

Sites : création+lecture limit100, budget modifiable ; pas édition/archivage complet ni pagination/count strict. Horaires et consignes globales de site non structurés ; notes contacts ne remplacent pas ces champs.

Sources : `app/api/sites/route.ts GET limit100,POST create_site only`, `supabase/migrations/202610310001_initial.sql sites fields name/type/address/budget`, `app/api/professional/route.ts set_site_budget only for site changes`.

## APPROVALS_PAYERS — ENT-02 ENT-12 ENT-16

Règle seuil/rôle + approve/reject existent ; pas compléments/suppléants/multi-approbations/réceptiontravaux ni payeur délégué différent du créateur strict. Aucun droit de payer à déduire du seul rôlemanager.

Sources : `app/api/professional/route.ts schema set_approval_rule/decide_approval`, `supabase/migrations/202610310002_professional.sql approvals`, `supabase/migrations/20261107014010_platform_deferred_checkout.sql platform_checkout_actor_can_pay exact client_id`.

## ASSET_LINKS — ENT-07 ENT-08

Registres équipements, maintenance liée équipement et zones existent ; pas liaison intervention→équipement/zone ni historique des pannes par actif. Aucune télémesure raccordée ; états actuels restent déclaratifs.

Sources : `lib/features/site-operations/types.ts Equipment/MaintenancePlan`, `supabase/migrations/202610310001_initial.sql interventions no equipment_id/area_id`, `supabase/migrations/20261107020601_site_areas.sql independent hierarchy`, `components/role/enterprise-space.tsx:2728 telemetry unavailable note`.

## CONTRACT_PRICING — ENT-13

Contrats/grilles publiées sont enregistrés/versionnés ; devis ne sont pas rattachés à une grille/version ni calculés selon contrat. Ne pas inventer règles commerciales ouprix.

Sources : `lib/features/site-operations/types.ts ContractGrid`, `app/api/interventions/[id]/quote-draft/route.ts lines+tax only`, `app/api/quote-amendments/route.ts no contract-grid reference`.

## ENERGY_CONSOLIDATION — ENT-09 ENT-15

Relevés site par site disponibles ; pas total multi-sites de consommation/périodes comparables, aucune donnée capteur. Le placeholder est exact pour le consolidé seulement.

Sources : `app/api/sites/[id]/energy/route.ts`, `components/role/enterprise-space.tsx:3263 consolidated energy unavailable`, `no organization energy aggregate route`.

## WARRANTY_ACTIVATION — PUB-06 ADM-10

request_warranty existe mais app_settings initialise false. Pas de commande opérateur d’activation/versions des conditions ; mission corrective liée non modélisée (résolutiontexte seulement). Étatcloudactuel non consulté.

Sources : `supabase/migrations/202610310002_professional.sql:39 warranty_requests_enabled false default;40 reader`, `supabase/migrations/202610310003_web_operations.sql:294 create guard`, `app/api/warranty/route.ts request/resolve`, `app/api/platform-operations/settings/route.ts only invoice_issuer/commission_bps`.

## STRIPE_FINANCIAL_EVENTS — FIN-04 FIN-06 ART-11

Remboursements/litiges/commissions SQL et demandesopérateur existent ; webhook public ne dispatch que Checkout, pas refund/application_fee/transfer/payout. Aucun exécutant refund Stripe trouvé. Ce ne sont pas de simples clés manquantes.

Sources : `app/api/payments/webhook/route.ts checkoutEventOutcome only`, `lib/payment-events.ts`, `supabase/migrations/202610310014_platform_operators.sql platform_settle_refund/platform_record_commission_withheld`, `lib/features/platform-operations/types.ts refund_execution:false`, `lib/features/guest/settlement-provider.ts existing capture+transfer for heldbooking only`.

## PAYMENT_QR — CLI-08 ART-11

Lien authentifié existe ; QR demandé par propriétaire ne se génère pas, message indisponible explicite.

Sources : `app/api/payments/link/route.ts`, `components/role/payment-link.tsx:89,202 qrUnavailable`.

## PUBLIC_OPERATIONS — PUB-02 PUB-04 PUB-08 PUB-09 PUB-10 ADM-08

Nom/exploitant/contact/territoire/barème/conditions de garantie et données juridiques à renseigner. Éditeurcommission+invoiceissuer existe dansfinance, mais pas modèle public administrable pour ces contenus ; formulaire rappel public absent. Ne pas inventer ces valeurs.

Sources : `components/role/public-site.tsx:22 PUBLIC_VIEWS,442 about placeholder,484 privacy placeholder`, `components/role/public-lists.ts LEGAL_SECTIONS/PENDING`, `components/features/platform-operations/platform-finance-view.tsx:472 Settings editor exists`, `app/api/platform-operations/settings/route.ts only2keys`.

## PRIVACY_LIFECYCLE — SYS-09 PUB-10

Pas de parcours auto export personnel/suppression de compte ni politique de conservation générale appliquée ; rétention points GPS existe. État sauvegardes/restauration fournisseur inconnu dans cet inventaire sanscloud.

Sources : `components/role/public-site.tsx:484 access/rectification/deletion/retention pending`, `app/api inventory no account-erasure/data-export route`, `supabase/migrations/202610310020_tracking_retention.sql scope GPS only`.

## Ordre actif

Reporting financier exact en correction Codex ; interface copropriété et QR local en réalisation Claude ; recette UI adresses/contacts/zones/SLA/factures sur3402f64 en cours ROOT. TVA : support explicite2,1/8,5 à ajouter à tous les DTO/SQL/documents, sans choix fiscal automatique. Sources primaires consultées : [DGFiP DOM](https://www.impots.gouv.fr/professionnel/questions/quels-sont-les-differents-taux-de-tva-applicables-dans-les-dom), [BOFiP taux territoriaux](https://bofip.impots.gouv.fr/export/pdf/5753). Les anciens taux restent lisibles dans les versions historiques.
