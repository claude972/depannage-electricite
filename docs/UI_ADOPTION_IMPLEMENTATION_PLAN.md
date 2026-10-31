# Plan d’adoption UI — UI-ADOPTION-PLAN-001 (documentation seule)

- Base `ce54944` (DESIGN.md + `docs/DIRECTION_UI_UX_VALIDEE.md`), branche `claude/ui-adoption-plan`. Référence visuelle :
  `prototypes/delivo-test/web-network.html` à `6bc0cab`. Aucun code applicatif, global, backend ou prototype dans ce lot.
- Tout démarre **après le checkpoint B2** et reste soumis à la revue ROOT tranche par tranche.

## 1. État de départ (lu dans le code)

- `app/layout.tsx` : pas de police chargée, `themeColor` `#102a43`, aucun attribut de thème sur `<html>`.
- `app/globals.css` (≈ 4 700 lignes) : variables `:root` bleues (`--blue #1457d9`, `--navy #102a43`), police
  « Avenir Next » ; primitives partagées (`.button`, `.panel`, `.tag`, `.unavailable`, `.field`, `.alert`…).
- CSS modules de coque : `components/role/{client,artisan,enterprise,admin,public,support-tickets,artisan-quote-draft}`
  et feuilles `components/features/*` ; couleurs **codées en dur** nombreuses (ex. `enterprise.module.css` ≈ 65
  occurrences des seuls bleus d’origine, `tracking.module.css` 16) : elles doivent passer par les tokens, pas par une
  recherche-remplacement aveugle.
- Contrôleur `components/courant-app.tsx`, session/types/capacités dans `components/app/*` : **hors périmètre visuel**.

## 2. Propriété des fichiers

| Zone | Propriétaire | Règle |
| --- | --- | --- |
| `app/layout.tsx`, `app/globals.css` (tokens, primitives, script de thème), `components/app/ui.tsx` (primitives) | **lead** (une seule PR « tokens ») | **Un seul endroit** pour couleurs, rayons, espacements, typo, états ; aucun autre fichier ne définit de token. |
| `components/courant-app.tsx`, `components/app/{session,types,api,features,…}` | lead | Inchangés par l’adoption visuelle (aucune logique, aucun droit). |
| `components/role/public-site.tsx` + `public.module.css` | agent UI (tranche 2) | Accueil réel d’après 6bc0cab. |
| `components/role/client-space.tsx` + CSS | agent UI (tranche 3) | |
| `components/role/artisan-*.tsx` + CSS | agent UI (tranche 4) | |
| `components/role/enterprise-space.tsx` + CSS | agent UI (tranche 5) | |
| `components/role/admin-space.tsx` + CSS | agent UI (tranche 6) | |
| `components/features/**` (feuilles des lots) | propriétaires de lot | Remplacent leurs couleurs par les tokens dans la tranche de la coque qui les héberge, sur demande. |

Une tranche = un propriétaire, un worktree isolé, une branche ; pas d’édition concurrente d’un même fichier.

## 3. Séquence

1. **Tokens deux thèmes (lead).** Variables CSS sémantiques dans `globals.css` (`--color-bg/surface/card/line/text/
   text-muted/action/action-text/accent/focus/error`, `--advice-*`, rayons 12/14/18/22/28, espacements 4–64) pour
   `[data-theme="dark"]` et `[data-theme="light"]`, valeurs DESIGN.md ; Plus Jakarta Sans via `next/font/local` (fichiers
   de la maquette, provenance et licence à vérifier et à conserver par l’agent dans les assets avant intégration, sans redemande au propriétaire pour une vérification documentaire) ; anciennes variables `--blue`/`--navy` **aliasées** vers les
   tokens le temps de la migration (aucune page cassée) ; primitives `.button/.panel/.tag/.field/.alert/.unavailable`
   recalées ; script de thème inline dans `layout.tsx` (voir risques) + bouton de bascule exposé par le shell.
2. **Accueil client réel (`public-site`).** Composition 6bc0cab : diaporama photo manuel plein écran sans publicité,
   cartes d’interventions, catalogue à onglets, conseils jaunes, bannière « Nous rejoindre » — chaque action reliée au vrai
   parcours existants (`session.go("new")`, connexion, assistance), en utilisant les callbacks du routeur plutôt que des liens de maquette ou à un état « indisponible » explicite ; textes provisoires gardés tels.
3. **Espace client** : demande, estimation, suivi (lot GPS), devis, documents, paiement — références M61, V8-C06/C07,
   M7 ; mêmes composants, pas de mise en page publique.
4. **Espace artisan** : M35/M34/M36/M14/M65 (fidélité déjà établie, seulement re-thémée), planning, devis.
5. **Espace entreprise** : M4/M66/M13, V5-C01/C05/C08 ; tableaux, périmètre org/site, lecture seule conservés.
6. **SuperAdmin** : M43 + back-office plateforme ; densité et tableaux conservés.

Chaque tranche : thème seulement d’abord (tokens), puis compositions ; aucune restructuration de données.

## 4. Correspondance références → rôles

| Rôle | Référence visuelle | Références fonctionnelles (PDF, catalogue existant, non ré-audité) |
| --- | --- | --- |
| Public / accueil | `web-network.html` (6bc0cab) : diaporama, interventions, onglets, conseils, recrutement | M11, M41 (héros), V8-C03/C05 |
| Client | cartes, boutons, pastilles, thème | M61, M7, V8-C06, V8-C07 |
| Artisan | thème + composants | M35, M34, M36, M14, M65, M44/M67 |
| Entreprise | thème + composants ; pas de diaporama | M4, M66, M13, V5-C01/C05/C08 |
| SuperAdmin | thème + composants ; pas de diaporama | M43 |

## 5. Risques et parades

- **Flash de thème / SSR** : `<html>` rendu sans thème côté serveur ⇒ script inline minimal en tête (lecture
  `localStorage` sous try/catch, repli `prefers-color-scheme`), `suppressHydrationWarning` sur `<html>` seulement,
  `color-scheme` CSS ; clé unique (ex. `courant-theme`), aucune donnée personnelle ; fonctionnement sans stockage.
- **Contrastes** : le vert action ne sert jamais de texte courant sur fond sombre ; accent `#5BD49A` sur fond sombre et `#0F5C3A` sur fond clair ; jaune réservé
  au bloc conseils ; mesure automatisée par tranche.
- **États existants** : lecture seule, indisponible (`Unavailable`), chargement/vide/erreur/reprise, refus serveur rendus
  tels quels — à re-thémer sans les retirer ; permissions, gardes de rôle et parcours réels inchangés (aucune action
  « décorative » de la maquette ne devient une fonction).
- **Formulaires et focus** : labels persistants, erreurs près du champ, focus visible dans les deux thèmes, cibles 44 px.
- **Couleurs codées en dur** dans les modules : migration par module, revue visuelle avant/après, pas de remplacement global.
- **Concurrence** : B2 et lots en cours ⇒ démarrage après B2, une tranche à la fois, rebases sur la branche partagée.

## 6. Vérification par tranche

- `npx tsc --noEmit`, `npm test`, `npx tsx --test tests/ui/*.test.ts` ; tests unitaires réels pour toute logique ajoutée
  (lecture du thème, choix système, stockage indisponible, bascule).
- Captures **2 thèmes × 1440/1280/390/360** (démo + compte réel quand disponible) : nominal, chargement, vide, erreur,
  lecture seule ; clavier/focus ; contrastes mesurés ; aucune requête externe nouvelle ; console propre.
- Une **preview par tranche**, bornée au SHA testé ; previews historiques et prototypes conservés.

## Revue ROOT avant implémentation

Plan retenu comme séquence, pas comme preuve de migration. Les fichiers du thème ont un propriétaire unique ; les callbacks et gardes de session sont conservés. La vérification des licences et leur conservation relèvent de l’agent, sans bloquer sur une approbation utilisateur supposée. Le bloc jaune ne modifie pas les couleurs sémantiques des alertes métier. Les anciens bleus codés en dur sont inventoriés par module avant migration ; aucun remplacement global ne vaut vérification. La tranche1 nécessite une mission et un contrat de composants explicites avant code, après le checkpoint fonctionnel B2.
