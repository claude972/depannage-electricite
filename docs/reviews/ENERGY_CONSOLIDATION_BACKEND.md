# ENT-09/15 — consolidation des relevés déclarés

Base `3657bdd`, branche `codex/energy-consolidation`, claim `4c35b07`. Les lectures/saisies énergie par site existaient ; ce lot ajoute leur consolidation en lecture seule. Aucun compteur automatique, fournisseur, donnée historique inventée, interface ou export CSV nouveau.

## API

`GET /api/organizations/{id}/energy?site_ids={uuid},{uuid}&from=2026-01-01&to=2026-01-31`

Comparaison facultative : ajouter ensemble `previous_from` et `previous_to`. Les dates ci-dessus sont des exemples de filtres, pas des mesures. Limites techniques : 1 à 50 sites explicites, 366 jours inclusifs par plage et 500 compteurs déclarés actifs sur ces sites. Dépasser la limite de compteurs retourne 422 ; aucun résultat tronqué ne devient un total. Les filtres inconnus/dupliqués et sélections de sites dupliquées sont refusés.

Une seule RPC stable `organization_energy_consolidation` lit un instantané. `SECURITY INVOKER`, RLS existantes conservées, JWT et adhésion actuelle à l’organisation obligatoires ; chaque site demandé doit appartenir à celle-ci et être accessible. Un seul site non autorisé fait échouer toute la sélection (404). Les lecteurs peuvent lire. Pas de service key ni privilège de lecture supplémentaire. Les sites archivés restent consultables selon les droits courants.

## Réponse et limites métier

- `scope` confirme les filtres ; `meters` fournit par couple site/compteur normalisé la période courante et éventuellement précédente. Normalisation identique à la saisie : minuscules et espaces de bord supprimés. Seuls les relevés non archivés sont inclus.
- Chaque période expose `record_count`, `crossing_count`, `missing_cost_count`, `consumption_wh`, `cost_cents` et `coverage_complete`. Les sommes sont des chaînes décimales entières exactes, jamais des flottants ; `null` signifie absence ou coût incomplet, tandis que `"0"` peut être une mesure réelle. Ni notes, ni références documentaires, ni identités d’auteurs ne sont projetées.
- Les relevés entièrement inclus sont additionnés ; ceux qui dépassent la plage sont comptés dans `crossing_count` mais exclus des sommes. Aucune proratisation. La couverture vérifie l’union réelle des jours ET l’absence de double couverture ; un trou compensé arithmétiquement par un chevauchement ne devient pas complet.
- L’ensemble des compteurs connus provient des relevés actifs, y compris hors des plages : leur absence dans une plage rend cette couverture incomplète. Un changement de libellé crée donc un compteur déclaré distinct ; une réconciliation automatique serait inventée.
- `sites`, `current`, `previous` agrègent uniquement ces relevés. `recorded_consumption_wh` peut être une somme partielle et doit toujours être affiché avec `recorded_coverage_complete`. Aucun relevé = `null`, pas zéro. Tout coût absent rend `recorded_cost_cents` nul ; `cost_complete` exige aussi une couverture temporelle complète. Un site sélectionné sans compteur rend le périmètre consolidé incomplet.
- `comparison.comparable` exige mêmes durées inclusives, plages disjointes, mêmes compteurs connus et couverture complète dans les deux plages. `reason` indique absence de comparaison, durées différentes, chevauchement ou couverture incomplète. Deltas exacts en chaînes signées ; coût comparé seulement si complet des deux côtés. Aucun pourcentage sur une base nulle.
- **Le modèle ne possède ni registre exhaustif des compteurs ni hiérarchie compteur/sous-compteur.** Les sommes peuvent additionner des relevés de périmètres physiques superposés. Elles ne sont jamais présentées comme consommation réelle exhaustive du site : `physical_scope_complete=false`, `actual_site_consumption_wh=null`, même si la couverture des relevés connus est complète. La provenance reste déclarée, pas certifiée.

## Validation et raccordement

18 tests énergie PASS (dont 8 nouveaux) ; TypeScript strict PASS. Tests ciblés des calculs et vrais handlers HTTP : refus de filtres/projections, scope, erreurs, zéro/absence, précision au-delà des entiers JS sûrs, durées, coût absent. SQL isolé : 30 assertions PASS sur 46 migrations réelles et Auth/Storage/cron simulés : accès inter-sites et inter-organisations, retrait d’adhésion, lecteur, archives, plages adjacentes/trous/chevauchements, relevé aux frontières, >100 relevés, limite 500 compteurs et rôles anon/service refusés. Régression SQL des saisies énergie existantes : 29 assertions PASS.

Aucune preuve cloud/preview dans ce lot. Le raccordement UI et les exports utilisant ce même périmètre restent à réaliser ; ENT-15 complet n’est pas revendiqué.
