# Reste à livrer — inventaire du code du 6 novembre 2026

Objectif : application entière ; seules liaisons fournisseur Stripe/SMS différées. Inventaire source, pas preuve de panne hébergée et pas reprise des anciens pourcentages. Référence initiale fe4f24c ; interfaces zones et backend copropriété intégrés depuis en3402f64.

## État vérifié le 7 novembre, version `eff0061`

Les constats plus anciens restent ci-dessous pour l’historique. La preview et les rapports datés fixent la portée vérifiée.

- Les approbations, les devis et les contrats cadres dépassent les fenêtres de chargement initiales. La décision d’approbation, l’acceptation client d’un devis courant, l’ouverture d’une ancienne version entreprise et l’archivage d’un contrat ancien ont des preuves hébergées. [Approbations](reviews/DELIVERY_635_APPROVALS.md) · [Devis et contrats](reviews/DELIVERY_9E6_QUOTES_CONTRACTS.md)
- La preview `eff0061` passe l’approbation puis l’acceptation du devis exact d’un dossier entreprise ancien. Elle passe aussi les douze étapes du parcours client–artisan, de la demande à la clôture avec PDF privé. Le règlement reste attendu. [Recettes sur la version courante](reviews/DELIVERY_EFF_ENTERPRISE_DECISION.md)
- Stripe et Vonage attendent leurs accès et la recette fournisseur. Les canaux e-mail et push et la revue photo avec validation humaine disposent de code et de contrôles locaux. Leur configuration et leurs essais réels restent à effectuer. [Notifications](EXTERNAL_NOTIFICATION_OUTBOX_BACKEND.md) · [Revue photo](PHOTO_TRIAGE_BACKEND.md)
- L’activation du compte propriétaire Super Admin et sa recette positive restent différées. Les règles de conservation et d’effacement doivent être validées avant de coder l’exécution de la suppression. Le ticket d’effacement est déjà utilisable. [Demandes d’effacement](DATA_ERASURE_REQUESTS_BACKEND.md)
- La vérification PWA sur iOS et Android et la distribution native restent à faire. La reprise de brouillon a une preuve dans Chromium. Le natif suit la validation Web/PWA selon l’ordre du plan. [Ordre de livraison](PLAN_LIVRAISON_INTEGRALE.md)

## Assemblage de code du 7 novembre avant la recette

La branche `codex/full-delivery-assembly` regroupe les ajouts destinés à la recette par parcours. La dernière version vérifiée en ligne reste `610b13f`.

- L'énergie consolidée et son CSV, les rappels de rendez-vous, le rattachement d'un dossier correctif et le téléchargement des données du compte sont câblés. La demande d'effacement ouvre un ticket privé. L'effacement effectif, les règles de conservation et la restauration restent à traiter séparément.
- Les équipes prestataires ont leur accès depuis les espaces artisan, client et entreprise. Les invitations et tâches internes respectent le rôle global existant. Une réaffectation du dossier retire la tâche précédente. Une invitation antérieure au retrait ne peut pas rétablir le membre. La déconnexion et le changement de compte purgent les commandes privées de l’onglet.
- La vérification publique de la zone et l'éditeur administratif des codes postaux sont câblés et ont passé leurs tests ciblés. Le dossier entreprise affiche la gestion du payeur délégué et le bouton de paiement existant pour le membre habilité. L'artisan peut appliquer une grille autorisée à son brouillon de devis et programmer un rappel sur ses justificatifs. La finance plateforme affiche les observations du fournisseur et leur revue opérateur. Le lot `7751fa0` passe 61 tests ciblés, dont Chromium, et compile avec TypeScript strict et Webpack. La recette hébergée de ces ajouts reste à faire. La vérification du territoire informe sur la zone publiée et conserve les critères d'attribution existants.
- Les approbations ordonnées et les rappels de conformité sont raccordés à l'espace entreprise. Une politique avancée active gouverne le devis courant. La règle simple reste disponible pour les dossiers sans site et quand la lecture serveur confirme l'absence de politique active. Les réponses tardives et les refus d'autorisation ne réactivent pas l'acceptation. Le lot final passe 36 tests ciblés, dont un changement de devis avec réponses différées dans Chromium, et compile. L'émission planifiée des rappels d'échéance reste à activer et vérifier pendant la recette.
- Une URL Stripe déjà transmise relève de l'expiration du fournisseur. Le retrait d'un mandat ferme la reprise de la session de paiement dans l'application. Le registre Stripe rapproche les transferts qui correspondent aux références déjà conservées. Les versements agrégés, commissions et litiges restent à examiner dans les cas sans lien prouvé. La recette Stripe/Vonage reste la dernière étape fournisseur.
- Les modules restants incluent le classement géographique, les notifications externes, les fonctions financières avancées, le diagnostic photo et les applications natives. Les règles commerciales, les traitements de conservation et l'ouverture publique nécessitent leurs propres décisions et contrôles.
- La revue manuelle des photos est raccordée à la conversation du dossier. Le client peut ouvrir cet échange depuis ses photos lorsqu'un artisan est attribué. La fiche de mission lit les photos de ce seul dossier avec la pagination privée et les ouvre par le lien temporaire existant. Les tests couvrent un refus et une réponse arrivée après un changement de session. L'analyse automatique et son évaluation restent ouvertes.
- La file privée e-mail et push est assemblée et inactive. L’adaptateur e-mail optionnel Resend vérifie les droits, l’adresse confirmée, le bail et la limite de reprise avant l’envoi. Les 24 tests ciblés et les 64 contrôles SQL isolés passent. Il reste la configuration et la recette réelle de l’e-mail, ainsi que le raccordement du push. [Contrat de livraison externe](EXTERNAL_NOTIFICATION_OUTBOX_BACKEND.md)

La suite complète du commit `0cf7166` a donné 1 613 succès, deux contrôles facultatifs ignorés et aucun échec. Des tests ciblés couvrent les écrans et les rappels ajoutés ensuite. Le lot eac01a0 passe 52 tests ciblés et quatre suites SQL de régression. Fable 5.1 a relu les quatre migrations du lot 0cf7166. La revue a conduit à refuser les anciennes invitations après retrait et la réinitialisation d’un accord toujours valide. Les suites PostgreSQL isolées simulent Auth, Storage et les tâches planifiées. Voir les preuves en ligne du commit effectivement déployé dans le rapport de recette.

## Actualisation du 7 novembre, version `610b13f`

- La demande générale connectée a été créée et rejouée sur la preview. Le parcours public a passé les contrôles des huit fiches et de leur bouton de poursuite. Le brouillon public a été repris après retour du réseau. [Recette](reviews/DELIVERY_610B_HOSTED.md)
- L’historique des justificatifs, l’édition et l’archivage des sites, les liens entre dossier et équipements ou zones, l’éditeur de l’exploitant et l’unique carte de suivi sont intégrés. Il reste à vérifier les opérations par rôle sur ce déploiement. L’archivage ferme la création de nouvelles interventions. Certains anciens modules gardent leurs règles propres pour les données historiques.
- Le remplacement d’empreinte et l’exécution des remboursements sont intégrés, avec leurs conditions et états explicites. Restent les vérifications Stripe sur autorisation, capture, remboursement et rapprochement, et les fonctions financières supplémentaires du plan.
- La consolidation des relevés d’énergie, les versions de garantie et leurs autorisations côté serveur sont intégrées. Les interfaces de consolidation, les rappels et les essais de publication opérateur restent des lots séparés. Aucune condition opérateur n’a été publiée. [État courant](ETAT_LIVRAISON_COURANT.md)
- Restent notamment les équipes prestataires, le payeur délégué et les approbations avancées, la tarification liée aux contrats, la mission corrective de garantie, la livraison externe de notifications, la gestion de fin de vie des données, le diagnostic photo et la distribution native. Les 76 capacités et leurs preuves de sortie sont listées dans le plan. [Plan complet](PLAN_LIVRAISON_INTEGRALE.md)

## Actualisation — 6 novembre23h19 Martinique

L'inventaire ci-dessous conserve les constats initiaux fe4 ; les statuts courants suivants priment :

- TVA : corrigée, taux0/2,1/5,5/8,5/10/20 explicites sans fallback automatique ; API/SQL/UI et transaction réelle vérifiés.
- REPORT_TOTALS : corrigé, devis+avenants acceptés, paiements enregistrés et remboursements distincts ; migration réelle24046, preuves SQL réelles rollback. Extension refund31755 installée avec refus sans exécution qualifiée ; aucun test bancaire réel.
- COVERAGE_MATCHING : pagination offres50+1 et lecture ponctuelle anonymisée livrées,135offres vérifiées par transaction réelle rollback ; distance/rayon/classement géographique et zone publique configurables restent ouverts.
- QR : génération locale réellement décodée/testée, visible dans la recette467 ; ni paiement ni OTP fabriqués.
- CARD_HOLD_EXTRA_TOTAL : remplacement autorisation en développement, pas livré.
- Parcours client connecté : demande→artisan→devis8,5%→acceptation→début/compte rendu/fin vérifiés sur467, mises à jour devis et acceptation sans reload. Choix du paiement et identifiant durable avant émission manquent encore au formulaire générique connecté : correction en cours. Cela ne remet pas en cause la preuve du parcours réellement contrôlé, mais empêche une clôture globale.
- LOCALISATION : carte de détail client affiche fournisseur non choisi ; géocodage et itinéraire existants ne constituent pas un rendu cartographique.

Toutes les autres limites ci-dessous restent ouvertes sauf preuve datée ultérieure. Sources/historiques ne valent pas livraisons à eux seuls.

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
