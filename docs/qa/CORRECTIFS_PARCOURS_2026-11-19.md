# Correctifs issus de la recette complète

Périmètre : défauts D1, D3, D4 et D5 du rapport Web/PWA des rôles. Les contrôles serveur et les portes commerciales restent inchangés.

- D1 : une erreur de lecture ou d'enregistrement du rayon ouvre le panneau « Zone de recherche ». Le bouton de reprise n'est plus caché. Le callback ne relance aucune mutation.
- D3 : l'écran de refus utilise un titre principal h1.
- D4 : le rôle administrateur ne déclare plus l'accès au formulaire d'assistance client. Sa file d'assistance opérateur reste soumise à la capacité serveur existante.
- D5 : le choix obligatoire d'un site professionnel affiche aussi un message applicatif persistant, associé au champ par le composant Field. La validation native reste active.
- D2 : la reprise manuelle après retour réseau est fonctionnelle. Le rafraîchissement automatique de tous les blocs n'est pas encore implémenté ; aucune commande en échec n'est rejouée implicitement.

Vérifications locales : TypeScript réussi ; suites session et rayon réussies ; deux tests Chromium exécutés sans saut (bornes/enregistrement/réinitialisation et erreur dans panneau replié/reprise GET sans mutation). Suite complète des interfaces avec navigateur réel en cours, distincte d'une recette des fournisseurs déployés.

La matrice intègre le rapport courant des quatre rôles. Les scénarios déclarés PASS avec une variante explicitement non rejouée restent PARTIEL dans la matrice consolidée.
