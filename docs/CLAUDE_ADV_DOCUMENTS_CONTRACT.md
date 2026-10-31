# ADV-DOCUMENTS-001 — devis enrichis, validité, avenants et documents PDF

Base : 9b3dae03e1a413ffe89b34e0db7553ddc1b3ade9. Branche : claude/web-documents. **Contrat publié avant tout code ; implémentation, tests et revue SQL isolée livrés dans les commits suivants de cette branche. Aucune migration appliquée, aucun déploiement, aucune donnée commerciale ou réglementaire inventée.**

## Plan court

1. Migration 015 additive (dépend seulement de 001–013) : validité explicite par devis, avenants versionnés liés à un devis accepté, documents générés à partir d’un instantané serveur immuable, journal d’événements. RLS lecture par accès au dossier ; toutes les mutations passent par des commandes SECURITY DEFINER sous verrous organisation → dossier.
2. Routes privées `app/api/quote-documents/**` et `app/api/quote-amendments/**` : schémas zod stricts, `authenticatedClient`, `assertOrigin`, `dbError`, `Cache-Control: private, no-store`, messages français sans nom interne.
3. Rendu PDF sans dépendance nouvelle : écrivain PDF 1.4 minimal maison (`lib/features/quote-documents/pdf.ts`), polices standard Helvetica/Helvetica-Bold (Type1 de base, encodage WinAnsi, échappement des chaînes), table xref calculée en octets et vérifiée par tests. Le PDF est rendu à la demande depuis l’instantané stocké, jamais depuis des données vivantes ; il est servi uniquement par une route authentifiée en flux (pas de bucket, pas d’URL publique).
4. Composants feuilles React (`components/features/quote-documents/**`, CSS module propre, DESIGN.md) avec états chargement / erreur avec reprise / vide / validation / indisponible, raccordables par le lead via une clé `Capabilities` proposée.
5. Tests : `tests/documents/*.test.ts` (routes avec fausses dépendances, structure PDF, cohérence des montants, états de validité) et `tests/sql-quote-documents-review.mjs` (PostgreSQL isolé, harnais existant).

## Invariants respectés

- Un devis accepté reste immuable : aucune colonne de `public.quotes` n’est modifiée par ce lot (seul un trigger de garde refuse l’acceptation d’un devis dont la validité explicite est dépassée).
- Un avenant est un objet versionné distinct, rattaché au devis accepté, avec ses propres lignes et montants calculés serveur selon les mêmes règles que `send_quote`. Il doit être explicitement accepté par le décideur du dossier avec son identifiant exact ; un seul avenant proposé à la fois par devis.
- Le document reflète exactement la version sélectionnée : l’instantané est construit côté base au moment de la génération et porte l’identifiant du devis/avenant, ses lignes, ses totaux, sa validité et son état. Un nouvel instantané différent crée une révision ; un instantané identique renvoie le document existant (idempotence).
- Émetteur : uniquement les données réelles du dossier professionnel (`artisan_profiles.company_name`, `siret`, `legal_status`, `address`) et du compte (`profiles.full_name`, `phone`). Si `company_name`, `siret` (14 chiffres) ou `address` manquent, la génération refuse avec une erreur de configuration explicite (code `QD001`, liste des champs) : jamais de PDF mensonger. Le numéro de TVA intracommunautaire et l’assurance n’existent pas dans le schéma : le document indique « non renseigné dans le dossier professionnel », sans valeur inventée.
- Validité : `valid_until` nul signifie « validité non renseignée », affiché tel quel dans l’API, l’UI et le PDF. Aucune rétro-expiration : un devis sans validité n’expire jamais implicitement ; une validité passée ne peut pas être enregistrée.
- Aucune signature certifiée, aucun cachet, aucune mention légale ou numérotation réglementaire inventée : le document porte une référence applicative (`DEV-XXXXXX`, `AV-n-DEV-XXXXXX`) et la mention qu’il n’est pas une facture.
- Règlement : l’acceptation d’un avenant n’est pas raccordée au paiement en ligne (montant Stripe = devis accepté). L’API et l’UI le disent explicitement (`settlement: "not_connected"`). Le lot plateforme/finance reprend l’interface de rendu (`renderQuoteDocumentPdf`) pour factures/avoirs : une seule source de rendu.

## Modèle de données (migration `202610310015_quote_documents.sql`)

```
quote_terms(quote_id pk→quotes, valid_until date null, set_by→profiles, updated_at)
quote_amendments(id pk, intervention_id→interventions, base_quote_id→quotes, artisan_id→profiles,
  version int (unique par base_quote_id), reason text 1..2000, lines jsonb, subtotal_cents>0,
  tax_rate in (0,5.5,10,20), tax_cents>=0, total_cents 1..10000000, valid_until date null,
  status in ('proposed','accepted','rejected','withdrawn'), decision_note<=2000,
  decided_by→profiles, created_at, decided_at)
  index unique partiel : un seul 'proposed' par base_quote_id
quote_documents(id pk, intervention_id, quote_id→quotes, amendment_id→quote_amendments null,
  kind in ('quote','amendment'), revision int>=1, reference text, snapshot jsonb,
  snapshot_sha256 hex64, generated_by→profiles, generated_at)
  unique (quote_id, amendment_id, revision)
quote_document_events(id identity, intervention_id, quote_id, amendment_id null, document_id null,
  actor_id, action in ('terms_set','document_generated','document_downloaded','amendment_proposed',
  'amendment_accepted','amendment_rejected','amendment_withdrawn'), details jsonb, created_at)
```

RLS : `select` pour `authenticated` si `public.can_access_intervention(intervention_id)` (via `quotes` pour `quote_terms`) ; aucun `insert/update/delete` direct ; `service_role` conserve tout. Les anciens membres, viewers hors périmètre de site et tiers sont refusés par les helpers existants (009).

Commandes (`security definer`, `set search_path=''`, exécution réservée à `authenticated` sauf mention) :

| Fonction | Acteur | Règles |
| --- | --- | --- |
| `set_quote_terms(p_quote_id, p_valid_until)` | artisan auteur du devis, encore attribué, approuvé | devis `sent` uniquement ; `valid_until` nul ou ≥ date du jour ; verrous organisation → dossier → devis ; événement `terms_set` ; limite 20/min |
| `propose_quote_amendment(p_base_quote_id, p_lines, p_tax_rate, p_reason, p_valid_until)` | artisan attribué, approuvé, dossier approved | devis de base `accepted`, dossier `accepted` ou `in_progress` ; lignes 1..30 validées comme `send_quote`, totaux calculés serveur ; aucun avenant déjà `proposed` ; version = max+1 ; événement + `audit_log` |
| `withdraw_quote_amendment(p_id)` | artisan auteur | `proposed` → `withdrawn` |
| `decide_quote_amendment(p_id, p_decision, p_note)` | `owns_intervention` (client ou gestionnaire de site avec écriture) | `proposed` seulement, dossier `accepted`/`in_progress` ; refus si validité explicite dépassée ; si une règle d’approbation de site est active et que (devis + avenants acceptés + celui-ci) dépasse le seuil, refus explicite (le circuit d’approbation des avenants n’est pas livré : pas de contournement) ; événement + `audit_log` |
| `generate_quote_document(p_quote_id, p_amendment_id)` | artisan auteur, `owns_intervention` ou admin | instantané serveur ; `QD001` si émetteur incomplet ; révision nouvelle seulement si l’empreinte change ; événement `document_generated` ; limite 20/min |
| `record_quote_document_download(p_document_id)` | tout acteur ayant accès au dossier | événement `document_downloaded` ; limite 60/min |
| `quote_documents_overview(p_intervention_id)` | tout acteur ayant accès au dossier | lecture consolidée (ci-dessous) ; `stable` |
| `quote_validity_state(date)` | interne | `unspecified` / `valid` / `expired` (date du jour serveur, inclusif) |
| trigger `quote_validity_guard` before update on quotes | — | refuse `sent → accepted` si `quote_terms.valid_until < current_date` (P0001) |

Codes d’erreur SQL → HTTP : `42501` 403, `P0002` 404, `P0001`/`23505` 409, `22023`/`23514` 422, `53300` 429, `QD001` 409 `{error, code:"issuer_incomplete", missing:[...]}`, autre 503.

## Instantané de document (`snapshot`)

```
{ kind:"quote"|"amendment", reference:"DEV-ABC123"|"AV-2-DEV-ABC123", currency:"EUR",
  intervention:{id, reference:"INT-ABC123", category, urgency, address, postal_code, city, description},
  issuer:{company_name, legal_status, siret, address, contact_name, phone, missing_optional:[...]},
  recipient:{name, organization:{name}|null, site:{name,address}|null},
  quote:{id, status, created_at, accepted_at, lines:[{label,quantity,unit_price_cents}],
         subtotal_cents, tax_rate, tax_cents, total_cents,
         terms:{valid_until|null, validity:"unspecified"|"valid"|"expired"}},
  amendment:null | {id, version, status, reason, created_at, decided_at, lines, subtotal_cents, tax_rate,
         tax_cents, total_cents, terms:{...}, cumulative_total_cents (devis + avenants acceptés + celui-ci)},
  settlement:"not_connected", notices:["Ce document n’est pas une facture.", ...] }
```
`snapshot_sha256 = sha256(snapshot::text)`. Le rendu recalcule sous-total/TVA/total depuis les lignes et refuse (503) tout instantané incohérent ; le PDF imprime la date de génération, la révision et l’empreinte abrégée.

## API

Toutes les réponses : JSON `Cache-Control: private, no-store` ; 401 sans session ; 403 acteur non autorisé ; 404 dossier/document inconnu ; 409 état changé, double envoi, validité dépassée, émetteur incomplet ; 422 données invalides ; 429 limite ; 503 service/rendu indisponible. Aucun paramètre inconnu accepté.

### `GET /api/quote-documents?intervention_id=UUID`
```
{ intervention:{id,status,artisan_id,site_id}, viewer:{role, is_artisan, can_manage},
  issuer:{ready:boolean, missing:string[]}          // missing détaillé seulement pour l’artisan lui-même
  quotes:[{ id, reference, status, created_at, accepted_at, subtotal_cents, tax_rate, tax_cents, total_cents,
     terms:{valid_until, validity, updated_at}|null,
     permissions:{can_set_terms, can_generate, can_propose},
     documents:[{id, kind, reference, revision, generated_at, snapshot_sha256}],
     amendments:[{ id, version, reference, status, reason, created_at, decided_at, decision_note,
        subtotal_cents, tax_rate, tax_cents, total_cents, lines, terms:{valid_until, validity},
        permissions:{can_decide, can_withdraw, can_generate}, documents:[...] }] }],
  history:[{id, action, actor_id, quote_id, amendment_id, document_id, details, created_at}],   // 200 derniers
  settlement:"not_connected" }
```
Les permissions sont calculées serveur ; l’UI ne déduit aucun droit d’un rôle ou d’un menu.

### `POST /api/quote-documents`
- `{action:"set_terms", quote_id, valid_until:"YYYY-MM-DD"|null}` → `{terms}`
- `{action:"generate", quote_id, amendment_id:UUID|null}` → `{document, created:boolean}` (201 si nouvelle révision)

### `GET /api/quote-documents/[id]`
Flux `application/pdf` (`Content-Disposition: attachment; filename="devis-DEV-ABC123-r1.pdf"`, `?inline=1` pour affichage), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. Lecture sous RLS, événement de téléchargement enregistré avant l’envoi, rendu depuis l’instantané. Aucune URL signée : la route authentifiée est l’unique accès.

### `POST /api/quote-amendments`
- `{action:"propose", base_quote_id, lines:[{label,quantity,unit_price_cents}], tax_rate:0|5.5|10|20, reason, valid_until|null}` → `{amendment}` 201
- `{action:"withdraw", amendment_id}` → `{amendment}`
- `{action:"accept", amendment_id}` / `{action:"reject", amendment_id, note}` → `{amendment}` ; l’acceptation ne prend que l’identifiant exact de la version affichée, aucun montant navigateur.

## Rendu PDF

`lib/features/quote-documents/pdf-writer.ts` : objets, pages A4, flux de texte, polices Helvetica/Helvetica-Bold (Type1 de base, `WinAnsiEncoding`), encodage Unicode → WinAnsi (é, è, ç, €, œ, ’, espace insécable), remplacement `?` pour les caractères non représentables, échappement `\ ( )`, xref à offsets exacts, `startxref`, `%%EOF`. `lib/features/quote-documents/pdf.ts` : `renderQuoteDocumentPdf(snapshot, meta)` → `Uint8Array`, pagination automatique des lignes, totaux alignés à droite via table de chasses Helvetica. Tests : en-tête, offsets xref relus et pointant sur `n 0 obj`, trailer `/Size`, échappement, contenu multipage, refus d’instantané incohérent.

## UI — composants feuilles

Dossier `components/features/quote-documents/` (CSS module local, tokens DESIGN.md : bleu `#1457D9`, bleu nuit, bordures 1px, pas d’ombre lourde, cibles 44 px, focus visible, statut jamais transmis par la seule couleur).

- `QuoteDocumentsPanel` props : `{ interventionId: string; quoteId?: string; variant: "artisan" | "client" | "enterprise"; client?: QuoteDocumentsClient; onContractState?: (state: ContractState) => void; onChanged?: () => void }`. Charge l’aperçu, affiche par devis : validité (formulaire artisan si `can_set_terms`), documents (générer / télécharger), avenants (proposition artisan si `can_propose`, décision si `can_decide`, retrait si `can_withdraw`), historique. États : chargement, erreur avec « Réessayer », vide (« Aucun devis pour ce dossier »), indisponible (404/405 → `missing`, 503/réseau → `unavailable`), configuration émetteur incomplète (liste des champs, lien vers le dossier professionnel via `onOpenProfile?`), conflit 409 avec rechargement explicite, validation de formulaire près des champs, protection double soumission.
- `QuoteDocumentsClient` (`lib/features/quote-documents/client.ts`) : `{ overview(interventionId), setTerms(body), generate(body), propose(body), decide(body), withdraw(body), downloadHref(documentId, inline?) }` ; implémentation par défaut `createQuoteDocumentsClient(fetcher?)` sur les routes ci-dessus, erreurs `{status, message, code?, missing?}`.
- Vues cibles : panneau devis artisan (`variant="artisan"`, sous le devis courant), vue devis client (`variant="client"`, sous le tableau du devis), approbations entreprise (`variant="enterprise"`, détail d’un devis/approbation). Le lead raccorde en passant `interventionId` et éventuellement `quoteId` pour n’afficher qu’une version.
- Clé `Capabilities` proposée : `quoteDocuments: ContractState` (mise à jour par `onContractState`). Aucune entrée de menu nouvelle requise ; aucune modification de `components/app/**` ou `components/role/**` par ce lot.

## Vérifications

- `npx tsc --noEmit`, `npx tsx --test tests/documents/*.test.ts`, `npx tsx --test tests/*.test.ts`.
- `PGLITE_MODULE=... node tests/sql-quote-documents-review.mjs` : 015 s’exécute après 001–013 sans objet de 014/016/017 ; helpers/policies antérieurs byte-identiques ; refus anonyme/tiers/viewer hors site/membre retiré/artisan réaffecté ; validité passée refusée, devis sans validité jamais expiré, garde d’acceptation sur validité dépassée ; avenant : devis non accepté refusé, double proposition 409, acceptation avec identifiant exact seulement, double acceptation 409, retrait, refus, seuil d’approbation de site bloquant ; génération : émetteur incomplet `QD001`, idempotence par empreinte, nouvelle révision après changement d’état, événements et `audit_log` ; pas de modification de `quotes` hors trigger de garde.
- Preuves à produire par la revue Codex : exécution SQL sur la base dédiée, PDF ouvert et relu à l’œil (montant, version, TVA, validité, émetteur), tentative de téléchargement par un tiers.

## Explicitement hors lot

Factures/avoirs et numérotation comptable ; raccordement du règlement des avenants au paiement ; circuit d’approbation B2B des avenants (seulement bloqué, pas livré) ; signature électronique ; envoi e-mail ; stockage objet des PDF ; modification des routes/contrats devis existants ; menus et coques de rôle.

## Amendement 1 — conformité au contrat partagé WEB-SHARED-001 (correction lead sur 0a01147)

Référence : `docs/CLAUDE_WEB_SHARED_CONTRACT.md` (claude/web-shared a29f732). Cet amendement remplace la section « UI — composants feuilles » ci-dessus pour tout ce qui concerne les props, l’accès réseau et les états ; le modèle de données, la migration, les routes et le rendu PDF sont inchangés.

### Ce qui est retiré
- Le client optionnel `createQuoteDocumentsClient(fetcher?)` et tout appel `fetch` autonome dans un composant feuille : supprimés. La prop `client` est **obligatoire**, construite par le lead sur `api()` existant et bornée par sa garde d’identité (`createRunner`/`runForResult`).
- Les props `onContractState`, `onChanged`, `onOpenProfile` : supprimées. Le lead calcule `state` avec `contractStateFromError` et passe la navigation par `onNavigate`.
- Tout import de `components/app/**` ou `components/courant-app` : aucun. Les types du lot vivent dans `lib/features/quote-documents/types.ts` ; les formats (euros, dates, références) dans `lib/features/quote-documents/format.ts`. Primitives communes réutilisées par classes globales (`.unavailable`, `.field-error`, `.tag`), jamais par import.

### Props normalisées de `QuoteDocumentsPanel`
```
state: "unknown" | "available" | "missing" | "unavailable"
unavailableMessage?: string                       // libellé commun fourni par le lead pour state ≠ available
scope: { userId: string; role: "client"|"artisan"|"manager"|"admin"; organizationId?: string; siteId?: string;
         authority: { canWrite: boolean; reason?: string } }
client: QuoteDocumentsClient                      // obligatoire, injecté
demo?: QuoteDocumentsDemo                         // graines de lib/features/quote-documents/demo.ts, mode démonstration explicite seulement
onNavigate?(view: string, param?: string): void   // navigation déléguée (hash routing du lead)
// données propres au lot :
target: { interventionId: string } | { quoteId: string }   // un dossier complet, ou une seule version (vue `quote-documents`, param = id de devis)
variant: "artisan" | "client" | "enterprise"      // copie seulement, jamais un droit
```
`QuoteDocumentsClient` (`lib/features/quote-documents/types.ts`) :
```
load(target): Promise<QuoteDocumentsOverview | null>
command(body: QuoteDocumentsCommand): Promise<QuoteDocumentsCommandResult | null>
documentHref(documentId: string, inline?: boolean): string   // URL de la route privée GET /api/quote-documents/[id] ; aucun fetch, lien <a> seulement
```
`QuoteDocumentsCommand` = `set_terms` | `generate` | `propose` | `withdraw` | `accept` | `reject` (corps des routes ci-dessus, le lead choisit la route). Un résultat `null` signifie chaîne périmée (identité changée, déconnexion) : **aucun message de succès, aucune mise à jour d’état**, le formulaire reste tel quel sans indicateur d’enregistrement. Toute erreur `{ status, message, code?, missing? }` est rendue telle quelle (message serveur), avec `data-blocker` technique sans nom interne dans la copie.

### Comportements exigés
- Changement de `scope` (`userId`, `organizationId`, `siteId`) ou de `target` : effacement des formulaires, brouillons locaux, conflits, notices et données chargées, puis rechargement via `client.load` si `state === "available"`.
- `state ≠ "available"` : aucun appel de `client` ; écran indisponible honnête avec `unavailableMessage` (ou libellé par défaut du lot) et `data-blocker`.
- `scope.authority.canWrite === false` : contrôles d’écriture (validité, génération, proposition, décision, retrait) absents, raison affichée ; les téléchargements de documents existants restent possibles. Les permissions serveur (`permissions.*` de l’aperçu) restent la vérité fine : un contrôle n’apparaît que si `canWrite` **et** la permission serveur sont vrais ; un refus serveur ultérieur est rendu tel quel.
- États obligatoires : chargement, erreur avec action « Réessayer », vide (« Aucun devis pour ce dossier »), validation de formulaire près des champs (valeurs conservées après échec), indisponible, lecture seule, conflit 409 avec rechargement explicite, configuration émetteur incomplète (champs listés, lien `onNavigate("artisan-profile")` proposé au lead), double soumission protégée.
- Démonstration : `demo` fourni → aucun appel `client`, données des graines étiquetées démonstration, commandes rendues comme « non enregistrées en démonstration », liens de téléchargement désactivés.

### Capacité, sonde et vue (section 3 du contrat partagé)
- Clé `Capabilities` : `quoteDocuments` (exactement). Sonde : `GET /api/quote-documents?quote_id=<id>` **ou** `?intervention_id=<id>` (exactement un des deux) ; la variante `quote_id` résout le dossier du devis sous RLS puis renvoie le même aperçu limité à ce devis. Vue : `quote-documents` (param = id de devis). Aucune vue ni clé supplémentaire demandée.
- Tests du lot (`tests/documents/*.test.ts`) : un test par état indisponible / lecture seule / refus serveur / résultat `null`, en plus des tests de routes et de PDF.

Historique : 0a01147 contrat initial ; cet amendement est publié avant tout composant.

## Livraison — checkpoints et interface de raccordement

Historique des SHA (origin claude/web-documents) : 0a01147 contrat ; 0e31711 amendement 1 (WEB-SHARED-001) ; 61becd9 migration 015 + revue SQL ; add90c9 correction P2 (accès courant sous verrou), renderer PDF, routes, composant feuille, tests.

### Correction P2 (revue pilote de 61becd9)
`generate_quote_document` acceptait l’auteur historique d’un devis après réaffectation. Depuis add90c9 : vérification de l’accès **courant** sous le verrou du dossier (`can_access_intervention`) et, pour un document émis par l’artisan, exigence que l’auteur soit encore l’artisan attribué ; `withdraw_quote_amendment` exige attribution courante + accès ; `decide_quote_amendment` revérifie l’accès ; la permission `can_generate` de l’aperçu suit la même règle. Revue SQL : refus de l’ancien artisan après `reassign_intervention` (le nouvel artisan n’est pas l’émetteur ; le propriétaire conserve l’accès), retrait d’attribution simulé sur un devis accepté avec avenant (génération devis/avenant, retrait et téléchargement refusés à l’ancien auteur), gestionnaire avec grant d’écriture puis retrait du grant par l’owner (lecture/génération/décision refusées).

### Fichiers livrés
- `supabase/migrations/202610310015_quote_documents.sql` — tables `quote_terms`, `quote_amendments`, `quote_documents`, `quote_document_events`, RLS lecture par accès au dossier, trigger `quote_validity_guard`, commandes `set_quote_terms`, `propose_quote_amendment`, `withdraw_quote_amendment`, `decide_quote_amendment`, `generate_quote_document`, `record_quote_document_download`, `quote_documents_overview` ; helpers privés `quote_validity_state`, `quote_document_reference`, `quote_document_issuer`, `quote_document_snapshot`, `quote_document_json`, `quote_amendment_json`. Dépend seulement de 001–013 (vérifié : la revue charge 001–013 puis 015 sans 014/016/017).
- `lib/features/quote-documents/` — `types.ts` (contrat du lot, `QuoteDocumentsClient`, `QuoteDocumentsScope`), `format.ts`, `validity.ts`, `snapshot.ts` (schéma strict + recalcul des montants), `pdf-writer.ts` (PDF 1.4, Helvetica/Helvetica-Bold WinAnsi, xref exacte, métadonnées UTF-16), `pdf.ts` (`renderQuoteDocumentPdf(snapshot, meta)` — interface de rendu réutilisable par le lot plateforme pour factures/avoirs), `panel-model.ts` (réducteur et validation de formulaire purs), `demo.ts` (`quoteDocumentsDemo(role)`), `server.ts` (en-têtes privés, erreur `issuer_incomplete`).
- `app/api/quote-documents/route.ts` (GET aperçu `?intervention_id=` ou `?quote_id=`, POST `set_terms`/`generate`), `app/api/quote-documents/[id]/route.ts` (GET flux PDF privé, `?inline=1`), `app/api/quote-amendments/route.ts` (POST `propose`/`withdraw`/`accept`/`reject`).
- `components/features/quote-documents/` — `quote-documents-panel.tsx` (`QuoteDocumentsPanel`), `validity-form.tsx`, `amendment-form.tsx`, `quote-documents.module.css`, `index.ts`.
- Tests : `tests/documents/{pdf,snapshot,panel-model,quote-documents-route,quote-amendments-route,panel}.test.ts` + `tests/documents/harness.ts` (33 tests) ; `tests/sql-quote-documents-review.mjs` (12 sections PASS).

### Contrôles exécutés (add90c9)
`npx tsc --noEmit` : aucune erreur. `npx tsx --test tests/documents/*.test.ts` : 33/33. `npx tsx --test tests/*.test.ts` : 93/93. `PGLITE_MODULE=… node tests/sql-quote-documents-review.mjs` : 12/12 PASS. Les sept scripts `tests/sql-*-review.mjs` existants passent avec 015 présente. PDF exemples (devis 30 lignes sur 2 pages, avenant) analysés en mode strict par un lecteur PDF indépendant (pypdf) et inspectés visuellement après rastérisation. Pas de `next build`/`next dev` lancé par ce lot.

### Ce que le lead raccorde
- Clé `Capabilities.quoteDocuments` ; sonde `GET /api/quote-documents?quote_id=<id>` ou `?intervention_id=<id>` (404/405 → `missing`, 503/réseau → `unavailable`). Vue `quote-documents` (param = id de devis).
- `client` : `{ load(target) → api<QuoteDocumentsOverview>(GET …), command(body) → POST /api/quote-documents (set_terms, generate) ou /api/quote-amendments (propose, withdraw, accept, reject), documentHref(id, inline?) → "/api/quote-documents/<id>[?inline=1]" }`, chaque appel borné par `runForResult` (null = chaîne périmée). Les erreurs doivent conserver `{ status, message, code?, missing? }` (`ApiRequestError` convient ; pour `issuer_incomplete`, transmettre `code` et `missing` du corps JSON).
- Props : `state`, `unavailableMessage?`, `scope` (`authority.canWrite` = autorité entreprise fail-closed ou vrai pour client/artisan), `client`, `demo?` (`{ overview: quoteDocumentsDemo(role) }` en démonstration seulement), `onNavigate?` (vue `artisan-profile` proposée pour compléter le dossier), `target`, `variant`.
- Ancrages (via l’agent design) : panneau devis artisan sous le devis courant (`variant="artisan"`, `target={{ interventionId }}`), vue devis client sous le tableau (`variant="client"`, `target={{ quoteId }}`), détail approbation entreprise (`variant="enterprise"`, `target={{ quoteId }}`).

### Ce que Codex vérifie
- Revue SQL sur la base dédiée : `tests/sql-quote-documents-review.mjs` puis les sept scripts existants ; application séquentielle de 015 seulement après revue.
- PDF ouvert à l’œil (devis et avenant) : montant/TVA/version/validité/émetteur relus contre la base ; tentative de téléchargement par un tiers (404) et par un membre retiré ; double acceptation d’avenant (409) ; émetteur incomplet (409 `issuer_incomplete`, aucun PDF).
- Après raccordement : captures 360/1280, console propre, test de refus `canWrite=false`.

### Explicitement non livré
Factures/avoirs et numérotation comptable ; règlement en ligne des avenants (montant Stripe = devis accepté, dit dans l’API, l’UI et le PDF) ; circuit d’approbation B2B des avenants (bloqué explicitement au-delà du seuil, pas livré) ; signature électronique ; envoi e-mail ; stockage objet des PDF ; menus, coques de rôle et fichiers globaux ; toute modification des routes/contrats devis existants (seul le trigger de garde sur validité explicite touche `public.quotes`, en refus uniquement).
