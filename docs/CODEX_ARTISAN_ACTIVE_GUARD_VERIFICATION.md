# CL-BE-001 — vérification de la garde dossier/travail

Branche codex/web-pwa-backend ; base fface1af11d62b19522cc5266b6f2b6b536209c0. Mission/correction distantes lues ; seule affectation012 revendiquée. Contrat prépublié47e7b13 puis **1951782 avant code**, suivant le renforcement explicite du pilote : completed impayé est aussi bloquant. Aucune migration001–011, ancienne route, frontend ou règle financière modifiée. Seule nouvelle012, harness SQL, contrat/rapport et étape CI ciblée.

## Changement

- save_artisan_profile appelle d’abord la garde existante (rôle/suspension/verrous profiles puis artisan_profiles), puis lit les dossiers assigned/quoted/accepted/in_progress/completed sans aucun verrou intervention. Si une obligation existe : P0001/HTTP409, aucun champ du dossier ou d’approbation modifié. La raison SQL française précise missions et règlements ; la route existante conserve son409 générique, à contextualiser par l’UI pour cette action.
- paid/cancelled libèrent cette garde si aucune autre obligation ne reste. Une édition alors permise conserve l’ancien retour draft/non approuvé/indisponible avec nouvelle soumission/examen. Aucun débit, dette ou paiement transformé ; completed doit réellement devenir paid côté serveur avant de libérer le dossier.
- Disponibilité et contacts restent distincts ; pas de nouvelle exception d’approbation terrain. Suspension explicite reste prioritaire403.
- accept_mission sérialise avec l’édition sous organisation → intervention → profil acteur → dossier artisan. Réaffectation admin prend le même ordre vers le profil cible, après validation du rôle opérateur ; remise en attente sans cible reste permise selon règles antérieures.
- Les anciennes fonctions renommées sont privées (EXECUTE révoqué public/anon/authenticated). Signatures publiques et tous les contrôles précédents d’éligibilité/portée/statut/montants/devis exact sont conservés.

## Vérifications fraîches

- `npm run typecheck` : passe.
- `npm test` : **49 tests Node passent**, zéro échec. Aucune nouvelle route HTTP dans ce lot.
- `node tests/sql-artisan-active-guard-review.mjs` avec PGLITE_MODULE0.5.13 existant : **6 groupes PASS**, douze migrations exécutées. Refus et intégrité exacte pour chacun des cinq états ; contacts/disponibilité séparés ; règlement simulé exclusivement en SQL isolé puis édition permise ; annulation et réaffectation ; suspension ; édition d’abord → attribution refusée ; attribution d’abord → édition refusée ; rôles étrangers/helpers privés et ordre de verrous en source.
- Régressions SQL après012 : principal **29**, performance **6**, portée site **8**, brouillons **9**, support **8** groupes, tous PASS.
- `git diff --check` propre. Aucun package/install/build supplémentaire.

Les tests utilisent Auth/Storage stubs et un PostgreSQL local isolé. Les séquences opposées et le contrôle des verrous ne sont **pas une preuve de concurrence réseau réelle**. Le paiement de fixture n’a appelé aucun fournisseur et ne constitue aucune transaction Stripe.

## Revue et recette restantes

Claude doit revoir le SHA exact ; après autorisation d’application à la seule base dédiée, le pilote QA doit exercer les deux résultats d’interleaving sur des comptes temporaires : claim/reassign contre édition, puis refus sans perte de dossier/approbation. Les endpoints existants peuvent servir cette recette sans nouveau déploiement HTTP. Aucun apply012 réalisé par cet agent.

La disponibilité/contact et les écritures terrain conservent leurs contrôles précédents. Les comptes déjà devenus non approuvés par l’ancien comportement avec des missions impayées nécessitent une revue/remédiation opérateur ; aucune approbation automatique ou voie self-service de contournement n’est ajoutée. Pas de suppression de dette, d’exception Checkout, d’annulation financière ou d’élargissement de réaffectation après accord du devis.

Pas de build/npm run check complet, tests UI ou preview nouvelle revendiqués : volume et quota Vercel limités, checkout backend séparé du frontend Claude. La CI intégrée et la recette applicable restent ouvertes. Toute suite de codage après00h America/Martinique doit passer à Claude selon le relais.
