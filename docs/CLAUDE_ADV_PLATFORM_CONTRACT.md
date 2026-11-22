# ADV-PLATFORM-FINANCE-001 — contrat super back-office et finance préparée

Branche `claude/web-platform`, base 9b3dae0. Propriétaire : Claude (fichiers `app/api/platform-operations/**`, `lib/features/platform-operations/**`, `components/features/platform-operations/**`, `tests/platform-operations/**`, `tests/sql-platform-operations-review.mjs`, migration `202610310014_platform_operators.sql`). Codex pilote, revoit et intègre ; le lead raccorde les composants feuilles dans la coque admin. Ce contrat précède le code ; ce qui n’y figure pas n’est pas livré.

## 1. Modèle de permissions

### Trois natures d’acteurs, jamais confondues
| Acteur | Source de vérité | Portée |
| --- | --- | --- |
| Super administrateur | `profiles.role = 'admin'` (existant, `public.is_admin()`) | Tout, y compris la gestion des opérateurs. |
| Opérateur de plateforme | ligne active dans `public.platform_operator_grants(user_id, scope)` | Uniquement les scopes accordés. |
| Owner / manager B2B | `organization_members` (existant) | Son organisation ; aucune permission plateforme. |

Un opérateur limité ne reçoit **jamais** `profile.role='admin'`. Un super administrateur ne reçoit aucun grant (refus explicite : il détient tout implicitement) ; la promotion d’un compte en super administrateur révoque ses grants, avec audit.

### Scopes explicites (table `platform_operator_grants.scope`)
| Scope | Autorise (côté serveur) |
| --- | --- |
| `finance_read` | Lecture ledger, rapport de rapprochement, factures/avoirs, demandes de remboursement, litiges, paramètre émetteur. |
| `finance_write` | Rapprochement, émission facture/avoir, création/décision de demandes de remboursement, litiges. Jamais d’action fournisseur de paiement. |
| `reviews_moderate` | Lecture des avis avec état de modération, masquage/rétablissement, décision des contestations. |
| `audit_read` | Lecture du journal `platform_audit`. |

Hors périmètre de ce lot : un scope « support » n’est **pas** déclaré, car les routes et RPC d’assistance (`mutate_support_ticket`, `can_access_support_ticket`, `app/api/support/**`) vérifient `is_admin()` et appartiennent à un autre propriétaire. Intégration future documentée au §8.

### Fonctions serveur (migration 014, `security definer`, `search_path=''`)
- `public.has_platform_scope(p_scope text) → boolean` : `auth.uid()` non nul et (`is_admin()` ou grant actif). Utilisée par toutes les RLS et RPC du lot.
- `public.platform_access() → jsonb` : `{super_admin, scopes[], super_admin_count}` du compte appelant. Tout utilisateur authentifié peut l’appeler ; elle ne révèle rien d’autrui.
- `public.platform_grant_scope(p_user_id, p_scope, p_note) → jsonb {grant, replayed}` : super admin seul ; cible existante et non admin ; idempotent sur (user, scope) actif ; audit `operator_scope_granted`.
- `public.platform_revoke_scope(p_grant_id, p_note) → jsonb {grant, replayed}` : super admin seul ; la ligne reste (historique) avec `status='revoked'`, `revoked_by`, `revoked_at` ; audit `operator_scope_revoked`.
- `public.platform_set_super_admin(p_user_id, p_enabled, p_restore_role, p_note) → jsonb {profile_id, role, replayed}` : super admin seul ; auto-modification refusée (`P0001`) ; verrouillage de toutes les lignes admin avant décision ; promotion ⇒ révocation des grants actifs ; rétrogradation vers `p_restore_role ∈ {client, manager}` (artisan refusé, ce rôle relève de l’approbation artisan) ; audit `super_admin_granted` / `super_admin_revoked`.
- Protection du dernier super administrateur : trigger `profiles_last_super_admin` (`before update of role or delete`) qui lève `P0001` si la ligne est le dernier `role='admin'`. Il s’applique aussi au `service_role` et à la cascade `auth.users` → `profiles`.
- Mutations directes : aucun `insert/update/delete` accordé à `authenticated` ; `delete` interdit par trigger ; `update` d’un grant limité à la seule transition `active → revoked` (trigger `platform_operator_grants_guard`).
- Limites : `consume_action('platform_operators', 30/min)`, `consume_action('platform_admin', 10/min)`.

## 2. Audit immuable
Table `public.platform_audit(id identity, actor_id, action, target_kind, target_id, details jsonb, created_at = now())`. Horodatage serveur uniquement. `update`, `delete` et `truncate` sont refusés par trigger pour tous les rôles, `update/delete` révoqués de `service_role`. Lecture : `has_platform_scope('audit_read')`. Chaque RPC du lot écrit une entrée dans la même transaction ; un échec annule l’action et l’audit ensemble.

`target_kind ∈ {operator, super_admin, setting, reconciliation, ledger, invoice, refund_request, dispute, review}` ; `details` porte `from/to`, `version`, montants, scope, taux utilisé, etc.

## 3. Paramètres persistants
Table `public.platform_settings(key, value jsonb, version, updated_by, updated_at)`, clés autorisées : `invoice_issuer` seulement. Écriture : `public.platform_set_setting(p_key, p_value, p_expected_version)` super admin, validation stricte, audit `setting_updated` avec ancienne/nouvelle valeur. Lecture : `finance_read`.

`invoice_issuer` = `{legal_name (1..160), siret (14 chiffres), address (5..500), vat_number (null | ^[A-Z]{2}[0-9A-Z]{2,13}$), commission_vat_rate (null | 0 | 5.5 | 10 | 20)}`. Aucune valeur par défaut : tant que la clé est absente, l’émetteur plateforme est « non configuré » et aucune facture de commission n’est possible. Les valeurs sont saisies par un super administrateur sous sa responsabilité ; le code ne les invente ni ne les vérifie auprès d’un registre.

La commission n’est **pas** stockée en base : la seule source est `PLATFORM_FEE_BPS` (déjà lue par le checkout). Si elle est absente ou invalide, l’API répond `commission: {configured:false, bps:null}` et l’interface affiche « non configuré » ; aucun taux n’est proposé.

## 4. Ledger et rapprochement
Table `public.platform_ledger_entries` (immuable par trigger, lecture `finance_read`) :
`id, request_id uuid unique, entry_kind ∈ {payment_settled, commission_expected, refund_settled}, direction ∈ {credit, debit}, amount_cents integer > 0, currency = 'eur', payment_id → payments, external_event_id, basis jsonb, recorded_by, created_at`.
Idempotence : index uniques partiels `(payment_id) where entry_kind='payment_settled'`, `(payment_id) where entry_kind='commission_expected'`, `(entry_kind, external_event_id)`.

Sémantique (relative au règlement de la prestation) : `payment_settled` = montant encaissé confirmé par l’événement fournisseur signé (`payments.status='paid'`, posé uniquement par `confirm_stripe_payment`) ; `commission_expected` = commission attendue calculée au taux configuré au moment du rapprochement (`round(total × bps / 10000)`, même formule que le checkout), jamais présentée comme perçue ; `refund_settled` = remboursement confirmé par événement fournisseur (voir §5, inatteignable sans Stripe).

- `public.platform_reconcile(p_commission_bps, p_limit) → jsonb` (`finance_write`) : insère les `payment_settled` manquants depuis `payments` (`external_event_id = session_id`) puis, si `p_commission_bps` non nul, les `commission_expected` manquants ; retourne `{settled_added, commission_added, commission_bps, remaining_unsettled}` ; audit `reconciliation_run`.
- `public.platform_finance_report() → jsonb` (`finance_read`, stable) : `payments {paid_count, paid_cents, pending_count, failed_attempts}`, `ledger {settled_count, settled_cents, missing_settlement, amount_mismatches, commission_count, commission_cents}`, `refund_requests` par statut (count, cents), `disputes` par statut, `invoices {invoice_count, credit_note_count}`. Comptes exacts, pas d’estimation.

Fonctions pures TypeScript testées (`lib/features/platform-operations/ledger.ts`) : `commissionCents`, `reconcile(payments, entries)`, `paymentNet(entries)`, `refundableCents`.

## 5. Remboursements et litiges — « demandé ≠ effectué »
Table `public.platform_refund_requests` : `id, request_id unique, payment_id, amount_cents > 0, currency, reason (10..2000), status, version, requested_by, created_at, updated_at, decided_by, decided_at, decision_note, provider_reference, settled_event_id, settled_at`.

Machine d’états :
```
requested ──approve──▶ approved ──(service_role + événement fournisseur)──▶ settled
    │                     │
    ├──reject──▶ rejected └──cancel──▶ cancelled
    └──cancel──▶ cancelled
```
- Création (`platform_request_refund`, `finance_write`) : paiement `paid`, somme des demandes non rejetées/annulées + montant ≤ `payments.total_cents`, idempotente par `request_id`.
- Décisions (`platform_decide_refund`, `finance_write`) : `approve | reject | cancel` avec `p_expected_version` ; note obligatoire pour `reject`.
- `settled` n’est atteignable que par `public.platform_settle_refund(p_id, p_event_id, p_event_type ∈ {charge.refunded, refund.updated}, p_provider_reference, p_amount_cents)` réservée à `service_role`, qui inscrit `stripe_events`, le ledger `refund_settled` et l’audit dans la même transaction. Aucune route HTTP de ce lot ne l’appelle : le webhook appartient au code paiement existant, non modifié. Tant que Stripe n’est pas configuré, l’interface affiche sur toute demande approuvée : « Exécution indisponible : fournisseur de paiement non configuré ». Aucun bouton n’exécute un remboursement.

Table `public.platform_disputes` : `id, request_id unique, payment_id, intervention_id, origin ∈ {client, artisan, platform}, subject, description, status ∈ {open, under_review, resolved, closed}, outcome ∈ {none, refund_requested, no_refund, other}, refund_request_id, version, opened_by, created_at, updated_at, resolved_by, resolved_at, resolution_note`.
Transitions : `open → under_review | closed`, `under_review → resolved | closed`. `resolved` exige `outcome ≠ none` et une note ≥ 10 ; `outcome = refund_requested` exige un `refund_request_id` du même paiement. Les contestations fournisseur (chargebacks) ne sont pas simulées.

## 6. Factures et avoirs
Table `public.platform_invoices` : `id, request_id unique, kind ∈ {invoice, credit_note}, basis ∈ {service, platform_commission}, number unique par émetteur, issuer_key, issuer jsonb, recipient jsonb, payment_id, quote_id, intervention_id, related_invoice_id, lines jsonb, subtotal_cents, tax_rate, tax_cents, total_cents, currency, reason, issued_by, issued_at`. Immuable (trigger) ; une facture n’est jamais supprimée, elle est corrigée par avoir. Numérotation continue par `(issuer_key, kind, année)` via `platform_invoice_counters` verrouillé.

Conditions réelles exigées, sans substitution :
- `basis = service` : paiement `paid` ; devis accepté ; émetteur = artisan du devis d’après `artisan_profiles` (`company_name`, `siret` 14 chiffres, `legal_status`, `address` requis) ; destinataire = demandeur (`full_name`) et adresse de l’intervention, organisation du site si présente ; lignes, taux et montants = ceux du devis accepté. Une facture `service` par paiement.
- `basis = platform_commission` : paramètre `invoice_issuer` complet avec `commission_vat_rate` non nul ; entrée `commission_expected` existante pour le paiement (sinon « commission non rapprochée ») ; destinataire = artisan (`artisan_profiles`) ; une ligne au montant de la commission ; TVA au taux configuré par le super administrateur.
- Avoir : référence une facture, `amount_cents ≤ total − avoirs existants`, motif 10..1000 ; TVA répartie au prorata (`round(amount × tax/total)`).
- `public.platform_invoice_readiness(p_basis, p_payment_id) → jsonb {ready, missing[], preview}` permet à l’interface d’afficher précisément ce qui manque avant toute émission ; `platform_issue_invoice` et `platform_issue_credit_note` lèvent `P0001` en cas de course.

Interface attendue de ADV-DOCUMENTS-001 (branche `claude/web-documents`) pour le rendu PDF — déclarée dans `lib/features/platform-operations/invoice-document.ts`, non implémentée ici :
```ts
export type InvoiceDocumentInput = {
  kind: "invoice" | "credit_note"; number: string; issued_at: string; currency: "eur";
  issuer: { legal_name: string; siret: string; address: string; vat_number: string | null; legal_status?: string };
  recipient: { name: string; address: string; organization?: string | null };
  lines: { label: string; quantity: number; unit_price_cents: number }[];
  subtotal_cents: number; tax_rate: number; tax_cents: number; total_cents: number;
  related_number: string | null; reason: string; quote_reference: string; intervention_id: string;
};
export interface InvoiceDocumentRenderer { render(input: InvoiceDocumentInput): Promise<{ bytes: Uint8Array; mime: "application/pdf" }>; }
```
Le lot plateforme fournit `invoiceDocumentInput(row)` ; le lot documents fournit le renderer et le stockage privé. Aucune mention légale n’est ajoutée par le rendu au-delà des données présentes.

## 7. Modération et contestation des avis
- `public.platform_review_moderation(review_id pk, state ∈ {visible, hidden}, version, note, updated_by, updated_at)` ; `public.platform_review_contestations(id, request_id unique, review_id, contested_by, reason, status ∈ {open, upheld, dismissed}, version, created_at, decided_by, decided_at, decision_note)` ; une seule contestation ouverte par avis.
- `platform_moderate_review(p_review_id, p_action ∈ {hide, restore}, p_note, p_expected_version)` (`reviews_moderate`) ; `platform_contest_review(p_request_id, p_review_id, p_reason)` réservée à l’artisan attributaire de l’intervention notée ; `platform_decide_contestation(p_id, p_decision ∈ {upheld, dismissed}, p_note, p_expected_version)` (`reviews_moderate`), `upheld` masque l’avis.
- Un avis n’est jamais supprimé ni modifié : une policy **restrictive** sur `public.reviews` (`reviews_moderation_visibility`) retire les avis `hidden` de la lecture, sauf pour l’auteur et les modérateurs. Chaque transition est auditée (`review_hidden`, `review_restored`, `review_contested`, `contestation_decided`).

## 8. API `app/api/platform-operations/**`
Conventions communes : `authenticatedClient`, `assertOrigin` sur mutations, zod `.strict()`, `Cache-Control: private, no-store`, erreurs `{error}` en français sans nom interne ; 401 non connecté, 403 scope absent (vérifié par `platform_access()` puis refusé de nouveau par RLS/RPC), 409 conflit de version/transition, 422 saisie, 429 limite, 503 indisponible (dont « fournisseur de paiement non configuré »). Listes : curseur `base64url` lié à l’empreinte des filtres, `page {limit, total, has_more, next_cursor}` avec comptage exact.

| Méthode et chemin | Scope | Corps / réponse |
| --- | --- | --- |
| `GET /access` | connecté | `{super_admin, scopes[], super_admin_count, capabilities{operators, audit, finance, reviews_moderation, refund_execution:false, invoice_rendering:false}, config{commission{configured,bps}, payment_provider{configured, mode:test\|live\|null, live_enabled}, invoice_issuer{configured}}}` |
| `GET /operators` | super admin | `{grants[{id,user_id,full_name,scope,status,note,granted_at,granted_by,revoked_at}], page}` filtres `status`, `scope`, `user_id` |
| `POST /operators` | super admin | `{action:'grant', user_id, scope, note}` → `{grant, replayed}` ; `{action:'revoke', grant_id, note}` → `{grant, replayed}` |
| `POST /super-admins` | super admin | `{user_id, enabled, restore_role?, note}` → `{profile_id, role, replayed}` ; refus 409 si dernier super admin ou auto-modification |
| `GET /audit` | `audit_read` | `{entries[], page}` curseur sur `id desc`, filtres `target_kind`, `target_id`, `actor_id` |
| `GET /settings` | `finance_read` | `{invoice_issuer: {value, version} \| null}` |
| `PUT /settings` | super admin | `{key:'invoice_issuer', value, expected_version}` → `{setting}` |
| `GET /finance` | `finance_read` | `{report, config}` (rapport §4 + config §3) |
| `POST /finance` | `finance_write` | `{action:'reconcile', limit?}` → résultat §4 ; le taux provient du serveur (`PLATFORM_FEE_BPS`), jamais du client |
| `GET /finance/ledger` | `finance_read` | `{entries[], page}` filtres `entry_kind`, `payment_id` |
| `GET /finance/invoices` | `finance_read` | `{invoices[], page}` filtres `kind`, `basis`, `payment_id` |
| `POST /finance/invoices` | `finance_write` | `{action:'readiness', basis, payment_id}` → readiness ; `{action:'issue', request_id, basis, payment_id}` ; `{action:'credit_note', request_id, invoice_id, amount_cents, reason}` |
| `GET /finance/invoices/[id]` | `finance_read` | `{invoice, credit_notes[], document: InvoiceDocumentInput}` |
| `GET /finance/refund-requests` | `finance_read` | `{requests[], page}` filtres `status`, `payment_id` |
| `POST /finance/refund-requests` | `finance_write` | `{request_id, payment_id, amount_cents, reason}` → `{request, replayed}` |
| `POST /finance/refund-requests/[id]` | `finance_write` | `{action: approve\|reject\|cancel, expected_version, note}` → `{request}` ; `execute` n’existe pas |
| `GET /finance/disputes`, `POST` | `finance_read` / `finance_write` | liste ; création `{request_id, payment_id, origin, subject, description}` |
| `POST /finance/disputes/[id]` | `finance_write` | `{action: review\|resolve\|close, expected_version, outcome?, refund_request_id?, note}` |
| `GET /reviews` | `reviews_moderate` | `{reviews[{…, moderation, contestations[]}], page}` filtres `state`, `contested` |
| `POST /reviews/[id]` | voir action | `{action:'hide'\|'restore', expected_version, note}` (`reviews_moderate`) ; `{action:'contest', request_id, reason}` (artisan attributaire) ; `{action:'decide', contestation_id, decision, expected_version, note}` (`reviews_moderate`) |

## 9. Interface et raccordement (pour le lead, session b4b555f0)
- Clés `Capabilities` proposées pour `components/app/types.ts` : `platformAccess: ContractState` (route `/access`), `platformFinance: ContractState`, `platformReviews: ContractState`. Les menus n’apparaissent que si `access.super_admin` ou le scope correspondant est présent dans la réponse serveur ; le menu ne crée aucun droit.
- Composants feuilles (`components/features/platform-operations/`, CSS module propre, primitives `Empty/Loader/Unavailable/Field/Tag` de `components/app/ui`) : tous reçoivent `client: PlatformClient` (`{ request<T>(path, body?, method?) }`, le lead passe `api` de `components/app/api.ts`) et `access: PlatformAccess | null` (null = chargement) ; `state?: ContractState` pour l’état de contrat.
  - `OperatorAccessPanel` — vue admin « Opérateurs » : grants, formulaire d’attribution (user_id + scope + note), révocation avec confirmation, gestion super administrateurs avec confirmation explicite et refus du dernier.
  - `PlatformAuditLog` — vue « Journal plateforme ».
  - `FinanceOverview` — vue « Finance » : rapport, états « non configuré » commission/fournisseur/émetteur, bouton de rapprochement (`finance_write`).
  - `LedgerList`, `InvoiceRegister` (readiness avant émission, avoir), `RefundRequests` (création, décision, bandeau « exécution indisponible »), `DisputeBoard`.
  - `ReviewModeration` — vue « Avis » : masquer/rétablir, contestations à trancher.
  - `usePlatformAccess(client)` — hook renvoyant `{access, state, reload}` pour le menu.
- Aucun composant n’écrit dans `components/app/**`, `components/role/**`, `app/globals.css`.

## 10. Vérification
- `npx tsc --noEmit`, `npx tsx --test tests/platform-operations/*.test.ts`, `npx tsx --test tests/*.test.ts`.
- `tests/sql-platform-operations-review.mjs` (PGlite isolé, recette QA.md) : migrations 001–014 ; refus de rôle/scope pour client/artisan/manager/opérateur hors scope ; grant/revoke idempotents et historisés ; refus de grant à un admin ; dernier super admin indémotable/insupprimable y compris par `service_role` ; audit non modifiable/non supprimable ; ledger idempotent (rejeu de rapprochement sans doublon, montant et devise exacts) ; readiness/émission facture refusée sans émetteur réel ; avoir plafonné ; transitions remboursement/litige valides et invalides, versions obsolètes ; `settled` impossible hors `service_role` ; contestation réservée à l’artisan attributaire ; avis masqué invisible aux tiers, visible à l’auteur et au modérateur, jamais supprimé.
- Codex : exécuter la revue SQL sur base dédiée, matrice de refus, lecture de l’audit ; ne pas appliquer la migration en production.

## 11. Non fait, explicitement
Aucun appel Stripe (remboursement, facturation, commission réelle) ; aucun webhook ajouté ; aucun PDF (interface déclarée §6) ; pas de scope support ; pas de modification d’`admin_overview()` ni des routes admin existantes ; aucune donnée commerciale ou réglementaire inventée.

---

## Amendement A1 — correction pilote P1 sur 5634b79 (avant tout code)
Le texte ci-dessus reste l’historique ; en cas de divergence, cet amendement prévaut.

### A1.1 Taux de commission : valeur serveur de confiance, jamais un argument opérateur
- `platform_reconcile(p_limit integer)` ne prend **plus** de taux. Le taux est lu dans la base au moment du rapprochement depuis `platform_settings` clé `commission_bps` (`{bps: 0..10000}`), écrite uniquement par un super administrateur via `platform_set_setting` (versionnée, auditée). Absente ⇒ aucune estimation n’est créée et la réponse porte `commission_bps: null` (« non configuré »).
- Chaque entrée porte un **instantané historique** dans `basis` : `{rate_source:'platform_setting', bps, setting_version, gross_cents}`. Un changement ultérieur du taux ne modifie jamais une entrée (ledger immuable).
- Deux natures distinctes, jamais confondues dans les données ni dans l’interface :
  - `commission_estimated` (débit) — estimation au taux configuré, libellée « estimation au taux configuré, non prélevée » ;
  - `commission_withheld` (débit) — commission réellement retenue, connue uniquement par un événement fournisseur confirmé ; inscrite par `public.platform_record_commission_withheld(p_payment_id, p_event_id, p_event_type, p_amount_cents, p_currency)` réservée à `service_role` (événement inédit dans `stripe_events`, unique par paiement). Aucune route de ce lot ne l’appelle : déclarée pour le code paiement existant.
- Le rapport expose `ledger.commission_estimated_{count,cents}` et `ledger.commission_withheld_{count,cents}` séparément. Le checkout continue de lire `PLATFORM_FEE_BPS` (code non modifié) ; la route `GET /finance` expose `config.commission = {setting_bps, setting_version, checkout_bps, aligned}` et l’interface signale un écart sans le résoudre.
- Facture `platform_commission` : exige désormais une entrée `commission_withheld` (montant confirmé), jamais l’estimation. Sans fournisseur configuré, l’état « commission non confirmée par le fournisseur de paiement » est affiché et l’émission reste impossible.

### A1.2 Raccordement aligné sur `docs/CLAUDE_WEB_SHARED_CONTRACT.md` (remplace le §9)
- Clé `Capabilities` : `platformOperations` ; route sonde `GET /api/platform-operations/me` (remplace `/access`, même réponse) ; vues `platform-operators`, `platform-finance`, `platform-moderation`.
- Les composants feuilles n’importent rien de `components/app/**` ni `components/courant-app` ; types propres dans `lib/features/platform-operations/types.ts` ; primitives via les classes globales (`.tag`, `.stat`, `.unavailable`, `.field-error`, `.empty-state`, `.page-loader`) et un CSS module du lot.
- Props exactes de chaque composant (`PlatformOperatorsView`, `PlatformFinanceView`, `PlatformModerationView`) :
  - `state: "unknown" | "available" | "missing" | "unavailable"` et `unavailableMessage: string` ;
  - `scope: { userId, role, organizationId?, siteId?, authority: { canWrite: boolean; reason?: string } }` — aucun droit déduit ; contrôles d’écriture masqués avec la raison quand `authority.canWrite` est faux ; tout refus serveur rendu tel quel ;
  - `client: PlatformClient` (obligatoire, injecté par le lead sur `api()`), typé `{ load: { me, operators, audit, finance, ledger, invoices, invoice, refundRequests, disputes, reviews }, command: { grant, revoke, setSuperAdmin, setSetting, reconcile, invoiceReadiness, issueInvoice, issueCreditNote, requestRefund, decideRefund, openDispute, decideDispute, moderateReview, contestReview, decideContestation } }` ; chaque `command` renvoie `T | null`, `null` = chaîne périmée : aucun message de succès, aucune mise à jour d’état ; les `load` renvoient `T | null` de même ;
  - `demo?: PlatformDemo` (graines dans `lib/features/platform-operations/demo.ts`, jamais mélangées) : en démo aucun appel `client` n’est émis ;
  - `onNavigate?(view, param?)`.
- Changement de `scope.userId`/`role` ⇒ remise à zéro des formulaires et données chargées (clé de montage).
- La réponse `/me` reste la seule source des scopes ; le menu ne crée aucun droit.

### A1.3 Opérateurs support : non livré
Aucun scope support n’est défini dans ce lot. Un compte support ne reçoit **jamais** un rôle admin général à la place ; l’éventuel scope sera ajouté par le propriétaire des routes d’assistance avec `has_platform_scope('support')` dans une migration ultérieure.

### A1.4 Durcissement
- Demandes de remboursement, litiges, factures et avoirs : clé `request_id` unique **et** `content_fingerprint` (md5 du contenu canonique : paiement, montant, devise, motif/facture) stocké ; un rejeu avec le même `request_id` et un contenu différent est refusé (`P0001`), un rejeu identique renvoie `replayed:true`. Toute écriture finance d’un paiement s’exécute sous `select … from payments where id=… for update` (verrou ligne, ordre de verrouillage : paiement puis entité) ; les plafonds (somme des demandes, avoirs cumulés) sont recalculés sous ce verrou.
- Dernier super administrateur : trigger `before update of role or delete` sur `profiles` qui prend `pg_advisory_xact_lock(hashtext('profiles_super_admin'))` puis compte les autres admins (sérialisation des décisions concurrentes), couvrant mises à jour directes, `service_role` et la cascade `auth.users`. L’RPC ajoute le même verrou ; aucune voie applicative ne contourne le trigger.
- Avis masqués exclus de **tous** les agrégats, y compris SECURITY DEFINER : `artisan_performance` (007) est renommée `artisan_performance_before_review_moderation` et réécrite avec la même signature pour ne compter que les avis visibles ; `platform_finance_report` et `platform_access` ne touchent pas aux avis ; aucune autre fonction existante n’agrège `reviews` (vérifié par grep des migrations 001–013). La revue SQL teste : avis masqué absent de `artisan_performance`, invisible aux participants non auteurs, visible à l’auteur et au modérateur, jamais supprimé.

## Amendement A2 — revue pilote de fd29b7f
- Fonction héritée `artisan_performance_before_review_moderation(timestamptz,timestamptz,timestamptz,timestamptz)` : dans 014, `revoke execute … from public, anon, authenticated` immédiatement après le renommage ; aucun `grant` (pas même à `service_role`) ; elle n’est appelable que depuis la nouvelle `artisan_performance` (SECURITY DEFINER, même signature, avis masqués exclus) et n’est donc jamais exposée en RPC PostgREST. La revue SQL `tests/sql-platform-operations-review.mjs` affirme : `anon` et `authenticated` reçoivent `42501` sur la fonction héritée ; `artisan_performance` retourne un `rating.count`/`average` qui ignore l’avis masqué et les retrouve après rétablissement.
- Remise à zéro de `scope` : tout changement de `scope.userId`, `scope.role`, `scope.organizationId` ou `scope.siteId` remonte les formulaires, brouillons et données chargées des trois composants (clé de montage calculée sur ces quatre valeurs), exactement comme le contrat partagé.
- Aucune migration n’est appliquée par ce lot, nulle part ; Codex applique séquentiellement les migrations revues.

### A2 (suite) — clarifications de la relecture `docs/reviews/PLATFORM_FD29B7F.md`
1. **TVA de commission, relation facture ↔ ledger, arrondi.** Le montant `commission_withheld.amount_cents` est le montant réellement retenu par le fournisseur, **toutes taxes comprises** (c’est ce qui a été prélevé ; rien n’y est ajouté). La facture de commission a donc `total_cents = commission_withheld.amount_cents` exactement ; si `invoice_issuer.commission_vat_rate` est renseigné, la TVA est **extraite de l’intérieur** : `tax_cents = total − round(total / (1 + taux/100))`, `subtotal_cents = total − tax_cents` ; si le taux est `null`, readiness incomplète (`platform_commission_vat_rate`), jamais un total majoré. Facture `service` : `total_cents = quote.total_cents = payment_settled.amount_cents` (montants du devis accepté, déjà en centimes). Relation : `platform_invoices.payment_id` ↔ `platform_ledger_entries.payment_id` ; une facture de commission par paiement, liée à l’unique entrée `commission_withheld` ; un avoir est un document sans entrée de ledger (le ledger n’enregistre que des mouvements confirmés par le fournisseur) ; prorata de TVA d’un avoir `round(amount × tax/total)`. Arrondi : centimes entiers, `round()` PostgreSQL (demi vers l’infini, positifs uniquement) et `Math.round` côté TypeScript sur des entiers positifs — identiques sur ce domaine ; les tests le vérifient.
2. **Coordonnées de facturation autoritatives.** Le schéma 001–013 n’a aucune donnée de facturation (organisations : nom seul ; sites : adresse d’exploitation ; profils : nom, téléphone). 014 ajoute `public.platform_billing_contacts(subject_kind ∈ {profile, organization}, subject_id, legal_name 1..160, address 5..500, siret null|14 chiffres, vat_number null|motif, version, updated_by, updated_at, pk(subject_kind, subject_id))`, écrite par `platform_set_billing_contact(...)` (`finance_write`, audit `billing_contact_updated`, version optimiste), lue par `finance_read`. Readiness `service` : destinataire = contact de facturation de l’organisation du site s’il y en a un, sinon du profil demandeur ; absent ⇒ `missing: ['billing_contact']` (« coordonnées de facturation manquantes »), sans substitution par l’adresse d’intervention ni le nom du demandeur. L’adresse d’intervention est portée séparément en référence (`service_address`), pas comme destinataire. Facture `platform_commission` : destinataire = identité légale déclarée de l’artisan (`artisan_profiles.company_name/siret/address`), déjà exigée par l’approbation.
3. **Lecture explicite du modérateur limité.** Une policy restrictive ne crée aucun droit : 014 ajoute la policy **permissive** `reviews_moderator_read` (`for select to authenticated using (public.has_platform_scope('reviews_moderate'))`) sur `public.reviews`, en plus de la restrictive `reviews_moderation_visibility`. Revue SQL : modérateur limité (scope `reviews_moderate` seul) lit un avis masqué ; opérateur `finance_read` seul ne lit aucun avis hors de ses dossiers ; participant ordinaire (artisan noté) ne lit pas l’avis masqué ; auteur le lit toujours ; appel direct de la fonction héritée par `authenticated` refusé (`42501`).
4. **Fonctions service et événements fournisseur.** `platform_settle_refund(p_id, p_event_id, p_event_type, p_session_id, p_provider_reference, p_provider_status, p_amount_cents, p_currency)` et `platform_record_commission_withheld(p_payment_id, p_event_id, p_event_type, p_session_id, p_provider_reference, p_provider_status, p_amount_cents, p_currency)` exigent, dans la même transaction et sous verrou du paiement : ligne `payments` existante au statut `paid` dont `session_id = p_session_id`, `currency = p_currency = 'eur'`, montant cohérent (`= demande approuvée` pour un remboursement, `≤ total_cents` pour une commission), `p_provider_status = 'succeeded'` et référence fournisseur non vide ; événement inédit (`stripe_events`). Un nom d’événement seul ne prouve rien ; tout écart lève `P0001` sans marquer l’événement traité.
5. 014 ne dépend que de 001–013 ; le renderer PDF reste une interface TypeScript jusqu’à livraison du lot documents.

## Livraison (checkpoints poussés sur `origin/claude/web-platform`)
- Contrat : 5634b79 ; A1 : fd29b7f ; A2 : c618b83, 37da4a1.
- Migration 014 + revue SQL isolée : ca3bc6c (`supabase/migrations/202610310014_platform_operators.sql`, `tests/sql-platform-operations-review.mjs`, 12 sections PASS sous PGlite 0.5.13 ; les 7 revues SQL existantes restent PASS avec 014).
- Lib, API, composants feuilles, tests unitaires : 97b41d6 ; matrice de refus HTTP : 202b2c9.
- Commandes : `npx tsc --noEmit` (propre), `npx tsx --test tests/platform-operations/*.test.ts` (18/18), `npx tsx --test tests/*.test.ts` (93/93), `PGLITE_MODULE=… node tests/sql-platform-operations-review.mjs`.
- Raccordement (lead) : clé `platformOperations`, sonde `GET /api/platform-operations/me`, vues `platform-operators` → `PlatformOperatorsView`, `platform-finance` → `PlatformFinanceView`, `platform-moderation` → `PlatformModerationView` (export `components/features/platform-operations/index.ts`) ; `client` typé `PlatformClient` (`lib/features/platform-operations/types.ts`) construit sur `api()` ; démo `PLATFORM_DEMO` (`lib/features/platform-operations/demo.ts`).
- Non livré : tout appel Stripe (remboursement, commission réelle, chargeback), webhooks, rendu PDF (interface `InvoiceDocumentRenderer`), scope support, modification d’`admin_overview()`, application de migration. Les fonctions service `platform_settle_refund` et `platform_record_commission_withheld` n’ont aucun appelant dans ce lot.

## Amendement A4 — liens PDF privés des factures et avoirs (branche `claude/web-platform-link`, base b92d641)
- Propriété : la route `app/api/platform-operations/finance/invoices/[id]/pdf/route.ts` et `lib/features/platform-operations/invoice-pdf.ts` (+ `tests/platform-operations/invoice-pdf*.test.ts`) sont **propriété Codex** (CODEX-INVOICE-PDF-001) par décision du propriétaire — exception explicite à l’espace de noms plateforme. Le raccordement des liens et le drapeau `invoice_rendering` sont propriété Claude. La P3 de Codex (référence de dossier à la place de l’UUID) est traitée par Codex dans ses fichiers.
- Drapeau : `INVOICE_RENDERING_AVAILABLE` (`lib/features/platform-operations/config.ts`) est la seule source de `capabilities.invoice_rendering` dans `/me` ; `true` uniquement dans un build qui embarque la route PDF (ce checkpoint), à repasser à `false` si la route sort du build. `refund_execution` reste `false`. Aucun changement SQL.
- Interface : sur chaque ligne du registre et dans le détail d’un document (nouveau panneau « Détail du document » chargé par `client.load.invoice`), deux liens simples sans fetch — « Ouvrir le PDF » → `/api/platform-operations/finance/invoices/<id>/pdf?inline=1`, « Télécharger » → la même adresse sans `inline` — rendus seulement pour un document existant **et** si `access.capabilities.invoice_rendering === true` ; sinon la note « Rendu PDF non disponible sur ce service » (ni lien mort ni bouton). En démonstration, liens affichés désactivés (`role="link" aria-disabled`, aucune navigation) avec la note de démonstration.
- Logique pure testée : `lib/features/platform-operations/invoice-links.ts` (`invoicePdfPath`, `invoiceDocumentLinks` ; capacité absente → aucun lien ; démo → désactivé) dans `tests/platform-operations/invoice-links.test.ts`.

## Préparation A5 — côté UI (branche `claude/web-platform-support-ui`, base `origin/claude/web-shared` 82e507e ; docs seulement, aucun code avant le feu du lead)
Référence : `docs/SCOPED_SUPPORT_CONTRACT.md` (Codex, 052ebac sur `codex/support-operators`), mission b556407, ownership cf53e4c. Le code UI ne démarre qu’après la livraison Codex (migration 018, `types.ts`/`describeAccess`, routes support, `lib/features/support/permissions.ts`) et le go explicite du lead, sur une branche isolée créée depuis le dernier `claude/web-shared` avec la branche Codex fusionnée. Aucun cast permissif pour faire passer le typecheck : les erreurs d’assemblage attendues (Record incomplet, littéraux de capacités) sont corrigées à la source par leur propriétaire.

### 1. `platform-operators-view.tsx` (propriété Claude)
- `SCOPE_LABELS: Record<PlatformScopeKey, string>` complété avec les trois nouvelles clés : `support_read` → « Assistance — lecture de la file », `support_reply` → « Assistance — réponse », `support_status` → « Assistance — changement de statut ».
- Nouveau `SCOPE_DESCRIPTIONS: Record<PlatformScopeKey, string>` affiché sous le sélecteur du formulaire d’attribution et dans le tableau : `support_read` « Lit toutes les demandes d’assistance, messages et événements ; aucun droit sur dossiers, finance, audit ou modération. », `support_reply` « Répond dans la file seulement combiné à la lecture ; seul, ne donne rien. », `support_status` « Change le statut d’une demande seulement combiné à la lecture ; seul, ne donne rien. » (plus les quatre descriptions existantes). Le formulaire affiche l’avertissement « Un scope d’écriture sans la lecture n’accorde rien » quand `support_reply`/`support_status` est choisi sans grant `support_read` actif pour ce compte (information dérivée de la liste serveur déjà chargée, jamais un droit).
- « Fiche opérateur » : filtre existant `user_id` du tableau réutilisé pour afficher, pour un compte, ses grants actifs/révoqués groupés par famille (finance, modération, audit, assistance) et la combinaison effective déclarée par le contrat (lecture file / réponse / statut) **telle que résultant des grants actifs listés par le serveur**, sans appel supplémentaire ; aucune promesse sur un autre compte au-delà de ses grants visibles.
- Rien d’autre ne change : grant/revoke/super-admin passent par les mêmes commandes ; `PLATFORM_SCOPES` (Codex) alimente déjà le sélecteur.

### 2. Littéraux de capacités (propriété Claude)
- `lib/features/platform-operations/demo.ts` : `PLATFORM_DEMO.access.capabilities` reçoit `support: false, support_reply: false, support_status: false` (démonstration sans file opérateur).
- `tests/platform-operations/**` : tout objet littéral `capabilities` (fixtures de `routes.test.ts`, `invoice-links.test.ts` si besoin) porte les trois booléens ; `routes.test.ts` ajoute l’assertion `/me` → `support`/`support_reply`/`support_status` cohérents avec les scopes mockés (`support_read` seul ⇒ `support: true`, `support_reply: false`), sans dupliquer la logique Codex (`platform_access` mock étendu, `describeAccess` réel).
- `types.ts`/`http.ts` ne sont pas touchés par Claude (A5).

### 3. Côté opérateur : réutilisation du centre d’assistance existant
- Aucun nouvel écran de file : l’opérateur utilise `SupportCenter` existant avec la file globale (`scope=all`) quand `/me` renvoie `capabilities.support === true` ; réponse possible quand `support_reply`, changement de statut quand `support_status` — ces drapeaux ne servent qu’à l’affichage/masquage des contrôles ; la décision reste la réponse serveur (`permissions.can_reply` / `can_set_status` du détail, refus 403/409 des routes rendus tels quels).
- Les composants plateforme ne lancent aucune requête support ; le menu/l’entrée « File d’assistance » et son ancrage sont au lead (shared contract §4 : visible seulement si la capacité est `available`/`unknown`, jamais un menu sans action).

### 4. Demandes exactes au lead (fichiers lead : `components/app/types.ts`, `components/role/support-tickets.tsx`)
- `SupportMessage.author_kind: "user" | "admin" | "operator"` (et toute autre union dérivée, `SupportEvent` si elle porte `author_kind`).
- `SupportCenter` : nouvelle prop optionnelle `queue?: "mine" | "all"` (défaut `"mine"`), transmise telle quelle à `session.loadSupportTickets({ scope: queue, … })` ; les curseurs sont déjà liés aux filtres côté serveur. En `queue="all"`, la liste affiche la colonne/méta « Demandeur » = `shortId(creator_id)` (pas de nom : aucun profil supplémentaire n’est fourni par ce lot) et le dossier lié en identifiant court.
- Libellé d’auteur (ligne actuelle `author_kind === "admin" ? "Assistance" : "Vous"`) remplacé par une fonction pure : `authorLabel(message, { viewerId, queue })` → `message.author_id === viewerId` ⇒ « Vous » ; sinon `queue === "mine"` ⇒ `author_kind === "user"` ? « Vous » (cas historique : seul le créateur voit sa file) : « Assistance » (admin **et** operator : le demandeur n’a pas à distinguer) ; `queue === "all"` ⇒ `user` → « Demandeur », `operator` → « Opérateur », `admin` → « Assistance ». Style `eventUser` appliqué uniquement quand le libellé est « Vous ».
- Contrôles : « Répondre » visible si `permissions.can_reply`, sélecteur de statut si `permissions.can_set_status` (déjà le cas) ; en `queue="all"` sans `can_reply` ni `can_set_status`, le message lecture seule existant est reformulé « Lecture seule : vos droits d’assistance ne permettent pas de répondre ni de changer le statut. » ; un ticket résolu garde la règle serveur « réouverture explicite avant réponse » (409 rendu tel quel).
- Changement d’identité/révocation : clé de montage existante de `SupportCenter` + invalidation 403/404 déjà en place ; la file `all` d’un opérateur révoqué redevient vide/403 et l’entrée de menu disparaît à la prochaine lecture de `/me`.
- Aucun autre prop : pas de `canReply`/`canSetStatus` passés depuis les capacités ; seules les permissions par ticket renvoyées par le serveur pilotent les contrôles.

### 5. Vérification prévue (après go)
`npx tsc --noEmit` sans cast ; `tests/platform-operations` (labels complets pour chaque clé de `PLATFORM_SCOPES` par test exhaustif, `authorLabel` si fourni dans un helper pur que le lead souhaite me confier, sinon test côté lead) ; `npx tsx --test 'tests/**/*.test.ts'` ; `npm run check` avec restauration `AGENTS.md`/`next-env.d.ts` ; captures 360/1280 de la fiche opérateur et de la file `all` en lecture seule si le lead fournit l’ancrage. Pas de migration appliquée, pas de grant/admin réel créé.
