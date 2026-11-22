# ENT-15 — export CSV privé des relevés consolidés

Base `610b13f`, branche `codex/energy-export`, claim `ea64ec2`. Périmètre confirmé : `docs/audit/COUVERTURE_PLAN.csv`, ligne ENT-15 (dates/AG/énergie, mêmes filtres et totaux) ; `docs/PLAN_LIVRAISON_INTEGRALE.md`, lot 4 (consolidation énergie et reporting/export, réconciliation écran/export) ; `docs/PLAN_REPRISE.md`, phase 7.

## Contrat

Même route `GET /api/organizations/{id}/energy`, mêmes paramètres `site_ids`, `from`, `to`, `previous_from`, `previous_to`. Ajouter `format=csv`. Paramètre absent ou `format=json` : réponse JSON existante inchangée. Tout autre format, paramètre inconnu ou dupliqué est refusé.

Une seule RPC sous le JWT du demandeur, `organization_energy_consolidation`, puis le même `energyReport` validé. Aucun nouvel accès SQL, calcul de total, sélection de site ou chargement partiel. Les caps et refus existants s’appliquent aussi au CSV. Une erreur reste du JSON privé avec son statut habituel, jamais un téléchargement vide prétendument réussi.

Succès CSV : UTF-8 avec BOM, séparateur point-virgule, fins de ligne CRLF, fichier `rapport-energie.csv`, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.

## Contenu et lecture

Lignes de niveaux distincts : `compteur`, `site`, `ensemble_des_releves`, puis `comparaison_des_releves` quand une plage précédente est sélectionnée. **Ne pas additionner les niveaux** : ils représentent les détails et leurs consolidations. Chaque ligne conserve organisation, sites sélectionnés, plages inclusives, base déclarée et indicateurs de complétude. La comparaison reprend celle du rapport JSON ; aucune comparaison nouvelle n’est calculée.

Consommation en Wh et coûts en centimes, chaînes décimales exactes sans division, conversion flottante ni arrondi. `non disponible` représente une absence, un coût incomplet ou une valeur non applicable ; une mesure réelle nulle reste `0`. Les sommes partielles restent accompagnées de `non` pour la couverture temporelle complète. Aucun total de consommation physique n’est créé : le périmètre physique est explicitement incomplet, conformément au rapport JSON et à l’absence de registre exhaustif/hiérarchie des compteurs.

Toutes les cellules passent par le helper partagé `csvCell` : guillemets doublés, séparateurs et sauts de ligne encapsulés, marqueur apostrophe devant les formules ou valeurs sensibles (y compris espaces/onglets et signes négatifs). Ce marqueur de protection peut donc précéder un écart négatif dans le fichier brut ; il ne représente pas une modification du calcul.

## Vérification

14 tests PASS (6 nouveaux et 8 régressions du consolidé), TypeScript strict PASS. Tests des vrais handlers : mêmes arguments RPC et rapport JSON/CSV, absence versus zéro, 201 compteurs sans troncature, grandes valeurs exactes, formules/espaces/onglets/guillemets/sauts de ligne, accès étranger, réponse malformée, formats/filtres stricts et headers privés. Régression du rapport JSON et TypeScript strict. Aucune UI ni opération cloud ; l’accès au téléchargement depuis l’interface et la recette preview restent au pilote.
