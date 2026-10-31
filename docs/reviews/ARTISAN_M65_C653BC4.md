# Revue M65 candidature c653bc4

SHA exact c653bc492c2795b3f628ea42cb6d4070054eb74f. Diff5637519..c653bc4 lu par commits, checkout design propre ; source, CSS, helper/tests et addendum au même SHA. Aucun WIP futur validé, aucun build/cloud/credential/source/test modifié.

Verdict : aucun nouveau P1/P2 concret établi dans ce changement M65 ; intégration visuelle bornée possible. ART-CREDENTIAL-001 reste ouvert, séparément : ce commit ne change pas la dérivation existante du tag de pièce Validé à partir d’une approbation globale. Aucune clôture de ce finding n’est donnée ici.

Sources visuelles : vraie M65 volume4/page18 (v4-p18.jpeg) et captures artisan-application-{360,1280}-after.jpg consultées. Deux colonnes 1/2/4 à gauche et3/5/soumission à droite reprennent la composition ; mobile garde cet ordre DOM explicitement déclaré dans contrat. Aucun champ optionnel non modélisé, assurance, certification ou taux de profil inventé.

applicationSteps extrait la logique existante : nom personnel connu, champs société, pièces transmises, zones+catégories et profil de disponibilité. Résumé dit sections renseignées, pas candidature approuvée ; des pièces expirées restent transmises et cela ne valide pas leur qualité. SaveBody, contrôles missing/touched, transitions saveDraft→submitApplication, confirmation d’édition approved, canSubmit et disponibilité inchangés. État serveur de candidature reste l’autorité.

Accessibilité source : étiquettes/contrôles de formulaire conservés ; les stepLabels deviennent visuellement masqués sous760 mais restent disponibles au lecteur d’écran ; pastilles décoratives aria-hidden. Ce stepper n’est pas une navigation interactive. Puces et boutons Retirer44×44 ; labels checkbox natifs cliquables étendus à44px ; focus global conservé. Pas de nouvelle mesure DOM/clavier indépendante.

Vérification exécutée : tests/ui/artisan-lists.test.ts,12 PASS/0 échec ; complet/incomplet/SIRET13chiffres et résumé sans faux succès couverts. Tests identiques au checkpoint. Captures montrent le dossier demo approuvé mais incomplet avec verrous et soumission indisponible : ce n’est pas une preuve des transitions connectées ni des pièces examinées individuellement.

Limites : aucun dépôt, modification de compte, envoi candidature ou changement réel de disponibilité exécuté ; pas de recette des refus serveur, zoom, clavier ou taille760. PWA réel terminé par le pilote, pas rejoué par ce reviewer. Aucune acceptation globale du parcours artisan tant que le finding distinct sur les pièces reste ouvert.
