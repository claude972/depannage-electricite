# Direction UI/UX retenue — 31 octobre 2026

Décision du propriétaire : la maquette construite constitue désormais la nouvelle direction UI/UX. Référence concrète : `6bc0cab3a9eabcc52ac62802b5ddfb953a5cb78e`, `prototypes/delivo-test/web-network.html` ; [preview publique](https://depannage-electricite-mgyxn7dsb-brafas-projects.vercel.app/web-network.html).

## Éléments retenus

- Identité verte, Plus Jakarta Sans, composants et arrondis de la variante Delivo adaptée.
- Modes clair et sombre, initialisés depuis le système, avec choix utilisateur mémorisé.
- Accueil web à grand diaporama photographique manuel, pleine largeur et premier écran complet, sans publicité.
- Interventions en cartes avec photos ; catalogue de services par onglets.
- Bloc « Conseils et formation » jaune, texte sombre ; composition article vedette et liste de vignettes.
- Bannière verte « Nous rejoindre » pour les professionnels.
- Références de disposition : captures du propriétaire et page Électricité https://www.mesdepanneurs.fr/electricite ; conserver notre identité et nos contenus.

Les textes restent provisoires, les photos illustratives, et les actions de recrutement/blog sont des démonstrations dans ce prototype. La validation graphique ne transforme pas ces actions en fonctions applicatives livrées. Le nom final, le logo et les contenus définitifs restent ceux à décider dans le projet.

## Adoption progressive

1. Figer cette référence et centraliser ses tokens et composants dans les conventions existantes de l’application, sans multiplier les variantes de thème.
2. Adapter l’accueil applicatif et le parcours client : demande, récapitulatif/estimation, suivi, devis, documents et paiement. Connecter chaque action à son parcours réel ou à un état d’indisponibilité explicite.
3. Décliner les mêmes codes sur l’espace artisan puis entreprise et SuperAdmin, en gardant leurs structures métier, tableaux, périmètres et permissions propres. Les PDF et l’audit des 76 capacités restent les références fonctionnelles.
4. Vérifier chaque tranche sur preview, dans les deux thèmes et aux formats mobile/desktop : nominal, chargement, vide, erreurs/reprise, formulaires, clavier/focus, contrastes et accès selon rôle. Réutiliser les recettes pertinentes en les bornant au SHA réellement testé.

La maquette approuvée couvre une partie des écrans ; les autres espaces ne sont pas déclarés visuellement finalisés par cette décision. Aucune migration graphique de l’application n’est annoncée comme effectuée à ce stade. Conserver les previews historiques et les travaux en cours ; ne pas appliquer les mises en page publiques telles quelles aux back-offices.
