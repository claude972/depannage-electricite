# Correctifs issus de la recette complète

Périmètre : défauts D1, D3, D4 et D5 du rapport Web/PWA des rôles. Les contrôles serveur et les portes commerciales restent inchangés.

- D1 : une erreur de lecture ou d'enregistrement du rayon ouvre le panneau « Zone de recherche ». Le bouton de reprise n'est plus caché. Le callback ne relance aucune mutation.
- D3 : l'écran de refus utilise un titre principal h1.
- D4 : le rôle administrateur ne déclare plus l'accès au formulaire d'assistance client. Sa file d'assistance opérateur reste soumise à la capacité serveur existante.
- D5 : le choix obligatoire d'un site professionnel affiche aussi un message applicatif persistant, associé au champ par le composant Field. La validation native reste active.
- D2 : au retour réseau, les lectures en erreur du rayon, des offres et du tableau administrateur sont relancées. La revalidation bornée de l’espace reçoit aussi ce signal. Les commandes, préférences en attente et refus de permission ne sont jamais rejoués automatiquement. Les autres panneaux conservent leur reprise manuelle explicite.

Vérifications locales : TypeScript réussi ; suites session et rayon réussies ; deux tests Chromium exécutés sans saut (bornes/enregistrement/réinitialisation et erreur dans panneau replié/reprise GET sans mutation). Suite complète des interfaces avec navigateur réel en cours, distincte d'une recette des fournisseurs déployés.

La matrice intègre le rapport courant des quatre rôles. Les scénarios déclarés PASS avec une variante explicitement non rejouée restent PARTIEL dans la matrice consolidée.

## Navigation native et profil de recette

Le nouveau passage iOS a observé une barre basse visible mais inaccessible aux appuis après connexion. La capture `ios-screen-layout-failure-20261119.png` identifie finalement une alerte système « Enregistrer le mot de passe ? » au-dessus de l'application. Les essais de changement de conteneur/navigation ont été retirés : ils ne prouvaient pas la cause. Le pilote choisit désormais « Plus tard » et exige une cible visible avant appui. La recette complète des trois rôles reste à terminer. Le correctif RNHostView des fenêtres de profil est distinct et déjà vérifié.

Les profils EAS simulator/device désactivent désormais EXPO_PUBLIC_HOME_SUPPORT_PREVIEW : le délai d'exemple « 20 min » n'est pas une promesse validée. Les scripts de reconstruction locaux utilisent la même valeur false.

La suite Chromium a révélé deux attentes textuelles périmées du test d'observations financières, depuis l'ajout du rapprochement automatique Checkout. Elles sont actualisées sans supprimer les contrôles : un transfert observé n'est pas une preuve bancaire ; la revue ne crée aucun paiement/transfert/remboursement/facture ni rattachement forcé. Le test corrigé passe en clair/sombre à 360 px, avec une seule commande et un reçu exact.

## Bilan de la passe Chromium complète

`web-ui-complet-20261119.log` : 1 170 tests, 1 168 réussis, 2 échecs, aucun ignoré. Les échecs sont l'attente textuelle financière périmée et un timeout de lancement de Chrome dans le test des panneaux de profil. Le harnais borne désormais lancement/actions/navigation et ferme le serveur même si Chrome ne démarre pas. Le processus de test resté ouvert après ce timeout a été arrêté ; cet échec n'est pas supprimé du bilan.

Reprise ciblée des deux fichiers : `web-regressions-replay-20261119.log`, 4/4 réussis, aucun ignoré. Contrôle renforcé du site obligatoire (message visible, aria-invalid, association au champ, disparition après sélection) : `web-site-validation-20261119.log`, 1/1 réussi.

Reprise réseau : 8 tests ciblés passent (rayon monté, tableau administrateur et ordonnanceur), aucun ignoré. Le test simule deux signaux online et vérifie une seule relecture, aucun POST.
