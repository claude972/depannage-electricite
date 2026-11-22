# Déploiement correctif sécurité Next 16.4.6 — recette (19/11/2026)
Exécution de `DEPLOIEMENT-SECURITE-CODEX-20261119.md`. Périmètre respecté : `package.json` + `package-lock.json` seulement, PREVIEW du projet existant, variables preview inchangées, aucune production, aucune migration, aucune opération financière, Stripe TEST, portes inchangées, aucune notification externe.

## Source
- Fichiers copiés tels quels du clone Codex (e37754e3, arbre b8a99ea4…) : SHA-256 identiques (`package.json` 28dde0a0…, `package-lock.json` 18f0bf22…).
- Diff du lock : uniquement `next`, `@next/env`, `@next/swc-*` 16.4.3 → 16.4.6, tous depuis registry.npmjs.org.
- Commit Claude : `214ec0d2` (sur 39d0dbf9 / 07124e0b / e595ba2e / ed22f0a5). Non poussé.

## Déploiement
- `dpl_G8TQpwy2NZj9PeLiq5AL1iCkxv9x` — https://domdepannage-recette-20261112-qeqpc4bbs-brafas-projects.vercel.app — cible `preview`, READY, build « Next.js 16.4.6 (Turbopack) » (vérification de types incluse, `ignoreBuildErrors` absent).
- Alias `domdepannage-recette-20261112.vercel.app` → qeqpc4bbs (vérifié par `vercel inspect`). Retour arrière possible : 5zggqivyj (`dpl_9qgdnBYFk6brxrFd7XoAEUGmAssm`).

## Vérifications (expurgées)
- Public : `/`, `/prestations`, `/conseils`, `/suivi`, manifeste, operator-profile, indicative-prices, services, warranty-terms, coverage → 200 ; HSTS et X-Frame-Options présents.
- Finance sans session : finance 401, observations 401, `POST …/checkout-link` 401 ; webhook sans signature 400.
- Recette admin réelle (compte synthétique, lecture) : **35/35 PASS** en 1440 et 390 px : 15 écrans admin dont Finance plateforme et Journal d’audit, fiches INT-5B12D9 et INT-6C3682, aucune erreur JS, routes admin refusées au particulier — `preuves/securite-next-1646/recette-admin-35-controles.json` (aucun secret).
- Non fait ici : test unitaire local avec Next 16.4.6 installé (node_modules du mini en 16.4.3, disque Stockage saturé) ; couvert par TypeScript + npm audit côté Codex et par le build Vercel.
