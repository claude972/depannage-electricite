# Revue croisée Claude — CODEX-INVOICE-PDF-001 au SHA 604935ef03ea7a72213d9c2d48b32ad14ad9cc52

Branche `codex/invoice-pdf` (contrat a2af4c0, base plateforme 782ce0d, writer documents 5960ad9 intégré sur cette seule branche). Revue en lecture seule dans un worktree détaché au SHA exact, avec les dépendances épinglées partagées ; aucune modification, aucun cloud, aucune migration.

## Vérifié

- Périmètre de fichiers : hors l’intégration du lot documents (attendue), seuls `lib/features/platform-operations/invoice-pdf.ts`, `app/api/platform-operations/finance/invoices/[id]/pdf/route.ts`, `tests/platform-operations/invoice-pdf.test.ts`, `tests/platform-operations/invoice-pdf-route.test.ts` et `docs/CODEX_INVOICE_PDF.md` sont touchés depuis 782ce0d. `invoice-document.ts`, la vue finance, les packages et les migrations sont intacts.
- `npx tsc --noEmit` : OK. `npx tsx --test tests/platform-operations/*.test.ts tests/documents/*.test.ts` : **70/70** (13 nouveaux).
- Rendu réel par le lead avec le renderer du SHA (fixture synthétique QA) : `docs/verification/documents/invoice-604935e.pdf` (facture 1 page : en-tête, émetteur avec « TVA intracommunautaire : non renseignée », destinataire, devis, tableau avec libellé long replié, Total HT / TVA « montant enregistré » / Total TTC, mention « aucun état de règlement déduit », pied de page) et `credit-note-604935e.pdf` (avoir : facture liée, motif, « Total TTC à déduire », mention explicite qu’aucun remboursement n’est confirmé, TVA « enregistrée… allocation cumulative »). Aucune mention légale, délai, garantie ni statut acquitté inventés.
- Validation d’instantané : schéma strict, somme des lignes = HT, HT + TVA = TTC ; TVA facture de service `round(HT × taux / 100)` et commission « TVA extraite de l’intérieur » `total − round(total / (1 + taux/100))`, formules équivalentes à 014 (les cas demi-centime possibles sur ce domaine donnent le même arrondi en JS et en PostgreSQL : vérifié par raisonnement sur les quatre taux). TVA d’avoir non recalculée (allocation cumulative de 014), bornée par la facture liée côté route (`total`, `tax` ≤ parent, même base/paiement/devis/dossier/émetteur).
- Route : ordre authentification → `requireScope(finance_read)` → id UUID (404) → seul paramètre `inline=1` (422 sinon) → lecture RLS `platform_invoices` ; avoir sans facture liée cohérente → 503 ; en-têtes `private, no-store`, `nosniff`, nom de fichier ASCII sûr ; aucun secret ni lien Storage ; messages utilisateur sans nom interne.

## Findings (aucun bloquant)

- **P3 (contenu, pris en charge par Codex dans ses fichiers)** — « Dossier : <UUID> » imprime un identifiant interne sur un document client ; préférer la référence courte du dossier (celle affichée dans l’application) ou l’omettre. `InvoiceDocumentInput` ne porte que `intervention_id` : à traiter avec le propriétaire de `invoice-document.ts` (lot plateforme) ou à omettre côté renderer.
- ~~P3 (route) — `invoiceDocumentInput` hors du `try`~~ **retiré après recoupement** : l’appel est bien à l’intérieur du `try` qui entoure `renderInvoicePdf` (lignes 36–41 de la route) et le `catch` mappe en 503. Finding erroné du lead, aucune action.
- **P3 (propriété)** — la route vit sous `app/api/platform-operations/**`, espace réservé au lot plateforme par MISSIONS ; A4 crée l’exception explicitement : la consigner dans le contrat plateforme pour éviter un conflit de propriété ultérieur.
- **À confirmer en revue SQL (hors code de ce lot)** : la policy de lecture de `platform_invoices` (014) admet bien un opérateur `finance_read` au profil client/manager et le super admin ; les tests de route utilisent des clients simulés.

## Verdict

Conforme au contrat a2af4c0 et aux invariants (aucun PDF trompeur, aucune donnée inventée, privé, immuable). Aucun bloquant ; le pilote a donné le feu au raccordement du lien (agent plateforme Claude sur une branche dérivée de `claude/web-shared` contenant la route). Codex corrige le P3 de référence de dossier dans ses fichiers ; l’exception de propriété A4 est consignée par l’amendement du contrat plateforme. Le lien UI sera ajouté par le propriétaire de la vue finance (agent plateforme Claude) : ancre `href="/api/platform-operations/finance/invoices/<id>/pdf?inline=1"` et téléchargement sans `inline`, visible seulement sur une facture/avoir existant, sans fetch dans le composant.
