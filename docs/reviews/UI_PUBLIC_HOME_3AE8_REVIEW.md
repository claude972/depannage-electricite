# Revue UI-PUBLIC-HOME — 3ae8c2d

SHA exact : 3ae8c2da5a700cb5205649b5e102f1793873b11b. Tête distante claude/ui-public-home identique vérifiée par ls-remote lors de la prise en charge. Claim/contrat antérieurs au code. Export figé /private/tmp/depannage-public-home-review-3ae8c2d-ukDELA ; aucun WIP, cloud, credential ou code auteur modifié.

Verdict : aucun P1/P2 actionnable trouvé dans ce checkpoint ; feu borné pour build/preview et recette ROOT de l'accueil. Cela ne vaut pas migration des autres écrans ni acceptation visuelle globale.

## Ancres : collision absente de ce SHA

public-home.tsx utilise déjà des boutons data-home-anchor avec identifiants accueil-interventions/services/conseils, scrollIntoView et focus du titre ; aucun href de section n'écrit le hash applicatif. Le souci décrit par ROOT n'est donc pas présent dans cette source figée.

Reproduction avec les VRAIS PublicHome/ThemeProvider, CSS globals + modules et images de l'export, dans Chromium local : aux largeurs360 et1280, clic Services => hash reste#home, événementhashchange0, focus sur le titre Dépannage électrique : nos services. Aucun débordement horizontal dans ces deux contrôles. ToucheEnd sélectionne le dernier onglet ; après passage à la diapositive suivante, une seule diapositive reste visible.

## Tests et source

22 tests ciblés PASS, zéro échec/skip : public-home et thème. Comprennent SSR sanswindow, mapping des contrôles rendus aux callbacks, branchePublicSite home seulement, autres vues publiques gardant leur coque, catégorie préremplie et sauvegarde du brouillon versauth via la vraie surface PublicSession (RequestForm stubbed dans ce test), thème SSR/StrictMode/stockage refusé.

- PublicSite ne monte PublicHome que pour home ; formulaires/auth/help/pricing/join/about/privacy/legal restent dans la coque existante. Les alertes restent conservées. Aucun changement CourantApp/API/session/droits.
- CTA passent par les callbacks réels : demande/new et catégorie métier, login/auth, conseils/help, recrutement/join, démonstration existante ; aucune route de maquette fictive. Catégories canoniques et textes estimation/devis séparés conservés.
- Carrousel manuel sans minuterie, seconde diapositive masquée, commandes nommées44/48px, images d'illustration identifiées. Onglets ARIA reliés aux panneaux, rovingtabindex, flèches/Home/End. MenuEscape restaure le bouton ; sections reçoivent le focus. Réduction du mouvement coupe l'animation et le scroll fluide.
- Wrapper ThemeSurface/ThemeToggle uniquement pour accueil ; sortie vers vue publique legacy retire la surface selon le montage normal. Le contrat de restaurationmeta est couvert par les tests thème ; aucun changement de logique de thème dans ce diff.
- CSS : texte du héros sur surface noire forte ; couleurs explicites pour conseils jaunes et recrutement vert ; focus local adapté au héros/conseils/recrutement ; pas de bleu legacy pour les titres du nouveau composant. Les contrastes réels de chaque état doivent encore être mesurés sur le build/preview final, pas déduits du seul commentaireCSS.
- Les cinq blobs photo sont strictement identiques au prototype6bc0cab (git blob complet comparé), crédités dans public/home/CREDITS.md, copies locales. Aucune photo électroménager exclue réintroduite, aucune qualification/avis/chiffre inventé identifié.

## Limites

Le repro local bundle les vrais composants, pas le layout Next complet ; la police next/font et l'hydratation réelle Next, les captures clair/sombre à toutes les largeurs, l'intégralité des actions/formulaires en navigateur et la fidélité détaillée à la référence restent pour la preview ROOT. Aucun test local n'est présenté comme cette recette en ligne. Le second slide masque le premierh1 : à considérer au contrôle de structure de page, sans défaut bloquant démontré dans cette revue. Aucune réussite annoncée pour les autres rôles.
