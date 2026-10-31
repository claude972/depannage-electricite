# Revue UI-THEME-FOUNDATION — 743d608

SHA exact : 743d608e37001d03e8248347444fc44134e0c5b8, base58b76414f6233220f938dbc42681c089abe58316. Claim/contrat UI_THEME_FOUNDATION lu ; source/diff exacts seulement. Export isolé /private/tmp/depannage-theme-review-743d608-2GL281. Aucun cloud, credential, code auteur ou build applicatif lancé.

Verdict : aucun P1/P2 actionnable trouvé dans cette fondation opt-in. Feu borné pour assemblage/build et recette ROOT ; aucun écran n'est encore migré et aucun thème produit complet n'est déclaré livré.

## Vérifications

11 tests thème PASS, zéro échec/skip : résolution, stockage refusé, contrôleur système/choix explicite/cross-tab, script VM et hash constant, SSR des vrais composants, vrai React StrictMode dans Chromium local, bascule clavier/persistance, deux surfaces et restauration meta, stockage bloqué.

Le premier essai de l'export n'avait pas les dépendances résolubles pour le bundler esbuild (10PASS/1erreur de résolution React). Après lien dans le dossier temporaire vers node_modules existant, les11tests passent ; aucune installation ni modification source. Ce problème était propre à l'export, pas un défaut du checkpoint.

- Layout : police locale exposée comme variable, script constant dans head, data-ui-theme uniquement ; suppressHydrationWarning limité àhtml. Provider ne lit pas window au rendu ; premier rendu theme=null, placeholder non interactif/aria-hidden, puis bouton réel avec aria-pressed.
- CSS : ancien contenu et anciennes variables inchangés ; seule addition du namespace --ui-* et wrapper .ui-v2. color-scheme/font/couleurs appliqués au wrapper, sans rethémer les rôles legacy. Aucun consommateur ThemeSurface/ThemeToggle ajouté à une vue produit dans ce lot.
- Stockage : clé non sensible, valeurs light/dark seulement ; erreurs get/set absorbées. Choix explicite conservé pour la session même si setItem échoue ; système suivi sans choix explicite ; suppression de clé/clear d'un autre onglet rétablit le système.
- Meta : gestion acquise lors de la première surface après disponibilité du contrôleur ; release idempotent, dernier unmount restaure la couleur historique. Tests vrais StrictMode et deux surfaces verts.
- Toggle : bouton réel, dimensions minimales44px, label visible, focus par token, mouvement seulement sous prefers-reduced-motion:no-preference. Le test navigateur vérifie hauteur et action clavier ; il ne constitue pas un audit complet des contrastes des futures vues.
- Fontes : SHA256 des4assets identiques aux fichiers du prototype6bc0cab et à PROVENANCE. Lecture directe du binaire TTF avec Python standard : poids400/500/600/700 corrects ; copyright projet Plus Jakarta Sans, version2.071/gftools0.9.30, URL licence OFL conformes à la notice. Texte OFL1.1 conservé dans app/fonts/OFL.txt. Chargement configuré via next/font/local ; aucun hébergeur de fonte externe dans le code ajouté. Ce contrôle décrit les fichiers/provenances, pas un avis juridique général.

## Limites à préserver

Le test SSR fait renderToString ; le test Chromium monte createRoot, PAS hydrateRoot sur un HTML Next rendu. Aucun next build ni preview de ce SHA exécuté ici : transformation next/font, absence de flash dans Next et vraie hydratation restent à vérifier lors du build/preview ROOT. Le test navigateur embarque les composants, pas l'intégralité globals/layout ou les écrans produit ; il ne prouve ni tous les contrastes, ni l'absence de régression visuelle dans tous les rôles. Prévoir ces contrôles lors du premier consommateur accueil.

Aucun changement API/SQL/session/controller/tracking/permissions, ni adoption concurrente ou modification prototype dans ce diff. Le plan d'adoption suivant reste distinct.
