# DomDépannage — suivi de finalisation (Claude)

Mis à jour : 2026-11-15 ~00:25 AST — session Claude Opus 5.5 (Fable non utilisé : quota hebdomadaire épuisé, aucune facturation ajoutée).

## Base de reprise

| Élément | Valeur vérifiée |
|---|---|
| Copie de travail Claude | `/Volumes/Stockage/dev/Atelier/claude/depannage-electricite/repo` (clone séparé, `.git` propre, push vers l'intégration désactivé) |
| Branche | `claude/finalisation-20261114` |
| Base | `b424c8d` (`codex/figma-responsive-20261114`, 47 commits au-dessus de `codex/plan-lancement-2026-11-12`) |
| Commits plus récents ailleurs | aucun dans le dépôt d'intégration du mini après `b424c8d` (`git log --all --since`) ; MacBook non joignable en SSH depuis le mini |
| Travaux planning Codex non commités | sur le MacBook ; **non intégrés, non touchés** |
| Référence choisie | `domdepannage-recette-20261112.vercel.app` → déploiement CLI `dpl_5HgGE477…` (12/11), projet Vercel `prj_Tce0…`, sans métadonnée git |
| Dernière preview Codex | `…-4dzh253nr-…` (`dpl_5PMhem…`), annoncée `b424c8d` par `WEB_CLIENT_CONTACT_DELIVERY.json` |
| Backend preview | Supabase réel (variables `NEXT_PUBLIC_SUPABASE_*` présentes, valeurs non lues) ; Stripe en variables preview |
| **Preview Claude (URL testée)** | https://domdepannage-recette-20261112-1aav2k9it-brafas-projects.vercel.app — `dpl_AYtudt6vUuJmCKpMqiQbBrKFdzKe`, commit `399c5a3`, cible *preview*, alias de recette **non modifié** |
| Recette locale | `next dev` port 3417 sans variables Supabase → mode public + **démo synthétique** (localStorage), Playwright headless (Chromium 1248) |

Légende : **synthétique** = mode démo (données d'exemple, aucun serveur) · **réel** = backend Supabase · **preview** = déploiement Vercel non aliasé · **production** = alias de recette.

## Tableau de suivi

| Parcours | Web/PWA | iOS | Android | Preuve / version | Défaut restant |
|---|---|---|---|---|---|
| Accueil public | vérifié (preview, visuel 320/390/768/1440) | à faire | à faire | `bd77d50…` local 320/390/768/1440 ; comparé à l'alias : identique hors bandeau « 20 min » (volontairement limité à `VERCEL_ENV=preview`) | en-tête des pages publiques secondaires compacté (≤110 px) |
| Particulier : demande → devis → décision → suivi → règlement | **vérifié (synthétique, local + preview)** | à faire | à faire | test E2E `interactive-journey` 390 + 1440 PASS ; captures `flow{320,390,768,1440}` | non vérifié en réel (Supabase) ; validation native des champs en anglais dans un navigateur EN (navigateur FR non testé) |
| Particulier ↔ entreprise : approbation puis acceptation | **vérifié (synthétique, local + preview)** ; garde serveur `guard_quote_approval` présente (SQL) | à faire | à faire | blocage « approbation entreprise requise » → approbation gestionnaire → acceptation ; devis 222 € `accepted` dans le stockage démo | non vérifié en réel |
| Artisan : offre → devis → intervention | vérifié partiel (synthétique) | à faire | à faire | même test E2E (acceptation offre, devis TVA 8,5 %, démarrage, compte rendu, clôture) | planning tablette non repris |
| Entreprise : demande → approbation devis | en cours | à faire | à faire | approbation démo OK | — |
| Admin : affectation / suivi | à faire | à faire | à faire | — | — |

## Corrections concrètes (commits sur `claude/finalisation-20261114`)

1. `bd77d50` — **Espace particulier mobile : menu de compte restauré.** Sous 1024 px, l'en-tête ne gardait que la cloche : *paramètres du compte, assistance et déconnexion étaient inaccessibles sur téléphone*. Tiroir ☰ identique aux espaces artisan/entreprise/admin (focus, Échap, retour du focus). Vérifié 390 px.
2. `0593a98` — **Messages hors champ rendus visibles** (composant `Alerts` partagé par les 4 espaces) : un refus de « Accepter le devis » en bas de page paraissait inerte. **Dossier sans artisan** : titre « Artisan » sans bouton « Contacter » trompeur.
3. `8b…`/`6c270f7` — **En-tête public compact** et **en-tête admin mobile harmonisé** (☰ + outils sur la 1re ligne, titre pleine largeur) : logo empilé 84 px (<940) / 104 px (≥940) ; l'en-tête faisait 121 px à 320–939 px.
4. Tests UI périmés réalignés sur les changements volontaires déjà présents dans la base (libellés, texte démo, rayon replié, suffixe « (obligatoire) »).
5. `7da0632` — Mobile : style Jakarta Medium appliqué à tous les titres d'en-tête natifs (écart relevé dans `NATIVE_FINENESS_QA_20261114.md`).

## Tests réellement passés
- `npm run typecheck` : OK (base et après corrections).
- Base `b424c8d` : `npm test` 2335/2372 ; 35 échecs → 19 instables (passent isolément), 16 qualifiés : 14 tests périmés réalignés + 2 restants.
- Après corrections : tests ciblés relancés et passés (header client 320–390 clair/sombre, parcours client↔artisan 390/1440, paramètres de compte ×5 fichiers 27/27, énergie, rayon, auth 11/11, ERP 2/2, en-tête public 320–1440).
- Suite complète post-corrections (`7da0632`) : **2357/2372** ; les 13 échecs rejoués séquentiellement → 11 passent (instabilité sous charge), 2 `requests-search` corrigés (stub de session périmé) → 10/10. Aucun échec reproductible connu.
- `npm run build` (Next.js 16.4.3) : OK sur `399c5a3`. Typecheck mobile (`apps/mobile`, `tsc --noEmit`) : OK.
- **En ligne sur la preview `1aav2k9it`** (Chromium headless, données synthétiques) : menu de compte particulier 390 px (ouverture, Échap + retour du focus, Paramètres, Quitter) ; blocage d'acceptation visible → approbation gestionnaire → acceptation 222 € ; création de demande 390/1440 ; dossier sans artisan ; en-tête public 320 px = 109,6 px.

## Défauts restants / blocages
- **Bloqué — recette « réel » (Supabase)** : aucun compte de test ni identifiant de service disponible dans cette session (le banc `scripts/qa` exige `credentials.json` + clé de service). Les parcours ci-dessus sont prouvés en démo synthétique uniquement. Besoin : comptes de test particulier/artisan/gestionnaire/admin sur le projet Supabase de recette, ou exécution du banc par le propriétaire.
- iOS/Android : non relancés dans cette session pour l'instant.
