# UI-PUBLIC-REQUEST-PLAN-001 — Plan : parcours public de demande et authentification sur le nouveau thème

Plan uniquement (aucun code applicatif). Base `53d34a9` (accueil public livré). Branche
`claude/ui-public-request-plan`. Auteur : Claude (worker design UI). Le code ne commence qu'après
acceptation de ce plan et réservation explicite des fichiers par root.

## 1. Périmètre

Dans le périmètre : les vues publiques `new` (demande en 3 étapes) et `auth` (connexion, création
de compte, réinitialisation), ainsi que l'en-tête et le pied de page publics de ces deux vues.
Thème : `ThemeSurface`, `ThemeToggle` et les tokens `--ui-*` (fondation `1d2ebd4`), utilisés tels
quels.

Hors périmètre :
- les vues `help`, `pricing`, `join`, `join-organization`, `demo`, `about`, `privacy` et `legal`
  (elles gardent l'ancien habillage jusqu'à une mission dédiée) ;
- les espaces rôles (client, entreprise, artisan, admin), y compris leur usage de `RequestForm` ;
- le paiement et le remappage global de `--navy` ou des fonds ;
- toute nouvelle navigation générique.

### Formulaires existants concernés (logique inchangée)

| Composant | Fichier (propriétaire) | Utilisateurs actuels | Ce qui doit rester identique |
| --- | --- | --- | --- |
| `RequestForm` | `components/app/forms.tsx` (lead) | public (`mode="public"`), client (`live`/`demo`), entreprise (sites) | étapes, validation (15 caractères min., CP `[0-9]{5}`, adresse ≥ 5, ville ≥ 2), photos (6 max., `validateUpload`/`PHOTO_TYPES`, non conservées dans le brouillon), pré-remplissage `initialCategory`/`initialValues`, `busy`, libellés selon le mode, `onSubmit`/`onBack`/`onDemo` |
| `AuthForm` | `components/app/forms.tsx` (lead) | public uniquement | modes login/signup/reset, choix d'espace, longueurs, `autoComplete`, « Mot de passe oublié ? », bascule de mode, `onDemo` |
| `Field`, `Alerts` | `components/app/ui.tsx` (lead) | partout | id/`aria-describedby`/`aria-invalid`, `role="alert"` |
| Session | `courant-app.tsx` / `session-types.ts` (lead) | — | `saveDraft` (sessionStorage `courant-request-draft` + passage en signup + notice), `signIn`/`signUp`/`resetPassword`, `adoptIdentity` avec reprise du brouillon, `busy`/`error`/`notice` |

La mission décrit les étapes comme « problème/catégorie → adresse/description/photos →
estimation/confirmation ». Le formulaire réel est organisé ainsi : étape 1 = catégorie,
description et photos ; étape 2 = adresse, code postal, ville et urgence ; étape 3 =
récapitulatif, estimation et confirmation. Je conserve cet ordre, car déplacer un champ
reviendrait à modifier la logique partagée. Un éventuel réordonnancement serait une décision du
lead, à prendre dans `forms.tsx`.

## 2. Approche : un habillage opt-in, sans toucher à la logique

1. **Habillage du chrome public.** J'extrais l'en-tête et le pied de page de `PublicHome` dans
   `PublicChrome`, réutilisé par l'accueil, `new` et `auth`. Ce n'est pas une nouvelle navigation.
   Sur l'accueil, les entrées Interventions / Services / Conseils restent des boutons de
   défilement, sans hash. Sur `new` et `auth`, l'en-tête affiche : marque (retour à l'accueil),
   Tarifs, « Vous êtes artisan ? », thème, « Se connecter » et « Décrire ma panne ». Ces entrées
   utilisent les mêmes callbacks qu'aujourd'hui (`navigate`, `login`, `newRequest`). Les entrées
   de section deviennent « Accueil » (`navigate("home")`), sans défilement différé.
2. **Habillage des formulaires.** `PublicSite` rend `RequestForm` et `AuthForm` **tels quels**,
   dans `<ThemeSurface>` + `PublicChrome` + un conteneur stylé par un CSS module à portée locale :
   `.requestSkin :global(.stepper) {…}`, `.authSkin :global(.auth-form) {…}`. Cet habillage
   repeint les classes historiques (voir l'inventaire en §3) avec les `--ui-*`, uniquement sous
   ce conteneur. Les rôles qui utilisent `RequestForm` ne sont jamais enveloppés, donc pas
   affectés.
3. **Demandes au lead, optionnelles et séparées.** Sans elles, l'habillage fonctionne déjà :
   - une prop `className` sur la racine de `RequestForm`/`AuthForm` ;
   - le focus sur le titre `h2` à chaque changement d'étape.

   Je ne fais aucune de ces modifications moi-même : `forms.tsx`, `ui.tsx` et la session
   appartiennent au lead.

Pourquoi l'habillage plutôt qu'une réécriture : aucun risque de divergence avec les espaces rôles
(même composant, même validation), les règles de travail sont respectées et le retour arrière est
trivial (on retire l'enveloppe).

## 3. Inventaire des classes historiques à habiller (sous le conteneur seulement)

- **Demande :** `form-page`, `back-link`, `form-heading`, `stepper` (`li.current`, `> span`),
  `panel`, `request-form`, `alert` (`error`, `warning`), `category-grid` (`button.selected`,
  `radio-dot`), `field` (`label`, `small`, `field-error`, `field-invalid`), contrôles
  `input`/`select`/`textarea`/`input[type=file]`, `photo-list`, `icon-button`, `inline-note`,
  `form-columns`, `urgency-options` (`legend`, `label.selected`), `form-note`, `recap-service`,
  `service-icon`, `recap-address`, `estimate-box`, `form-actions`, `button primary|outline`,
  `text-button full`.
- **Connexion :** `auth-layout`, `auth-copy`, `auth-mark`, `auth-form`, `forgot-link`,
  `auth-switch`, `button primary full`.
- **Alertes de session :** `public-alerts` (rendues au-dessus du chrome).

Règles de l'habillage :
- les titres `h1`/`h2`/`h3` et les `p` historiques (navy, muted) passent à `--ui-text` /
  `--ui-text-muted` ;
- les actions utilisent `--ui-primary`/`--ui-on-primary` ; la sélection utilise une bordure
  `--ui-accent` et une pastille ;
- erreur = `--ui-danger`, alerte = `--ui-warning` ; le focus est celui de `.ui-v2` ;
- cibles ≥ 44 px, bordures 1 px, aucune ombre lourde.

Un test de garde vérifiera que ces classes existent toujours dans le rendu SSR des formulaires.
Si le lead les renomme, le test échoue au lieu de laisser un affichage cassé passer en silence.

## 4. Fichiers et propriétaires (à réserver avant le code)

| Fichier | Action | Propriétaire |
| --- | --- | --- |
| `components/role/public-chrome.tsx` + `public-chrome.module.css` | NOUVEAU : en-tête et pied de page publics extraits de `public-home` | worker (moi) |
| `components/role/public-home.tsx` / `.module.css` | MODIFIÉ : utilise `PublicChrome`, rendu visuel identique | worker |
| `components/role/public-forms.module.css` | NOUVEAU : habillages `requestSkin` et `authSkin` | worker |
| `components/role/public-site.tsx` | MODIFIÉ : branches `new` et `auth` seulement (`ThemeSurface` + chrome + habillage), autres vues inchangées | worker |
| `tests/ui/public-request.test.ts` | NOUVEAU | worker |
| `components/app/forms.tsx`, `ui.tsx`, `session*.ts`, `courant-app.tsx`, `app/globals.css`, `layout`, fondation thème | lecture seule | lead |

## 5. Phases (une livraison courte par phase, SHA + tests + captures)

| Phase | Contenu | Validation |
| --- | --- | --- |
| P1 Chrome | extraction de `PublicChrome` ; accueil identique | tests accueil (13) verts ; captures avant/après identiques sur l'accueil (2 thèmes × 4 tailles) |
| P2 Demande | vue `new` dans le thème (3 étapes, erreurs, photos, récapitulatif) | tests §6 ; captures de chaque étape et des états d'erreur |
| P3 Connexion | vue `auth` (login, signup, reset), notice de brouillon, alertes de session | tests §6 ; captures des 3 modes et d'une erreur de connexion simulée |
| P4 Recette root | parcours complet sur une preview | §7 |

## 6. Tests prévus

- **SSR** (harnais `tests/documents/harness`, sans `window`) : `new` et `auth` sont rendus sous
  `.ui-v2` avec `PublicChrome` ; les autres vues gardent l'ancien en-tête ; les classes de §3 sont
  présentes (garde).
- **Câblage**, avec une session factice sur le vrai `PublicSite` :
  - les props passées à `RequestForm` sont strictement les mêmes qu'avant (`initialCategory`,
    `initialValues = pendingDraft`, `sites=[]`, `mode="public"`, `busy`, `onBack → go("home")`,
    `onSubmit → saveDraft`, `onDemo → startDemo("client","new")`) ;
  - les props passées à `AuthForm` (mode, `onMode`, et `onSubmit` vers `signIn`/`signUp`/
    `resetPassword` selon le mode) sont inchangées ;
  - aucun appel à la session au rendu.
- **Parcours brouillon** : accueil → `newRequest("socket")` → `new` pré-rempli → `saveDraft` →
  `auth` en mode signup avec la notice de reprise, sans aucune inscription automatique (aucun
  `signUp` sans soumission explicite). Retour depuis `auth` vers `new` : valeurs restaurées depuis
  `pendingDraft`.
- **Non-régression des rôles** : les rendus de `client-space` et d'`enterprise-space` avec
  `RequestForm` ne contiennent ni `ui-v2` ni l'habillage public.
- `tsc --noEmit` strict, `npm run test:ui` et la suite complète.

## 7. Captures et recette (2 thèmes × 360 / 390 / 1280 / 1440)

Écrans : étape 1 (vide, erreur « 15 caractères », 6 photos + erreur de type), étape 2 (CP invalide
via la validation native), étape 3 (récapitulatif, estimation, avertissement de compte),
`auth` login, signup (avec et sans « Artisan »), reset, notice de brouillon, erreur de connexion.

Contrôles mesurés :
- 0 débordement horizontal, cibles ≥ 44 px ;
- contraste AA des textes, des erreurs et des sélections dans les deux thèmes ;
- 0 erreur console, 0 requête externe ;
- aucun POST pendant le parcours anonyme jusqu'à la soumission d'`auth` ;
- thème persistant entre `home`, `new` et `auth` ;
- le changement de thème en cours d'étape ne perd pas la saisie (pas de remontage).

## 8. Risques et parades

| Risque | Parade |
| --- | --- |
| **Focus** : le changement d'étape ne déplace pas le focus (comportement actuel) ; avec le chrome, l'utilisateur au clavier peut rester en bas | le corriger demande de modifier `forms.tsx` → demande au lead (§2.3) ; en attendant, la recette documente l'état actuel, sans contournement côté habillage |
| **Erreurs** : l'alerte de validation (`role="alert"`), `field-error` et les alertes de session doivent rester visibles et annoncées dans les deux thèmes | habillage `--ui-danger`/`--ui-warning` + capture de chaque erreur ; `Alerts` rendu au-dessus du chrome, jamais caché sous l'en-tête collant |
| **Valeurs persistées** : brouillon en sessionStorage sans les photos ; l'étape revient à 1 au retour | comportement conservé et annoncé (texte existant) ; test de restauration ; aucune nouvelle persistance |
| **Remontage** : envelopper le formulaire dans un arbre qui change avec le thème remettrait l'état à zéro | `ThemeSurface` stable (thème par attribut) ; test « basculer le thème garde la saisie » en navigateur |
| **États lecture seule / indisponible** : sans backend (preview sans env), `signIn`/`signUp` échouent ; `busy` désactive l'envoi | le message d'erreur de session existant est affiché dans le thème ; bouton désactivé visible (opacité + curseur) ; aucune promesse ajoutée |
| **Estimation chiffrée** : l'étape 3 affiche `money(c.min)–money(c.max)` présentés comme « exemples de préparation » | contenu existant non modifié par ce slice ; signalé à root/lead pour décision de copie, sans changement de logique ici |
| **Couplage aux classes historiques** | test de garde (§3) ; habillage limité au conteneur |
| **Chrome dupliqué** | une seule source (`PublicChrome`) pour l'accueil, `new` et `auth` |
| **Bans DESIGN** (polices, gradients, ombres) | revue de l'habillage contre `DESIGN.md` avant chaque livraison |

## 9. Hors périmètre, à ne pas annoncer

Pas d'espaces rôles rethémés, pas d'application complète, pas de nouvelle logique de demande,
d'envoi de photos, de paiement ou d'authentification, et pas de preview cloud par ce worker.
