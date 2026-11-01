# Revue croisée — lecture ponctuelle (backend Codex) à `e0eeee4`

Source exacte revue : `e0eeee4da3310b40e49164f214d9dbf8bacf870c` (`codex/detail-read`, base `53d34a9`), exportée par `git archive` dans un répertoire temporaire. Référence : contrat `docs/DETAIL_READ_CONTRACT.md` à `690da9f` (identique à celui de `e0eeee4`, aucun écart) et mission `33bc491`. Revue en lecture seule : aucun code modifié, aucun cloud, aucun identifiant.

## Verdict
**Acceptable sous réserve d’une correction P2** (aucun P1). Le cœur du contrat est respecté : client de session sous RLS, projections fermées identiques au §4.1, `limited` exact (N > limite), paiements sur le périmètre complet des devis, statuts `none`/`hidden`/`error`, 404 non divulgatrice, 503 + `Retry-After` + `private, no-store` sur toutes les réponses, validation d’exécution de l’enveloppe, relecture finale contre une révocation en cours de lecture.

## Tests exécutés à `e0eeee4` (export archive, `node_modules` identiques par `package-lock.json`)
- Ciblés `tests/detail-read-backend.test.ts` + `tests/workspace-limits.test.ts` : **13/13 PASS**.
- `npm test` (`tests/**/*.test.ts`) : **780 tests, 778 PASS, 1 FAIL, 1 SKIP**. Le FAIL (`qa-tracking-provenance.test.ts:146`, `git rev-parse HEAD` → « not a git repository ») et le SKIP (`QA_BUSINESS_4C_HTML` non défini) sont **des artefacts de mon environnement** (export sans `.git`, variable non fournie), sans lien avec ce lot ; ils correspondent aux conditions décrites dans le rapport Codex (780 PASS avec la variable, dans un dépôt git).
- `npx tsc --noEmit` : **PASS**.

## Constats

### P2-1 — schéma strict des lignes de devis : des devis valides deviennent `error`
`lib/features/workspace/detail-read.ts:22` valide `quotes.lines` avec `z.object({ label, quantity, unit_price_cents }).strict()`. Or la base stocke `p_lines` **tel quel** (`supabase/migrations/202610310001_initial.sql:221`, seule insertion dans `public.quotes` des migrations) : la validation SQL (`:214–217`, `jsonb_to_recordset(... as x(label, quantity, unit_price_cents))`) **ignore les clés supplémentaires** et n’impose pas que `quantity` soit stocké comme entier JSON (contrôle `quantity = trunc(quantity)` sur `numeric`, donc `2.0` est accepté). Un devis légitime dont une ligne porte une clé en plus (ou `quantity: 2.0` sérialisé) fait échouer `z.array(rowSchemas.quotes).parse` (`:73`) ⇒ **toute la liste `quotes` passe en `error`** (`:76`), affichée « momentanément indisponible » de façon permanente pour ce dossier. Ce n’est pas un défaut de sécurité, mais une fausse indisponibilité sur des données valides.
**Correction proposée** : accepter les clés inconnues de chaque ligne sans les exposer (`.strip()` sur l’objet ligne, ou ne projeter que `label/quantity/unit_price_cents`) et valider `quantity` comme nombre entier par valeur (`Number.isInteger`) ; garder `.strict()` sur les colonnes de premier niveau. Ajouter un test : ligne avec clé supplémentaire ⇒ devis lu, clé non exposée.

### P3-1 — `updated_at` dans la relecture finale ⇒ 503 parasites sous activité normale
`detail-read.ts:119` rejette (503) si `updated_at` ou `status` a changé entre les deux lectures. Toute mise à jour légitime concurrente (étape de déplacement `travel_stage`, devis envoyé, statut) produit un 503 ; le client réessaie (`Retry-After: 2`), donc pas de fuite ni de mélange d’époques. Comportement sûr, à documenter côté consommateur (une relance automatique au plus) ; la détection de **révocation** repose, elle, sur la seconde lecture RLS qui renvoie 0 ligne ⇒ 404 (`:117–118`), ce qui est correct.

### P3-2 — `organization: hidden` sans lecture quand le site est masqué
`detail-read.ts:85` renvoie `organization: hidden` sans interroger `organizations` lorsque le site est invisible. C’est voulu et testé (`tests/detail-read-backend.test.ts:55`, « never triggers organization discovery ») et ne divulgue rien ; mais le contrat définit `hidden` comme « lecture réussie, 0 ligne ». Proposition : amender le contrat (§4) pour dire « `hidden` = non visible, ou non évaluée parce que le parent est masqué ».

### P3-3 — ordre des listes non spécifié pour le consommateur
`messages` sont renvoyés **du plus récent au plus ancien** (`:71`), alors que le workspace les renvoie dans l’ordre chronologique (`app/api/workspace/route.ts`, `.reverse()`). Le contrat ne fixe pas l’ordre ; le hook devra trier. À préciser dans le contrat avant le câblage front.

### P3-4 — UUID strict (Zod 4 `z.uuid()`) pour toutes les lignes
`detail-read.ts:14` et `workspaceWindow` (`:50`) exigent des UUID RFC (version/variante). Les identifiants produits par `gen_random_uuid()`/Auth le sont ; un identifiant non RFC (données importées, fixtures manuelles) ferait passer la ligne en erreur — et, côté workspace, toute la réponse en **503** (`app/api/workspace/route.ts` diff : `workspaceWindow` lève `DetailReadUnavailable`). Nouveau mode d’échec du workspace à noter, acceptable si aucune donnée non RFC n’existe.

## Points vérifiés conformes (preuves)
- **Session + RLS, aucune clé serveur, aucun `available_missions`** : `app/api/interventions/[id]/route.ts:8` `authenticatedClient()` → `lib/supabase/server.ts:13–22,32–41` (clé publishable + cookies, `getUser`) ; `detail-read.ts` n’utilise que `db.from(...)` ; aucune occurrence de `adminClient`/`available_missions` dans la route ni la bibliothèque.
- **Projections §4.1 exactes** : `detail-read.ts:4–13` = les huit listes du contrat, octet pour octet ; schémas `.strict()` (`:18–28`) ⇒ toute colonne en plus est une erreur.
- **Plafonds et `limited = N > limite`** : listes `limit + 1` puis `slice(0, limit)` et `limited: rows.length > limit` (`:71–75`) ; paiements `limit(21)` / `> 20` (`:106–110`) ; workspace `limit(101/201/101/51)` puis `workspaceWindow` `data.length > limit`, ligne surnuméraire jamais exposée, `loadedIds` calculé sur les lignes fenêtrées (diff workspace). Tests N < L, N = L, N = L + 1 : `tests/workspace-limits.test.ts:7`.
- **Paiements sur le périmètre complet** : ids de tous les devis du dossier avec `count: "exact"` (`:100–104`), `incomplete = count > 200`, paiements `in("quote_id", ids)` et contrôle d’appartenance (`:109`) ; test « payment on quote outside the displayed 20 … 201 quote scope declares incomplete » (`tests/detail-read-backend.test.ts:71`).
- **`none` / `hidden` / `error` par élément ; site et organisation par id** : `:78–97` (`site_id` nul ⇒ `none` ; 0 ligne ⇒ `hidden` ; erreur/forme ⇒ `error`), lectures `eq("id", …)` hors des listes du workspace ; test `:55`.
- **404 non divulgatrice** : même réponse `missing()` (`route.ts:5`) pour non-UUID (`:10`), absent ou invisible (`:12`, `readInterventionDetail` ⇒ `null`) ; 401 vérifié **avant** la validation de l’id (`:8`, test `:38`).
- **503 + `Retry-After: 2` + `private, no-store`** : toutes les branches posent `headers` (`route.ts:4,5,12,15,16`), y compris le `catch` ; une erreur de lecture du dossier lève `DetailReadUnavailable` (`detail-read.ts:59–64`) ⇒ 503, jamais 404 ; `null` JSON malformé ≠ absence (seul un tableau vide prouve l’absence).
- **Validation d’exécution** : `detailReadSchema.parse` sur l’enveloppe finale (`:120`) ; `workspaceLimitsSchema` stricte exportée.
- **Révocation en cours de lecture** : seconde lecture RLS du dossier après les dépendances (`:116–119`) ; 0 ligne ⇒ 404, changement de `client_id/artisan_id/site_id/status/updated_at` ⇒ 503 ; test `:115`.
- **Client propriétaire sans artisan servi** : test `:22` ; offre refusée par RLS ⇒ même 404.
- **Types front** : seul `Workspace.limits?` ajouté (`components/app/types.ts`), conforme à la mission.

## Non prouvé par cette revue
- Le comportement réel de PostgREST/RLS sur le projet (les tests utilisent un `fetch` simulé) : `count: "exact"` combiné à `limit` sous RLS, visibilité réelle des sites/organisations par périmètre (artisan attribué, membre `selected`), latence.
- La fenêtre réelle de révocation entre les deux lectures (TOCTOU résiduel inhérent après la seconde lecture).
- Le consommateur front (hook, cache, générations) : non livré à ce stade, par conception.
