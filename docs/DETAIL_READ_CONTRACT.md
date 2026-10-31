# DETAIL-READ — lecture ponctuelle autorisée d’un dossier hors des fenêtres du workspace (proposition, aucun code)

Base `58b76414` ; branche `claude/web-remaining-contracts`. **Docs seulement** ; revue root puis contre-revue avant tout code (backend Codex, consommateur lead). Aucune modification de la recette 28b ni des fichiers UI réservés au lead (layout, globals, thème). Rapport de revue intégré : DETAIL-CONTRACT-2F9-001/002/003.

## 1. Constat
`app/api/workspace/route.ts` (58b) lit : `interventions` 100 (`created_at desc`) + au plus 100 offres (`available_missions`, artisans), `quotes` 200, `sites` 100, `organizations` 50, `messages` 500, `documents` 100, `payments` 100, `organization_members` 500, `intervention_appointments` 200 (seul signal existant : `appointments_limited`). Un dossier hors fenêtre — ou son site, son organisation, ses devis — peut manquer de l’instantané ; `#detail/<id>` affiche alors « introuvable » à tort. Aucun endpoint ne renvoie aujourd’hui le dossier complet (`GET /api/interventions/[id]/operations` n’est qu’un modèle de structure).

## 2. Déclencheur — signal de troncature (DETAIL-CONTRACT-2F9-001)
- **À ajouter (backend, propriétaire Codex)** à l’enveloppe du workspace, sans inventer d’autre indicateur : `limits: { interventions: { limit: 100, limited: boolean }, quotes: { limit: 200, limited }, sites: { limit: 100, limited }, organizations: { limit: 50, limited } }`, où `limited` est **vrai si la lecture a renvoyé exactement `limit` lignes** (lecture `limit + 1`, ligne surnuméraire non exposée, ou `count: "exact"`) — jamais estimé.
- Le consommateur appelle la lecture ponctuelle **seulement si** l’id demandé est absent **et** `limits.interventions.limited = true` (ou, pour un dossier présent dont le site/l’organisation/les devis manquent, si la collection correspondante est `limited`).
- **Sans signal** (enveloppe d’une version qui ne le porte pas, ou `limits` absent/illisible) : aucune lecture ponctuelle automatique ; la vue affiche « Ce dossier n’apparaît pas parmi les dossiers chargés » avec une action explicite « Ouvrir quand même » qui déclenche **une** lecture ponctuelle à la demande de l’utilisateur ; jamais « introuvable » affirmé sans lecture.

## 3. Route et autorisation
- `GET /api/interventions/<id>` — nouveau fichier `app/api/interventions/[id]/route.ts` ; client de session `authenticatedClient()` existant ; **jamais** de clé serveur / `service_role` ; lectures **sous RLS uniquement** ; aucune policy, aucun `security definer` nouveau ; pas de nouveau taux, pas de finance nouvelle.
- **Périmètres** (via `interventions_read` = `can_access_intervention(id)`) : client direct, y compris **le dossier d’un client propriétaire sans artisan attribué** (il est accessible au client et doit être servi) ; artisan **attribué** ; membres du périmètre organisation/site ; admin.
- **« Offre non attribuée »** signifie un dossier **non accessible à l’artisan** demandeur (proposé via `available_missions`, sans adresse) : la route n’appelle jamais `available_missions` et n’élargit rien ; pour un artisan non attribué, la lecture RLS renvoie 0 ligne ⇒ 404.

## 4. Enveloppe 200 (DETAIL-CONTRACT-2F9-002)
```
{
  "intervention": { <projection explicite, mêmes colonnes que celles consommées par la vue de détail> },
  "site":         { "status": "ok", "value": { id, organization_id, name, type, address, budget_cents, created_at } } | { "status": "none" } | { "status": "hidden" } | { "status": "error" },
  "organization": { "status": "ok", "value": { id, name, owner_id, created_at } } | { "status": "none" } | { "status": "hidden" } | { "status": "error" },
  "quotes":       { "status": "ok", "items": [ <colonnes explicites>, ≤ 20 ], "limited": boolean } | { "status": "error" },
  "payments":     { "status": "ok", "items": [ { id, quote_id, total_cents, currency, status, created_at, paid_at }, ≤ 20 ], "limited": boolean } | { "status": "error" },
  "messages":     { "status": "ok", "items": [ <colonnes explicites>, ≤ 200, plus récents ], "limited": boolean } | { "status": "error" },
  "documents":    { "status": "ok", "items": [ { id, intervention_id, owner_id, name, mime_type, created_at }, ≤ 50 ], "limited": boolean } | { "status": "error" },
  "appointments": { "status": "ok", "items": [ { intervention_id, starts_at, ends_at, note, updated_by, updated_at }, ≤ 50 ], "limited": boolean } | { "status": "error" },
  "generated_at": "<ISO>"
}
```
- Chaque dépendance est lue **par identifiant** sous RLS : site par `intervention.site_id`, organisation par `site.organization_id`, devis par `intervention_id`, paiements par `quote_id ∈ devis lus`, messages/documents/rendez-vous par `intervention_id` — **hors** des listes du workspace (aucune dépendance aux fenêtres 100/50/200).
- **Absence ≠ erreur** pour chaque élément lié : `none` = le dossier n’a pas de site (`site_id` nul) ; `hidden` = lecture réussie, 0 ligne sous RLS ; `error` = lecture en échec (transport/base) — la vue affiche alors « momentanément indisponible » pour cet élément, jamais « aucun ». Les listes portent `limited` (vrai si le plafond est atteint, même règle que §2).
- Projections fermées : aucune colonne hors liste, aucun `select *`. Les colonnes exactes de `intervention`, `quotes` et `messages` sont figées dans le fichier de types (`detail-read.ts`) à partir de ce que la vue consomme, revues avec le backend avant code.

## 5. Erreurs et en-têtes
- `404` « introuvable » sans divulgation : la lecture du dossier **a réussi** et ne renvoie aucune ligne sous RLS (inexistant ou non visible), ou id non UUID — indiscernables (même corps, même code).
- `401` session absente/expirée.
- `503` pour toute erreur de base/transport sur la lecture **du dossier** : corps `{"error":"…"}`, en-tête **`Retry-After: 2`** ; jamais converti en 404. Une erreur sur une **dépendance** ne fait pas échouer la réponse : statut `error` de l’élément (§4).
- **Toutes** les réponses (200/401/404/503) portent **explicitement** `Cache-Control: private, no-store` (le `dbError`/`apiError` actuel ne l’ajoute pas : la route le pose elle-même, y compris dans le `catch`).

## 6. Cache de détail (DETAIL-CONTRACT-2F9-003)
- **Indépendant** de la liste des 100 (jamais fusionné ; le signal `limited` reste exact ; un rafraîchissement du workspace ne l’efface pas).
- **Clé** = contexte complet `(génération d’identité, rôle, organisation active, site actif, id)` **+ génération de demande**.
- **Borné** : au plus 20 entrées (LRU) et **TTL 60 s** ; une entrée expirée est relue avant affichage.
- **Purge** : changement de session, de profil, de rôle, d’organisation/site actifs ou de droits connus (retrait de membre, réaffectation, changement de grant reçu par le workspace) ⇒ purge totale ; déconnexion ⇒ purge totale.
- **Revalidation indépendante de Realtime** : au focus/visibilité (même seuil que le workspace, ≥ 15 s), à l’ouverture de la vue et à l’expiration du TTL ; un événement realtime sur ce dossier peut en plus invalider l’entrée, mais n’est jamais requis.
- Réponses périmées : une réponse dont la clé de contexte ou la génération ne correspond plus est ignorée ; une seule requête en vol par clé ; `AbortController` au démontage/changement de hash.

## 7. Fichiers (séparés)
Backend `app/api/interventions/[id]/route.ts` (Codex) ; types/validation `lib/features/workspace/detail-read.ts` (schéma de l’enveloppe §4, statuts d’éléments) ; consommateur `lib/features/workspace/use-detail-read.ts` (hook sans UI : déclencheur §2, cache §6) ; câblage de la vue et textes par le lead ; ajout de `limits` au workspace (Codex).

## 8. Tests attendus (avant toute recette)
Route (faux client) : 200 pour client direct (y compris dossier sans artisan), artisan attribué, membre d’organisation/site, avec site/organisation/devis résolus par id hors des fenêtres 100/50/200 ; `none`/`hidden`/`error` distincts par dépendance ; plafonds et `limited` ; 404 identique pour inexistant, non UUID, autre client, ancien artisan après réaffectation, membre retiré, offre non accessible à l’artisan ; 503 + `Retry-After` sur erreur base/transport du dossier ; `Cache-Control: private, no-store` sur 200/401/404/503 ; aucune colonne hors liste, aucune clé serveur. Workspace : `limits.*.limited` exact (lecture `limit + 1`). Consommateur : pas d’appel sans signal hors action explicite ; cache borné (taille, TTL), purge sur changement de contexte/droits, revalidation sans Realtime, réponse périmée ignorée, une requête en vol, annulation.
