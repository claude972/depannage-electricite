# Revue artisan — checkpoints 1007ef7, d06dc78, 83794d8

Verdict : prêt à intégrer comme lot de présentation borné ; aucun nouveau P1/P2 concret trouvé dans le diff f3fd9c6..83794d8. Pas d’acceptation globale de fidélité ou de parcours connecté.

Source : snapshot propre /tmp/depannage-advanced-pinned-ee767b6, HEAD ee767b61e39a15020fc76e659d29dd9aa91954e4 ; commits artisan figés examinés, aucun travail d’ancres en cours lu/validé. Diff artisan-space, artisan-quote-draft, artisan-lists et deux CSS ; addendum docs/CLAUDE_VISUAL_FIDELITY_CONTRACT.md ; validation existante du domaine et SQL010.

Références : catalogue INVENTAIRE_SOURCES.json, M34 = volume3/page3, M35 = volume3/page4, M36 = volume3/page5 ; images sources v3-p3/4/5 consultées. Captures after consultées : overview360/1280, profile360 et quote360/1280. Les autres captures fournies ne constituent pas une nouvelle preuve indépendante de cette revue.

Tests exécutés dans le snapshot, dépendances partagées via NODE_PATH/tsx :
- artisan-lists + quote-draft : 12 PASS / 0 échec.
- tests/ui/*.test.ts + artisan-performance : 79 PASS / 0 échec.

Vérifications :
- Aucune commande, autorité ou transition modifiée dans les changements artisan-space ; extraction pure des états rendez-vous conservant undefined/loading, null/indisponible, absence/à fixer, rendez-vous réel/date. Aucun horaire inventé.
- Montants : calcul HT nouveau somme les produits arrondis par ligne. Formulaire et serveur imposent quantités et prix unitaires entiers ; le résultat reste identique à l’ancien calcul sur les valeurs admises. TVA inconnue => TVA/TTC tirets, envoi empêché ; validation/conflit/brouillon/versioning inchangés. Les résultats financiers restent recalculés côté serveur.
- Performance : aucune statistique créée pour satisfaction/ponctualité ; valeurs de note, règlements et ancienneté reposent sur les données déjà utilisées. Le diff réorganise leur présentation.
- Coque : Accueil remplace seulement le libellé long du bas ; même destination overview et même menu complet. Règles desktop après styles de base masquent bien menu mobile et barre inférieure ; segments/summaries et suppression conservent les cibles prévues >=44px.
- Fidélité bornée : M35 conserve bandeau marine, illustration, missions, performance et CTA ; M36 restitue en-tête teinté, justificatifs, six tuiles et actions ; M34 rassemble lignes, totaux et envoi. Écarts documentés : formulaire de devis éditable en place, deux colonnes de performance mobile, pas de tendance/indicateur inventé, pas de faux statut d’assurance ni de pièce jointe dans le brouillon, CTA bleu.

Limites : aucune nouvelle mesure DOM de cibles44, focus clavier, longue identité, débordement ou performance runtime effectuée. Captures mobiles longues montrent la barre fixe à la hauteur du viewport initial ; ce seul artefact de capture ne démontre pas un défaut de recouvrement en navigation réelle. Pas de navigateur connecté, aucune commande cloud, aucun test de publication réelle de devis exécuté. Pas de modification app/test.
