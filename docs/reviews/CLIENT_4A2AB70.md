# Revue client devis/détail 4a2ab70

SHA exact : 4a2ab70c86095b2b2563d94a7de34a93a5abbec8. Checkout documents propre à la lecture. Commits 8e43dd0 puis4a2ab70 examinés depuis bf37549 ; source/CSS/helpers/tests et contrat au même SHA. Aucun build/cloud/credential ni source/test modifié.

## P2 reconduit — règlement confirmé présenté « En cours »

components/role/client-lists.ts:84–88 marque la dernière étape current lorsque status=paid, même si paid_at est renseigné. components/role/client-space.tsx:1359 traduit current en « En cours ». Les captures client-detail-{360,1280}-after montrent ainsi « Règlement /22oct/En cours » puis juste dessous le reçu « Règlement … confirmé », tandis que le bandeau annonce « Terminée et réglée ».

Ce défaut existait dans le calcul inline avant extraction : ce n’est pas une nouvelle régression du diff. Il est toutefois reconduit dans le helper désormais testé/raccordé, et le test affirme paid[6].state=current au lieu d’empêcher la contradiction. Pour l’état terminal payé, marquer la dernière entrée réglée done (et réexaminer seulement le style terminal du stepper si nécessaire), sans inventer de date absente ni modifier le statut métier. Garder current pour les étapes réellement en cours. Recette négative : paid avec paid_at => aucun libellé « Règlement en cours » ; completed non payé garde Règlement à venir.

## Points vérifiés

- quoteDecisionState n’ouvre les actions que pour la version envoyée courante au dossier quoted. La version acceptée/rejetée/remplacée/close ne rend pas les boutons de décision. Identifiants des commandes accept_quote/reject_quote, motif, validations, busy et gestion de résultat inchangés. Les contrôles serveur restent l’autorité.
- quoteLineCells reprend exactement quantité × prix unitaire déjà affiché ; arrondi de ligne identique. Sous-total, TVA et TTC restent issus du devis serveur ; aucun prix ni garantie ajoutés.
- Panneau documents déplacé après la décision sans changer variant/target/authority/client. Ancien bloc CLI-07 « PDF non activé » supprimé ; nouveau bouton fait défiler vers ce panneau, ne change pas le hash et ne télécharge rien à lui seul.
- Stepper/chronologie extraits à logique équivalente ; dates enregistrées seulement, absences explicites, annulation conserve confirmation et commande cancel. Le P2 terminal ci-dessus est la limite de cohérence trouvée.
- CSS local : montants nowrap, libellé devis repliable, cartes artisan flex-wrap, carte indisponibilité compacte, lien PDF min-height44 et annulation avec primitive button. Pas de primitive partagée modifiée.

## Références et tests

Catalogue : V8-C06=volume8 page7 et V8-C07=volume8 page8 ; vraies images /tmp/courant-audit/volume8/C06.jpeg et C07.jpeg consultées. Captures après devis/détail360 et1280 consultées ; ordre note/tableau/artisan/décision/documents respecte le contrat. Écarts assumés cohérents : pas de promesses commerciales/certifications/avis fabriqués, pas de carte fournisseur inventée, cinq étapes selon statuts réels et actions bleues. Captures avant disponibles dans le contrat ; comparaison de changement fonctionnel faite par diff source, pas nouvelle recette navigateur.

Tests exécutés : tests/ui/client-lists.test.ts + tests/ui/session.test.ts, 16 PASS /0 échec. Le test payé actuel encode précisément le défaut P2, donc un résultat vert ne le réfute pas. Aucune nouvelle mesure DOM44, focus, zoom ou parcours connecté effectuée. Pas de verdict de fidélité globale ni de recette paiement tiré des images de démo.

Verdict : pas de nouvelle régression prix/permissions/actions établie ; un P2 de progression terminale à corriger avant clôture du checkpoint détail. Intégration de travail possible, acceptation visuelle finale non recommandée avec cette contradiction.
