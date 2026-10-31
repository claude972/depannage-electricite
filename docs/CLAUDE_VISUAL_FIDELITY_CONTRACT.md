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

### Résultat du checkpoint 1 — coque et tableau de bord M35

| Ligne de l’addendum | Fait | Reste / écart |
| --- | --- | --- |
| Onglets bas | Libellés sur une ligne, 63 px (60 + filet actif), masqués ≥ 1024 px avec le bouton menu (règles replacées après `.bottomNav` / `.iconButton`). Onglet d’accueil libellé **« Accueil »** (M36) car « Tableau de bord » ne tient pas sur une ligne dans 72 px ; le menu et la barre latérale gardent « Tableau de bord ». | — |
| Bandeau | Illustration conservée à 360 (64 px), titre 26 px sur une ligne ; masquée seulement < 340 px. | — |
| Lignes de mission | Titre sur 2 lignes maximum (plus de troncature) ; horaire réel ou « à fixer » via `appointmentSlotState`. | Colonne droite ≤ 96 px à 360 : les titres longs passent sur 2 lignes (choix assumé contre l’ellipse). |
| CTA | Flèche à droite, compteur d’offres réel, une ligne à 360 (15 px). | — |
| Cibles | `summary` 44 px ; segments Missions 44 px, 3 sur une ligne à 360 (wrapper local, primitive partagée inchangée) ; 0 élément interactif visible < 44 px à 360 et 760 sur Accueil, Missions, Profil. | — |

Captures : `artisan-overview-360-after.jpg`, `artisan-overview-1280-after.jpg`, `artisan-missions-360-after.jpg`
(avant : `artisan-overview-{360,1280}-before.jpg`). Tests : `tests/ui/artisan-lists.test.ts` (états d’horaire,
segments) ; suite UI 61/61 ; `tsc` au vert ; console sans erreur à 360 / 760 / 1280.

### Résultat du checkpoint 2 — profil M36

| Ligne de l’addendum | Fait | Reste / écart |
| --- | --- | --- |
| En-tête teinté | Bandeau bleu pâle pleine largeur (déborde le padding du contenu à 360 et 1280), avatar initiales, raison sociale, nom, note réelle « 5 / 5 (1 avis) », état de candidature ou « Artisan vérifié ». | Pas de rangée d’étoiles décoratives (assumé). |
| Documents & assurances | Inchangé : justificatifs transmis `/3`, « examinés par l’opérateur », lien Documents. | « validées » / coche verte non affichées (aucun statut par document). |
| Performance | Six tuiles pilotées par `perfTiles` (ordre M36) : 2 colonnes dès 360 px (hauteur de grille 458 px contre une colonne auparavant), 3 colonnes ≥ 761 px ; tuiles `Unavailable` compactes (icône, titre, raison) sans modifier la primitive ; satisfaction et ponctualité restent indisponibles. | M36 garde 3 colonnes sur téléphone : 2 colonnes ici pour conserver 13–14 px (assumé). |
| Actions | « Modifier le profil » (bleu) puis « Voir les statistiques détaillées » (outline, → Performance) ; lien texte « Voir le détail » retiré de l’en-tête de section ; Stripe conservé en dessous. | — |
| Cibles | 0 élément interactif visible < 44 px à 360 et 1280 sur Profil et Performance ; aucun débordement horizontal. | — |

Captures : `artisan-profile-360-after.jpg`, `artisan-profile-1280-after.jpg` (avant : `artisan-profile-360-before.jpg`).
Tests : `perfTiles` (valeurs formatées par les mêmes formateurs que l’affichage, tuiles indisponibles sans valeur) ;
suite UI 63/63 ; `tsc` au vert ; console sans erreur.

### Résultat du checkpoint 3 — devis M34

| Ligne de l’addendum | Fait | Reste / écart |
| --- | --- | --- |
| Carte « Lignes du devis / Prix HT » | Carte avec en-tête (décoratif, `aria-hidden`), une rangée par ligne : libellé, quantité, prix unitaire HT, **total HT de la ligne** (affichage, `quoteLineTotalCents`, « — » tant que la saisie est invalide), suppression 44 px. À ≤ 640 px : libellé pleine largeur, puis quantité | prix, puis total | supprimer. Champs, validation, erreurs près du champ, brouillon, conflit, rechargement et envoi inchangés. | Lignes éditables en place, sans icône par type (assumé). |
| Ajouter une ligne | Inchangé, sous la carte. | — |
| Totaux | Carte « Sous-total HT / TVA (taux choisi ou « taux à choisir ») / Total TTC » avec TTC sur fond bleu pâle ; calcul par `quoteTotals` (même formule qu’avant, TVA inconnue sans taux) ; mention d’estimation sous la carte. | Pas de fond orange (assumé). |
| Photos / documents | Rien d’ajouté. | Assumé : aucune pièce jointe dans le contrat de brouillon. |
| CTA | « Envoyer le devis au client » pleine largeur et 52 px à ≤ 640 px (286 px = largeur utile du panneau à 360) ; « Enregistrer le brouillon » / « Abandonner » conservés au-dessus. | Bleu action (assumé). |
| Cibles | 0 élément interactif < 44 px dans l’éditeur à 360 et 1280 ; aucun débordement horizontal ; saisie d’un prix recalculée en direct (vérifié par script : 80 € → « 80,00 € »). | — |

Captures (section de l’éditeur, dossier démo « devis envoyé » → « Réviser le devis ») : `artisan-quote-360-after.jpg`,
`artisan-quote-1280-after.jpg` (avant : `artisan-quote-360-before.jpg`, page entière). Tests : `quoteLineTotalCents`,
`quoteTotals` (20 %, 5,5 %, 0 %, sans taux, sans ligne) ; suite UI 65/65 ; `tsc` au vert ; console sans erreur.

### Bilan artisan (checkpoints 1–3)

Présentation seulement : aucune commande artisan, aucun contrat (QUOTE-DRAFT-001, opérations, candidature,
téléversements) ni primitive partagée modifiés ; `app/globals.css` intact. Logique pure dans
`components/role/artisan-lists.ts` (horaires, segments, tuiles de performance, note, totaux de devis), 9 tests.
Écarts assumés consolidés : onglet bas « Accueil » (libellé court), pas de tendance mensuelle ni d’indicateur sans
source, pas d’étoiles décoratives, pas de statut « validé » par document, pas de pièce jointe au devis, bleu action
pour les CTA, grille performance 2 colonnes sur téléphone. M14 (documents) et M65 (candidature) restent à auditer.

## Ancrages des lots avancés (branche `claude/web-anchors`, base `claude/web-shared` ee767b6)

Règle commune : aucune entrée ni cloche ne confère un droit ; une entrée n’apparaît que si `ACCESS` admet le rôle et
que la capacité n’est pas absente (`anchorEntryVisible`, `components/role/anchors.ts`, testé) ; capacité
`missing`/`unavailable` → état honnête `Unavailable` avec le libellé commun ; refus serveur rendus tels quels ; démo
isolée fournie par la session uniquement.

### Ancrage 1 — notifications (quatre coques)

| Coque | Cloche | Vue `notifications` |
| --- | --- | --- |
| Artisan | `NotificationBell` remplace la cloche « Messages » de l’en-tête (état `capabilities.notifications`, compteur serveur `unreadNotifications`). | `NotificationsPage` (`components/role/notifications-anchor.tsx`) : `NotificationCenter` avec `CONTRACT_MESSAGES[state]`, portée `{ userId, role, authority.canWrite:true }`, client `session.features.notifications`, démo `demoNotificationPage`/`demoPreferences` en mode démonstration seulement, « Ouvrir le dossier » → `openIntervention`. |
| Particulier | Cloche ajoutée dans les deux en-têtes (bureau et mobile) ; l’ancienne cloche Messages garde sa fonction avec l’icône message. Vue ajoutée à l’allowlist locale `CLIENT_VIEWS`. | Idem. |
| Entreprise | Cloche ajoutée dans la barre bleu roi (teinte locale `.topbarBell`), icône message pour les messages. | Idem, portée enrichie de l’organisation et du site actifs. |
| Super Admin | Cloche ajoutée dans les outils d’en-tête ; titre/sous-titre de vue dans l’en-tête de la coque. | Idem sans `PageTitle` (titre porté par l’en-tête). |

Vérifié (démo, script hors dépôt) : cloche visible 44 × 44 et active dans les quatre coques à 360 et 1280 (« Notifications,
2 non lues », compteur serveur de la démo), clic → `#notifications` et centre rendu ; console sans erreur. Captures :
`docs/visual-fidelity/anchors-notifications-{artisan,client,manager,admin}-{360,1280}.jpg`. Tests : `tests/ui/anchors.test.ts`
(visibilité d’entrée selon accès + capacité, portée de feuille) ; suite UI 80/80.

### Ancrage 2 — planning artisan

- Entrée secondaire « Planning » (icône `calendar`) proposée seulement si `canAccess("planning")` admet le rôle et que la
  capacité `planning` n’est pas absente (`secondaryNav(session)` → `anchorEntryVisible`) ; le même filtre s’applique à la
  barre latérale, au tiroir et aux liens du profil.
- Vue `planning` : `ArtisanPlanning` avec `CONTRACT_MESSAGES[state]`, client `session.features.planning`, démo
  `demoPlanning(demoPlanningRange(now, "America/Martinique"))` en mode démonstration seulement, fuseau
  `America/Martinique`, « Ouvrir le dossier » → vue `mission`.
- Droit d’écriture : `planningAuthority(mode, artisan_approved, application_status)` — lecture seule avec raison pour un
  artisan suspendu, ou non activé en mode réel (même source que les alertes de candidature de la coque) ; le serveur
  reste l’autorité.
- Vérifié (démo) : accès par le tiroir à 360 et la barre latérale à 1280 → `#planning` rendu (semaine, légende,
  disponibilités habituelles), 0 élément interactif < 44 px, aucun débordement ; `#demo/client-planning` → écran « ne
  fait pas partie de votre espace » sans entrée ; console sans erreur. Captures `anchors-planning-artisan-{360,1280}.jpg`.
  Tests : `planningAuthority`, `demoPlanningRange` ; suite UI 82/82.
- Observation hors périmètre (CSS du lot) : à 1280 l’en-tête du jour courant « sam. 31 oct. · Aujourd’hui » passe sur
  trois lignes dans la colonne de 120 px.

### Ancrage 3 — documents, validité et avenants de devis

- `QuoteDocumentsAnchor` (`components/role/quote-documents-anchor.tsx`) : `QuoteDocumentsPanel` avec l’état
  `capabilities.quoteDocuments`, `CONTRACT_MESSAGES[state]`, portée `leafScope(profileId, rôle, autorité, org/site)`,
  client `session.features.quoteDocuments`, démo `{ overview: quoteDocumentsDemo(rôle) }` en démonstration seulement,
  `onNavigate("artisan-profile")` → vue `profile`.
- Artisan : sous le devis courant du dossier (`variant="artisan"`, cible `{ interventionId }`, écriture vraie) ; l’éditeur
  de révision reste en dessous. Particulier : sous le tableau du devis (`variant="client"`, cible `{ quoteId }`, écriture
  vraie). Entreprise : après « Détails du devis » dans l’approbation (`variant="enterprise"`, cible `{ quoteId }`,
  écriture = `canWriteSite(site du devis)` du helper fail-closed, sinon `readOnlyReason`) ; l’ancien bloc
  « Validité du devis — règle à fixer » est retiré, la validité étant désormais portée par le lot.
- Vérifié (démo, 360 et 1280) : panneau présent dans les trois variantes (`#demo/artisan-mission.demo-001`,
  `#demo/client-quote.quote-demo-1`, `#demo/manager-approval.approval-demo`), 0 élément interactif < 44 px dans le
  panneau, aucun débordement, console sans erreur. Captures `anchors-quote-documents-{artisan,client,manager}-{360,1280}.jpg`.

### Ancrage 4 — opérations du site (entreprise)

- Fiche de site (`SiteSheet`) : panneau « Opérations du site » après la règle d’approbation, pleine largeur de la grille,
  rendant `SiteOperationsView` avec l’état `capabilities.siteOperations`, `CONTRACT_MESSAGES[state]`, portée
  `leafScope(profileId, rôle, écriture, { organizationId, siteId })` où l’écriture = `enterpriseAuthority(...).canWriteSite(site)`
  (fail-closed) avec `readOnlyReason`, client `session.features.siteOperations`, démo `demoReport()` en démonstration
  seulement (client de démonstration injecté par la session, jamais importé ici), « intervention » → `openIntervention`.
- Onglets du lot relevés à 44 px par une règle locale du panneau (composant du lot non modifié).
- Vérifié (démo `#demo/manager-site.site-1`, 360 et 1280) : panneau présent avec le rapport de démonstration et ses
  sept onglets (44 px), 0 élément interactif < 44 px, aucun débordement, console sans erreur. Captures
  `anchors-site-operations-manager-{360,1280}.jpg`.

### Ancrage 5 — back-office plateforme (Opérateurs, Finance, Modération)

- Entrées : `platformEntries(platformAccess, canAccess)` (`components/role/anchors.ts`, testé) — une entrée n’existe que si
  `canAccess` admet le rôle **et** `platformViewAllowed(platformAccess, vue)` est vrai ; sans réponse serveur (`null`)
  aucune entrée. Super Admin : les trois entrées après la navigation existante ; particulier et entreprise : section
  « Opérateur de plateforme » dans la barre latérale, seulement si le serveur a ouvert au moins une vue (opérateur limité).
- Vues `platform-operators` / `platform-finance` / `platform-moderation` : `PlatformPage` (`components/role/platform-anchor.tsx`)
  rend la vue du lot avec l’état `capabilities.platformOperations`, `CONTRACT_MESSAGES[state]`, portée
  `{ userId, role, authority: platformAuthority(platformAccess, vue) }` (écriture = super-admin ou capacité de la vue,
  sinon lecture avec raison), client `session.features.platform`, démo `PLATFORM_DEMO` en démonstration seulement ;
  sinon écran « Accès non vérifié » (`Unavailable`, raison : service indisponible, droit absent ou droits non vérifiés),
  aucune donnée chargée. Les vues sont ajoutées à l’allowlist locale `CLIENT_VIEWS`.
- En-tête Super Admin à ≤ 600 px : outils en deux lignes (puce de fraîcheur, puis cloche et « Actualiser ») pour
  supprimer le débordement horizontal constaté à 360 (préexistant, aggravé par la cloche).
- Vérifié (démo) : Super Admin → trois entrées à 1280 (barre latérale) et 360 (menu), chaque vue rendue sous son hash,
  0 élément interactif < 44 px, aucun débordement ; particulier et entreprise (sans `platformAccess`) → aucune entrée,
  lien direct `#platform-finance` → « Accès non vérifié » sans donnée ; console sans erreur. Captures
  `anchors-platform-{operators,finance,moderation}-admin-{360,1280}.jpg`, `anchors-platform-unverified-client-1280.jpg`.
  Tests : `platformEntries`, `platformAuthority` ; suite UI 86/86.

### Corrections de la revue des ancrages (ANCHOR-REV-001 à 003, branche `claude/web-design-admin`)

- ANCHOR-REV-001 — particulier sur mobile : carte « Opérateur de plateforme » dans la vue Profil (atteignable par l’onglet
  Profil à 360), liste des sections ouvertes par la plateforme, même garde fail-closed `platformEntries` que la barre
  latérale ; aucune carte sans réponse serveur ; onglets bas inchangés.
- ANCHOR-REV-002 — artisan : `secondaryNav` ajoute les sections du back-office ouvertes à ce compte (barre latérale,
  tiroir, liens du profil) et les vues `platform-*` rendent `PlatformPage` ; sans droit, « Accès non vérifié » au lieu de
  l’écran « ne fait pas partie de votre espace » ; aucune promotion de rôle, aucune restriction inventée.
- ANCHOR-REV-003 — entreprise : textes hérités re-cadrés sur le lot livré — équipements critiques (restaurant) renvoient
  à « Opérations du site » (état déclaré, aucune télémesure) ; bloc générique « Équipements » retiré ; « Respect des SLA »
  du rapport consolidé devient « (consolidé) » : suivi site par site dans la fiche, consolidé multi-sites non livré,
  aucune conformité attestée.
- Vérifié (démo, 360 et 1280) : `#demo/artisan-platform-finance` → « Accès non vérifié » ; aucune entrée artisan/particulier
  sans `platformAccess` ; fiche site-2 et rapport avec les nouveaux libellés ; console sans erreur. Captures
  `anchors-rev-artisan-platform-unverified-{360,1280}.jpg`, `anchors-rev-client-profile-{360,1280}.jpg`,
  `anchors-rev-reports-sla-1280.jpg`. Tests : visibilité opérateur limité pour artisan / particulier / entreprise par le
  garde `canAccess` réel, mode public sans entrée ; suite UI 89/89. Limite : la démo ne fournit `platformAccess` qu’au
  rôle Super Admin, la présence des entrées pour un opérateur limité est prouvée par les tests, pas par capture.

## Addendum — espace client (M61 / V8-C06 / V8-C07)

Publié **avant** toute modification de code de l’espace client (transfert consigné dans `docs/CLAUDE_STATUS.md`).
Branche `claude/web-design-client`, base `f58b3f4` (`claude/web-shared`). Références maîtresses : **M61** (volume 4
p14) pour l’accueil mobile, **V8-C06** (volume 8 p7) pour le devis, **V8-C07** (volume 8 p8) pour le détail
d’intervention. Les planches ne sont pas dans le dépôt : elles ont été rendues depuis les PDF nommés dans
`docs/audit/INVENTAIRE_SOURCES.json` (PyMuPDF, zoom 1,6) vers `/tmp/claude-client-ref/{M61,V8-C06,V8-C07}.png`
(empreintes SHA-256 des images d’origine dans l’inventaire). Captures « avant » prises sur la démo locale
(`next dev -p 3191`, Chromium headless 1248 piloté par un script Playwright hors dépôt, 360 × 800 et 1280 × 900,
page entière) : `docs/visual-fidelity/client-{overview,detail,quote}-{360,1280}-before.jpg` (`#demo/client`,
`#demo/client-detail.demo-003`, `#demo/client-quote.quote-demo-1`).
Fichiers du lot : `components/role/client-space.tsx`, `client.module.css`, `components/role/client-lists.ts` (logique
pure, créé au premier checkpoint), `tests/ui/client-*.test.ts`, cette section, `docs/visual-fidelity/client-*`.
Présentation seulement : devis (acceptation/refus par `session`), règlements, téléversements, assistance, ancrages
notifications / documents de devis / plateforme (`*-anchor.tsx`, `anchors.ts`) restent appelés à l’identique, avec les
mêmes props.

### Règle sur les données

Les éléments des planches sans source serveur ne sont **jamais fabriqués** : note et nombre d’avis de l’artisan,
« Profil vérifié / Certifié », années d’expérience, spécialité, photo, « Garantie satisfaction 30 jours »,
« Annulation gratuite jusqu’à 48 h », « Paiement sécurisé » comme promesse, point rouge de notification sans compteur,
carte et vignettes photo. Seules les données chargées sont affichées : catégorie, adresse, état, dates enregistrées,
lignes/TVA/totaux calculés serveur, coordonnées réelles du participant, règlement confirmé par la plateforme,
compteurs de messages reçus. Les absences restent explicites (« Carte non disponible », « Aucune photo jointe »,
« Téléphone non communiqué »).

### M61 — accueil mobile (`#demo/client`, < 1024 px)

| Élément de la référence | Composant / section existant | Écart constaté (f58b3f4) | Correction prévue |
| --- | --- | --- | --- |
| Barre haute : logo + cloche avec point | `.mobileHeader` : marque compacte, `HeaderBell` (ancrage notifications), bouton Messages avec point si messages reçus | Conforme ; bouton marque 42 px de haut (cible < 44). | Cible 44 px. **Écart assumé** : point de cloche seulement avec un compteur réel (ancrage), jamais décoratif. |
| « Bonjour » + « Comment pouvons-nous vous aider ? » | `.hello` | Conforme (prénom réel). | — |
| CTA bleu « ⚡ J’ai besoin d’un électricien › » sur une ligne | `.ctaButton` | Libellé sur deux lignes à 360 (18 px). | Libellé 16 px sur une ligne à 360, tuile icône 40 px, chevron à droite ; hauteur ≥ 56 px. |
| « Actions rapides » + « Voir tout › » ; 4 tuiles (icône bleue, libellé 2 lignes) | `.sectionRow` + `.tiles` (4 catégories réelles) | Conforme ; libellés sur 2 lignes. | — |
| « Interventions récentes » + « Voir tout › » ; carte : tuile calendrier teintée, titre, adresse, **état en bleu à gauche et date à droite sur une ligne**, « ⋯ » | `.recentList` > `.recentRow` (icône catégorie, titre, adresse, `Badge` + date, chevron) | État et date se replient sur deux rangées (pastille haute, « Recherche d’un artisan » sur 2 lignes) ; date non alignée à droite. | Rangée état/date en `space-between`, état sur une ligne (pastille compacte `nowrap`, texte jamais couleur seule), date alignée à droite ; titre 1 ligne (ellipse), adresse 1 ligne (inchangé). **Écart assumé** : chevron au lieu de « ⋯ » (aucune action secondaire sur la ligne). |
| Onglets bas Accueil / Demandes / Messages (badge) / Profil | `.bottomNav` (4 entrées, badge Messages réel) | Conforme (icône 22 px, libellé 12 px). | Vérification 44 px seulement. |
| Hors référence : bandeau de démonstration | `.demoBanner` | — | Conservé (démo explicite). |
| Desktop (hors M61, composition tableau de bord existante) | `.desktopOnly` : accueil, bandeau de 3 compteurs réels, « Un devis attend votre décision », récentes, catégories, colonne d’aide | Liens texte « Comprendre les étapes » (26 px) et « Consulter l’aide » (25 px) sous 44 px (classes globales). | Classes du module ajoutées sur ces deux boutons pour une cible ≥ 44 px, sans toucher `globals.css`. |

### V8-C06 — devis (`#demo/client-quote.quote-demo-1`)

| Élément de la référence | Composant / section existant | Écart constaté | Correction prévue |
| --- | --- | --- | --- |
| « ← Devis #D1258 / Reçu le 20 mai 2024 à 10:30 » | `PageTitle` (retour au dossier, référence `quoteRef`, « Reçu le … ») | Conforme (titre à gauche). | — |
| Bouclier vert « Étudiez tranquillement le devis » | `.quoteNote` (icône bouclier, bleu) | Conforme en structure. | **Écart assumé** : bleu action (DESIGN.md : vert réservé aux réussites). |
| Carte « Devis accepté = tranquillité assurée » (artisan sélectionné avec soin, garantie 30 jours, paiement sécurisé) + illustration | aucune | Absente. | **Écart assumé** : non reproduite (promesses commerciales non établies, cf. AGENTS.md). |
| « Détail du devis » + lien « Télécharger le devis (PDF) » à droite | tableau sans en-tête de section ; bloc `Unavailable` « Télécharger le devis (PDF) » (CLI-07) en bas de page | L’ancrage documents de devis (lot ADV-DOCUMENTS-001, `QuoteDocumentsAnchor`) fournit désormais le PDF ; le bloc CLI-07 est contradictoire et le panneau documents s’intercale **entre le tableau et la décision**, repoussant Accepter/Refuser en bas d’une page de 3 000 px à 360. | En-tête de section « Détail du devis » avec lien texte « Télécharger le devis (PDF) » qui **fait défiler** jusqu’au panneau documents (aucun `location.hash`, aucune nouvelle requête) ; bloc CLI-07 retiré ; ordre de la référence rétabli : note → tableau → artisan → décision → panneau documents/avenants (ancrage inchangé, mêmes props) → récapitulatif texte. |
| Tableau Prestation / prix unitaire / Prix ; Sous-total HT, TVA (10 %), **TOTAL TTC** sur fond vert | `.quoteTable` (Prestation / Quantité × PU HT / Prix, pied avec TVA réelle et Total TTC bleu pâle) | « 1 × 60,00 € » replié sur 2 lignes à 360. | Colonne quantité × PU en `nowrap`, libellé seul repliable ; Total TTC mis en avant (bleu pâle, 18 px). **Écart assumé** : pas de fond vert. |
| Carte « Artisan recommandé » : photo, nom, spécialité, expérience, note, « Profil vérifié », « Contacter » | `.artisanRow` (initiales, nom réel, « Artisan électricien ayant établi ce devis », Contacter) | Conforme en structure. | Intitulé de carte « Artisan » ; **écart assumé** : aucune note, expérience, vérification ni photo (données absentes). |
| Bouton vert « ✓ Accepter le devis / Je suis satisfait… » puis cadre rouge « ✕ Refuser / Je ne souhaite pas… » | `.quoteActions` : « Accepter le devis » (primary) + « Refuser » (outline), formulaire de motif | Conforme en fonction ; placé après le panneau documents. | Remonté sous la carte artisan ; pleine largeur à 360, côte à côte dès 761 px. **Écart assumé** : bleu action / contour neutre (pas de vert/rouge pleins), pas de sous-titres promettant satisfaction. |
| Pied « 🔒 Paiement sécurisé • Annulation gratuite jusqu’à 48 h » | `form-note` sur le récapitulatif | — | **Écart assumé** : non reproduit (conditions non établies). |

### V8-C07 — détail d’intervention (`#demo/client-detail.demo-003`)

| Élément de la référence | Composant / section existant | Écart constaté | Correction prévue |
| --- | --- | --- | --- |
| « ‹ Détail de l’intervention ⇪ » | `PageTitle` + retour | Conforme ; pas de partage. | **Écart assumé** : pas d’action de partage (aucun lien public). |
| Carte statut : tuile icône, « Statut / En cours / Intervention n° », 4 étapes Demandée / En cours / À planifier / Terminée | `.statusCard` + `.stepper` (5 étapes Demandée / Artisan / Devis / Intervention / Terminée, numéros/coches) | Conforme ; libellés 11 px. | Libellés 12 px, cercles 30 px ; **écart assumé** : 5 étapes alignées sur les statuts réels (« À planifier » n’est pas un statut). |
| « Artisan assigné » + « Contacter » ; carte photo, nom, « plombier – Certifié ✓ », téléphone, ★ 4,9 (128 avis) | `.cardHead` + `.artisanRow` (initiales, nom, téléphone réel ou « non communiqué ») | Conforme. | **Écart assumé** : pas de spécialité, certification, note ni photo. |
| « Adresse de l’intervention » + carte miniature | `.addressCard` : adresse + `Unavailable` « Carte non disponible » | Bloc indisponible volumineux. | `Unavailable` rendu compact (icône + titre + raison sur une ligne à 1280, 2 à 360) via une classe du module ; adresse en premier. **Écart assumé** : pas de carte (aucun fournisseur). |
| « Description du problème » + pastille « Catégorie : Plomberie » | `.card` + `.tagRow` (catégorie réelle, urgence, estimation indicative) | Conforme. | — |
| « Photos du problème (3) » vignettes défilantes | liste de noms de fichiers + lien « Gérer les pièces » | Pas de vignettes. | **Écart assumé** : documents privés servis à la demande ; liste conservée, compte réel dans le titre. |
| « Devis & résumé » : lignes, **Total TTC** bleu, « ⓘ Devis accepté le … », « Voir le devis » | `.lines` + `.totals` + `.quoteFoot` | Conforme. | Lignes avec libellé repliable et montant `nowrap` à 360. |
| « Historique & avancement » : chronologie icônes, états Terminé / En cours / À venir à droite | `.history` | Conforme. | — |
| Pied : « Annuler l’intervention ⊗ » (contour) + « Modifier le rendez-vous » (bleu) | `.actionBar` : annulation (texte danger, confirmation) + action principale selon l’état ; rendez-vous modifiable dans sa carte | Conforme en fonction. | Annulation en bouton contour 44 px (confirmation inchangée). **Écart assumé** : modification du rendez-vous dans la carte Rendez-vous (formulaire existant), pas de bouton dupliqué. |
| Hors référence : Déplacement, Compte rendu, Règlement, Avis, Suivi après intervention, file de téléversement | sections existantes | — | Conservées (fonctions réelles). |

### Règles responsive

- **360** : une colonne ; barre haute collante, onglets bas fixes (≥ 60 px + zone sûre) ; CTA pleine largeur sur une
  ligne ; tuiles 4 colonnes (M61) ; lignes récentes titre / adresse / état + date ; tableau de devis avec libellé
  repliable et montants `nowrap` ; décision Accepter puis Refuser empilées pleine largeur ; stepper sur une rangée
  (5 cercles 30 px) ; aucun défilement horizontal.
- **760** : mêmes composants ; décision côte à côte ; `cardHead` avec action à droite ; tuiles 4 colonnes.
- **1280** : barre latérale 240 px, contenu ≤ 1180 px ; tableau de bord desktop existant (3 compteurs réels) ;
  onglets bas et en-tête mobile masqués (règles existantes) ; carte statut : texte à gauche, stepper à droite.

### Accessibilité ciblée

- Cibles ≥ 44 × 44 : marque mobile (42 → 44), liens texte du tableau de bord desktop (26/25 → 44), onglets bas,
  tuiles, lignes récentes, boutons de décision, « Télécharger le devis (PDF) » (lien texte 44), annulation (44).
  Mesure automatisée à 360 et 1280 sur les trois vues : objectif 0 élément interactif visible < 44 px (hors
  indicateur de développement Next).
- Focus visible : anneau global ; ordre de lecture : titre → statut → sections → actions.
- Contraste sur les tokens : blanc sur `#1457d9` 5,4:1 ; `#526178` sur blanc 6,3:1 ; état jamais porté par la
  couleur seule (pastilles textuelles).

### Vérification : par test ou par capture

| Par test (`tests/ui/client-lists.test.ts`, logique pure dans `client-lists.ts`) | Par capture (démo 360 / 1280, script Playwright hors dépôt) |
| --- | --- |
| Descripteur d’une ligne récente (libellé d’état, date, adresse sur une ligne) ; état de décision d’un devis (actif / remplacé / accepté / clos) à partir des versions réelles ; cellules d’une ligne de devis (quantité × PU, total HT de ligne) ; étape courante du stepper et chronologie du détail (dates enregistrées seulement, « — » sinon, « À venir » après l’étape courante) ; compte de photos. | Composition M61 / V8-C06 / V8-C07 ; ordre note → tableau → artisan → décision → documents ; 0 cible < 44 px ; aucun débordement horizontal ; console sans erreur ; libellés longs (adresse, prestation). |

### Checkpoints prévus

1. Accueil M61 + cibles desktop — captures `client-overview-{360,1280}-after.jpg`.
2. Devis V8-C06 — captures `client-quote-{360,1280}-after.jpg`.
3. Détail V8-C07 — captures `client-detail-{360,1280}-after.jpg`.

### Résultat du checkpoint 1 — accueil M61 (client)

Captures `docs/visual-fidelity/client-overview-{360,1280}-after.jpg`. Lignes récentes : état sur une ligne et date
alignée à droite sur la même rangée (la date passe sous l’état seulement quand le libellé d’état est trop long à
360 px, sans troncature) ; CTA sur une ligne à 360 (`clamp(14px, 4.3vw, 17px)`) ; marque mobile et liens texte du
tableau de bord desktop portés à 44 px via des classes du module (`globals.css` intouché). Logique pure
`components/role/client-lists.ts` (`recentRowDescriptor`, `quoteLineCells`, `quoteDecisionState`, `CLIENT_STEPS`,
`currentStepIndex`, `detailHistory`) couverte par `tests/ui/client-lists.test.ts`. Mesures automatisées à 360 et
1280 : 0 cible interactive visible < 44 px, aucun débordement horizontal, console vide. Desktop inchangé hors cibles.
