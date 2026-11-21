# Correctifs UX O1, O2, O3, O7, O10 (Claude) + D23 (Codex) — 19/11/2026

Demandé par le propriétaire via Codex (« corrige les observations ux restantes o1/o2/o3/o7/o10 avec preuves ciblées »).

**Livraison**
- Commit Claude `b9002dd9`.
- Patch à intégrer côté Codex : `UX-O1-O2-O3-O7-O10-20261119.patch` (`git am`).
- D23 (Codex b0c66a2) est intégré à l'identique : commit `4fd8e1bf`.

## Changements
| Id | Fichiers | Changement |
|---|---|---|
| O1 | `credential-review-panel.tsx`, `artisan-space.tsx` | Le panneau de revue signale la décision courante qu'il a lue (`onCurrentDecision`). La carte de la pièce affiche « Acceptée », « Modifications demandées » ou « Refusée » à la place de « Transmis ». Sans lecture aboutie, « Transmis » reste affiché. Les pièces manquantes ou à renouveler ne changent pas. |
| O2 | `components/app/forms.tsx` | À la sélection des photos d'une demande, les octets de tête sont contrôlés (JPEG, PNG, WebP). Un fichier non conforme est signalé nommément et écarté. Le serveur reste l'autorité. |
| O3 | `artisan-space.tsx`, `enterprise-space.tsx` | Un créneau dont le début est passé est refusé avant tout envoi, avec un message sur le champ. Le formulaire client avait déjà ce contrôle. |
| O7 | `review-contestation-panel.tsx` | L'erreur de longueur du motif s'affiche sous le champ, reliée par `aria-invalid` et `aria-describedby`, avec le nombre de caractères saisis. Elle disparaît dès la correction. |
| O10 | `lib/features/site-records/handler.ts`, `site-records/model.ts`, `enterprise-space.tsx` | La lecture des dossiers d'un site renvoie `urgency` (schémas stricts serveur et client alignés). La fiche du site étiquette « Urgent » les demandes urgentes. |

**Tests ajustés**
- `tests/ui/site-records.test.ts` : fixtures avec `urgency`.
- `tests/ui/credential-reviews-panel.test.ts` : câblage O1.

**Contrôles locaux :** `tsc` 0 ; 35/35 sur les tests concernés ; fiches de site 12/12.

Aucune migration, aucune route nouvelle, aucun droit modifié.

## Vérification en ligne
Candidat `dpl_9gyPq1kJRNXMqzaZvC3gq5FJGEjB`, `https://domdepannage-recette-20261112-nn2dylxph-brafas-projects.vercel.app`, cible preview.

| Id | Résultat | Preuve |
|---|---|---|
| O10 | PASS à 390 et 1280 px : INT-B3B9AD affiche « Urgent » sur le site restauration ; un dossier non urgent (site office) n'a pas d'étiquette ; aucun débordement | `u1-o10-*.png` |
| O2 | PASS : `faux.png` est signalé (« le contenu ne correspond pas à une image… »), la vraie photo est conservée, aucun POST | `u1-o2-390.png` |
| O3 | PASS (artisan, INT-E243CC) : message « Ce créneau est déjà passé… » relié au champ, aucun POST | `u1-o3-1280.png` |
| O1 | PASS : la pièce Kbis v2 affiche « Acceptée » | `u1-o1-1280.png` |
| O7 | PASS : avec 9 caractères, « Motif trop court (9 caractères)… » s'affiche sous le champ, `aria-invalid` est posé, aucun POST ; le message disparaît à la correction | `u1-o7-1280.png` |
| D23 | PASS : l'historique de triage affiche « par l'opérateur réf. cff732ca » | `u1-d23-1280.png` |

**Non-régression :** D1–D6 et D15 passent (18/18) ; Leaflet 0 erreur sur 6 essais ; panneau D13 présent ; D21 passe (5/5).

**Alias `domdepannage-recette-20261112.vercel.app` → `dpl_9gyPq1kJRNXMqzaZvC3gq5FJGEjB` (nn2dylxph).**

## Limites
- **O3 :** le formulaire entreprise n'a pas été revérifié en ligne ; il utilise le même contrôle et il est typé.
- **O1 :** seul l'état « Acceptée » a été vu en ligne. Les deux autres libellés viennent de la même table.
- **O2 :** un fichier illisible par le navigateur est laissé au serveur.
- La reprise de `d21-http` a ajouté une seconde pause passée, valide, sur le dossier synthétique `SYNTH-SLA-INT-B3B9AD`.

## Finance : ce qui est prouvé sur le Web, et la limite d'outil
- **FIN-03, retour sans paiement : PASS.**
  - INT-CDD097 : « Payer 130,20 € sur la plateforme » ouvre Stripe Checkout (hôte `checkout.stripe.com`, bandeau « Sandbox / Environnement de test », 130,20 €).
  - L'abandon se fait par le lien de retour, sans aucune saisie.
  - Au retour sur le bon dossier, le message est « Retour depuis la page de paiement sans confirmation… ».
  - Le serveur relu indique `completed`, `paid_at` nul, et le bouton est de nouveau proposé (`log-g1-checkout-cancel.json`).
- **Droits de règlement : PASS.**
  - Le lecteur d'entreprise, un tiers et l'artisan reçoivent 404 sur `POST /api/payments/checkout` avec un `quote_id` valide.
  - Le lecteur n'a aucun bouton ; le propriétaire voit « Régler le devis et les avenants acceptés » (non cliqué).
  - O12 : cette route renvoie un message de validation en anglais quand le corps est mal formé.
- **Limite d'outil, conservée telle quelle.** Je ne saisis pas de numéro de carte, même de test, sur la page hébergée du fournisseur depuis cette recette distante. Les variantes qui exigent un paiement abouti ou échoué sur le Web ne sont donc pas rejouées par moi : FIN-01 (paiement Web), FIN-04 (échec, remboursement, litige) et ART-11.
- **FIN-05 et ENT-16** (factures et avoirs) restent bloqués par l'émetteur plateforme non configuré, qui est une décision du propriétaire.
