# DESIGN-DELIVO-TEST-001 — plan court (maquette test isolée)

- Base `4c398e8`, branche `claude/design-delivo-test`. Fichiers : `prototypes/delivo-test/index.html`, `styles.css`,
  `assets/fonts/plus-jakarta-sans-{400,500,600,700}.ttf` (copiés du ZIP), `assets/electricite.jpg` (copie de l’image projet
  `public/images/public-hero-m41.jpg`), `captures/home-{360,390,1280}.jpg`. Rien d’autre (pas d’app/composants/globals).
- Repris du modèle Delivo (capture racine 390) : en-tête orange #FD6931 arrondi en bas (avatar, lieu, cloche), titre blanc,
  barre de recherche noire arrondie ; fond noir #000 ; rangée de catégories en pastilles (active orange, autres brun
  #4A1A08) ; section « … » + « Tout voir » ; cartes sombres #1A1A1A arrondies avec image, bouton orange pleine largeur ;
  bandeau orange ; barre de navigation basse noire (Accueil actif orange). Police Plus Jakarta Sans.
- Électricité au lieu de la restauration : catégories Panne de courant / Prise ou interrupteur / Tableau électrique /
  Éclairage ; cartes « besoins fréquents » sans prix, délai, note, avis ni nom d’entreprise ; bouton « Demander un
  dépannage » et catégories → dialogue local (test, Échap, focus). Mention « Maquette test » visible.
- Police : le ZIP ne contient pas de fichier de licence ; Plus Jakarta Sans est publiée sous SIL OFL 1.1 par son auteur
  (Tokotype) — à confirmer par le propriétaire avant toute adoption ; usage limité à ce prototype.
- Vérif : 360/390/1280 sans débordement, cibles ≥ 44 px, focus visible, texte ≥ 14–16 px.

## DESIGN-DELIVO-TEST-002 — trois écrans de plus (plan court)

- Fichiers ajoutés : `prototypes/delivo-test/demande.html`, `suivi.html`, `devis.html`, `galerie.html` (liens vers les 4
  écrans), mêmes `styles.css` + quelques règles par écran, `assets/` existants (police du modèle, image électricité), un
  petit `dialog.js` local partagé (dialogue de test, Échap, retour du focus). Aucune requête externe.
- **Demande** : en-tête orange arrondi « Demander un dépannage », pastilles de catégorie (choix local), urgence
  (Urgente / À planifier), description (textarea avec compteur), zone photo factice (« Ajout de photos — désactivé dans la
  démonstration »), bouton orange « Envoyer la demande » → dialogue local, rien n’est envoyé. Étiquette « Démonstration ».
- **Suivi artisan** : carte SCHÉMATIQUE en SVG (blocs et tracé stylisés, libellée « Illustration — pas une position
  réelle »), étapes texte Demande / Artisan affecté / En route / Sur place / Terminé (état d’exemple), carte « Votre
  artisan » sans nom ni note (« Artisan attribué »), aucune heure d’arrivée, distance ni position.
- **Devis** : « Devis de démonstration », lignes Déplacement / Main-d’œuvre / Pièces avec « Montant à venir », totaux
  « — », encadré distinguant **accepter le devis** (accord sur les prestations) et **régler** (paiement après
  intervention, non disponible ici) ; bouton « Accepter le devis » → dialogue local ; aucun paiement, société ou SIRET.
- Navigation basse identique (Accueil / Mes demandes / Messages / Profil) ; liens entre écrans dans la galerie et
  l’en-tête (retour). Vérif 390×844, 360, 1280 : pas de débordement, cibles ≥ 44 px, console propre.

## DESIGN-DELIVO-TEST-003 — vert à la place de l’orange, bannière publicitaire (plan compact, base c246067)

- Fichiers : `prototypes/delivo-test/{styles.css,index.html,demande.html,suivi.html,devis.html,galerie.html}` uniquement.
- Palette (contrastes WCAG mesurés) :
  - primaire `#18794E` (fonds d’en-tête, boutons, pastilles actives) — texte blanc **5,41:1** ; comme élément d’interface
    sur noir **3,88:1** (≥ 3:1) ;
  - accent clair `#5BD49A` (texte/icônes actifs sur fonds sombres : navigation basse active, montants, notes) — sur noir
    **11,33:1**, sur carte `#1A1A1A` **9,39:1**, sur vert sombre **6,77:1** ;
  - vert sombre `#0E3B26` (pastilles, fonds teintés, ex-brun) avec bordure `#1F5C3D` — texte blanc **12,56:1** ;
  - inchangés : noir `#000`, carte `#1A1A1A`, texte atténué `#B5B5B5` (8,49:1 sur carte), rouge d’état `#FF3B30`.
  - Le vert primaire n’est jamais utilisé comme couleur de texte courant sur fond sombre (3,88:1 < 4,5:1).
- Accueil : en haut, emplacement **statique** « Publicité » au format fixe 16:9, mention « Votre publicité ici », prêt
  pour une image future (`<img>` en `object-fit: cover` avec texte alternatif, aucune image fournie) ; clic → dialogue
  local de démonstration ; aucun annonceur, visuel, prix, promotion, URL, suivi ni carrousel. Adresse, recherche et bouton
  « Demander un dépannage » restent visibles sous l’emplacement.
- Demande, Suivi, Devis, Galerie : en-têtes verts, navigation normale, aucune publicité.
- Vérification : 390/360/1280 sans débordement, cibles ≥ 44 px, focus, Échap, aucune requête externe, console propre.

## DESIGN-DELIVO-WEB-TEST-004 — accueil WEB bureau (plan compact, base 30a70a9)

- Fichiers : `prototypes/delivo-test/web.html`, `web.css` (+ lien depuis `galerie.html`). Réutilise `assets/fonts` (Plus Jakarta
  Sans) et `assets/electricite.jpg` (image héros M41), `dialog.js` (dialogue local, Échap). Écrans mobiles inchangés.
- Mise en page bureau pensée pour 1440×1000 (conteneur 1200 px), adaptée 1280 et 390 (une colonne) — pas l’écran mobile
  agrandi : barre de navigation horizontale (mot-symbole « courant » + « Dépannage électrique », liens Services /
  Comment ça marche / Espace pro → dialogue, « Mes demandes » → `suivi.html`, bouton « Décrire ma panne » → `demande.html`),
  bandeau large « PUBLICITÉ » / « Votre publicité ici » (statique, neutre), héros deux colonnes (titre, texte, champ
  adresse + « Décrire ma panne », image M41), 4 services (cartes → dialogue), parcours en 3 étapes (estimation indicative →
  devis avant toute intervention → paiement, étape distincte ; aucun délai), bandeau final, pied de page sobre.
- Thème : noir, `#18794E` (fonds/boutons, texte blanc 5,41:1), `#5BD49A` (texte/actifs sur sombre ≥ 6,77:1), cartes
  `#141414`/`#1A1A1A`, texte atténué `#B5B5B5` ; `#18794E` jamais en texte courant sur fond sombre.
- Aucun avis, prix, délai, certification, statistique, nom de société ; aucune requête externe.
- Vérif : 1440/1280/390 sans débordement, cibles ≥ 44 px, focus visible, Échap, console propre.
