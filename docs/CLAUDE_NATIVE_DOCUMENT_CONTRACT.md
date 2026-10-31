# NATIVE-DOCUMENT-GATEWAY-001 — gateway d’upload privé hors Vercel

Base 309ed9f2815c855f5e99ecad6368e2fe96f58975 ; branche claude/web-pwa-backend. **Plan/contrat publiés avant code dans e53c0f1 ; implémentation et tests locaux livrés dans le commit suivant de cette branche. Aucun déploiement Edge, aucune application de 013 à une base, aucune recette hébergée par cet agent : revue indépendante et recette pilote requises.**

## Plan court

1. Module de validation partagé pur (magic bytes, MIME, 4 MiB, nom) utilisé à l’identique par `app/api/documents/route.ts` (refactor minimal, comportement HTTP inchangé) et par la fonction Edge.
2. Migration 013 additive : une seule RPC `finalize_document_upload` SECURITY DEFINER qui re-vérifie l’accès sous verrous organisation → dossier, contrôle le chemin propriétaire et l’existence réelle de l’objet Storage, puis insère les métadonnées. Aucune policy, aucun helper existant modifié.
3. Fonction Edge Deno `supabase/functions/native-document-upload` : JWT utilisateur vérifié côté serveur, pré-contrôle identique au Web, upload Storage avec la clé serveur de la fonction, finalisation RPC sous l’identité de l’utilisateur, compensation de l’objet créé par la tentative uniquement.
4. Tests : tests Node purs du module de validation et du handler (fausses dépendances), revue SQL isolée de 013 selon le harnais `tests/sql-*.mjs`, régressions SQL existantes. Revue indépendante puis recette pilote (déploiement Edge de test) hors de ce lot.

## Sources officielles relues (citations)

- Edge Functions (guide) : « Edge Functions are developed using Deno » ; « Functions are `.ts` files that export a handler » ; « Use Supabase CLI for a local runtime similar to production for faster iteration (`supabase functions serve` command) ». Quickstart : `supabase functions new hello-world` crée `supabase/functions/hello-world/index.ts` ; déploiement `supabase functions deploy hello-world`.
- Auth des fonctions : « The default is `verify_jwt = true`, so the platform validates the JWT before your handler runs » ; « When a signed-in user calls a function, the request carries the user's session JWT on the `Authorization` header » ; « `ctx.supabaseAdmin` bypasses Row Level Security, so filter by the caller's ID from `ctx.userClaims` » ; « `auth: 'none'` disables every credential check, so your handler is fully responsible for authenticating the caller ». Le guide actuel présente le wrapper `withSupabase` de `npm:@supabase/server@1`. Ce lot n’en dépend pas : il vérifie lui-même le jeton avec `supabase-js` (`auth.getUser(token)` contacte le serveur Auth) afin de rester sur la bibliothèque déjà épinglée (2.118.0) et de garder `verify_jwt = true` par défaut sans modifier `supabase/config.toml`.
- Secrets : variables par défaut « SUPABASE_URL », « SUPABASE_PUBLISHABLE_KEYS » (dictionnaire JSON), « SUPABASE_SECRET_KEYS » (« These bypass Row Level Security »), « SUPABASE_JWKS » ; clés héritées « SUPABASE_ANON_KEY » et « SUPABASE_SERVICE_ROLE_KEY » ; lecture via `Deno.env.get('NAME_OF_SECRET')` ; « Secret names can't start with `SUPABASE_` ».
- Dépendances : « import { createClient } from 'npm:@supabase/supabase-js@2' » ; « Each function should have its own `deno.json` file to manage dependencies » ; un `deno.json` global dans `/supabase/functions` n’est admis que pour le développement local.
- Limites : « Maximum Memory: 256MB », « Maximum CPU Time: 2s », durée par worker « Free plan: 150s / Paid plans: 400s ». Aucune limite de corps de requête publiée ; le plafond de 4 MiB est imposé par ce contrat.
- Storage standard upload : « When uploading a file to a path that already exists, the default behavior is to return a `400 Asset Already Exists` error » ; « By default, Storage will assume the content type of an asset from the file extension » (d’où `contentType` explicite) ; « the first client to complete the upload will succeed ».
- Storage access control : « the only RLS policy required for uploading objects is to grant the INSERT permission to the storage.objects table » ; « Service keys entirely bypass RLS policies ». Le bucket `intervention-documents` n’a aucune policy INSERT pour `authenticated` (migration 001 : « Uploads are mediated by the server »). Ce lot ne l’ajoute pas : l’écriture Storage reste faite par un serveur (ici la fonction Edge) avec la clé serveur lue dans l’environnement de la fonction. Cette clé ne quitte jamais la fonction et n’est jamais embarquée dans l’app.

## Pourquoi une requête multipart unique et non un upload direct signé

Le Web lit les octets côté serveur et vérifie les magic bytes avant toute écriture. Une URL d’upload signée laisserait le client écrire directement dans Storage sans ce contrôle de contenu, et la métadonnée MIME Storage reposerait sur la déclaration du client. Le fichier plafonné à 4 MiB tient dans la mémoire d’une fonction (256 Mo). Le gateway reçoit donc le fichier, le valide, l’écrit puis finalise. Pas d’upload reprenable (resumable), pas de deuxième étape signée.

## Fichiers livrés par l’implémentation (étape 2)

- `supabase/functions/_shared/document-policy.ts` : module pur canonique (aucun import, aucun global Node/Deno). Convention Supabase pour le code partagé entre fonctions ; le bundle de déploiement reste confiné à `supabase/functions/`.
- `lib/shared/document-policy.ts` : ré-export du module canonique pour Next (`export * from "../../supabase/functions/_shared/document-policy"`). Une seule source de vérité.
- `supabase/functions/native-document-upload/handler.ts` : logique HTTP pure (Request → Response) paramétrée par une interface de dépendances, testable sous Node avec des fausses dépendances.
- `supabase/functions/native-document-upload/index.ts` : glue Deno (`Deno.serve`, `Deno.env`, clients supabase-js) ; seul fichier avec des globaux Deno. `deno.json` épingle `npm:@supabase/supabase-js@2.118.0`.
- `supabase/migrations/202610310013_document_finalization.sql`.
- `app/api/documents/route.ts` : importe le module partagé à la place de son `detectType` local ; mêmes codes/messages HTTP qu’aujourd’hui ; insertion admin conservée (voir « Ce que ce lot ne change pas »). Deux différences minimes et volontaires : la détection compare les octets exacts (l’ancien décodage `ascii` de Buffer masquait le bit haut, donc acceptait en théorie un faux « PNG ») et un nom de fichier vide devient « document » au lieu d’une chaîne vide.
- `tests/document-policy.test.ts`, `tests/native-document-gateway.test.ts`, `tests/sql-document-finalization-review.mjs`.
- `tsconfig.json` : exclusion du seul `supabase/functions/native-document-upload/index.ts` (globaux Deno) et `allowImportingTsExtensions` (noEmit déjà actif) pour que Node typecheck le handler qui importe `../_shared/document-policy.ts` avec l’extension exigée par Deno. Aucune autre option modifiée.

## Module partagé `document-policy`

Exports : `DOCUMENT_BUCKET = "intervention-documents"`, `MAX_DOCUMENT_BYTES = 4194304`, `MAX_REQUEST_BYTES = 4400000` (plafond Content-Length, marge multipart), `ALLOWED_DOCUMENT_MIME` (image/jpeg, image/png, image/webp, application/pdf), `DOCUMENT_NAME_MAX = 160`, `detectType(bytes: Uint8Array): AllowedMime | null` (JPEG FF D8 FF ; PNG 89 "PNG" ; PDF "%PDF-" ; WebP "RIFF"…"WEBP"), `validateDocumentUpload({ size, declaredType, bytes })` → `{ ok: true, mime }` ou `{ ok: false, reason: "empty" | "too_large" | "type_mismatch" }`, `documentNameFor(name)` (tronque à 160, remplace un nom vide par « document »), `isAllowedMime(value)`.

Validation identique au Web : taille 1..4 194 304 octets ; type détecté par les octets ; le MIME déclaré par le client doit être exactement égal au type détecté ; tout autre contenu refusé. Le module ne fait pas confiance au MIME déclaré ni à l’extension du nom.

## Contrat HTTP de `POST /functions/v1/native-document-upload`

En-têtes : `Authorization: Bearer <access_token utilisateur>` (jeton de session Supabase du natif), `apikey: <clé publishable>` (exigée par la plateforme). Aucune session cookie, aucun jeton de bypass Vercel, aucune clé secrète côté client.

Corps `multipart/form-data` : `file` (obligatoire, un seul fichier), `intervention_id` (UUID optionnel). Aucun autre champ accepté comme preuve d’identité ou de droit : propriétaire, chemin, MIME et date sont produits côté serveur.

Réponse `201` : `{ "document": { "id", "name", "mime_type", "created_at" } }` (mêmes champs que le Web). Toutes les réponses portent `Cache-Control: private, no-store`. Pré-vol `OPTIONS` répondu 204 pour une éventuelle cible web Expo ; aucun cookie/credential n’est admis par CORS.

Erreurs `{ "error": "<message français>" }` :
- `401` : en-tête absent, jeton invalide/expiré/révoqué (`auth.getUser` refuse), ou utilisateur introuvable.
- `403` : dossier non lisible ou inexistant (une seule réponse, pas d’oracle d’existence) ; rôle en lecture seule (membre viewer, membre site sans `can_write`, artisan non affecté) ; droits révoqués détectés au pré-contrôle ou à la finalisation.
- `404` : l’objet Storage attendu au chemin propriétaire n’existe pas au moment de la finalisation (défaillance interne ou suppression concurrente). L’objet éventuellement créé par la tentative est compensé.
- `405` : méthode autre que POST/OPTIONS.
- `409` : identifiant/chemin déjà utilisé ou règle métier P0001 ; aucun document accessible créé.
- `413` : `Content-Length` > 4 400 000 ou fichier > 4 194 304 octets.
- `415` : MIME déclaré hors liste, ou contenu dont les magic bytes ne correspondent pas au MIME déclaré (le Web renvoie 422 pour ce cas ; la validation est identique, seul le code transport diffère et est documenté ici).
- `422` : `file` absent/vide, `intervention_id` non UUID, nom invalide.
- `429` : quota `check_upload_limit` (10 uploads/minute/compte, inchangé) atteint — code SQL 53300.
- `503` : configuration serveur absente, Storage ou base indisponible.
- `500` : exception inattendue du handler (message générique). Aucune donnée interne, aucun code SQL brut, aucun chemin Storage n’est renvoyé par aucune réponse.

Pas d’idempotence par nom de fichier ou date : chaque tentative choisit un UUID neuf et un chemin neuf. Une réponse perdue côté client ne peut pas être « rejouée » ; le client relit la liste des documents du dossier (RLS) pour constater l’état. Aucune idempotence par hash de contenu n’est retenue dans ce lot.

## Déroulé serveur et compensation

1. `OPTIONS` → 204 ; méthode ≠ POST → 405. Extraction du Bearer ; absence → 401.
2. Client supabase-js « utilisateur » : `createClient(SUPABASE_URL, clé publishable/anon, { global: { headers: { Authorization } }, auth: { persistSession: false, autoRefreshToken: false } })` puis `auth.getUser(token)`. Erreur ou utilisateur nul → 401. Rien n’est lu dans le corps pour identifier l’utilisateur.
3. `Content-Length` > 4 400 000 → 413 avant lecture du corps. `formData()` ; `file` non File → 422 ; `intervention_id` présent mais non UUID → 422.
4. Pré-contrôle identique au Web, sous RLS de l’utilisateur : `select id, artisan_id from interventions where id = …` (non visible → 403) ; `rpc owns_intervention`, `rpc is_admin` ; refus 403 si ni propriétaire/gestionnaire site, ni admin, ni artisan affecté. Document personnel (sans `intervention_id`) : tout utilisateur authentifié, comme le Web (parcours pièces artisan préservé).
5. `rpc check_upload_limit` (53300 → 429) avant toute écriture.
6. Lecture des octets ; `validateDocumentUpload` : `empty` → 422, `too_large` → 413, `type_mismatch` → 415.
7. `id = crypto.randomUUID()`, `path = <uid>/<id>`. Upload Storage via le client serveur de la fonction (`upsert: false`, `contentType` = type détecté). Erreur → 503 et compensation best-effort du chemin de cette tentative (il peut avoir été écrit malgré une erreur réseau ; personne d’autre ne peut l’avoir créé).
8. `rpc finalize_document_upload(p_id, p_path, p_name, p_mime, p_intervention_id)` **avec le client utilisateur** (auth.uid() réel, pas la clé serveur). Succès → 201.
9. Échec de finalisation : le handler relit `documents` par `id` avec le client serveur ; si la ligne existe (réponse RPC perdue après commit), il renvoie 201 sans rien supprimer ; sinon il supprime **uniquement** `path` (objet de cette tentative) puis renvoie le code mappé (42501 → 403, P0002 → 404, 23505/P0001 → 409, 22023/23514/22P02/23502 → 422, 53300 → 429, autre → 503). Aucune suppression par préfixe, par propriétaire ou par nom ; jamais un objet d’une autre tentative.

## Migration 013 — `finalize_document_upload`

Additive uniquement. Aucune policy créée/modifiée, aucun `create or replace` de `is_admin`, `owns_intervention`, `can_access_intervention`, `can_access_site`, `can_manage_site`, aucune modification de `documents`, du bucket ou des grants existants.

```
create function public.finalize_document_upload(p_id uuid, p_path text, p_name text, p_mime text, p_intervention_id uuid default null)
returns public.documents language plpgsql security definer set search_path=''
```
Ordre des contrôles et des verrous :
1. `auth.uid()` nul → `insufficient_privilege` (42501). Aucun paramètre ne désigne l’utilisateur.
2. `p_path` doit valoir exactement `auth.uid()::text || '/' || p_id::text` sinon 42501 : un utilisateur ne peut jamais finaliser un objet hors de son dossier propriétaire ni réclamer un objet d’autrui.
3. `p_name` 1..160 caractères et `p_mime` dans la liste autorisée sinon `invalid_parameter_value` (22023).
4. Si `p_intervention_id` non nul : `lock_intervention_organization(p_intervention_id)` (verrou organisation du site, ordre établi par 009/012), puis `select … from interventions where id = … for share` (sérialise avec `reassign_intervention`, `intervention_action` et les changements de portée/membres qui verrouillent l’organisation `for update`, sans bloquer d’autres uploads concurrents sur le même dossier). Dossier absent → 42501 (pas d’oracle). Puis `coalesce(owns_intervention(p_intervention_id) or is_admin() or job.artisan_id = auth.uid(), false)` sinon 42501. Un retrait de membre, une réduction de portée site ou une réaffectation artisan commis avant ce point est observé : aucune métadonnée n’est créée et l’objet est compensé par le handler.
5. Existence réelle de l’objet : `exists(select 1 from storage.objects where bucket_id = 'intervention-documents' and name = p_path)` sinon `no_data_found` (P0002). Impossible de référencer un objet non écrit ou déjà supprimé.
6. `insert into public.documents(id, intervention_id, owner_id, name, path, mime_type)` avec `owner_id = auth.uid()` ; `returning *`. `documents.path` unique et `id` clé primaire → 23505 si réutilisation.

Grants : `revoke execute … from public, anon, authenticated` puis `grant execute … to authenticated`. La fonction n’accorde aucune lecture supplémentaire : la lisibilité reste régie par `documents_read` et `documents_objects_read` inchangées. Aucun verrou n’est pris pour un document personnel (pas de dossier). Jamais de verrou profil ou artisan ici : l’ordre organisation → dossier est le seul utilisé, compatible avec 012 (organisation → dossier → profil).

## Ce que ce lot ne change pas (limites honnêtes)

- Le Web continue d’insérer les métadonnées avec le client admin après upload ; seule la validation devient partagée. Basculer le Web sur la même RPC est une ligne à changer **après** application de 013 sur la base dédiée ; le faire avant casserait les uploads Web sur une base sans 013. Décision laissée au pilote.
- Aucune URL publique, aucun bucket public, aucun upload reprenable, aucune OCR/analyse, aucune miniature, aucune suppression de document côté natif, aucune limite supplémentaire par dossier.
- Idempotence non retenue : pas de corrélation nom/date, pas de hash de contenu dans ce lot.
- La fonction Edge n’est pas déployée par cet agent ; `verify_jwt` reste la valeur par défaut (true) ; aucun secret créé. Le natif devra appeler la fonction avec `supabase.functions.invoke` ou `fetch` + Bearer de session.
- Les tests Node utilisent de fausses dépendances et le test SQL un PostgreSQL isolé avec stubs Auth/Storage : ni l’un ni l’autre ne prouvent un interleaving réseau réel ; les scénarios de retrait concurrent sont séquentiels (retrait commis avant finalisation) et la structure des verrous est vérifiée en source.
- Le contrôle d’existence Storage porte sur `bucket_id`/`name` ; la métadonnée MIME Storage n’est pas relue (le MIME retenu vient des magic bytes lus par le serveur et de `contentType` qu’il a fixé).

## Tests prévus (exacts)

`tests/document-policy.test.ts` (node:test) : détection JPEG/PNG/PDF/WebP ; refus d’un GIF, d’un SVG/HTML renommé, d’un buffer court/vide ; refus déclaré ≠ détecté (PNG déclaré image/jpeg) ; 4 194 304 accepté et 4 194 305 refusé ; nom tronqué à 160 et nom vide remplacé ; `lib/shared/document-policy.ts` ré-exporte exactement le module canonique (même fonction) ; constantes de limite égales à celles du bucket (4194304).

`tests/native-document-gateway.test.ts` (node:test, `handler.ts` avec fausses dépendances) : OPTIONS 204 ; GET 405 ; sans Bearer 401 ; jeton refusé 401 ; Content-Length 4 400 001 → 413 sans lecture du corps ; `file` absent 422 ; `intervention_id` invalide 422 ; dossier non visible 403 ; viewer (ni owner/admin/artisan) 403 ; quota 53300 → 429 avant tout upload ; fichier déclaré image/png contenant JPEG → 415 sans upload ; succès owner → 201, upload puis finalize avec le **jeton utilisateur**, chemin `<uid>/<uuid>`, aucune suppression ; finalize 42501 (droit révoqué) → 403 et suppression du seul chemin créé ; finalize P0002 → 404 et suppression ; finalize jeté mais ligne `documents` présente → 201 sans suppression ; échec upload → 503 et tentative de suppression de ce seul chemin ; aucune réponse ne contient de chemin Storage ni de code SQL.

`tests/sql-document-finalization-review.mjs` (PGlite, PGLITE_MODULE 0.5.13 déjà installé hors application) : treize migrations exécutées ; anonyme → 42501 ; chemin d’un autre utilisateur ou id différent → 42501 et aucune ligne ; objet absent → P0002 ; MIME interdit → 22023 ; document personnel owner → ligne créée, lisible par l’owner seul, `link_artisan_credential` fonctionne toujours ; dossier client : client owner 201-équivalent, tiers 42501, artisan affecté OK, autre artisan 42501, admin OK ; dossier site : manager OK, viewer 42501, membre `selected` sans grant 42501, retrait du manager (delete membership) puis finalisation → 42501 sans ligne ; réaffectation artisan puis finalisation par l’ancien artisan → 42501 ; réutilisation d’un id/chemin → 23505 ; `anon`/`authenticated` ne peuvent pas insérer directement dans `documents` ; policies `documents_read`/`documents_objects_read` et définitions `owns_intervention`/`can_access_intervention`/`is_admin` identiques avant/après 013 (comparaison `pg_get_functiondef`/`pg_policies`) ; source 013 : `lock_intervention_organization` précède `for share`, aucune `policy`, aucun `create or replace` de helper.

Régressions : `node tests/sql-review.mjs`, `sql-performance-review`, `sql-site-access-review`, `sql-quote-draft-review`, `sql-support-review`, `sql-artisan-active-guard-review` ; `npm run check` (typecheck, tests, tests UI, build).

## Reste pour le pilote

Revue indépendante du SHA ; application de 013 à la seule base dédiée ; `supabase functions deploy native-document-upload` de test (après revue, aucune production) ; recette : jeton valide/invalide/expiré, tiers, viewer, droits révoqués entre pré-contrôle et finalisation, dépassement de taille, contenu falsifié ; vérification qu’aucune réponse n’expose un chemin ou une clé.
