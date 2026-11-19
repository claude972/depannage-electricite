# Recette responsive Web — 19 novembre 2026

Les défauts responsive reproduits sont corrigés dans la version de recette. Aucun débordement de page ni contrôle hors écran n’a été relevé dans les 858 mesures finales ; aucune erreur JavaScript n’a été enregistrée. Les tableaux larges restent consultables par défilement local, sans réduire le texte ni masquer leurs colonnes.

## Version vérifiée

- Recette : https://domdepannage-recette-20261112.vercel.app
- Déploiement immuable : https://domdepannage-recette-20261112-8yncy91pv-brafas-projects.vercel.app
- Déploiement Vercel READY : `dpl_XBAvbniLcY38To3W4XGjd6JZn3c8`.
- Source GitHub : `4ec961ca2678b3dd94795b18bc4cf8efaacbc91f`, clone Codex `c93ff77a`, arbre `525e323cf52bd5806d540d4cf2f4b93e4980612c`.
- L’alias de recette a été déplacé depuis `nn2dylxph` puis son identité a été relue via Vercel. Aucun déploiement commercial ni changement du schéma de données.

## Corrections

| Zone | Défaut corrigé |
|---|---|
| Notifications client, artisan, entreprise | Filtres et bouton de rechargement hors écran à 320 px ; grille rétrécissable et filtres sur plusieurs lignes. |
| Devis client | Sélecteur de version trop large à 320 px. |
| Devis et avenants | Tableau déplié débordant de 21 px à 320 px ; région défilable nommée, focus visible et accès clavier. |
| Entreprise — rapports | Colonnes rognées à 1 024 px et moins ; défilement local accessible au clavier. |
| Entreprise — dossier | Nom de site long élargissant la page à 390 px et moins. |
| Administration | Grille de fiche artisan, valeurs longues des paramètres et du journal d’audit sur petits écrans. |
| Finance — observations | Sélecteur imposant la largeur minimale de la grille à 320/390 px. |
| Finance — remboursements et formulaires | Filtres pouvant dépasser leur conteneur à 320 px. |
| Avis client après paiement | Cinquième note hors écran à 320 px, reproduite sur le dossier payé de recette ; retour à la ligne sans réduire les cibles tactiles. |

## Vérifications finales en ligne

Les sessions utilisent quatre comptes synthétiques distincts, dont le rôle est vérifié par `/api/workspace`. Les pages publiques utilisent une session anonyme. Les mesures attendent les requêtes utiles, la disparition des chargeurs et la stabilisation des transitions ; Plus Jakarta Sans est chargée pour toutes les mesures finales. Un menu animé mesuré pendant sa transition n’est pas classé comme défaut persistant.

- **81 vues × 8 largeurs = 648 mesures** : public, huit prestations, client, artisan, entreprise et administration ; 320, 360, 390, 640, 768, 1 024, 1 280 et 1 440 px.
- **27 états interactifs × 7 formats = 189 mesures** : menus des quatre rôles, paramètres client, sélection d’une note sans envoi, documents et assistance, candidature/planning/profil artisan, sites actifs/archivés, contrats/membres/rapports, neuf onglets financiers, paramètres et garantie d’administration.
- **3 étapes de demande × 7 formats = 21 mesures** : description et erreur de photo invalide, adresse avec carte, récapitulatif sans envoi.
- Formats interactifs : 320×740, 390×844, 640×800, 768×1024, 1024×768, 1440×900 et paysage 844×390.
- **Résultat : 858 mesures, zéro défaut mesuré, zéro erreur JavaScript.** Le manifeste JSON voisin conserve les résultats sans identifiants de dossiers ni secrets.
- Après bascule de l’alias habituel : **28 contrôles supplémentaires réussis** sur le dossier client payé, les rapports entreprise, les remboursements et les observations fournisseur.

Les cinq POST de la passe générale sont des recherches/lectures (`interventions/search`, `overview`, `overview/professional`). Aucun paiement, remboursement, changement de droits ou nouvelle intervention n’a été déclenché. Le rapprochement de paiement déjà terminé reste inchangé.

## Tests et portée

- Suite UI locale Chromium : **1 178 réussites, zéro échec, zéro test ignoré** sur l’ensemble intégré, puis **7 tests ciblés réussis** après les derniers ajouts (menus, avis, clavier rapports, observations à 320 px et remboursements).
- TypeScript final réussi ; build Vercel READY. Le job GitHub `check` du run 246 (`44577843046`) a réussi : tests et builds applicatifs. Le job SQL isolé distinct était encore en cours au dernier relevé ; il n’est pas annoncé réussi.
- La suite générale antérieure (avant ce lot responsive) comptait 2 427 réussites et deux contrôles ignorés faute de captures privées historiques ; elle ne remplace pas les vérifications du lot présent.
- Inspection visuelle complémentaire de l’accueil dans Safari sur le simulateur iPhone dédié. Ce contrôle n’est pas une recette exhaustive WebKit.
- Le redémarrage de l’émulateur Android a rencontré un blocage QEMU avant exposition ADB ; pas de validation Chrome Android native annoncée pour ce lot. Les formats mobiles sont couverts par Chromium et les contrôles ci-dessus.

Cette recette couvre les vues et états décrits, y compris les états vides ou indisponibles renvoyés par la configuration de recette. Elle ne certifie pas tous les navigateurs, toutes les valeurs possibles ou les fonctionnalités dont la configuration commerciale reste manquante. Une largeur de 640 px est un contrôle de reflow, pas une preuve de zoom navigateur réel à 200 %.

## Preuves conservées hors Git

Dans `../preuves/` du clone Codex : `responsive-verified.json/.log`, `responsive-interactions-verified.json/.log`, `responsive-public-flow.json/.log`, `responsive-ui-suite-20261119.log`, `responsive-navigation.log`, `responsive-finance-tests.log`, captures des panneaux ouverts et `responsive-safari-ios-20261119.png`. Les cookies et sessions restent dans le dossier privé et ne sont pas publiés.
