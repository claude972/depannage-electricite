# ADV-PLANNING-NOTIFICATIONS-001 — planning artisan et centre de notifications internes

Base 9b3dae03e1a413ffe89b34e0db7553ddc1b3ade9 ; branche `claude/web-planning` ; worktree dédié. **Contrat publié avant code.** Aucune application de migration, aucun déploiement, aucun fournisseur externe configuré, aucune donnée réelle. Codex pilote, revoit et intègre ; le lead (WEB-SHARED-001) raccorde les composants feuilles dans les coques de rôle.

## Périmètre et fichiers possédés

- `supabase/migrations/202610310016_planning_notifications.sql` (numéro réservé ; dépend uniquement de 001–013, jamais de 014/015/017).
- `app/api/planning/**`, `app/api/notifications/**`.
- `lib/features/planning/**`, `lib/features/notifications/**`.
- `components/features/planning/**`, `components/features/notifications/**` (CSS module local, règles `DESIGN.md`).
- `tests/planning/**`, `tests/notifications/**`, `tests/sql-planning-review.mjs`.
- Ce document.

Jamais modifiés : `components/app/**`, `components/role/**`, `components/courant-app.tsx`, `app/globals.css`, routes existantes, `package*.json`, `next.config.ts`, migrations 001–015/017. Aucune dépendance npm nouvelle.

## Décisions de modèle

1. **Planning personnel = agrégat serveur** de trois sources : règles hebdomadaires récurrentes (`artisan_availability_rules`), entrées ponctuelles (`artisan_planning_entries`, trois natures) et rendez-vous d’intervention existants (`intervention_appointments`, table 003, inchangée). Aucune seconde table de rendez-vous : le rendez-vous d’un dossier reste la ligne 003, créée par `save_intervention_appointment` (propriétaire/gestionnaire du site ou artisan affecté approuvé).
2. **Heures locales pour la récurrence.** Une règle « lundi 8 h–12 h » est locale par nature : stockage `weekday` ISO (1 = lundi … 7 = dimanche), `start_minute`/`end_minute` (0..1440) et `time_zone` IANA (défaut `America/Martinique`, UTC−4, sans heure d’été). L’expansion en instants (`timestamptz`) se fait en SQL via `(date + minutes) at time zone time_zone`, donc exacte même pour un fuseau à heure d’été. Tout ce qui est ponctuel (entrées, rendez-vous) est stocké `timestamptz` et exposé en ISO 8601 avec décalage.
3. **Pas de double réservation (serveur).** Les créneaux occupés sont : rendez-vous d’intervention de l’artisan (dossiers non annulés/payés/terminés) et entrées `busy`. Toute écriture d’un créneau occupé (RPC d’entrée `busy` **et** trigger `before insert or update` sur `intervention_appointments` ajouté en 016) prend d’abord `pg_advisory_xact_lock(hashtext('artisan_planning'), hashtext(artisan_id))` puis vérifie le chevauchement → `P0001` « Créneau déjà occupé ». Le verrou consultatif transactionnel sérialise deux écritures concurrentes pour le même artisan sans extension (`btree_gist` n’est pas requis, donc pas d’exclusion GiST sur une table 003 sans colonne artisan). Les `unavailable` (congés) et `available` (créneau exceptionnel) ne sont pas des réservations : ils ne génèrent pas de conflit, ils modifient seulement la disponibilité affichée.
4. **Disponibilité ≠ interdiction.** Un rendez-vous hors disponibilité déclarée reste possible (accord exceptionnel entre les parties) ; le modèle de lecture le signale (`outside_availability: true`). Les créneaux libres proposés aux clients/sites sont calculés serveur à partir des disponibilités moins les occupations.
5. **Confidentialité.** Règles et entrées : lecture RLS `artisan_id = auth.uid()` uniquement ; l’administration ne lit pas les plannings privés (aucune policy admin). Un client/site n’obtient que des **intervalles libres** de l’artisan affecté à **son** dossier (`intervention_free_slots`), jamais un titre, une note, un autre dossier ni une raison d’indisponibilité.
6. **Notifications = lignes persistantes par destinataire**, générées **uniquement** par des triggers 016 sur des transitions réelles de tables existantes (`interventions`, `intervention_appointments`, `messages`, `profiles`, `approvals`, `support_messages`, `support_tickets`, `organization_members`). Idempotence par `unique(recipient_id, dedupe_key)` + `on conflict do nothing`. Jamais d’auto-notification (destinataire = acteur ignoré). Lecture RLS : destinataire seul **et** accès encore valide à l’objet lié (`can_access_intervention` / `can_access_site` / `is_org_member`) : une révocation (réaffectation, retrait d’un membre, réduction de portée) masque immédiatement les notifications liées.
7. **Canaux externes.** Aucun fournisseur SMS/email/push n’est configuré. `lib/features/notifications/channels.ts` définit l’interface d’adaptateur et une détection de configuration par variables d’environnement (`NOTIFICATIONS_EMAIL_PROVIDER`, `NOTIFICATIONS_SMS_PROVIDER`, `NOTIFICATIONS_PUSH_PROVIDER`) ; sans valeur reconnue, chaque canal est `unavailable` et **aucun envoi n’est simulé**. Les préférences par canal sont enregistrées mais présentées comme « indisponible : aucun fournisseur configuré ». Aucune file de sortie DB dans ce lot.
8. **Employeur/techniciens** : non modélisé. Aucune organisation cliente n’est rebaptisée société prestataire ; aucune table d’équipe prestataire n’est ajoutée (le planning est strictement personnel à l’artisan `profiles.role='artisan'`).

## Migration 016 — tables, RLS, RPC, triggers

### Tables

```
artisan_availability_rules(
  id uuid pk, artisan_id uuid → profiles, weekday smallint 1..7,
  start_minute integer 0..1439, end_minute integer 1..1440 (> start_minute),
  time_zone text (vérifié par `now() at time zone` → 22023 si inconnu),
  valid_from date not null default current_date, valid_until date null (≥ valid_from),
  client_request_id uuid not null, version integer not null default 1,
  created_at, updated_at ; unique(artisan_id, client_request_id))
artisan_planning_entries(
  id uuid pk, artisan_id uuid → profiles, kind text in ('busy','unavailable','available'),
  starts_at timestamptz, ends_at timestamptz (> starts_at, ≤ starts_at + 31 jours),
  title text ≤ 160 (privé), note text ≤ 2000 (privé), client_request_id uuid, version integer default 1,
  created_at, updated_at ; unique(artisan_id, client_request_id))
notifications(
  id uuid pk, recipient_id uuid → profiles, kind text (liste fermée ci-dessous),
  title text ≤ 160, body text ≤ 600, intervention_id uuid null → interventions,
  organization_id uuid null → organizations, site_id uuid null → sites, actor_id uuid null → profiles,
  payload jsonb default '{}', dedupe_key text ≤ 200, read_at timestamptz null, created_at ;
  unique(recipient_id, dedupe_key)) ; index (recipient_id, created_at desc, id desc) ; index partiel non lus.
notification_preferences(
  user_id uuid pk → profiles, muted_kinds text[] (sous-ensemble des kinds), email_enabled, sms_enabled, push_enabled boolean default false,
  version integer default 1, updated_at)
```

Grants : `revoke all … from public, anon, authenticated` ; `grant select` à `authenticated` sous RLS ; `grant all` à `service_role`. Aucune écriture directe : tout passe par RPC SECURITY DEFINER `set search_path=''`, quotas `consume_action`.

### Policies (select uniquement)

- `rules_private_read`, `entries_private_read` : `artisan_id = auth.uid()`.
- `notifications_private_read` : `recipient_id = auth.uid() and (intervention_id is null or public.can_access_intervention(intervention_id)) and (site_id is null or public.can_access_site(site_id)) and (organization_id is null or public.is_org_member(organization_id))`.
- `preferences_private_read` : `user_id = auth.uid()`.

### RPC (toutes `security definer set search_path=''`, `grant execute to authenticated`)

| Fonction | Garde | Résultat |
|---|---|---|
| `save_availability_rule(p_request_id uuid, p_id uuid, p_weekday int, p_start_minute int, p_end_minute int, p_time_zone text, p_valid_from date, p_valid_until date, p_expected_version int)` | `guard_artisan_self_edit()` (008 : rôle artisan, non suspendu, verrous profil → dossier) ; quota `planning` 30/min | `{rule, replayed}` ; replay identique de `p_request_id` → `replayed:true` ; même clé avec contenu différent → P0001 ; `p_id` + `p_expected_version` ≠ version → P0001 |
| `delete_availability_rule(p_id, p_expected_version)` | idem | `{deleted:true}` |
| `save_planning_entry(p_request_id, p_id, p_kind, p_starts_at, p_ends_at, p_title, p_note, p_expected_version)` | idem + pour `busy` : verrou consultatif artisan puis chevauchement (entrées `busy` ≠ p_id, rendez-vous actifs) → P0001 | `{entry, replayed}` |
| `delete_planning_entry(p_id, p_expected_version)` | idem | `{deleted:true}` |
| `artisan_planning(p_from timestamptz, p_to timestamptz)` | rôle artisan (lecture, suspendu autorisé) ; `p_to − p_from` ∈ ]0, 62 jours] | voir modèle de lecture |
| `intervention_free_slots(p_intervention_id, p_from, p_to)` | `can_access_intervention` ; dossier avec artisan affecté et statut `assigned/quoted/accepted` ; plage ≤ 31 jours | `{intervention_id, from, to, slots:[{starts_at, ends_at}], computed_at}` — intervalles libres **uniquement** |
| `notification_summary()` | authentifié | `{unread_count, latest_created_at}` (comptes sous RLS du destinataire) |
| `mark_notifications(p_action 'read'\|'unread'\|'read_all', p_ids uuid[], p_before timestamptz)` | authentifié ; ne touche que ses lignes **visibles** (même prédicat que la policy) ; quota `notifications` 60/min | `{updated, unread_count}` |
| `save_notification_preferences(p_muted_kinds text[], p_email boolean, p_sms boolean, p_push boolean, p_expected_version int)` | authentifié ; version optimiste | `{preferences}` |

Fonctions privées (sans grant) : `artisan_available_multirange(artisan, from, to)`, `artisan_busy_multirange(artisan, from, to)`, `assert_artisan_slot_free(artisan, starts, ends, exclude_entry)`, `notify(...)`, fonctions trigger.

Calcul des disponibilités : `tstzmultirange` natif (PostgreSQL ≥ 14 ; Supabase 15/17, PGlite 17) : `range_agg` des règles expansées jour par jour dans leur fuseau ∪ entrées `available`, moins entrées `unavailable`, moins occupations ; découpe sur `[from, to)` ; `unnest` en intervalles triés.

### Triggers 016 sur tables existantes (aucune migration antérieure modifiée)

| Table / événement | Condition | Destinataire | kind | dedupe_key |
|---|---|---|---|---|
| `interventions` after update | requested→assigned | client_id | `mission_assigned` | `intervention:<id>:assigned:<artisan_id>` |
| | artisan_id change (réaffectation admin) | nouvel artisan | `mission_received` | `intervention:<id>:received:<artisan_id>` |
| | artisan_id retiré ou remplacé | ancien artisan | `mission_reassigned` (intervention_id **null**, payload.reference) | `intervention:<id>:reassigned:<old>:<new ou none>` |
| | assigned→quoted | client_id | `quote_received` | `intervention:<id>:quoted:<quote.id>` |
| | quoted→assigned | artisan_id | `quote_rejected` | `intervention:<id>:quote_rejected:<updated_at>` |
| | quoted→accepted | artisan_id | `quote_accepted` | `intervention:<id>:accepted` |
| | accepted→in_progress | client_id | `work_started` | `intervention:<id>:started` |
| | in_progress→completed | client_id | `work_completed` | `intervention:<id>:completed` |
| | completed→paid | artisan_id et client_id | `payment_confirmed` | `intervention:<id>:paid:<recipient>` |
| | →cancelled | artisan_id si affecté | `mission_cancelled` | `intervention:<id>:cancelled` |
| `intervention_appointments` after insert/update | — | la partie qui n’a pas enregistré (client_id si `updated_by` = artisan, sinon artisan_id) | `appointment_saved` | `appointment:<id>:<updated_at>` |
| `intervention_appointments` **before** insert/update | artisan affecté | — (garde anti-chevauchement, verrou consultatif) | — | — |
| `messages` after insert | artisan affecté, auteur ≠ destinataire | client_id et artisan_id sauf auteur | `message_received` | `message:<id>:<recipient>` |
| `profiles` after update of `artisan_approved` | acteur ≠ profil et acteur admin | le profil | `account_approved` / `account_suspended` | `profile:<id>:<approved>:<now>` |
| `approvals` after insert | — | `organizations.owner_id` du site | `approval_requested` | `approval:<id>:requested` |
| `approvals` after update | status décidé | client_id de l’intervention (si ≠ décideur) | `approval_decided` | `approval:<id>:<status>` |
| `support_messages` after insert | `author_kind='admin'` | créateur du ticket | `support_replied` | `support:<message.id>` |
| `support_tickets` after update of status | acteur admin | créateur | `support_status_changed` | `support:<id>:<status>:<version>` |
| `organization_members` after insert | user_id ≠ owner_id | owner | `member_joined` | `org:<org>:joined:<user>` |
| `organization_members` after delete | — | membre retiré (organization_id **null**, payload.organization_name) | `membership_removed` | `org:<org>:removed:<user>:<now>` |

Textes : français, sans nom de table/fonction/code interne ; référence dossier `INT-XXXXXX` (même règle que `shortId`). Préférences `muted_kinds` : la ligne n’est pas créée. Une ligne n’est jamais créée pour un compte sans lien avec l’événement.

## API HTTP (Next, `runtime nodejs`, `Cache-Control: private, no-store`, `assertOrigin` sur POST, zod `strict`, `authenticatedClient`, `dbError`)

### Planning

- `GET /api/planning?from=<ISO>&to=<ISO>` (défaut : semaine courante en `America/Martinique`, max 62 jours ; paramètres inconnus/dupliqués → 422). Réponse :
```
{ range:{from,to,time_zone:"America/Martinique"},
  rules:[{id,weekday,start_minute,end_minute,time_zone,valid_from,valid_until,version,updated_at}],
  entries:[{id,kind,starts_at,ends_at,title,note,version,updated_at}],
  appointments:[{intervention_id,reference,status,category,city,starts_at,ends_at,note,updated_at,outside_availability}],
  free:[{starts_at,ends_at}],
  limits:{rules:50,entries:200,appointments:200,entries_limited,appointments_limited},
  permissions:{can_edit:boolean (artisan non suspendu), reason:string|null} }
```
  Rôle non artisan → 403. 404/405 côté client = contrat absent (`missing`).
- `POST /api/planning` corps discriminé `action` :
  - `save_rule {request_id, id?, weekday 1..7, start_minute, end_minute, time_zone?, valid_from?, valid_until?, expected_version?}` → `{rule, replayed}`
  - `delete_rule {id, expected_version}` → `{deleted:true}`
  - `save_entry {request_id, id?, kind, starts_at, ends_at, title, note, expected_version?}` → `{entry, replayed}`
  - `delete_entry {id, expected_version}` → `{deleted:true}`
  Erreurs : 422 validation ; 403 rôle/suspension ; 409 version/conflit de créneau/clé rejouée avec contenu différent ; 429 quota ; 503 base.
- `GET /api/planning/slots?intervention_id=<uuid>&from&to` → `{intervention_id, from, to, slots:[{starts_at,ends_at}], computed_at}` ; 403 sans accès ; 409 dossier sans artisan/statut incompatible.

### Notifications

- `GET /api/notifications?limit=1..100 (25)&cursor&unread=1` → `{notifications:[{id,kind,title,body,intervention_id,organization_id,site_id,payload,read_at,created_at}], page:{limit,total,has_more,next_cursor}, unread_count}` ; pagination keyset `(created_at desc, id desc)` avec curseur lié aux filtres (même mécanique que `/api/support`), totaux exacts ou 503.
- `GET /api/notifications/summary` → `{unread_count, latest_created_at}` (sondage léger du bouton cloche).
- `POST /api/notifications` : `{action:"mark_read", ids:[uuid 1..100]}` / `{action:"mark_unread", ids}` / `{action:"mark_all_read", before:<ISO>}` → `{updated, unread_count}`.
- `GET /api/notifications/preferences` → `{preferences:{muted_kinds,email_enabled,sms_enabled,push_enabled,version}, kinds:[{kind,label}], channels:{in_app:"available", email:"unavailable", sms:"unavailable", push:"unavailable"}, channels_note}`.
- `POST /api/notifications/preferences` `{muted_kinds, email_enabled, sms_enabled, push_enabled, expected_version}` → `{preferences}`.

## Bibliothèque

- `lib/features/planning/schemas.ts` : zod partagés routes/tests ; `lib/features/planning/time.ts` : helpers purs (`weekRange(date, zone)`, `formatInZone`, `localMinutes`, `offsetFor`, jours ISO) testés sur `America/Martinique` (UTC−4 constant, aucun changement en mars/novembre) et un fuseau à heure d’été pour contraste ; `types.ts`.
- `lib/features/notifications/channels.ts` : `interface NotificationChannelAdapter { channel; detect(): ChannelState; send(): never }` + `detectChannels(env)` → `{email, sms, push}` ∈ `available | unavailable`, raison explicite ; aucun adaptateur concret ; `schemas.ts`, `types.ts`, `kinds.ts` (libellés français).

## Composants feuilles (`components/features/**`, CSS module local, sans modification des coques)

- `ArtisanPlanning({ client, state, timeZone?, onOpenIntervention? })` — vue semaine (7 colonnes desktop, liste mobile), navigation semaine ± / aujourd’hui, créneaux libres, occupés, congés ; formulaires règle récurrente et entrée ponctuelle (validation champ par champ, `request_id` conservé jusqu’au succès, conflit 409 affiché près du créneau avec rechargement) ; états chargement / erreur avec reprise / vide (« Aucune disponibilité déclarée ») / indisponible (`Unavailable` selon `state`) / lecture seule (suspendu).
  `client: { load(range): Promise<PlanningView>; command(body): Promise<PlanningCommandResult> }` — le lead l’implémente via `session`.
- `NotificationBell({ unreadCount, state, onOpen, label? })` — bouton 44×44, compteur accessible (`aria-label` « Notifications, 3 non lues »), jamais de compteur inventé quand `state ≠ available`.
- `NotificationCenter({ client, state, onOpen? })` — liste paginée, filtre non lus, « marquer lu / non lu / tout marquer lu », ouverture du dossier via `onOpen({intervention_id})`, panneau préférences avec canaux externes **affichés indisponibles**.
  `client: { list(params); summary(); mark(body); loadPreferences(); savePreferences(body) }`.

Aucun composant n’importe `session-types` ; tout passe par les interfaces client ci-dessus pour rester raccordable en démo et en direct.

## Interface d’intégration proposée au lead

- `Capabilities` : ajouter `planning: ContractState` et `notifications: ContractState` (sondés comme `support`).
- `View` : `"planning"` (espace artisan, navigation secondaire « Planning », icône `calendar`) et `"notifications"` (tous rôles, ouvert par la cloche d’en-tête ; l’en-tête artisan actuel envoie la cloche vers `messages` : à remplacer par `NotificationBell`).
- `Session` : `loadPlanning`, `planningCommand`, `loadFreeSlots`, `loadNotifications`, `notificationSummary`, `markNotifications`, `loadNotificationPreferences`, `saveNotificationPreferences` — contreparties démo explicites ou `null` (indisponible).
- Sélecteur de créneau côté client/site (formulaire de rendez-vous existant) : facultatif, alimenté par `GET /api/planning/slots` ; hors de ce lot.

## Tests

- `tests/planning/time.test.ts` : Martinique UTC−4 toute l’année, ISO avec décalage, semaine ISO, minutes locales, contraste `Europe/Paris`.
- `tests/planning/api.test.ts` : harnais routes (esbuild + vm, faux `@/lib/supabase/server`) : défauts, bornes 62 jours, paramètres inconnus, rôle non artisan 403, transmission exacte des RPC, `request_id` obligatoire, erreurs SQL → 403/409/422/429, origine étrangère 403, no-store, slots.
- `tests/notifications/api.test.ts` : pagination > 100 avec curseur lié aux filtres, `unread=1`, totaux absents → 503, mark read/unread/all, préférences (kinds inconnus 422), canaux indisponibles explicites.
- `tests/notifications/channels.test.ts` : sans variables → `unavailable` + raison ; valeur inconnue → `unavailable` ; jamais d’envoi.
- `tests/sql-planning-review.mjs` (PGlite, `PGLITE_MODULE` 0.5.13 hors application) : seize migrations ; CRUD règles/entrées, replay idempotent, conflit de version, clé rejouée divergente ; chevauchement busy↔rendez-vous dans les deux sens (P0001) et absence de ligne ; verrou consultatif présent dans `pg_locks` pendant l’écriture ; RLS (autre artisan, client, admin : 0 ligne) ; `intervention_free_slots` pour le client du dossier, refus tiers, intervalles sans titre/note ; expansion Martinique (instant UTC exact) et exception ; artisan suspendu → 42501 en écriture, lecture conservée ; notifications : chaque transition produit exactement les lignes de la matrice, jamais pour l’acteur, dedupe en replay ; lu/non lu/tout lu ; réaffectation puis retrait de membre masquent les lignes liées ; préférences muettes ; aucun grant à `anon`.

Régressions : scripts `tests/sql-*.mjs` existants et `npx tsx --test tests/*.test.ts`, `npx tsc --noEmit`. Pas de `next build` ni `next dev` dans ce lot.

## Limites honnêtes

- Le harnais PGlite est mono-connexion : la preuve d’entrelacement réel (deux sessions concurrentes) reste à faire par Codex sur base dédiée (deux connexions, même artisan, deux créneaux chevauchants : une seule doit réussir).
- Les notifications ne sont pas poussées en temps réel ; le bouton cloche relit `summary` à l’ouverture/au rafraîchissement du workspace.
- Pas d’envoi externe, pas de file, pas de rappel automatique, pas de calendrier partagé, pas d’import/export iCal.
- Les membres d’organisation ne sont pas tous notifiés d’un événement de site : seuls le créateur du dossier et, pour les approbations, le propriétaire de l’organisation.
