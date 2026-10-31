# Écart de livraison — état réel d9374fa (31 octobre2026)

Audit court en lecture seule, sans cloud, credentials, modification applicative ou nouvelle analyse PDF. Révision livrable examinée : `d9374fad01e2eb980bef53206051d88be074479a`. Les preuves d'exécution citées proviennent du pilote, pas d'une relance de cet audit. Les76 lignes de `docs/audit/COUVERTURE_PLAN.csv` sont un inventaire historique : leur colonne `etat_audit` ne décrit pas l'état actuel.

## État acquis à préserver

- Le pilote confirme001–017 appliquées. Auth/RLS, acceptation atomique, rôles client/artisan/B2B/admin, devis/brouillons, photos et assistance possèdent déjà des preuves réelles bornées : ne pas les remettre dans « backend absent ».
- Source d937 : les quatre lots avancés014–017 et leurs ancres/clients sont intégrés. PDF/validité/avenants, équipements/maintenance/budgets/grilles/SLA/ERP déclaratif, finance/modération/scopes opérateurs, planning/notifications internes ne sont plus globalement absents.
- Dernier fait reçu du pilote : harnais avancé f0, applicationd937,13 étapes API+navigateur PASS, cleanup33PASS puis27 scopes àzéro/six Auth absents. Cela couvre notamment races busy/busy et premières préférences, suspension, formulaire réel, retrait d'accès aux notifications support techniques. Ne couvre pas les notifications externes ni toutes les courses rendez-vous.
- `fd27cbe` est une source Claude **hors d937** : elle incorpore les changements client M61/V8-C06/C07 `4a2ab70` et AdminM43/correction de date de demande. Ce n'est pas une deuxième livraison indépendante ; elle reste à intégrer/vérifier au SHA final. Le public reste non accepté : un checkpoint local `d2e906e` existe, mais il n'est pas compté comme livré/revu par ce relevé.

## Ce qui reste codé/raccordé mais non clos par les preuves actuelles

| Périmètre | Reste réel avant annonce finale | Références |
|---|---|---|
| Assemblage final fidèle aux maquettes | Revue/intégration des derniers clients/Admin/public, puis captures et parcours au **même SHA final** ; ne pas substituer les seules captures démo à la recette connectée. | Phase3/11 ; diff `d937..fd27` ; contrat VISUAL-FIDELITY. |
| Reprise après503 | SHARED-REV006 : la capacité devient honnêtement indisponible, mais action de reprise inline absente. Le PASS du harnais prouve seulement blocage des commandes et récupération par reload. | `components/app/features.ts:observe`, `components/app/ui.tsx:Unavailable`, rapport Codex QA/non_proofs. |
| Planning | Courses rendez-vous↔busy et rendez-vous↔rendez-vous, valeur effective `current_setting('role')` dans le trigger en RPC réel ; sélecteur de créneaux client/site encore non raccordé. Ne pas généraliser la race busy/busy déjà verte. | ART04/CLI04 ; contrat planning§« Ce que Codex doit vérifier »/« Non fait ». |
| API HTTP et opérateurs | Certaines assertions HTTP authentifiées (slots tiers403, curseur/filtre422, marquage étranger, préférences périmées409), changements de scopes opérateur et refus UI restent à prouver au combiné. La suite API seule authentifie surtout RPC/REST, pas les routes Next. | ADM09/SYS02 ; `scripts/qa-advanced` non_proofs. |
| Devis enrichis et finance | Code et garde-fous présents ; achever recettes utilisateur au SHA final, PDFs réels/version/émetteur/montants, erreurs de configuration, anciens artisans/grants retirés, avoirs et opérateurs limités. Ne pas transformer les tests SQL isolés/rollback en preuve UI ni inventer de documents commerciaux sans émetteur. | CLI07/08, FIN05, ADM05 ; contrats documents/plateforme. |
| B2B avancé | Les CRUD/calculs/grilles/contrôles existent ; circuits complets par verticale, refus après révocation et états d'erreur/vide/limitation doivent être vérifiés une fois les écrans assemblés. Le rapport agrégé `/api/reports` existe et refuse les troncatures ; ne pas le déclarer absent. | ENT04/07/08/10/11/13/14/15 ; contratB2B et route reports. |
| PWA/exploitation | Installation OS réelle, standalone et mise à jour2versions/2onglets ne sont pas établies par les captures ni par les13 étapes avancées. Le harnais PWA avait des findings safety ouverts à la dernière trace lue. Restauration de sauvegarde et supervision/rétention non démontrées. | SYS08/09, phase2/11 ; CORRECTIONS PWA-LIFECYCLE-REV001–003. |

## Code ou circuit encore absent/partiel, hors simple attente Stripe/Vercel

| Capacité(s), phase | Absence/limite constatée | Conséquence |
|---|---|---|
| CLI05/ART06, phases4–5 ; PUB03 | Carte/GPS/position/distance/ETA non réalisés ; suivi « en route/sur place » déclaratif seulement. Éligibilité par codes postaux existe, mais ne vaut carte de territoire publiable/itinéraire/ETA. | Impossible d'annoncer suivi géolocalisé/arrivée estimée. Source client1326 et artisan1288–1289 le disent. |
| ART12, phase10 conditionnelle | Société prestataire dirigeant/planificateur/techniciens, attribution interne, capacité d'équipe et propriété des règlements non modélisées. | L'entreprise cliente B2B ne remplace pas ce modèle. Décider retenu/reporté ; absence explicite, pas nouveau prérequis arbitraire du MVP. |
| ADM07/09, phase8 | Pas de scope support (ni dispatch limité) dans014 : scopes actuels finance_read/finance_write/reviews_moderate/audit_read. Assistance globale reste `is_admin()`/roleadmin. Pas d'affectation équipe/escalade support complète. | Ne pas annoncer back-office support délégué cloisonné. Source contrat plateforme§1 et `/api/support` scopeall. |
| ENT07/08/11, SYS04/05/06, phase9 | Maintenance enregistrée et échéances affichées, mais pas de création automatique de missions/visites à échéance. SLA calculé sur faits saisis, pas alimenté automatiquement depuis interventions ; pas d'horloges/escalades/alertes métiers opérées. Expiration/archivage/relances automatiques manquants. | Les CRUD et calculs ne suffisent pas à promettre maintenance/SLA automatisés ou alertes envoyées. |
| ENT08/09, phase9 | Hiérarchie bâtiments/étages/zones/plans et mesure énergie/occupation non réalisées ; aucune source de consommation physique. | Ne pas annoncer un Bureaux360 mesuré complet. `enterprise-space:2551` est explicitement indisponible. |
| ENT05/10, phase9 | Parties communes/AG/appels de fonds non modélisés ; ERP = contrôles/checklists déclaratifs, pas certification/audit réglementaire automatisé. | Conserver la distinction électrique et limites de verticale. |
| CLI09/FIN08, phases5/10 | Carnet d'adresses multiples et moyens enregistrés non réalisés. Préférences de notification internes existent désormais : ne pas répéter leur ancienne mention « absentes ». | Profil enrichi/financier encore partiel. |
| CLI07/ENT12/FIN, phases5–7 | Signature électronique/certifiée absente ; règlement en ligne des avenants non raccordé ; circuit approbation B2B d'avenant seulement bloqué, pas livré. Grilles contractuelles versionnées ne sont pas un moteur automatique de prix intégré au devis. | Ne pas annoncer un avenant accepté comme payé ni un tarif contractuel appliqué automatiquement. |
| ADM10/PUB06, phases8–9 | Suivi/décision de garantie existe ; conditions réelles, activation/attestation et mission corrective complète avec preuves/délais restent à finaliser. | La mention garantie ne clôt pas le circuit. |
| SYS04, phase9 | Centre interne et préférences existent ; aucun fournisseur/adaptateur opérationnel email/SMS/push ni file de livraison métier. | Ce n'est **pas** un service explicitement différé par l'utilisateur comme Stripe/Vercel : manque à traiter ou à reporter formellement. |
| PUB02/03/05/06/08/09/10, phases3–5/9 | Identité exploitant/coordonnées/territoire, barème/commission, conditions de garantie et textes commerciaux/confidentialité réels non validés. Les nouvelles pages ne peuvent les inventer. | Bloque une ouverture commerciale présentée comme finale, pas l'exécution interne de fonctions existantes. |
| FIN07/SYS10 et intégrations, phase10 | Abonnements/premium, diagnostic photoIA, intégrations CRM/compta/BI non réalisés. | Extensions conditionnelles : consigner une décision, ne pas les compter terminées. |

## Services explicitement différés, sans maquiller les autres manques

Stripe Checkout/Connect/webhook/statut existe ; cycle fournisseur test, bénéficiaire, remboursement exécuté, commission réellement retenue/transferts/payouts ne sont pas prouvés.014 prépare factures/avoirs/ledger/demandes de remboursement/litiges ; la fonction de settlement/commission fournisseur n'est pas raccordée par ce lot au webhook existant. Cette part relève bien de la reprise paiement différée, mais les workflows d'approbation/document/équipe/automatisation ci-dessus ne sont pas résolus par une clé Stripe.

Nouvelle preview Vercel différée explicitement ; tests locaux et vrais RPC Supabase restent des preuves locales/cloud bornées, pas une nouvelle version hébergée. PWA installation/2déploiements garde ses limites. iOS/Android : plans et missions existent ; aucun package/build natif livré dans d937. La suite native reste conditionnée au checkpoint Web accepté, sans transformer toute extensionphase10 en préalable supplémentaire.

## Ordre de clôture proposé au pilote

1. Clore défauts réels ouverts et assembler/revoir les sources finales visuelles, puis recette cohérente au SHA exact ; conserver13PASS avancés comme preuve bornée.
2. Recetter les quatre lots intégrés, PDFs/avenants, rôles opérateur limités et PWA selon les moyens autorisés ; déclarer séparément chaque critère encore non exercé.
3. Pour dire « Web final selon le plan76 », réaliser ou **reporter explicitement** chaque circuit absent (GPS, supportscopé, automatismes, verticale, équipe conditionnelle…). Pour un checkpoint MVP/préproduction plus étroit, annoncer ce périmètre sans prétendre toutes76capacités closes.
4. Fournisseurs/conditions commerciales puis preuve d'exploitation avant ouverture publique ; natif et extensions suivant leur ordre accepté. Aucun pourcentage global ni « fini » déduit du nombre de migrations/tests.

Sources : PLAN_REPRISE phases3–11 ; COUVERTURE_PLAN76lignes ; DELIVERY_EVIDENCE_AUDIT_8H (historique, corrigé ici sur014–017) ; quatrecontratsADV àd937 ; sources/API/leafs citées ; gitlog d937..fd27 et4a2ab70 ; dernières corrections coordonnées consultées ; faits d'exécution13PASS fournis directement par le pilote. Les PDF catalogués n'ont pas été réanalysés.
