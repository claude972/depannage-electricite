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
| Artisan | M35 (shell + tableau de bord), M34 (devis), M36 (profil) | Addendum ci-dessous (base f3fd9c6) ; M14/M65 (documents, candidature) hors de ce lot |
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
| VIS-REV-001 — « Aucune » affiché sans données professionnelles | La cellule Alertes dépend de l’état réel du contrat professionnel : « Vérification… » tant qu’il est inconnu, « Non vérifiées » (cadenas) s’il est manquant/indisponible, avec une note `Unavailable` au-dessus du tableau et un bouton Réessayer ; « Aucune » n’apparaît qu’avec des données chargées et porte la mention « parmi les données chargées » : en-tête de colonne et légende du tableau sur grand écran, texte visible dans chaque cellule sous 760 px (où l’en-tête est masqué), lu par les lecteurs d’écran partout. Aucune conformité réglementaire ni SLA n’est déduit. | `siteAlertSummary` (`enterprise-lists.ts`), `SitesView` | Tests unitaires (états unknown / unavailable / missing / available, pluriels). **Limite** : la démo fige toutes les capacités à « disponible » (`courant-app.tsx`, hors périmètre), l’état « Non vérifiées » n’est donc pas capturable en démo ; il est couvert par le test et la lecture du code. |
| VIS-REV-002 — filtre local de site conservé après changement de périmètre global | `reconcileFilters` efface le site local et ramène à la page 1 dès que l’organisation ou le site global change, ou si le site local n’appartient plus au périmètre ; le hook applique le résultat comme prédicat effectif (liste, compteur, export et pagination cohérents). Type, statut, recherche et tri sont conservés. Droits inchangés. | `reconcileFilters`, `useInterventionList` | Tests unitaires (inchangé, site global, retour à tous les sites, changement d’organisation, site orphelin) ; séquence de la revue rejouée : site local A → site global B donne « 1 intervention », Exporter actif ; retour à « Tous les sites » vide le sélecteur local. `interventions-1280-filter-reset-global-site.jpg`, `interventions-1280-filter-reset-all-sites.jpg`. |
| VIS-REV-003 — taux de budget plafonné avant affichage | `budgetFigures` sépare le taux réel (`ratio`, affiché et annoncé : « 150 % ») de la largeur de barre (`width`, seule valeur plafonnée à 100). Budget absent : `ratio` null, « Pas de budget de référence » / « Budget non défini ». Même correction sur la fiche de site. | `budgetFigures`, `wholePercent`, `siteFigures`, fiche de site | Tests 0 / 45 / 80 / 100 / 150 % / budget absent. `sites-1280-after-review.jpg` : 144 € engagés sur 96 € → « 150 % », barre pleine rouge, `aria-label` « 150,0 % … budget dépassé ». |
| VIS-REV-004 — cible < 44 px sous 760 px | `.rowOpen` garde `min-height: 44px` et occupe toute la largeur de sa cellule sur mobile ; anneau de focus explicite (3 px) dans le module, le panneau coupant les débordements. | `enterprise.module.css` | Mesures à 360 px : 66 / 66 / 66 / **45 px** (site « Lot B », adresse « 2 rue »), lignes d’interventions 45 px ; focus clavier visible. `sites-360-focus-short-label.jpg`, `sites-360-after-review.jpg`, `interventions-360-after-review.jpg`. Aucun débordement horizontal de page. |

Captures « après » de ce checkpoint (démo, données fictives ; le site « Lot B » et le budget de 96 € sont saisis via l’interface pour l’essai) :
`docs/visual-fidelity/sites-1280-after-review.jpg`, `sites-360-after-review.jpg`, `sites-360-focus-short-label.jpg`,
`interventions-1280-filter-reset-global-site.jpg`, `interventions-1280-filter-reset-all-sites.jpg`, `interventions-360-after-review.jpg`.

Vérifications : `npx tsc --noEmit` au vert ; `tests/ui` 58 tests (49 existants + 9 nouveaux) au vert ; aucune erreur ni avertissement console pendant les captures.

## Addendum — espace artisan (VISUAL-FIDELITY-001, base `f3fd9c6`)

Publié **avant** toute modification de code de l’espace artisan. Références maîtresses : **M35** (volume 3 p4,
`/tmp/courant-audit/pdf-images/v3-p4.jpeg`) pour la coque et le tableau de bord ; **M34** (vol. 3 p3) pour l’éditeur
de devis ; **M36** (vol. 3 p5) pour le profil. Captures « avant » prises sur la démo locale (`next dev`,
`#demo/artisan…`, 360 et 1280) : `docs/visual-fidelity/artisan-overview-360-before.jpg`,
`artisan-overview-1280-before.jpg`, `artisan-profile-360-before.jpg`, `artisan-quote-360-before.jpg`.
Fichiers du lot : `components/role/artisan-space.tsx`, `artisan-quote-draft.tsx`, `artisan.module.css`,
`artisan-quote-draft.module.css`, `tests/ui/**`, cette page, `docs/visual-fidelity/**`. Logique pure testable
extraite dans `components/role/artisan-lists.ts` (créé au premier checkpoint). Présentation seulement : éditeur de
devis (contrat QUOTE-DRAFT-001), missions, performance, téléversements et commandes artisan conservés à l’identique.

### Règle sur les données

Les chiffres des références (4,7/5, 128 avis, 4 850 €, +12 %, 96 %, 98 %, 245 missions, 2,1 ans, « 3/3 assurances
validées », horaires, villes) sont des **exemples**. Seules les valeurs calculées par `artisanPerformance` sur les
dossiers chargés (note moyenne et nombre d’avis, CA du mois = règlements Stripe payés du mois, interventions réglées,
ancienneté depuis `created_at` du compte) sont affichées. **Jamais fabriqué** : taux de satisfaction, ponctualité /
« dans les délais », évolution mensuelle, distance, SLA, note qualité distincte, nombre de documents « validés »,
compteur de notifications. Ces absences restent des états explicites (`Unavailable`, « Aucun avis encore »).

### M35 — coque et tableau de bord (`#demo/artisan`)

| Élément de la référence | Composant / section existant | Écart constaté (f3fd9c6) | Correction prévue |
| --- | --- | --- | --- |
| Barre haute : menu, logo + « Bonjour, Artisan Électricien », cloche | `.topbar` (bouton menu, `.greeting`, cloche → Messages) | Conforme en structure ; pas de logo rond dans la barre (marque dans le tiroir et la barre latérale). | Conservé. **Écart assumé** : pas de point de notification (aucun compteur serveur). |
| Bandeau marine « Tableau de bord / Vue d’ensemble » + illustration tableau électrique | `.banner`, `.bannerKicker`, `PanelArt` | Illustration masquée sous 420 px alors que la référence la montre sur mobile. | Illustration conservée à 360 (taille réduite, `aria-hidden`), masquée seulement sous 340 px. |
| « Missions d’aujourd’hui » + « Voir tout » | `.sectionHead` + `session.go("missions")` | Conforme. | — |
| Ligne de mission : tuile icône teintée, titre, adresse + pastille, « Aujourd’hui 10:00 – 12:00 », chevron | `MissionRow` + `appointmentSlot` (rendez-vous réel, sinon « Horaire à fixer ») | Titre tronqué à 360 (« Tableau électri… ») ; colonne droite bornée à 96 px. | Titre sur deux lignes maximum (`line-clamp`) à ≤ 480 px ; adresse sur une ligne avec ellipse (inchangé) ; pastille à droite de l’adresse quand la place existe. **Écart assumé** : catégorie de dossier affichée à la place de la pastille « À réaliser / Dépannage / Préventif » (pas de type préventif/curatif dans le modèle). |
| « Comment ces missions sont choisies » (ajout projet) | `details.basisFlat` | `summary` 36 px. | `summary` ≥ 44 px. |
| Bloc Performance : étoile Note moyenne, € CA du mois, pied « En hausse de 12 % » | `PerformanceSummary` + `details` « Base de calcul » | Conforme pour les deux chiffres réels ; `summary` 40 px. | `summary` ≥ 44 px. **Écart assumé** : pas de tendance mensuelle (historique non chargé), remplacée par la base de calcul. |
| CTA bleu pleine largeur « Voir missions disponibles → » | `.cta` + compteur d’offres | Pas de flèche ; compteur à la place. | Flèche ajoutée à droite, compteur conservé (donnée réelle). |
| 5 onglets bas Tableau de bord / Missions / Devis / Messages / Profil | `.bottomNav` / `PRIMARY_NAV` | **360** : « Tableau de bord » passe sur 2 lignes, tous les onglets font 81 px. **1280** : onglets bas et bouton menu restent visibles à côté de la barre latérale (règles `.bottomNav` / `.iconButton` déclarées après la media query 1024 px, même spécificité) — visible sur `artisan-overview-1280-before.jpg`. | Libellés sur une ligne (12 px, sans retour), hauteur 60 px ; au-dessus de 1024 px, onglets bas et bouton menu masqués (règles replacées après les déclarations de base). |
| Liste Missions (cible de « Voir tout ») : segments Disponibles / En cours / Terminées | `Missions` + `Segments` (primitive partagée, 40 px) | Segments 40 px (< 44) ; titre d’offre tronqué. | Hauteur ≥ 44 px via le wrapper `.segmentsWrap` (primitive partagée non modifiée) ; même clamp de titre. |

### M34 — devis (`#demo/artisan-mission.demo-001`, dossier au statut « devis envoyé » → « Réviser le devis »)

| Élément de la référence | Composant / section existant | Écart constaté | Correction prévue |
| --- | --- | --- | --- |
| Barre « ← Créer un devis ⋯ » puis H1 + sous-titre | `PageTitle` du dossier (retour Missions) + `.head` h2 « Établir / Réviser le devis » + `.lead` | Conforme ; pas de menu « ⋯ » (aucune action). | — |
| Carte « LIGNES DU DEVIS / Prix HT » : lignes icône + libellé + sous-libellé + prix + chevron | `.rows` > `.row` (champs Prestation, Quantité, Prix unitaire HT, bouton supprimer) | Formulaire empilé : 3 champs + bouton par ligne, très long à 360 ; pas d’en-tête de carte ; pas de total de ligne. | Chaque ligne devient une carte : libellé sur la première rangée, « Quantité × Prix unitaire HT » et **total HT de la ligne** (calcul d’affichage, comme les totaux existants) sur la seconde, bouton supprimer 44 px ; en-tête de carte « Lignes du devis / Prix HT ». Champs, validation, erreurs près du champ, brouillon, conflit et envoi inchangés. **Écart assumé** : lignes éditables en place (pas de sous-écran), pas d’icône par type de ligne (aucun type de ligne dans le contrat). |
| « + Ajouter une ligne » | bouton `text-button` existant | 44 px, conforme. | Style de rangée aligné sur la carte. |
| Totaux : Sous-total HT, TVA (20 %), TOTAL TTC mis en avant | `.tax` (taux réel choisi) + `.totals` / `.total` + mention « estimation d’affichage » | Totaux en simple liste ; TTC peu distingué. | Carte de totaux : Sous-total HT, TVA (taux choisi ou « taux à choisir »), Total TTC sur fond bleu pâle. **Écart assumé** : pas de fond orange (orange réservé aux alertes, DESIGN.md). |
| « PHOTOS / DOCUMENTS — Ajouter une photo » | aucun dans l’éditeur ; documents du dossier via le panneau Documents existant | Absent. | **Écart assumé** : le contrat de brouillon n’a pas de pièce jointe ; aucun faux sélecteur. Rien d’ajouté. |
| CTA marine « Envoyer le devis au client » | `.actions` : « Enregistrer le brouillon » (outline) + « Envoyer le devis au client » (primary) | Conforme ; couleur bleu action. | Bouton d’envoi pleine largeur sur mobile. **Écart assumé** : bleu action (token) au lieu de marine. |

### M36 — profil (`#demo/artisan-profile`)

| Élément de la référence | Composant / section existant | Écart constaté | Correction prévue |
| --- | --- | --- | --- |
| Barre « ← Profil Artisan 🔔 » | `PageTitle` « Profil artisan » | Conforme. | — |
| En-tête teinté : avatar, « Artisan Bâti & Co », étoiles 4,6 (128 avis), « Artisan vérifié » | `.profileHead` : initiales, raison sociale, nom, note réelle, `Tag` « Artisan vérifié » (si `artisan_approved`) ou état de candidature | Pas de fond teinté ; une icône étoile + valeur. | Bandeau bleu pâle pleine largeur ; note affichée « 5 / 5 (1 avis) » (réel). **Écart assumé** : pas de rangée de 5 étoiles décoratives. |
| Carte « Documents & Assurances / Assurances validées / 3/3 ✓ / Voir les documents » | `.docCard` : compte des justificatifs transmis `/3`, « examinés par l’opérateur », lien Documents | Conforme en structure. | **Écart assumé** : « validées » et coche verte non affichées (pas de statut de validation par document) ; compteur = justificatifs transmis. |
| « Performance » 3 × 2 : satisfaction %, qualité /5, dans les délais %, missions réalisées, ancienneté, note moyenne | `PerfGrid` : 2 tuiles `Unavailable` (satisfaction, ponctualité) + 4 tuiles réelles | 360 : une colonne, page très longue ; tuiles indisponibles volumineuses. | Grille 2 colonnes dès 360 (3 à ≥ 761 px), tuiles compactes ; `Unavailable` compact (icône, titre, raison courte) sans changer la primitive. **Écart assumé** : les 2 indicateurs sans source restent « indisponibles », pas de valeur. |
| Bouton bleu « Modifier le profil » puis outline « Voir les statistiques détaillées » | `.profileActions` : « Modifier le profil » (primary, ouvre le formulaire) ; « Voir le détail » (lien texte dans l’en-tête de section) ; « Configurer mes règlements Stripe » (outline) | Lien texte au lieu du bouton outline. | Bouton outline « Voir les statistiques détaillées » sous « Modifier le profil » ; lien texte retiré de l’en-tête (une seule entrée vers Performance). Stripe conservé en dessous (fonction réelle). |
| Onglets bas Accueil / Missions / Profil / Messages / Plus | `PRIMARY_NAV` M35 | Jeu d’onglets différent entre M35 et M36. | **Écart assumé** : M35 reste maître pour la coque (Devis plutôt que Plus ; le « Plus » est le tiroir). |
| Hors référence : Disponibilité, liens Dossier et aide, Installer l’application, Déconnexion | sections existantes | — | Conservés sous le profil (fonctions réelles). |

### Règles responsive

- **360** : une colonne ; barre haute collante, onglets bas fixes (60 px + zone sûre) ; bandeau avec illustration réduite ;
  lignes de mission sur 2 rangées (titre / adresse + état) avec colonne droite ≤ 96 px ; grille performance 2 colonnes ;
  cartes de ligne de devis empilées, totaux en carte, CTA pleine largeur ; aucun défilement horizontal de page.
- **760** : mêmes composants, performance 2 colonnes jusqu’à 760 px puis 3 ; ligne de devis sur une rangée
  (libellé | quantité | prix | supprimer) à partir de 641 px (règle existante) ; tiroir pour la navigation secondaire.
- **1280** : barre latérale 240 px (inchangée), contenu ≤ 1180 px, onglets bas et bouton menu masqués (correction),
  bandeau avec illustration pleine taille, performance 3 colonnes.

### Accessibilité ciblée

- Cibles ≥ 44 × 44 : onglets bas (60 px), segments (44 via wrapper), `summary` (44), suppression de ligne (44 déjà),
  boutons de ligne/tuile, CTA (52). Mesure automatisée des éléments interactifs visibles < 44 px à 360 : objectif 0.
- Focus visible : anneau global 3 px (`globals.css`) ; vérification clavier sur onglets bas, lignes, segments, éditeur.
- Contraste (vérifié sur les tokens utilisés) : blanc sur marine `#102a43` 14,6:1 ; blanc sur bleu `#1457d9` 5,4:1 ;
  `#526178` sur blanc 6,3:1 ; onglet inactif `#5b6b82` sur blanc 5,2:1 ; état jamais porté par la couleur seule
  (pastilles textuelles, « indisponible » en toutes lettres).

### Vérification : par test ou par capture

| Par test (`tests/ui/artisan-lists.test.ts`, logique pure dans `artisan-lists.ts`) | Par capture (démo 360 / 1280, script Playwright hors dépôt) |
| --- | --- |
| État d’horaire d’une mission (lecture / indisponible / à fixer / aujourd’hui / date) ; descripteurs des tuiles de performance (valeur réelle vs indisponible avec raison, jamais de valeur inventée) ; libellés et compteurs des segments de missions ; total HT d’une ligne et des totaux du brouillon (quantité × prix, TVA au taux choisi, « taux à choisir ») ; compte des justificatifs transmis. | Composition M35 / M34 / M36 côte à côte ; onglets bas sur une ligne à 360 et absents à 1280 ; 0 élément interactif < 44 px ; focus clavier ; absence de débordement horizontal ; console sans erreur ; libellés courts et longs (titre de mission, nom de société). |

### Checkpoints prévus

1. Coque + tableau de bord M35 (+ segments de la liste Missions) — captures `artisan-overview-{360,1280}-after.jpg`.
2. Profil M36 — captures `artisan-profile-{360,1280}-after.jpg`.
3. Éditeur de devis M34 — captures `artisan-quote-{360,1280}-after.jpg`.
