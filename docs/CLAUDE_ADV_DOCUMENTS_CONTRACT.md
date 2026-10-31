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
