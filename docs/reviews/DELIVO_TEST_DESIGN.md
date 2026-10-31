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
