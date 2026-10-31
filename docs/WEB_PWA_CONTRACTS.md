# Contrats Web/PWA — checkpoint backend 1

Mission WEB-PWA-20261030. Ces nouveaux contrats sont **implémentés et vérifiés dans le code du checkpoint 1**, mais non activés sur une base Supabase dédiée et non validés par une intégration distante. Les API existantes sont conservées. Toutes les réponses authentifiées sont privées/no-store ; erreurs JSON `{error:string}` avec 401/403/404/409/422/429/503. Le rôle est dérivé de la session serveur, jamais du corps. Aucun mode démo serveur.

## API artisan

`GET /api/artisan` → `{artisan_profile: object|null, credentials: array}` (artisan courant ou admin avec `?user_id=UUID`).

`POST /api/artisan` : commandes strictes :

- `{action:"save_profile",company_name:string,siret:string,legal_status:string,employee_count:number,address:string,postal_codes:string[],categories:("outage"|"panel"|"socket"|"lighting"|"diagnostic")[]}`. SIRET vide autorisé au brouillon ; 14 chiffres requis à soumission. Codes postaux exacts, pas département implicite. L’enregistrement ne vaut pas approbation.
- `{action:"submit_application"}` : société, SIRET, adresse, zone et compétences requis. Ne prétend pas vérifier une qualification automatiquement.
- `{action:"set_availability",available:boolean}` : disponibilité immédiate, pas un calendrier récurrent complet.
- `{action:"link_credential",document_id:UUID,kind:"registration"|"liability"|"qualification"|"other",expires_on:"YYYY-MM-DD"|null}` : lie une pièce déjà déposée via /api/documents, appartenant à cet artisan et hors intervention. Revue et qualification réelle restent opérateur.

`GET /api/workspace` conserve sa forme et ajoute `organization_members` (sous RLS), `artisan_profile` (profil courant si artisan) ; `participants` est lu via GET operations par dossier attribué. Offres anonymisées, filtrées par disponibilité, code postal configuré, compétence, approbation et refus individuel.

## Opérations intervention

`POST /api/interventions/[id]/operations`, corps discriminé `action` :

- `{action:"decline_offer",reason:string}` : artisan approuvé, offre éligible encore ouverte. Masque seulement pour cet artisan ; ne change pas la demande client.
- `{action:"reject_quote",quote_id:UUID,reason:string}` : demandeur autorisé/gestionnaire, devis actif exact. Rejette ce devis et remet le dossier à assigned pour une nouvelle proposition ; pas une annulation de mission.
- `{action:"save_appointment",starts_at:ISODateTime,ends_at:ISODateTime,note:string}` : client habilité ou artisan affecté ; dossier assigned/quoted/accepted ; fin après début, durée ≤24h, créneau futur. Date proposée/enregistrée, pas une réservation externe ou notification fournie.
- `{action:"set_travel_stage",stage:"planned"|"en_route"|"on_site"}` : artisan affecté, dossier accepted/in_progress ; métadonnée terrain, pas de GPS ou ETA calculé.
- `{action:"save_report",summary:string,checks:{label:string,result:"pass"|"issue"|"not_applicable"}[],signature_name:string}` : artisan affecté pendant/après travaux. Nom saisi = attestation déclarative, aucune promesse de signature électronique certifiée.
- `{action:"reassign",artisan_id:UUID|null,reason:string}` : administrateur plateforme ; avant acceptation du devis uniquement. Réaffectation à artisan approuvé/éligible ou remise en attente ; rejette les devis envoyés et trace l’action.

`GET /api/interventions/[id]/operations` → `{participants,appointment,report,history,history_limit:100,travel_stage}` sous autorisation de lecture du dossier. Les versions de rendez-vous et rapport sont conservées dans un historique append-only ; liste renvoyée limitée aux 100 derniers événements, explicitement signalée.

## Administration

`GET /api/admin/overview` → `{counts,financial,artisans,clients,organizations,interventions,audit,capabilities}` réservé admin. Sommes calculées en SQL sur le périmètre entier, listes bornées signalées ; ne pas présenter le CA prestation comme revenu plateforme. `capabilities` explicite les fonctions absentes plutôt que des menus décoratifs.

## Propriété et révocation B2B

Un dossier avec site appartient à son organisation : son créateur client_id ne conserve pas un droit autonome après retrait de l’organisation. Dossier particulier sans site : droit du créateur conservé. Le payeur reste volontairement le créateur exact tant que délégation financière non définie ; aucun élargissement silencieux de Checkout.

## À ne pas déduire

Pas de nouvelle API invitations/rôles par site/factures/remboursements dans ce premier checkpoint. Pas de calendrier récurrent, GPS, SLA automatisé, scanner de qualification ou statut certifié inventé. Présenter l’absence honnêtement, jamais simuler une mutation en mode réel.

## Politique technique initiale de candidature/suspension

Une modification du dossier société/zone/compétences réinitialise son approbation et sa disponibilité : soumettre à nouveau puis examiner. Une suspension bloque nouvelles missions et nouvelles écritures terrain (devis/début/fin/rapport), tout en conservant lecture des preuves historiques. Le règlement est déjà bloqué par Checkout ; le traitement commercial des travaux restant dus demeure un blocage d’ouverture, pas une dette annulée automatiquement. Approbation exige dossier submitted ; elle ne certifie pas automatiquement les justificatifs.

## Checkpoint 2 — tentatives et échecs Checkout (implémenté, intégration distante non vérifiée)

Webhook ajoute `checkout.session.expired` et `checkout.session.async_payment_failed`, après signature et contrôle session/devis/montant/devise. Un échec ne rétrograde jamais un paiement payé ni une intervention payée. Les tentatives précédentes restent dans `payment_attempts`, accessibles via `GET /api/payments/status?quote_id=UUID` aux lecteurs autorisés du dossier, avec limite explicite 50. Aucune donnée carte ni secret de session n’est renvoyé.

Une session encore ouverte est réutilisée ; une session expirée peut être remplacée en conservant la trace précédente. Une session complete non payée reste en confirmation ou en échec déclaré : pas de nouvelle charge automatique tant que la conciliation n’a pas de règle validée. Les événements d’une ancienne tentative échouée n’altèrent pas la nouvelle tentative. Les remboursements, litiges et versements restent hors de ce checkpoint.

Précision stable checkpoint 1 : **workspace ne renvoie pas participants**. `GET /api/interventions/[id]/operations` renvoie `participants: Array<{id:string,full_name:string,phone:string,role:string}>` ; tableau vide sans artisan attribué, parties client/artisan après attribution, 404 si dossier non lisible. `admin_overview.capabilities` est un objet de booléens `{dispatch_before_quote_acceptance:true,refunds:false,invoices:false,support_tickets:false,list_limit:100}`, pas une liste de menus.
