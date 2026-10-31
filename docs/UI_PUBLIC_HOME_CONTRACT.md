# UI-PUBLIC-HOME-001 — Contrat court (claim)

Owner : Claude (UI design worker). Branche `claude/ui-public-home`, base intégration `1d2ebd4`
(fondation thème acceptée). Référence visuelle canonique : prototype `6bc0cab` `web-network.html`.
« Courant » reste un nom de travail.

## Fichiers (exclusifs)

- NEW `components/role/public-home.tsx` — accueil public complet (en-tête/nav, hero, cartes,
  catalogue, conseils, bannière réseau, pied de page) + helpers purs exportés (slides, onglets).
- NEW `components/role/public-home.module.css` — CSS module, tokens `--ui-*` uniquement.
- NEW `public/home/*.jpg` — photos copiées sans retouche depuis `6bc0cab` (liste ci-dessous) +
  `public/home/CREDITS.md`.
- NEW `tests/ui/public-home.test.ts` — tests ciblés.
- EDIT `components/role/public-site.tsx` — seulement : quand la vue est `home`, rendre
  `<PublicHome …/>` (qui porte son propre en-tête/pied) au lieu de l'en-tête + `HomeView` + pied
  actuels. Toutes les autres vues (new, auth, help, pricing, join, join-organization, demo, about,
  privacy, legal) restent strictement inchangées, avec l'en-tête/pied existants.
- Ce contrat.

Lu, jamais modifié : `components/app/theme-provider.tsx` (`ThemeSurface`),
`components/app/theme-toggle.tsx` (`ThemeToggle`), tokens `--ui-*` de `app/globals.css`.
Aucun changement : CSS global, layout, session, `courant-app.tsx`, API, backend, SQL, packages.

## Blocs → callbacks réels (PublicSession existante)

| Bloc | Action | Callback / vue |
| --- | --- | --- |
| Marque | retour accueil | `navigate("home")` |
| Nav « Interventions / Services / Conseils » | ancres internes | `#interventions` `#services` `#conseils` |
| Nav « Vous êtes artisan ? » | vue réelle | `navigate("join")` |
| « Se connecter » | auth réelle | `login()` (`setAuthMode("login")` + `go("auth")`) |
| Bascule thème | clair/sombre | `ThemeToggle` de la fondation |
| Hero CTA « Décrire ma panne » | formulaire réel | `newRequest()` → `session.go("new")` |
| Hero lien « Essayer la démo » | démo explicite | `session.startDemo()` |
| Cartes intervention (compactes) | catégorie pré-remplie | `newRequest(categoryId)` |
| Catalogue — 5 onglets | les 5 `CATEGORIES` métier (outage, panel, socket, lighting, diagnostic) | onglet = affichage ; bouton « Décrire cette panne » → `newRequest(id)` (pré-remplit `RequestForm` via `setCategory`) |
| « Conseils et formation » (jaune) | aide réelle | `navigate("help")` — aucune publication/article/formation inventés |
| Bannière réseau (verte) « Nous rejoindre » | vue réelle | `navigate("join")` ; « Espace professionnel (démo) » → `session.startDemo("manager")` |
| Pied de page | vues réelles | `navigate("about" \| "privacy" \| "legal" \| "pricing" \| "help")` |
| Vue inconnue (gated) | même comportement qu'aujourd'hui | message conservé |

Pas de prix contractuel, d'avis, de délai, de qualification, de métrique ni de faux dialogue de
service. Copie sobre et provisoire. Pas de publicité.

## Hero

Plein écran bord à bord sous la nav, 2 photos, slides MANUELLES uniquement (flèches + points,
cibles ≥ 44 px, `aria-roledescription` carrousel/diapositive, flèches clavier ←/→, pas
d'autoplay, transitions coupées sous `prefers-reduced-motion`). Texte sur panneau opaque
(contraste AA garanti dans les 2 thèmes).

## Photos retenues (6bc0cab, Pexels License, copies non retouchées)

| Fichier | Source | Crédit |
| --- | --- | --- |
| `hero-photo-1.jpg` | Pexels 17842832 | Fatih Yurtman |
| `hero-photo-2.jpg` | Pexels 27928762 | ranjeet |
| `section-real-panel.jpg` | Pexels 27928760 | ranjeet |
| `section-socket.jpg` | Pexels 7647233 | Anastasia Shuraeva |
| `section-outlet.jpg` | Pexels 5691599 | Ksenia Chernaya |

Exclues définitivement : photos électroménager (Pexels 34054464 / 34054474).

## Tests prévus

- Helpers purs : navigation slides (bornes, boucle, ←/→), onglets (←/→/Home/End, roving tabindex).
- Mapping callbacks : chaque CTA appelle le bon callback avec la bonne catégorie (session factice).
- Onglets = exactement les 5 `CATEGORIES` métier, dans l'ordre.
- SSR : `renderToStaticMarkup` sans `window`, aucune erreur ; présence nav, hero, 5 onglets,
  aucun prix (`€`) ni avis.
- `public-site` : home → `PublicHome` ; autres vues inchangées.
- Non-régression parcours brouillon : home → `newRequest("socket")` → vue `new` avec catégorie
  pré-remplie → brouillon → auth (tests existants verts).
- `tsc --noEmit` strict + `npm run test:ui` + suite complète.

## Hors périmètre (explicite)

Les espaces rôles (client, artisan, entreprise, admin) ne sont PAS rethémés. L'application n'est
pas « complète » ; seule l'accueil public adopte la fondation. Recette réelle par root
(2 thèmes × 360/390/1280/1440, home → décrire panne → brouillon → auth sans mutation réelle).
