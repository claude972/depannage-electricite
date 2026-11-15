# DomDépannage — suivi de finalisation (Claude)

Mis à jour : 2026-11-15 ~00:30 AST — session Claude Opus 5.5 (Fable non utilisé : quota hebdomadaire épuisé, aucune facturation ajoutée).

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
| Recette locale | `next dev` port 3417 sans variables Supabase → mode public + **démo synthétique** (localStorage), Playwright headless (Chromium 1248) |

Légende : **synthétique** = mode démo (données d'exemple, aucun serveur) · **réel** = backend Supabase · **preview** = déploiement Vercel non aliasé · **production** = alias de recette.

## Tableau de suivi

| Parcours | Web/PWA | iOS | Android | Preuve / version | Défaut restant |
|---|---|---|---|---|---|
| Accueil public | en cours | à faire | à faire | `bd77d50…` local 320/390/768/1440 ; comparé à l'alias : identique hors bandeau « 20 min » (volontairement limité à `VERCEL_ENV=preview`) | en-tête des pages publiques secondaires compacté (≤110 px) |
| Particulier : demande → devis → décision → suivi → règlement | **vérifié (synthétique, local)** | à faire | à faire | test E2E `interactive-journey` 390 + 1440 PASS ; captures `flow{320,390,768,1440}` | non vérifié en réel (Supabase) ; validation native des champs en anglais dans un navigateur EN (navigateur FR non testé) |
| Particulier ↔ entreprise : approbation puis acceptation | **vérifié (synthétique, local)** | à faire | à faire | blocage « approbation entreprise requise » → approbation gestionnaire → acceptation ; devis 222 € `accepted` dans le stockage démo | non vérifié en réel |
| Artisan : offre → devis → intervention | vérifié partiel (synthétique) | à faire | à faire | même test E2E (acceptation offre, devis TVA 8,5 %, démarrage, compte rendu, clôture) | planning tablette non repris |
| Entreprise : demande → approbation devis | en cours | à faire | à faire | approbation démo OK | — |
| Admin : affectation / suivi | à faire | à faire | à faire | — | — |

## Corrections concrètes (commits sur `claude/finalisation-20261114`)

1. `bd77d50` — **Espace particulier mobile : menu de compte restauré.** Sous 1024 px, l'en-tête ne gardait que la cloche : *paramètres du compte, assistance et déconnexion étaient inaccessibles sur téléphone*. Tiroir ☰ identique aux espaces artisan/entreprise/admin (focus, Échap, retour du focus). Vérifié 390 px.
2. `0593a98` — **Messages hors champ rendus visibles** (composant `Alerts` partagé par les 4 espaces) : un refus de « Accepter le devis » en bas de page paraissait inerte. **Dossier sans artisan** : titre « Artisan » sans bouton « Contacter » trompeur.
3. (commit suivant) — **En-tête public compact** : logo empilé 84 px (<940) / 104 px (≥940) ; l'en-tête faisait 121 px à 320–939 px.
4. Tests UI périmés réalignés sur les changements volontaires déjà présents dans la base (libellés, texte démo, rayon replié, suffixe « (obligatoire) »).
5. Mobile (non commité à ce stade) : style Jakarta Medium appliqué à tous les titres d'en-tête natifs (écart relevé dans `NATIVE_FINENESS_QA_20261114.md`).

## Tests réellement passés
- `npm run typecheck` : OK (base et après corrections).
- Base `b424c8d` : `npm test` 2335/2372 ; 35 échecs → 19 instables (passent isolément), 16 qualifiés : 14 tests périmés réalignés + 2 restants.
- Après corrections : tests ciblés relancés et passés (header client 320–390 clair/sombre, parcours client↔artisan 390/1440, paramètres de compte ×5 fichiers 27/27, énergie, rayon, auth 11/11, ERP 2/2, en-tête public 320–1440).
- Suite complète post-corrections : en cours.

## Défauts restants / blocages
- 2 tests `requests-search` (mode connecté simulé) à requalifier : sélection `[data-requests-more]`/`.request-row` absente dans le banc ; pas de défaut produit démontré.
- Recette « réel » (Supabase) : impossible en local sans variables ; à faire sur une preview avec comptes de test dédiés.
- iOS/Android : non relancés dans cette session pour l'instant.
