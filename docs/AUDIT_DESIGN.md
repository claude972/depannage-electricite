# Audit design et UX — 10 novembre 2026

Périmètre : interface livrée sur `46aac2a`, exécutée en local (`next dev`), mode démonstration, captures 1440 × 900 et 390 × 844. Les quatre espaces (particulier, artisan, professionnel, administration) et la page publique ont été parcourus. Ne sont pas couverts : parcours connecté réel (Supabase indisponible), paiement Stripe, lecteur d'écran, mesure de contraste exhaustive.

Les chiffres ci-dessous sont mesurés sur le code ou le DOM rendu ; les jugements esthétiques sont signalés comme tels.

## Synthèse

L'interface est propre, cohérente et honnête (données de démonstration identifiées, estimation distinguée du devis). Ses faiblesses sont de trois ordres :

1. **Les rôles ne sont pas différenciés.** Artisan, professionnel et administrateur voient la vue d'ensemble du particulier.
2. **La densité typographique contredit DESIGN.md.** La majorité des textes est sous 14 px, et plusieurs cibles tactiles sous 44 px.
3. **L'identité est générique.** Aucune décision visuelle ne dit « électricité », « urgence » ou « artisan » ; c'est ce qui donne l'impression d'un gabarit produit automatiquement.

## Constats

### P0 — erreurs de contenu par rôle
| Constat | Preuve | Correction |
| --- | --- | --- |
| Vue d'ensemble artisan identique à celle du client : « Un devis attend votre attention », « Consulter le devis », « Un nouveau problème électrique ? », « Vos documents » | Capture artisan/overview | Vue dédiée : missions disponibles, mission en cours, devis à rédiger, paiements en attente |
| « Mes missions » (artisan) affiche le bouton principal « Nouvelle demande » et le sous-titre client | Capture artisan/missions | Action principale : « Voir les missions disponibles » ; aucun dépôt de demande côté artisan |
| Administration : même vue client, « Bonjour Camille », « Nouvelle demande » | Capture admin/overview | Vue dédiée : candidatures artisans à traiter, litiges/garanties, dossiers bloqués |
| Professionnel : seule différence, une tuile « Sites suivis » ; aucun site actif visible, ni budget, ni approbation | Capture manager/overview | Sélecteur de site persistant, budget consommé, approbations en attente (prévu par DESIGN.md) |

### P1 — lisibilité et accessibilité
| Constat | Preuve | Correction |
| --- | --- | --- |
| Texte courant à 15 px, alors que DESIGN.md fixe ~16 px | `app/globals.css` (`body`) | Base 16 px |
| 35 nœuds de texte sur 54 sous 14 px sur la vue d'ensemble desktop (32/50 sur mobile) ; 6 sous 12 px | Mesure DOM | Plancher 14 px pour le secondaire, 12 px réservé aux métadonnées non essentielles |
| 268 déclarations `font-size` ≤ 12 px dans la feuille, dont 47 à 8–9 px | `app/globals.css` | Échelle typographique fermée (voir direction) |
| 7 éléments interactifs visibles sous 44 px de haut sur desktop, 9 sur mobile (règle projet : 44 × 44) | Mesure DOM | Hauteur minimale 44 px sur boutons, liens d'action, sélecteur |
| Mobile : « Le devis vous donnele dernier mot. » — espace perdu quand le saut de ligne est masqué | Capture mobile/overview | Remplacer le `<br>` par un espace + `text-wrap: balance` |
| Mobile : le fil d'Ariane est tronqué à « Mon espace > » ; le nom de la page courante disparaît | Capture mobile/overview | Afficher le titre de page courant dans la barre |
| Listes : filet horizontal orphelin au-dessus du premier élément | Captures « Mes demandes », « Mes missions » | Supprimer la bordure du premier élément |
| Page publique mobile : grille 2 colonnes laissant une cellule vide (5 catégories) | Capture mobile/home | Liste une colonne ou 6e entrée « Autre problème » |

### P1 — parcours
- **Page publique** : aucune réponse aux trois questions d'un particulier en panne — *où intervenez-vous, en combien de temps, à quel coût*. C'est cohérent avec l'interdiction d'inventer des délais et tarifs, mais la zone et les conditions réelles doivent être décidées (elles sont listées « à renseigner » dans PROGRESS.md) : sans elles la page ne peut pas convertir.
- **Cas dangereux absent** : odeur de brûlé, étincelles, eau sur l'installation. Un service de dépannage électrique doit orienter immédiatement (couper le disjoncteur général, appeler le 18/112) avant tout formulaire. Le libellé exact est à valider métier.
- **Deux actions concurrentes** dans le héros (« Demander une intervention », « Explorer la démonstration ») : la démonstration est un outil de projet, pas un parcours client ; à retirer du héros en production.
- **Tuiles de compteurs** (« 02 », « 01 », « 01 ») : elles occupent la meilleure zone de l'écran pour une information que la liste donne déjà. Pour un particulier ayant 1 à 3 dossiers, l'élément utile est *l'étape suivante du dossier en cours*.

### P2 — système de design
- **Tokens non tenus** : 12 variables déclarées, mais 134 couleurs hexadécimales distinctes, 28 tailles de police et 13 valeurs de rayon dans `app/globals.css`.
- **Police non maîtrisée** : pile `"Avenir Next", Avenir, "Segoe UI", sans-serif`, sans police web. Le rendu change selon le système (Avenir sur macOS, Segoe sur Windows, police par défaut ailleurs) ; les maquettes ne peuvent pas être fidèles tant que la famille n'est pas fixée et servie.
- **Maintenabilité** : un composant de 5 274 lignes (`components/courant-app.tsx`) et une feuille globale de 4 424 lignes. Toute refonte visuelle écran par écran sera coûteuse sans découpage préalable par espace et par composant.
- **Navigation par état local** (`view`) : pas d'URL par écran, donc pas de lien partageable vers un dossier, ni de bouton « retour » fiable. À confirmer par un test dédié avant de le classer en défaut.

## Pourquoi l'interface « fait générée »

Jugement de design, étayé par des marqueurs observables :
- bleu saturé unique + bleu nuit + gris pâle, sans couleur propre au métier ;
- cartes blanches arrondies à bordure fine partout, y compris là où un simple filet suffirait ;
- pastille d'icône colorée devant chaque titre ;
- tuiles de chiffres clés en tête de tableau de bord ;
- point coloré décoratif après les titres (« Bonjour Camille**.** ») ;
- titres en deux phrases symétriques (« Une panne électrique. Un parcours clair. ») ;
- aucune photographie, aucun élément du vocabulaire réel du métier (tableau, différentiel, calibre, schéma).

## Direction proposée pour les maquettes

À valider avant production des écrans ; les valeurs sont des propositions.

- **Parti pris** : outil d'intervention, pas tableau de bord SaaS. Référence visuelle : le document technique d'électricien (schéma unifilaire, étiquette de tableau, bon d'intervention) — filets, numérotation, alignements stricts, peu de cartes.
- **Couleur** : fond papier chaud `#F6F4EF`, encre `#14171A`, une seule couleur d'action — jaune sécurité `#FFC400` avec texte encre (contraste à vérifier sur chaque usage) — et le rouge `#B42318` réservé au danger réel. Vert et orange conservés pour les statuts, toujours doublés d'un libellé.
- **Typographie** : une grotesque à caractère pour les titres et une famille texte très lisible ; chiffres tabulaires pour montants et références. Familles à arrêter parmi des polices libres servies par l'application. Échelle fermée : 12 / 14 / 16 / 20 / 28 / 40 / 64.
- **Formes** : rayon 4 px, filets 1 px encre à 12 %, aucune ombre hors éléments flottants. Icônes au trait sans pastille.
- **Structure** : mobile d'abord pour client et artisan (une action par écran, barre d'action fixe en bas) ; desktop dense pour professionnel et administration (tableau, filtres, site actif).
- **Contenu** : montants toujours qualifiés (« estimation », « devis », « payé ») ; aucune photo, avis, délai ou certification fictifs présentés comme réels.

### Écrans à maquetter (ordre de priorité)
1. Page publique — desktop et mobile, avec bloc « danger immédiat ».
2. Demande client — 4 étapes mobile : problème, adresse, description/photos, estimation.
3. Suivi de dossier client — frise d'états, devis à accepter, paiement.
4. Artisan — missions disponibles, détail de mission, éditeur de devis (mobile).
5. Professionnel — vue multi-sites avec budget et approbations (desktop).
6. Administration — file des candidatures artisans (desktop).
7. Planche de fondations — couleurs, typographie, composants et états.

## État de la livraison Figma

Les maquettes Figma n'ont pas été produites dans cette session : le connecteur Figma n'a pas pu se connecter au démarrage (hôte `mcp.figma.com` refusé par la politique réseau). L'environnement `depannage-electricite` créé depuis autorise désormais cet hôte ; les connecteurs n'étant chargés qu'au lancement, la production des maquettes demande une nouvelle session sur cet environnement.
