# UI-PUBLIC-REQUEST-001 — Claim court

Owner : Claude. Branche `claude/ui-public-request` = intégration `721853a` + merge du plan accepté
`d623521` (`docs/UI_PUBLIC_REQUEST_IMPLEMENTATION_PLAN.md`, qui fait foi).

Fichiers réservés : NEW `components/role/public-chrome.tsx`, `public-chrome.module.css`,
`public-forms.module.css`, `tests/ui/public-request.test.ts` ; EDIT `public-home.tsx`,
`public-home.module.css`, `public-site.tsx` (branches `home`, `new`, `auth` seulement), ce contrat.
Lecture seule : `forms.tsx`, `ui.tsx`, session, `courant-app.tsx`, `globals.css`, layout,
fondation. Pas de prop `className` ni de focus d'étape dans les fichiers partagés.

Décisions root appliquées : ordre réel des étapes (description + photos en 1, adresse + urgence en
2, récapitulatif indicatif en 3) ; la fourchette existante reste « exemples indicatifs », aucun
prix garanti ; retour à l'accueil depuis `new`/`auth` = `session.go("home")` ; les ancres de
l'accueil n'écrivent jamais le hash ; enveloppe CSS opt-in stable (saisie conservée au changement
de thème) ; photos/erreurs/busy/brouillon/callbacks auth inchangés.

Livraisons : P1 extraction `PublicChrome` (accueil identique au pixel), P2 vue `new`, P3 vue `auth`
— un SHA court chacune, avec tsc, tests ciblés + `test:ui`, vrai `PublicSite`, parcours brouillon
sans inscription automatique, rôles jamais thémés. Aucune API, cloud, identifiant ou rôle.
