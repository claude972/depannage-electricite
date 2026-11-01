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

## Livraisons

- P1 `d80423f` — `PublicChrome` extrait (en-tête, pied, menu, helpers d'actions ré-exportés par
  `public-home`). Accueil identique au pixel (comparaison PNG avant/après, 2 thèmes, 1280/1440/390
  et menu 360 ; la page entière à 360 ne diffère que par le chargement différé d'une image dans la
  capture de référence).
- P2 `6ccdb56` + `7180ff5` (fixture du test brouillon de l'accueil) — vue `new` : `RequestForm`
  partagé inchangé (props vérifiées par espion), habillage `requestSkin`, alertes de session thémées.
- P3 — vue `auth` : `AuthView` existant (avis de brouillon + `AuthForm` partagé inchangé) dans le
  chrome, habillage `authSkin`. L'ancien shell ne sert plus qu'aux vues help/pricing/join/
  join-organization/demo/about/privacy/legal (inchangées).

Tests `tests/ui/public-request.test.ts` : SSR réel de l'étape 1 et des 3 modes auth avec garde des
classes **réellement rendues dans ces états** (étapes 2 et 3 non atteignables en SSR : vérifiées en
navigateur, pas présentées comme couvertes par la garde) ; props et callbacks par espions ; parcours
brouillon sans inscription automatique ; rôles et autres vues jamais thémés.

Navigateur (app réelle, 2 thèmes × 360/390/1280/1440, hors cloud) : étapes 1→2→3, erreur 15
caractères, erreur de type photo + liste, saisie conservée au changement de thème (demande et
auth), « Précédent » conserve le code postal, envoi → `#auth` en mode inscription avec avis de
brouillon et brouillon en sessionStorage, retour au formulaire avec la description restaurée,
login/signup (artisan)/reset, erreur de connexion locale affichée dans le thème ; 0 débordement,
0 contraste < 4,5:1 ni texte < 12 px dans l'habillage, 0 erreur console, 0 requête externe, 0
requête non-GET.

Constat hors périmètre (préexistant, non modifié) : ouvrir directement `/#new` en public affiche
l'accueil ; la demande s'ouvre par la navigation interne (`session.go("new")`).
