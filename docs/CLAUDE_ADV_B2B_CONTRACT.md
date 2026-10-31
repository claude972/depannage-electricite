# ADV-B2B-OPERATIONS-001 — équipements, maintenance, budgets, grilles, SLA et contrôles ERP

Base 9b3dae03e1a413ffe89b34e0db7553ddc1b3ade9 ; branche `claude/web-b2b` ; worktree dédié. **Contrat publié avant code. Rien n’est déployé, aucune migration n’est appliquée par cet agent ; Codex revoit, exécute la revue SQL sur base dédiée et intègre.** ERP signifie ici *établissement recevant du public* ; aucune intégration à un progiciel comptable n’est choisie.

## Plan court

1. Migration `202610310017_site_operations.sql`, additive, dépendante uniquement de 001–013 : tables, RLS, RPC `security definer` sous les verrous existants (`lock_site_access`, organisation `for update`), journal d’historique, fonction de lecture `security invoker` (une seule requête cohérente sous RLS).
2. Bibliothèque pure `lib/features/site-operations/` : schémas zod stricts, calcul SLA sur calendrier ouvré (fenêtres, jours fermés, pauses, reprise, échéances), indicateurs de complétude. Tests Node sur données synthétiques explicitement « QA ».
3. Routes `app/api/site-operations/` : `GET` instantané par site (faits + calculs serveur + complétude), `POST` commandes discriminées → RPC. Conventions existantes : zod strict, `authenticatedClient`, `assertOrigin`, `dbError`, messages français sans nom interne, `Cache-Control: private, no-store`.
4. Composants feuilles `components/features/site-operations/` (CSS module local, règles `DESIGN.md`) : équipements, plan de maintenance, budget par exercice, grilles contractuelles, tableau SLA, contrôles ERP, historique. États chargement / erreur avec reprise / vide / validation / indisponible / lecture seule.
5. Tests : `tests/site-operations/*.test.ts` (lib pure, schémas, routes avec dépendances factices) et `tests/sql-site-operations-review.mjs` (PostgreSQL isolé : CRUD privé, historique, refus intersites/inter-organisations/viewer, révocation immédiate, immutabilité des grilles publiées, versions concurrentes).

## Invariants (rappel contractuel)

- **Autorité** identique au modèle `enterpriseAuthority` (009) : lecture d’un site = `can_access_site` ; écriture sur un site = membre `owner`/`manager` **et** portée `all` ou grant `can_write` (`lock_site_access`) ; écriture d’organisation (exercices, calendriers, grilles) = `can_access_organization_wide(org,true)` (owner ou manager à portée `all`). `viewer` : lecture seule partout. Le retrait d’un grant ou d’un membre refuse immédiatement (vérification SQL à chaque commande, sous verrou organisation). L’administration plateforme lit, n’écrit pas.
- **Rien d’inventé** : aucune valeur par défaut de délai, de calendrier, de tarif, de fréquence ou de seuil. Un délai sans cible ou sans calendrier est `not_measurable`, jamais « respecté ». Une checklist ERP est `declarative` (colonne contrainte) ; libellé UI fixe « Déclaratif — ne vaut pas certification réglementaire ». Aucun texte réglementaire n’est cité comme validé ; les intitulés de contrôle sont saisis par l’organisation.
- **Budgets** : montant par site, par exercice configuré (dates saisies par l’organisation) et par poste ; consommation calculée serveur à partir des devis acceptés des dossiers du site dont la date d’acceptation tombe dans l’exercice. Pas d’exercice → pas de consommation affichée, indicateur `budget.configured=false`.
- **Grilles contractuelles** versionnées : brouillon modifiable, publication immuable, nouvelle version créée à partir d’une version publiée ; montants uniquement tels que saisis (centimes, EUR).
- **Historique** : chaque commande écrit un événement `site_operations_events` (acteur, entité, action, version, instantané après).
- **Complétude** : l’instantané expose des drapeaux (`completeness`) ; l’UI n’affiche jamais « aucune alerte » si des données manquent ou sont tronquées.

## Modèle de données (migration 017)

Toutes les tables : `id uuid`, `version integer` (concurrence optimiste, `expected_version` obligatoire en mise à jour → `P0001` 409 si divergent), `created_by`, `created_at`, `updated_at`. Chaînes bornées, énumérations contraintes.

| Table | Portée | Colonnes principales |
| --- | --- | --- |
| `site_equipment` | site | `name` 1–160, `category` ∈ panel/lighting/emergency_lighting/fire_safety/hvac/generator/ups/other, `criticality` ∈ low/medium/high/critical, `location` ≤160, `reference` ≤160, `installed_on date?`, `status` ∈ in_service/degraded/out_of_service/retired, `notes` ≤4000 |
| `site_maintenance_plans` | site | `equipment_id?` (même site, contrôlé), `title`, `frequency_kind` ∈ none/days/weeks/months, `frequency_value 1–3650?` (obligatoire si kind≠none), `next_due_on date?`, `last_done_on date?`, `status` ∈ active/paused/archived, `notes` |
| `site_maintenance_visits` | site (via plan) | `plan_id`, `done_on date`, `intervention_id?` (dossier du même site), `summary` ≤4000. Enregistrer une visite met à jour `last_done_on` et, si une fréquence est configurée, `next_due_on = done_on + fréquence` ; sinon `next_due_on` reste tel que saisi (« non planifié » si null). |
| `organization_fiscal_years` | organisation | `label` 1–80, `starts_on`, `ends_on ≥ starts_on`, `status` ∈ open/closed ; chevauchement refusé dans la RPC (P0001). |
| `site_budget_lines` | site | `fiscal_year_id` (même organisation), `category` ∈ maintenance/repairs/compliance/equipment/other, `amount_cents 0–100 000 000`, `note` ≤1000 ; unique (site, exercice, catégorie). |
| `organization_contract_grids` | organisation | `lineage_id uuid` (famille de versions), `version_number ≥1`, `label`, `contract_id?` (contrat 002 de la même organisation), `effective_from date?`, `currency='EUR'`, `status` ∈ draft/published/superseded, `published_at?`, `lines jsonb` (array ≤100 de `{label 1–160, unit ∈ hour/visit/flat/km/unit, amount_cents 0–10 000 000, note ≤400}`, validé en SQL). |
| `organization_sla_calendars` | organisation | `name`, `timezone` (IANA, validé côté route + longueur SQL), `windows jsonb` (array ≤21 de `{weekday 1–7, start 'HH:MM', end 'HH:MM', end>start}`), `closed_dates jsonb` (array ≤366 de dates ISO). |
| `site_sla_policies` | site | `name`, `calendar_id?` (même organisation), `urgency?` ∈ urgent/scheduled (null = toutes), `response_target_minutes?` 1–525 600, `resolution_target_minutes?`, `status` ∈ active/archived. |
| `site_sla_cases` | site | `policy_id` (même site), `intervention_id?` (dossier du même site), `reference` ≤160, `opened_at timestamptz`, `responded_at?`, `resolved_at?` (ordre chronologique contrôlé), `notes`. Faits saisis/confirmés par l’organisation ; rien n’est déduit automatiquement d’un dossier. |
| `site_sla_pauses` | site (via case) | `case_id`, `started_at`, `ended_at?` (≥ started_at), `reason` ≤400. Une seule pause ouverte par dossier. |
| `site_erp_checklists` | site | `title`, `nature text check(nature='declarative')`, `description` ≤4000, `performed_on date?`, `performed_by_label` ≤160 (texte libre, pas une certification), `status` ∈ draft/completed/archived, `items jsonb` (array ≤200 de `{key, label 1–240, state ∈ not_checked/ok/reserve/not_applicable, note ≤1000, reserve_resolved_on date?}`). |
| `site_operations_events` | org + site? | `organization_id`, `site_id?`, `actor_id`, `entity`, `entity_id`, `action`, `version`, `snapshot jsonb`, `created_at`. Identité bigint, lecture seule pour `authenticated`. |

Index : `(site_id, updated_at desc)` sur les tables site ; `(organization_id, created_at desc, id desc)` sur les événements ; `(lineage_id, version_number)` unique sur les grilles ; `(case_id) where ended_at is null` unique sur les pauses.

## Matrice RLS

| Acteur | Lecture tables site | Écriture site (RPC) | Lecture config org (exercices, calendriers) | Lecture grilles | Écriture config org / grilles |
| --- | --- | --- | --- | --- | --- |
| owner canonique | oui | oui | oui | oui | oui |
| manager portée `all` | oui | oui | oui | oui | oui |
| manager portée `selected`, grant `can_write` | sites accordés | sites accordés | oui (config nécessaire à l’affichage, sans donnée de site) | non (`can_access_organization_wide`) → `contract_grids_readable=false` | non |
| manager grant lecture seule | sites accordés | non | oui | non | non |
| viewer | sites visibles | non | oui | non (sauf portée `all`) | non |
| membre retiré / grant retiré | non, immédiat | non, immédiat | non | non | non |
| autre organisation | non | non | non | non | non |
| admin plateforme | oui | non | oui | oui | non |

`authenticated` n’a que `select` sur les tables ; toutes les mutations passent par RPC `security definer` révoquées de `public/anon`. Les RPC verrouillent l’organisation (`for update`) avant de revérifier les droits, dans l’ordre de 009/013.

## RPC

Retour : la ligne créée/mise à jour en jsonb (`to_jsonb(row)`). Erreurs : `insufficient_privilege` (403), `no_data_found` (404), `invalid_parameter_value` (422), `P0001` (409 : version divergente, chevauchement d’exercice, grille publiée immuable, pause déjà ouverte), `53300` (429 via `consume_action('site_operations',60)`).

- `save_site_equipment(p_site_id, p_payload jsonb, p_id uuid=null, p_expected_version int=null)`
- `save_maintenance_plan(p_site_id, p_payload, p_id=null, p_expected_version=null)` ; `record_maintenance_visit(p_plan_id, p_done_on date, p_summary text, p_intervention_id uuid=null)`
- `save_fiscal_year(p_organization_id, p_payload, p_id=null, p_expected_version=null)` ; `save_budget_line(p_site_id, p_fiscal_year_id, p_category, p_amount_cents, p_note, p_expected_version=null)` (upsert par clé unique ; version attendue obligatoire si la ligne existe)
- `save_contract_grid(p_organization_id, p_payload, p_id=null, p_expected_version=null)` (brouillon uniquement ; `p_payload.from_grid_id` crée la version suivante d’une lignée publiée) ; `publish_contract_grid(p_id, p_expected_version)` (publie, marque `superseded` l’ancienne version publiée de la lignée)
- `save_sla_calendar(p_organization_id, p_payload, p_id=null, p_expected_version=null)` ; `save_sla_policy(p_site_id, p_payload, p_id=null, p_expected_version=null)`
- `save_sla_case(p_site_id, p_payload, p_id=null, p_expected_version=null)` ; `pause_sla_case(p_case_id, p_started_at, p_reason, p_expected_version)` ; `resume_sla_case(p_case_id, p_ended_at, p_expected_version)`
- `save_erp_checklist(p_site_id, p_payload, p_id=null, p_expected_version=null)`
- `site_operations_snapshot(p_site_id)` → jsonb, `security invoker` (RLS appliquée) : `site`, `equipment[]`, `maintenance_plans[]` (+ `visits[]` 20 dernières), `fiscal_years[]`, `budget_lines[]`, `budget_consumption[]` (`fiscal_year_id`, `accepted_cents`, `paid_cents`, `interventions`), `contract_grids[]` ou `null` si non lisible, `sla_calendars[]`, `sla_policies[]`, `sla_cases[]` (+ `pauses[]`), `erp_checklists[]`, `events[]` (100 derniers), `limits` (compteurs et drapeaux `*_limited`). Refus `insufficient_privilege` si le site n’est pas lisible (pas d’oracle d’existence).

## API

Toutes les réponses : JSON, `Cache-Control: private, no-store`. Erreurs `{ "error": "<français>" }` : 400 JSON invalide, 401 session, 403 origine ou droit, 404 introuvable, 409 version/état, 413 taille, 422 validation, 429 quota, 503 indisponible.

### `GET /api/site-operations?site_id=<uuid>`
Paramètre unique obligatoire. Réponse `{ site_id, snapshot, sla: { cases: SlaEvaluation[] , summary }, completeness, computed_at }` :
- `SlaEvaluation` : `{ case_id, policy_id, measurable, reasons[], paused_now, response: Track, resolution: Track }` avec `Track = { target_minutes|null, deadline_at|null, elapsed_minutes|null, remaining_minutes|null, status ∈ met/breached/pending/not_measurable }`.
- `completeness` : `{ budget: { fiscal_years: n, current_fiscal_year_id|null, lines: n, configured }, sla: { calendars: n, policies: n, cases: n, measurable: n, not_measurable: n }, maintenance: { plans: n, without_schedule: n, overdue: n|null }, erp: { checklists: n, open_reserves: n }, contract_grids: { readable, published: n|null }, truncated: string[] }`. `overdue` est `null` tant qu’aucun plan n’a de `next_due_on`.

### `POST /api/site-operations`
Corps `{ action, ... }` strict (`validated`, 64 KiB) :
`save_equipment`, `save_maintenance_plan`, `record_maintenance_visit`, `save_fiscal_year`, `save_budget_line`, `save_contract_grid`, `publish_contract_grid`, `save_sla_calendar`, `save_sla_policy`, `save_sla_case`, `pause_sla_case`, `resume_sla_case`, `save_erp_checklist`. Chaque action porte les champs du tableau ci-dessus plus `id?` et `expected_version?` (obligatoire avec `id`). Réponse `{ action, result }` (ligne jsonb). Le calendrier est validé côté route (fuseau IANA via `Intl`, fenêtres cohérentes) avant la RPC.

## Calcul SLA (lib pure, serveur)

Entrées : calendrier `{ timezone, windows[{weekday,start,end}], closed_dates[] }` ou `null`, politique `{ response_target_minutes|null, resolution_target_minutes|null }`, faits `{ opened_at, responded_at|null, resolved_at|null, pauses[] }`, `now`.
Règles :
1. Sans calendrier, sans fenêtre ouvrée ou sans cible → piste `not_measurable` avec raison explicite (`no_calendar`, `no_target`, `calendar_without_windows`, `calendar_unreachable`).
2. Le temps ouvré compte uniquement dans les fenêtres du calendrier (fuseau du calendrier, jours fermés exclus), hors pauses. Une pause ouverte (sans `ended_at`) fige le compteur jusqu’à `now`.
3. Échéance = instant où le temps ouvré écoulé depuis `opened_at` atteint la cible (recherche bornée à 400 jours ; au-delà `calendar_unreachable`).
4. `met` si l’événement (réponse ou résolution) survient avec un temps ouvré ≤ cible ; `breached` si > cible ou si `now` dépasse l’échéance sans événement ; sinon `pending`.
5. Les instants sont des ISO UTC ; les fenêtres sont interprétées en heure locale du fuseau avec correction DST (offset calculé via `Intl`).

## Composants feuilles (`components/features/site-operations/`)

Aucun accès à `Session` : props explicites, raccordables par le lead.

```ts
type OperationsAuthority = { canWriteSite: boolean; canWriteOrganization: boolean; readOnlyReason: string | null };
type PanelProps<T> = {
  state: "loading" | "error" | "ready"; contract: ContractState; error: string;
  data: T | null; authority: OperationsAuthority;
  onCommand(command: SiteOperationsCommand): Promise<unknown>; onReload(): void;
};
```
- `EquipmentPanel` (vue entreprise « Équipements du site »), `MaintenancePanel` (« Plan de maintenance »), `BudgetPanel` (« Budget par exercice »), `ContractGridsPanel` (« Grilles contractuelles »), `SlaBoard` (« Suivi des délais »), `ErpChecklistPanel` (« Contrôles ERP — déclaratif »), `OperationsHistory` (« Historique »).
- Chaque panneau : `Loader` pendant `loading` ; `Unavailable` si `contract ≠ available` ; erreur avec bouton « Réessayer » ; état vide avec prochaine action (si écriture) ; lecture seule avec `readOnlyReason` ; formulaires avec labels persistants, erreurs près des champs, conservation des valeurs, double soumission bloquée, confirmation de succès.
- Pas de nom interne (tables, RPC, codes) dans la copie ; messages serveur affichés tels quels.

### Interface de raccordement pour le lead

- Clé `Capabilities` proposée : `siteOperations: ContractState` (sondée via `GET /api/site-operations?site_id=` du site actif ; 404/405 → `missing`, 503/0 → `unavailable`).
- Chargeur proposé dans la session : `loadSiteOperations(siteId) → SiteOperationsReport` et `siteOperationsCommand(command) → unknown`, implémentés avec `api()` existant ; types exportés depuis `lib/features/site-operations/types.ts`.
- Autorité : `authority = enterpriseAuthority(role, scope)` puis `{ canWriteSite: authority.canWriteSite(siteId), canWriteOrganization: authority.canWriteOrganization, readOnlyReason: authority.readOnlyReason }`.
- Vues cibles de la coque entreprise (propriété design/lead) : équipements par site, plan de maintenance, budget par exercice, contrats/grilles, tableau SLA, checklist ERP. Les composants rendent le contenu sous le titre fourni par la coque ; ils n’imposent ni navigation ni menu.

## Vérifications

- `npx tsc --noEmit` ; `npx tsx --test tests/site-operations/*.test.ts` ; `npx tsx --test tests/*.test.ts`.
- `PGLITE_MODULE=<pglite>/dist/index.js node tests/sql-site-operations-review.mjs` : migrations 001–017 en PostgreSQL isolé, matrice de refus, révocation, historique, immutabilité, versions.
- Pas de `next build`/`next dev` par cet agent.

## Non fait, à la charge d’autrui

- Raccordement session/menus/coque entreprise (lead WEB-SHARED-001) ; captures d’écran sur maquette.
- Application de la migration 017 sur une base, recette hébergée, revue indépendante (Codex).
- Toute déduction automatique de faits SLA depuis les dossiers (hors contrat : les faits restent saisis par l’organisation).

## Amendement A1 — alignement sur le contrat partagé WEB-SHARED-001 (correction lead sur 86bb3f3)

Référence : `docs/CLAUDE_WEB_SHARED_CONTRACT.md` (claude/web-shared a29f732). La section « Composants feuilles » ci-dessus est **remplacée** par ce qui suit ; l’historique est conservé. Modèle de données, RLS, RPC, API et règles SLA sont inchangés.

### Surface d’intégration unique

Un seul point d’entrée exporté : `SiteOperationsView` dans `components/features/site-operations/site-operations-view.tsx`, prenant **exactement** les props normalisées. Les panneaux internes (équipements, maintenance, budget, grilles, SLA, ERP, historique) ne sont pas une surface d’intégration ; ils sont rendus par ce composant sous forme d’onglets accessibles.

```ts
// lib/features/site-operations/types.ts — aucun import de components/app/**
export type SiteOperationsState = "unknown" | "available" | "missing" | "unavailable";
export type SiteOperationsScope = {
  userId: string; role: string; organizationId?: string; siteId?: string;
  authority: { canWrite: boolean; reason?: string };
};
export type SiteOperationsClient = {
  load(siteId: string): Promise<SiteOperationsReport | null>;          // null = chaîne périmée
  command(command: SiteOperationsCommand): Promise<SiteOperationsCommandResult | null>; // null = chaîne périmée
};
export type SiteOperationsViewProps = {
  state: SiteOperationsState;
  scope: SiteOperationsScope;
  client: SiteOperationsClient;
  unavailableMessage: string;
  demo?: SiteOperationsReport;
  onNavigate?(view: string, param?: string): void;
};
```

Règles appliquées par `SiteOperationsView` :
1. `client` obligatoire et injecté ; aucun `fetch` dans le dossier `components/features/site-operations/**`. Le chargement passe par `client.load(scope.siteId)` au montage et à chaque rechargement ; sans `scope.siteId`, état vide « choisissez un site » sans requête. `demo` fourni → rendu direct sans appel `load` ; les commandes restent celles de `client`.
2. Un résultat `null` de `client.load`/`client.command` est une chaîne périmée : ni message de succès, ni mise à jour d’état, ni réinitialisation de formulaire.
3. Changement de `scope` (`userId`, `organizationId`, `siteId`) : le contenu est remonté (`key`), ce qui efface formulaires, brouillons et données chargées, puis recharge.
4. `scope.authority.canWrite === false` : aucun contrôle d’écriture (boutons, formulaires, actions de pause/publication) ; la raison `scope.authority.reason` est affichée dans un bloc lecture seule. Les écritures d’organisation (exercices, calendriers, grilles) exigent en plus `snapshot.limits.can_write_organization` renvoyé par le serveur. Tout refus serveur est rendu tel quel ; viewer ou grant retiré = lecture seule sans recalcul côté composant.
5. `state ≠ "available"` : bloc indisponible avec `unavailableMessage` (attribut `data-blocker="site-operations"`), aucune donnée de remplacement, aucune commande.
6. `onNavigate` optionnel : seul moyen de naviguer (liens vers un dossier d’intervention) ; jamais `location.hash`.
7. Démonstration : graines synthétiques dans `lib/features/site-operations/demo.ts`, étiquetées « démonstration » dans leurs libellés, jamais mélangées aux données réelles.

### Clés, vue et chargeurs (réservés par le lead)

- `Capabilities.siteOperations`, sonde `GET /api/site-operations?site_id=<site actif>` ; vue `site-operations` (param : id de site) ; rôle manager (lecture viewer/gestionnaire, écriture selon grant).
- Chargeurs lead : `load = (siteId) => api<SiteOperationsReport>(\`/api/site-operations?site_id=${siteId}\`)` ; `command = (c) => api<SiteOperationsCommandResult>("/api/site-operations", c)` bornés par `runForResult`.
- `scope.authority` = `{ canWrite: enterpriseAuthority(role, scope).canWriteSite(siteId), reason: readOnlyReason ?? undefined }`.

## Amendement A2 — démonstration et réinitialisation de portée (correction pilote sur 467aaf5)

Remplace la règle 1 (partie « démo ») et précise la règle 3 de l’amendement A1 ; le reste est inchangé.

1. **Démonstration.** Le composant feuille n’a **aucun chemin de commande propre à la démo**. Il appelle uniquement le `client` injecté ; la décision démo/réel appartient au lead, qui choisit l’une des deux options :
   - soit il injecte un `client` de démonstration strictement isolé, opérant seulement sur les graines `demo` (mémoire ou `sessionStorage`), sans aucune requête réseau, jamais mélangé aux données réelles ;
   - soit il injecte un `client` dont `command` rejette avec le message « Démonstration : action non disponible. » ; le composant rend ce refus tel quel (état honnête, aucune mise à jour).
   Quand `demo` est fourni, le composant affiche un bandeau « Démonstration — données fictives » (attribut `data-demo="true"`) et ne déclenche jamais `client.load` ; `lib/features/site-operations/demo.ts` fournit les graines et une fabrique `demoClient(seed)` **que seul le lead décide d’injecter** (le composant ne l’importe pas).
2. **Portée.** Tout changement de `scope.userId`, `scope.organizationId` **ou** `scope.siteId` remonte le contenu (`key`), effaçant formulaires, brouillons, sélections et données chargées, puis recharge via `client.load` — exactement comme le contrat partagé, pas seulement sur `userId`.
3. Rappel : aucune migration n’est appliquée par cet agent ; Codex applique uniquement les migrations revues.

## État de livraison (checkpoint composants)

Fichiers livrés (propriété du lot uniquement) :
- `supabase/migrations/202610310017_site_operations.sql` — 12 tables RLS, 15 helpers privés, 13 RPC versionnées, `site_operations_snapshot` (security invoker), journal `site_operations_events`.
- `lib/features/site-operations/` : `types.ts`, `schemas.ts` (zod strict + `toRpc`), `sla.ts` (calendrier ouvré pur), `report.ts` (évaluation + complétude), `labels.ts`, `forms.ts`, `view-model.ts` (autorité, clé de portée, résultat périmé), `demo.ts` (graines + `demoClient`, injecté seulement par le lead).
- `app/api/site-operations/route.ts` — `GET ?site_id=`, `POST` commandes.
- `components/features/site-operations/` : `site-operations-view.tsx` (**seule surface d’intégration : `SiteOperationsView`**), panneaux internes `equipment-panel`, `maintenance-panel`, `budget-panel`, `grids-panel`, `sla-panel`, `erp-panel`, `history-panel`, `shared.tsx`, `site-operations.module.css`.
- Tests : `tests/site-operations/{sla,report,schemas,route,view-model}.test.ts` (26 tests), `tests/sql-site-operations-review.mjs` (11 groupes PASS en PostgreSQL isolé).

Vérifications exécutées par l’agent : `npx tsc --noEmit` ✓ ; `npx tsx --test tests/site-operations/*.test.ts` 26/26 ✓ ; `npx tsx --test tests/*.test.ts` 93/93 ✓ ; `npx tsx --test tests/ui/*.test.ts` 43/43 ✓ ; `PGLITE_MODULE=… node tests/sql-site-operations-review.mjs` ✓ (pglite 0.5.13 installé hors dépôt dans un dossier temporaire selon `docs/QA.md`). Aucun `next build`/`next dev`, aucune migration appliquée, aucune capture.

À raccorder par le lead (WEB-SHARED-001) : clé `Capabilities.siteOperations` (sonde `GET /api/site-operations?site_id=`), vue `site-operations`, chargeurs `load`/`command` bornés par `runForResult`, `scope.authority` depuis `enterpriseAuthority`, choix du client de démonstration (A2), ancrage dans la coque entreprise via l’agent design, tests de raccordement `tests/ui`, captures 360/1280.

À vérifier par Codex : revue SQL 017 sur base dédiée (matrice de refus owner/manager/viewer × grant, révocation, immutabilité des grilles publiées, versions, chevauchement d’exercices), revue des routes et des composants, application séquentielle 014 → 017 uniquement après revue.

## Amendement A3 — corrections de revue pilote sur 603ce12 (P2 pauses SLA, P2 invalidation du rapport)

1. **Pauses jamais tronquées.** `site_operations_snapshot` renvoie **toutes** les pauses de chaque dossier (plus de limite 50) avec `pauses_total` (compte serveur). Le calcul SLA (`evaluateSlaCase`) refuse de mesurer si `pauses_total` diffère du nombre de pauses reçues : les deux pistes passent en `not_measurable` avec la raison `pauses_incomplete` (« pauses incomplètes »), `paused_now=false`, aucune échéance annoncée. L’UI affiche cette raison. Les plans exposent de même `visits_total` (20 dernières visites affichées, total serveur indiqué).
2. **Listes bornées restantes** (équipements 300, plans 300, exercices 50, lignes 300, grilles 100, calendriers 50, règles 100, dossiers 300, contrôles 100, historique 100) : chaque borne a son drapeau `limits.*_limited` repris dans `completeness.truncated` ; l’en-tête de la vue annonce « N listes tronquées : les totaux affichés sont partiels », la synthèse des délais et le compteur de réserves indiquent « liste tronquée » quand leur liste l’est ; la consommation budgétaire est calculée en SQL sur l’ensemble des dossiers (jamais sur la liste affichée).
3. **Invalidation du rapport.** Règle pure `applyLoadResult` : un chargement en erreur (403/404 contexte invalidé, 503) **supprime** le rapport affiché (`report=null`) et affiche l’état indisponible avec « Réessayer » ; sans rapport, `resolveAuthority` est fermée (`canWrite=false`, raison « droits non vérifiés »). Un résultat `null` (chaîne périmée) ne met pas à jour les données mais marque l’état `stale` : toutes les commandes sont désactivées avec la raison « contexte modifié : actualisez » jusqu’à un chargement frais ; un changement de portée remonte le contenu et efface le rapport. Une commande renvoyant `null` applique le même gel.
4. Tests ajoutés : revue SQL (dossier à 55 pauses, pause ouverte en dernier, toutes renvoyées avec `pauses_total`), lib (`pauses_incomplete` sur total divergent, valeur correcte sur liste complète), rapport (synthèse non mesurable), view-model (rapport invalidé sur 403/503, `canWrite=false` après refus, `null` sans état actionnable, retour à l’écriture après chargement frais).

## Correction P2 — sélection de l’exercice du panneau budget (run réel root 78a5f871aaba)

`BudgetPanel` initialisait l’exercice sélectionné une seule fois au montage : monté sans exercice (`""`), il ne sélectionnait jamais le premier exercice créé — sélecteur affiché, mais ni synthèse ni tableau des lignes (« Saisir » inaccessible) jusqu’à un remontage. Correction : sélection effective dérivée à chaque rendu par `effectiveFiscalYearId(choix, exercices, exercice en cours)` (choix explicite conservé s’il existe encore, sinon exercice en cours, sinon le premier) et, après création, `selectionAfterYearCreated` sélectionne l’exercice créé s’il couvre la date du jour. Fonctions pures appelées par le panneau, testées sur la séquence « 0 exercice → création → rapport rafraîchi ».
