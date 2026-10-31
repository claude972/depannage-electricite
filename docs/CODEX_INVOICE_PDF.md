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

Contrat seul à ce premier commit. Implémentation, résultats et artefacts seront ajoutés après exécution effective. Le lead Claude raccorde le lien dans sa coque ; ce lot ne déclare pas le menu ou la recette intégrée livrés.
