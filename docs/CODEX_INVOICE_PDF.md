# CODEX-INVOICE-PDF-001

## Contrat publié avant code

Mission A4 publiée sur `missions/web-pwa` (d8ebb3e). Propriété confirmée par le lead Claude (d6ac5fb), puis autorisation de coder transmise par Codex pilote. Branche `codex/invoice-pdf`, base plateforme `782ce0d`, dépendance writer documents `5960ad9`. Aucun code des autres lots n'est modifié ; leur checkpoint documents est seulement intégré sur cette branche.

Plan : (1) réutiliser `PdfDocument`, `wrapText` et les métriques Helvetica du writer existant ; (2) valider l'instantané de facture/avoir stocké puis produire un PDF paginé ; (3) exposer le téléchargement privé sous authentification, permission serveur `finance_read` et RLS ; (4) tests de rendu/arithmétique/refus, génération d'exemples QA hors dépôt, rastérisation et inspection visuelle ; (5) revue Claude et pilote avant intégration.

Fichiers possédés exclusivement : `lib/features/platform-operations/invoice-pdf.ts`, `app/api/platform-operations/finance/invoices/[id]/pdf/route.ts`, nouveaux `tests/platform-operations/invoice-pdf*.test.ts`, ce document. Aucun package, migration, menu, composant partagé ou branche Claude modifié.

## Interface

`GET /api/platform-operations/finance/invoices/<uuid>/pdf` renvoie un PDF en pièce jointe ; `?inline=1` permet son ouverture privée dans le navigateur. Tout autre paramètre, y compris doublon, est refusé (422). Identifiant absent/malformé ou ligne non lisible : 404 ; sans session : 401 ; sans scope courant : 403 ; données incohérentes ou service indisponible : 503. Chaque réponse est `Cache-Control: private, no-store` ; succès `Content-Type: application/pdf`, `X-Content-Type-Options: nosniff`, nom ASCII sûr. Aucun lien Storage public ni secret de service.

La route utilise `authenticatedClient`, `requireScope(db, "finance_read")`, puis une sélection RLS de `platform_invoices`. Pour un avoir, elle relit sa facture liée (même stockage immuable) et exige une vraie facture correspondante. Aucun profil, paramétrage émetteur ou paiement vivant n'alimente le PDF ; les coordonnées, lignes, taux, montants, numéros et dates proviennent des lignes stockées.

`renderInvoicePdf(input: InvoiceDocumentInput & { basis: "service" | "platform_commission" }): Uint8Array<ArrayBuffer>` dans le nouveau fichier réutilise le contrat `invoiceDocumentInput` déjà livré, complété du `basis` stocké. La validation refuse les parties requises absentes, les montants non entiers ou incohérents, les lignes invalides, les dates invalides et un avoir sans référence de facture. Pour les factures de service, la TVA est ajoutée au HT ; pour la commission confirmée, elle est extraite du TTC selon le calcul de migration014. Pour les avoirs, la TVA stockée n'est pas recalculée comme une nouvelle facture : migration014 plafonne le cumul au reliquat de TVA de la facture, ce qui peut légitimement produire un ajustement d'un centime. La somme des lignes HT et HT + TVA = TTC restent vérifiées exactement.

Le PDF affiche facture/avoir, numéro stocké, date UTC, émetteur/destinataire, référence du devis/dossier, tableau des prestations, HT/TVA/TTC, pagination ; l'avoir précise sa facture liée et son motif. Les montants d'un avoir sont identifiés comme montants à déduire, pas comme remboursement exécuté. Aucun statut acquitté/remboursé, délai de règlement, garantie, mention légale ou numéro de TVA n'est inventé. L'absence de donnée facultative est explicitement indiquée ou omise.

## Vérifications prévues

Tests existants et nouveaux ciblés : syntaxe PDF/xref, accents français et échappement, pagination avec libellés longs, centimes/taux multiples, avoir avec TVA ajustée, déterminisme, refus des instantanés invalides ; route : authentification/scope avant lecture, refus RLS et erreurs fournisseur, facture/avoir lié, paramètres stricts, nom sûr et en-têtes privés. Typecheck au checkpoint combiné. Les tests de route utilisent le vrai renderer et des clients SQL simulés ; ils ne prouvent pas une recette Supabase réelle.

Exemples synthétiques identifiés QA, PDF/PNG hors dépôt ; ouverture avec lecteur indépendant et inspection des pages rendues. Aucun credential, fixture cloud, débit Stripe, nouveau déploiement, achat ou publication.

## État

Contrat seul au premier commit `a2af4c0`. Implémentation poussée : `604935ef03ea7a72213d9c2d48b32ad14ad9cc52` ; réutilisation du checkpoint documents `5960ad9` par merge `0da3fbb` sur cette branche seulement. Le lead Claude raccorde le lien dans sa coque ; ce lot ne déclare pas le menu ou la recette intégrée livrés.

## Rapport de livraison au SHA604935e

Fichiers applicatifs ajoutés : le renderer/validateur `invoice-pdf.ts` et la route `finance/invoices/[id]/pdf/route.ts`. Deux nouveaux fichiers de tests autorisés A4. Aucun fichier existant des lots plateforme/documents modifié par le développement PDF, aucun package/migration/coque modifié. Le lien de téléchargement attendu dans la coque est `/api/platform-operations/finance/invoices/${invoice.id}/pdf` (pièce jointe), ou le même lien avec `?inline=1` (ouverture). Aucun `Capabilities.invoice_rendering` existant n'a été changé ; le lead en reste propriétaire.

### Contrôles effectivement exécutés

- `./node_modules/.bin/tsx --test tests/platform-operations/invoice-pdf*.test.ts` : 13/13 PASS.
- `./node_modules/.bin/tsx --test tests/platform-operations/*.test.ts tests/documents/*.test.ts` : 70/70 PASS, dont les nouveaux13.
- `npm run typecheck` : PASS ; `git diff --check` : PASS.
- Le premier typecheck a détecté une propriété facultative `issuer.vat_number` incompatible avec le contrat partagé ; normalisation explicite à `null` corrigée, puis contrôles ci-dessus réussis. Le premier marqueur d'artefact pointait par erreur vers le helper DOCX et a refusé le format ; le helper PDF correct a ensuite été exécuté avec succès une seule fois avant la génération des exemples.
- Trois fichiers QA synthétiques ont été générés hors dépôt. Lecture indépendante `pypdf.PdfReader(..., strict=True)` : 3 PDF valides, accents et totaux attendus extraits ; facture30 lignes sur3pages, avoir1page, commission1page. Les5 pages ont été rastérisées avec Poppler110dpi puis ouvertes/inspectées : tableaux alignés, en-têtes répétés, pagination, accents, HT/TVA/TTC et lien facture lisibles ; aucun texte coupé ou superposé. Poppler a émis un avertissement Fontconfig de configuration système, sans empêcher le rendu vérifié.

### Artefacts locaux de recette

Dossier : `/tmp/depannage-invoice-pdf-qa-dMTs7f` (aucune donnée utilisateur ; toutes les identités et références portent QA).

| Fichier | Pages | SHA256 |
| --- | --- | --- |
| `facture-multipage-qa.pdf` | 3 | `d806fa5d432083645807576209a6fb81d6dddb8f169bb9cadb85fd517c61a8ec` |
| `avoir-arrondi-qa.pdf` | 1 | `3fea9bc3b5e52264869383c4821a65431682b975866b36cad22cefcc6fdbb283` |
| `facture-commission-qa.pdf` | 1 | `48baa0b9f70fc4ae08ff2a0ac89d7d06ccca084182defedc0873d47e7cc749e6` |

Les PNG correspondants portent le même radical suivi du numéro de page. Le script QA temporaire `/tmp/depannage-invoice-pdf-examples.mts` n'appartient pas au bundle ni au dépôt. Les sorties QA ne sont pas une preview déployée.

### Garanties bornées et revue attendue

Les tests exécutent le vrai renderer et de vrais clients Supabase JS avec transport HTTP simulé. Ils prouvent les refus401/403/404/422/503, le scope avant lecture, la lecture limitée au registre immuable sous client authentifié, les paramètres stricts, les en-têtes privés et la relation facture/avoir dans la route ; ils ne prouvent pas une nouvelle recette RLS distante. Le fonctionnement RLS réel dépend de migration014, qui n'est pas appliquée par cette mission. Aucun compte, document cloud, facture comptable, remboursement ou paiement réel créé.

Le renderer contrôle les parties nécessaires et les centimes, conserve la TVA exacte de l'avoir, distingue service HT et commission TTC, réutilise les métriques/encodages/échappements du writer canonique. L'avoir ne vaut pas confirmation d'un remboursement. Pas de signature électronique, conditions de paiement, assurance, TVA intracommunautaire ou mention réglementaire inventées. Les polices du writer sont WinAnsi : les accents français sont couverts ; les caractères hors de cet alphabet suivent le remplacement existant `?` (pas de nouvelle promesse multilingue).

À revoir indépendamment par Claude et le pilote : exactSHA604935e, routes et validation d'instantanés, relation avoir/facture, refus finance, exemples visuels. À vérifier après raccordement par le propriétaire de la coque : lien visible selon droits, facture et avoir sélectionnés exacts, ouverture privée, révocation réelle, erreurs/configuration. Aucun build lourd, nouveau déploiement, modification de production, provider Stripe ou natif exécuté dans ce lot.
