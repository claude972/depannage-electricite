# Résultat — déploiement des correctifs parcours D1–D5 (19/11/2026)

Auteur : Claude (mini). Consignes : `DEPLOIEMENT-PARCOURS-CODEX-20261119.md` et `COMPLEMENT-RESEAU-CODEX-20261119.md`. Cible : uniquement des previews du projet `domdepannage-recette-20261112`. Variables preview inchangées, base `kcpyjzndybfdlnhvscbs`, Stripe TEST. Aucune migration, aucune notification externe, rien en LIVE ni en production.

## Application des fichiers
Avant chaque copie, nos fichiers ont été comparés au parent du commit Codex : ils étaient identiques, donc aucune modification concurrente n'a été écrasée. Les fichiers ont été copiés depuis le commit exact (`git show`), puis leur SHA-256 a été comparé à celui de la consigne : identique pour les 10 fichiers.

| Commit Claude | Source Codex | Fichiers |
|---|---|---|
| `c1ab347b` | 4935141 (GitHub fdf1673e) | forms.tsx, session.ts, ui.tsx, mission-radius-panel.tsx, artisan-space.tsx |
| `d471db1e` | 4935141 | Tests alignés : `tests/ui/session.test.ts`, `tests/ui/mission-radius.test.ts`. Notre `mission-radius-mounted.test.ts` divergeait déjà du parent Codex : laissé tel quel. |
| `56025232` | 236f4ca (GitHub 3860297) | use-online-read-retry.ts (nouveau), courant-app.tsx, use-admin-dashboard.ts, available-missions-panel.tsx, mission-radius-panel.tsx |

Contrôles locaux : `tsc --noEmit` passe (code de sortie 0) après chaque lot ; tests session et rayon : 20/20 PASS.

## Candidats
1. `dpl_FJA9aiiHzEstcaUBfTbAp6aKCMK4` (8k1jrui9o), D1–D5 : READY, cible preview.
   - D1, D3, D4 et D5 sont PASS.
   - Contrôles publics : accueil, services, profil exploitant, manifeste et service worker répondent 200 ; un webhook non signé reçoit 400.
   - L'alias a d'abord été posé sur ce candidat.
2. `dpl_2BYA232KTSnTrL7wSw1skQg8pv6j` (6pwutkukc), D1–D5 + D2 : READY, cible preview.
   - D1–D5 sont rejoués PASS, et D2 est PASS.
   - **L'alias `domdepannage-recette-20261112.vercel.app` pointe désormais sur ce candidat.**

## Vérifications (Chromium, comptes synthétiques, sans écriture métier)
| Défaut | Résultat | Preuve |
|---|---|---|
| D1 — erreur de lecture du rayon | PASS : sur une lecture en 503 simulée, le panneau « Zone de recherche » s'ouvre seul et montre l'erreur et « Réessayer ». La reprise ne fait qu'un GET, sans aucun POST. | `log-v-fixes.json`, `d1-*.png` |
| D2 — retour réseau | PASS. Artisan : rayon et offres relus automatiquement, un GET par lecture malgré deux signaux `online`, aucun POST. Admin : tableau de bord relu et erreur effacée sans clic. | `log-v-d2.json`, `d2-*.png` |
| D3 — h1 de l'écran de refus | PASS : le client sur `#admin` voit un `h1` « Cette page ne fait pas partie de votre espace ». | `d3-*.png` |
| D4 — admin et `#support` | PASS : refus cohérent avec la table d'accès, aucune entrée « Assistance » client dans le menu admin, et la file opérateur `#support-queue` s'ouvre selon les droits. | `d4-*.png` |
| D5 — site professionnel obligatoire | PASS : le message de l'application est relié au champ (`aria-describedby`), aucune demande n'est envoyée, et le message disparaît une fois le site choisi. | `d5-*.png` |

## Nouveau défaut constaté — D6 (non corrigé : le runtime appartient à Codex)
**Après une lecture du rayon en échec, une relecture réussie laisse le message « Service momentanément indisponible : réessayez. » affiché sous le formulaire, sans bouton.**
- Le défaut se produit dans les deux cas : relecture par « Réessayer » et relecture automatique au retour réseau.
- Résultat observé dans les deux cas : `data-mission-radius="ready"` avec un bloc `[data-mission-radius-error]` toujours présent.
- **Ce n'est pas une régression de ces correctifs.** `components/features/mission-radius/model.ts` n'a pas changé (dernier commit 011b928d).
- Ma vérification D1 initiale ne contrôlait que la disparition du bouton : elle a été renforcée dans `v-d6.mjs`.
- **Cause probable** (`model.ts`, fonction `load`) :
  - `load` passe d'abord en `phase: "loading"` quand il n'y a pas encore de données ;
  - au succès, il ne vide l'erreur que si `get().phase === "error"`, ce qui n'est plus le cas puisque la phase vaut déjà `"loading"`.
  - L'erreur précédente est donc conservée.
- Preuves : `log-v-d6.json`, `d6-radius-stale-manual-390.png`, `d6-radius-stale-online-390.png`.

Preuves dans `preuves/correctifs-parcours-20261119/` (journaux horodatés, captures, scripts). Les identifiants restent dans les fichiers privés et n'apparaissent dans aucun journal. Rien n'a été poussé.

## Contrôle complémentaire Codex

Le connecteur Vercel confirme le 19 novembre l’alias sur `dpl_2BYA232KTSnTrL7wSw1skQg8pv6j`. D6 est corrigé localement : le contrôleur suit le message de la dernière lecture en échec, puis l’efface au succès sans supprimer les avertissements de commande. Les 12 tests rayon (modèle et Chromium) passent sans omission, dont reprise à froid, reprise avec données déjà chargées, conservation d’un enregistrement incertain et disparition du message après retour réseau. La publication de ce complément reste à vérifier.
