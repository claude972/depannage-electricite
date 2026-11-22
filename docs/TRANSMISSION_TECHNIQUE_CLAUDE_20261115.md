# Transmission technique — finalisation Claude du 15/11/2026

## Code
- Dépôt de travail Claude (mini) : `/Volumes/Stockage/dev/Atelier/claude/depannage-electricite/repo`, clone séparé du dépôt d'intégration `/Volumes/Stockage/depannage-qa-private/pwa-autonomie-2026-11-11/integration` (push vers ce dernier désactivé dans la copie).
- Branche : `claude/finalisation-20261114`, base `b424c8d` (`codex/figma-responsive-20261114`). Aucun merge, aucun rebase, aucun commit sur une branche Codex.
- Commits Claude (ordre) : `bd77d50` menu de compte particulier mobile · `0593a98` alertes hors champ + dossier sans artisan · en-tête public compact + tests réalignés · `6c270f7` en-tête admin mobile + suivi · `7da0632` titres natifs Jakarta · `399c5a3` stub de test `requests-search` · commits `docs:` de suivi.
- Travaux planning Codex non commités (MacBook) : non intégrés, non touchés.

## Configuration (sans secrets)
- Web : variables listées dans `.env.example`. Le projet Vercel `domdepannage-recette-20261112` (`prj_Tce0NrWnNps95rb28gy0LrH1tIQS`, équipe « brafa's projects ») porte les variables *preview* (Supabase URL/clé publique, clé de service, Stripe, garde-fous de paiement). Aucune valeur n'a été lue ni copiée.
- `vercel link` crée `.vercel/` (ignoré par git) et un `.env.local` contenant un jeton OIDC : supprimé après liaison, ne jamais le commiter.
- Mobile : `EXPO_PUBLIC_API_URL` (origine HTTPS du Web/API). Pour une build cohérente, utiliser la preview du **même commit** que l'app native.

## Vérifier
```bash
npm ci && npm run typecheck && npm test && npm run build
cd apps/mobile && npm ci && npx tsc --noEmit
```
Les tests UI montés utilisent Playwright depuis `/Users/claudebrafa/rea/node_modules/playwright-core` et Chromium 1248 (`QA_PLAYWRIGHT_PATH`, `QA_CHROMIUM_PATH` pour surcharger). Sous forte charge CPU, une dizaine de tests montés peuvent dépasser leurs délais : les rejouer avec `--test-concurrency=1` avant de conclure.

## Déployer une preview Web (jamais l'alias de recette sans décision)
```bash
vercel link --yes --project domdepannage-recette-20261112 && rm -f .env.local
vercel deploy --yes
```
Preview livrée : `https://domdepannage-recette-20261112-1aav2k9it-brafas-projects.vercel.app` (`dpl_AYtudt6vUuJmCKpMqiQbBrKFdzKe`, commit `399c5a3`, état READY, aucun alias).
Promotion éventuelle vers l'alias de recette (décision du propriétaire) : `vercel alias set <url-preview> domdepannage-recette-20261112.vercel.app`.

## Retour arrière
- Web : l'alias de recette pointe toujours sur `dpl_5HgGE477YoDeCreCL4TpQvtjV38X` (non modifié). Si un alias est un jour déplacé : `vercel alias set domdepannage-recette-20261112-8110o35yn-brafas-projects.vercel.app domdepannage-recette-20261112.vercel.app`.
- Code : la base Codex `b424c8d` reste intacte ; `git checkout b424c8d` ou `git revert <commit>` commit par commit (changements indépendants).

## Builds natifs locaux (mini, sans EAS cloud)
```bash
cd apps/mobile
export EXPO_PUBLIC_API_URL=<preview du même commit>
CI=1 npx expo prebuild --platform ios --no-install && (cd ios && pod install)
xcodebuild -workspace ios/DomDepannage.xcworkspace -scheme DomDepannage -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ../../../build-ios CODE_SIGNING_ALLOWED=NO build
```
`expo prebuild` modifie les scripts `ios`/`android` de `apps/mobile/package.json` : restaurer avec `git checkout apps/mobile/package.json`. Les dossiers `apps/mobile/ios` et `apps/mobile/android` sont exclus localement (`.git/info/exclude`).
Distribution signée (TestFlight / Play interne) : non réalisée ; nécessite les accès Apple Developer / Google Play du propriétaire ou une build EAS cloud (`npm run build:simulator` / profil `device`), à décider pour ne pas consommer de crédits sans accord.
