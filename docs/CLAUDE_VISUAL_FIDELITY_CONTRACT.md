# Contrat de fidélité visuelle — VISUAL-FIDELITY-001

- Agent : Claude (Claude Desktop, worktree `depannage-claude-design`), pilote/relecture : Codex.
- Branche : `claude/web-pwa-design`, base `9b3dae03e1a413ffe89b34e0db7553ddc1b3ade9`.
- Publié **avant** toute modification de code. Les captures « avant » ont été prises sur la démo locale
  (`next dev`, `http://localhost:3177/#demo/manager-<vue>`), aucune preview Vercel (différée).

## Règles de lecture

- Une route = une référence maîtresse. On compare structure, navigation, proportions, hiérarchie,
  densité, tableaux et placement des actions — pas seulement la palette.
- Les noms, logos, chiffres, artisans, dates, SLA et budgets des maquettes sont des **exemples** : ils
  ne sont jamais recopiés. Les colonnes sans donnée réelle sont omises ou marquées comme telles.
- Les écarts volontaires (accessibilité, périmètre électrique, données absentes) sont listés comme tels.

## Images de référence inspectées

| Code | Fichier | Contenu observé |
| --- | --- | --- |
| M4 | `/tmp/courant-audit/pdf-images/v1-p4.jpeg` (grand format p4) | Barre haute bleu roi pleine largeur (marque 2 lignes à gauche, cloche, avatar + nom/rôle). Barre latérale blanche ≈215 px, 7 entrées, item actif pastille bleu pâle. Titre 32 px gras + sous-titre, bouton « Exporter » en haut à droite. **Carte de filtres séparée** (libellé au-dessus de chaque liste : Site, Type, Artisan, Statut, Période, Réinitialiser à droite). Carte tableau : en-tête « 12 interventions en cours » + « Trier par » à droite ; colonnes Site / Type (icône + pastille) / Artisan / Statut / Date (date et heure sur 2 lignes) ; pagination numérotée centrée, page active disque bleu. |
| M66 | `/tmp/courant-audit/pdf-images/v4-p19.jpeg` (volume 4 p19) | Même shell ; sélecteur de période en haut à droite du titre ; filtres en ligne sans libellé (recherche + listes + Réinitialiser) ; tableau Site (icône immeuble bleue, nom gras + adresse) / Type (libellé + pastille Préventif/Curatif) / Artisan (nom + spécialité) / Statut (pastille avec point) / Date (2 lignes) / « ⋯ » ; pied : compteur à gauche, pagination numérotée à droite. Bas de barre latérale : carte « Besoin d’aide ? » + contact support. |
| M13 | `/tmp/courant-audit/pdf-images/v1-p13.jpeg` (grand format p13) | Syndic : en-tête bleu sur la zone de contenu, barre latérale blanche avec marque. Section « Mes immeubles » + pastille compteur + lien « Voir tous » à droite ; **tableau** Immeuble (carré icône + nom + adresse) / Interventions en cours (carré compteur + « N en cours ») / Budget utilisé (barre + %) / montants (% + « engagé / budget ») / Alertes (texte coloré) / Statut / « ⋯ ». Puis « Interventions récentes (tous immeubles) » : ID / Immeuble / Intervention / Fournisseur / Date de début / Statut / Priorité (point coloré + libellé). |

## Captures « avant » (base 9b3dae0)

Stockées hors dépôt puis copiées dans `docs/visual-fidelity/` avec les captures « après » au checkpoint.

## Tableau route → référence → écarts → correction → vérification

### Checkpoint 1 (ce lot) — espace entreprise : shell, Sites, Interventions

| Route (démo) | Référence / page | Écart constaté au SHA de base | Correction prévue | Vérification |
| --- | --- | --- | --- | --- |
| Shell entreprise (toutes vues manager) | M4 p4, M66 vol.4 p19 | Barre haute bleu nuit `#102A43` au lieu du bleu roi des deux références ; marque + « Espace entreprise » séparés par un filet au lieu d’un bloc marque 2 lignes de la largeur de la barre latérale ; barre latérale 248 px, libellés 14 px moins lisibles que la référence (≈16 px) ; légende « Organisation » non présente ; bas de barre : bloc organisation au lieu de « Besoin d’aide ? ». | Barre haute bleu roi (token action `#1457D9`, contraste blanc 5,4:1) ; bloc marque 2 lignes aligné sur la largeur de la barre latérale ; barre latérale 232 px, items 15 px / 44 px min ; séparation par filet au lieu de légende ; bas : lien « Besoin d’aide ? » vers l’assistance réelle, puis déconnexion. Le nom/logo reste `courant.` (marque non décidée, ni PartnerPro ni PartenaRx). | Capture 1280 côte à côte M4/M66 ; navigation clavier ; menu mobile 360 inchangé fonctionnellement. |
| Bandeau périmètre (toutes vues) | M66 (sélecteur en tête de page) | Carte pleine largeur au-dessus du titre, absente des références ; elle repousse le titre. | Bandeau fin sans carte (texte + sélecteurs à droite) : l’organisation/le site actifs restent visibles (exigence DESIGN.md), poids visuel réduit. | Capture ; sélecteurs Organisation/Site toujours fonctionnels. |
| `#demo/manager-requests` Interventions | M4 p4 (structure), M66 (lignes) | Filtres placés **dans** la carte tableau ; « Exporter CSV » dans l’en-tête du tableau au lieu du coin de page ; en-tête « Toutes les interventions » + méta au lieu du compteur « N interventions » + tri ; date sur une ligne ; bouton « Ouvrir » encadré par ligne (M66 : ligne cliquable + menu discret) ; pagination « Page 1 / 1 » au lieu de numéros. | Carte de filtres séparée au-dessus (libellés M4, recherche M66, Réinitialiser à droite) ; « Exporter » en haut à droite du titre à côté de « Nouvelle demande » ; en-tête de tableau « N interventions » + « Trier par » (récent/ancien, réel) ; Date sur 2 lignes (jour / heure) ; nom du site = bouton d’ouverture, action de fin de ligne discrète (icône + libellé accessible) ; pagination numérotée avec page active pleine. | Capture 1280 côte à côte M4 ; tests filtres/tri/pagination (logique pure) ; lecture seule inchangée. |
| idem | M66 colonne Artisan | La référence affiche nom + spécialité ; le workspace ne contient **pas** le nom de l’artisan. | Conserver « Artisan attribué » / « Recherche en cours » ; aucun nom inventé. **Écart restant assumé.** | Revue du rendu. |
| `#demo/manager-sites` Sites & contrats | M13 p13 | **Grille de grandes cartes** (badge, titre, adresse, barre, deux boutons par carte) au lieu du tableau « Mes immeubles » ; pas de section « Interventions récentes » ; faible densité (3 sites occupent un écran). | Tableau dense : Site (carré icône + nom + adresse) / Type / Interventions en cours (carré compteur + « N en cours ») / Budget engagé (barre + % + « engagé / budget », base « devis acceptés sur dossiers chargés ») / Alertes (approbations en attente + conformité à traiter, sinon « Aucune ») / actions de ligne (Fiche, Nouvelle demande si droit d’écriture). Titre de section + compteur + « Contrats cadres » à droite. Section « Interventions récentes (tous les sites) » : Réf. / Site / Intervention / Date / Statut / Priorité + lien « Voir toutes les interventions ». Formulaire d’ajout et pilotage professionnel conservés sous les tableaux. | Capture 1280 côte à côte M13 ; lecture seule par site ; états vides. |
| idem | M13 colonne Statut « Actif » | Le modèle `Site` n’a pas de statut d’activité. | Colonne omise (aucune valeur inventée). **Écart assumé.** | — |
| idem | M13 couleurs d’icônes par immeuble (bleu, vert, violet, orange, cyan) | Multi-accents décoratifs, contraires à DESIGN.md (vert = réussite, orange = alerte). | Icône bleue unique ; la couleur de la barre de budget porte l’état : bleu normal, ambre ≥ 80 %, rouge dépassement. **Écart volontaire.** | Capture. |
| Mobile 360 (Sites, Interventions) | Aucune référence mobile pour ces écrans | Tableau converti en pile « libellé / valeur » sur toute la largeur : chaque dossier occupe plus d’un écran. | Lignes compactes : nom + statut sur la 1ʳᵉ ligne, type/date/budget en méta, action pleine largeur ; filtres en grille 2 colonnes. Adaptation documentée (DESIGN.md : cartes ou défilement identifié). | Capture 360 ; aucune barre de défilement horizontale de page. |

### Checkpoints suivants (référence fixée, écarts à établir avant leur code)

| Surface | Référence maîtresse | Statut |
| --- | --- | --- |
| Tableau de bord entreprise | M66 (shell) + M13 (syndic) / V5-C05 (bureaux) | À auditer |
| Fiche de site | V5-C01 / M50 | À auditer |
| Approbation | V5-C08 | À auditer |
| Artisan | M35, M34, M36, M14, M65 | À auditer |
| Super Admin | M43 (volume 3 p12) | À auditer |
| Pages publiques | M11 + variantes cataloguées | À auditer |

## Hors périmètre de ce lot

Backend, migrations, secrets, packages, session/auth, scripts QA, `app/globals.css`, composants partagés
`components/app/*` (formulaires, Badge, Tag). Les interfaces `Session` et les contrôles de lecture seule
sont conservés à l’identique.

## Résultat du checkpoint 1

Planches côte à côte (référence | avant `9b3dae0` | après), démo locale `next dev` — **aucune preview en ligne** :

- `docs/visual-fidelity/sites-1280-M13.jpg` — M13 / avant / après, 1280.
- `docs/visual-fidelity/interventions-1280-M4-M66.jpg` — M4 / M66 / avant / après, 1280.
- `docs/visual-fidelity/sites-360.jpg`, `docs/visual-fidelity/interventions-360.jpg` — avant / après, 360 (pas de référence mobile).

| Ligne du contrat | Fait | Reste |
| --- | --- | --- |
| Shell | Barre haute bleu roi, marque + « Portail entreprise », barre latérale 232 px / items 15 px, filet de séparation, carte « Besoin d’aide ? » → Assistance, déconnexion. | Marque sur une ligne (le composant partagé `Brand` n’est pas scindé en 2 lignes comme M4) ; bandeau démo conservé entre barre haute et contenu. |
| Bandeau périmètre | Bandeau fin sans carte, sélecteurs inchangés. | — |
| Interventions | Carte de filtres séparée (M4), Exporter en tête de page, « N interventions » + Trier par (réel), date sur 2 lignes, site cliquable + chevron d’ouverture, pagination numérotée (affichée dès 2 pages). Le tableau de bord réutilise le même ensemble (M66). | Colonne Artisan sans nom (donnée absente). Pas de filtre Période (pas de besoin métier validé). |
| Sites | Tableau « Mes sites » + compteur, en cours, barre de budget teintée par état, montant engagé / budget, alertes réelles (devis à approuver, échéances dépassées, contrôles à traiter), actions Fiche / Demande ou « Lecture seule ». Tableau « Interventions récentes (tous les sites) » + lien. | Pas de colonne Statut (absente du modèle) ; pas de menu « ⋯ » (actions visibles à la place). |
| Mobile 360 | Rangées compactes pour les trois nouveaux tableaux ; tableau Rapports conservé en pile libellé/valeur ; filtres en grille 2 colonnes. | — |

Vérifications : `npm run check` (typecheck, 93 tests unitaires, 49 tests UI dont `tests/ui/enterprise-lists.test.ts`, build Next) au vert.
Droits : `canCreateRequest`, `canWriteSite`, `canWriteOrganization` et les notes de lecture seule sont utilisés comme avant ; aucune interface `Session` modifiée.

## Corrections de la revue `DESIGN_E7AAEF7` (VIS-REV-001 à 004)

Checkpoint de corrections sur la base `e7aaef7`, périmètre inchangé (`components/role/**`, tests UI, cette page).
Démo locale `next dev` pilotée par un navigateur sans tête ; aucune preview en ligne, aucune donnée réelle.

| Constat | Correction | Où | Vérification |
| --- | --- | --- | --- |
| VIS-REV-001 — « Aucune » affiché sans données professionnelles | La cellule Alertes dépend de l’état réel du contrat professionnel : « Vérification… » tant qu’il est inconnu, « Non vérifiées » (cadenas) s’il est manquant/indisponible, avec une note `Unavailable` au-dessus du tableau et un bouton Réessayer ; « Aucune » n’apparaît qu’avec des données chargées et porte la mention « parmi les données chargées » (en-tête de colonne, légende du tableau, texte lu par les lecteurs d’écran). Aucune conformité réglementaire ni SLA n’est déduit. | `siteAlertSummary` (`enterprise-lists.ts`), `SitesView` | Tests unitaires (états unknown / unavailable / missing / available, pluriels). **Limite** : la démo fige toutes les capacités à « disponible » (`courant-app.tsx`, hors périmètre), l’état « Non vérifiées » n’est donc pas capturable en démo ; il est couvert par le test et la lecture du code. |
| VIS-REV-002 — filtre local de site conservé après changement de périmètre global | `reconcileFilters` efface le site local et ramène à la page 1 dès que l’organisation ou le site global change, ou si le site local n’appartient plus au périmètre ; le hook applique le résultat comme prédicat effectif (liste, compteur, export et pagination cohérents). Type, statut, recherche et tri sont conservés. Droits inchangés. | `reconcileFilters`, `useInterventionList` | Tests unitaires (inchangé, site global, retour à tous les sites, changement d’organisation, site orphelin) ; séquence de la revue rejouée : site local A → site global B donne « 1 intervention », Exporter actif ; retour à « Tous les sites » vide le sélecteur local. `interventions-1280-filter-reset-global-site.jpg`, `interventions-1280-filter-reset-all-sites.jpg`. |
| VIS-REV-003 — taux de budget plafonné avant affichage | `budgetFigures` sépare le taux réel (`ratio`, affiché et annoncé : « 150 % ») de la largeur de barre (`width`, seule valeur plafonnée à 100). Budget absent : `ratio` null, « Pas de budget de référence » / « Budget non défini ». Même correction sur la fiche de site. | `budgetFigures`, `wholePercent`, `siteFigures`, fiche de site | Tests 0 / 45 / 80 / 100 / 150 % / budget absent. `sites-1280-after-review.jpg` : 144 € engagés sur 96 € → « 150 % », barre pleine rouge, `aria-label` « 150,0 % … budget dépassé ». |
| VIS-REV-004 — cible < 44 px sous 760 px | `.rowOpen` garde `min-height: 44px` et occupe toute la largeur de sa cellule sur mobile ; anneau de focus explicite (3 px) dans le module, le panneau coupant les débordements. | `enterprise.module.css` | Mesures à 360 px : 66 / 66 / 66 / **45 px** (site « Lot B », adresse « 2 rue »), lignes d’interventions 45 px ; focus clavier visible. `sites-360-focus-short-label.jpg`, `sites-360-after-review.jpg`, `interventions-360-after-review.jpg`. Aucun débordement horizontal de page. |

Captures « après » de ce checkpoint (démo, données fictives ; le site « Lot B » et le budget de 96 € sont saisis via l’interface pour l’essai) :
`docs/visual-fidelity/sites-1280-after-review.jpg`, `sites-360-after-review.jpg`, `sites-360-focus-short-label.jpg`,
`interventions-1280-filter-reset-global-site.jpg`, `interventions-1280-filter-reset-all-sites.jpg`, `interventions-360-after-review.jpg`.

Vérifications : `npx tsc --noEmit` au vert ; `tests/ui` 58 tests (49 existants + 9 nouveaux) au vert ; aucune erreur ni avertissement console pendant les captures.
