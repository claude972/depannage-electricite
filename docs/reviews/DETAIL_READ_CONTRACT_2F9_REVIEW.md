# Revue du contrat DETAIL_READ — 2f9d7a5

Source exacte :2f9d7a570d2d079ae68a98fcc25270561d4e0750, docs/DETAIL_READ_CONTRACT.md (28lignes), brancheclaude/web-remaining-contracts ; mission07e0338 et sourceapp58b76414f6233220f938dbc42681c089abe58316 comparées. Lecture seule, aucun code/cloud/credential, aucun contrat concurrent.

Verdict : amendements requis AVANT GO code. Aucun élargissement de droits proposé par le document ; la solution Auth/RLS/point-read est appropriée. Les trois P2 ci-dessous sont des lacunes d’interface/comportement du contrat, pas des bugs applicatifs déjà implémentés.

## DETAIL-CONTRACT-001 — P2 : déclencheur dépendant d’un signal absent

Lignes9 et24 : route utilisée «seulement quand l’id est absent d’un instantané limité», et signal«limité» censé resterexact. Or GETworkspace58b renvoie uniquement appointments_limit/appointments_limited, aucun marqueur de troncature des interventions, sites, organisations oudevis. Un consommateur ne peut pas savoir si l’absence provient ducap100 ; prendre length===100 n’est pas une preuve de troncature et les offres ajoutées compliquent ce seuil.

Attendu : décider explicitement lectureparID sur touteabsenceaprèsrevalidation réussie (sans prétendre connaître la troncature), OU définir indicateur exact+fichierworkspace+ownership/format/tests avantcode. Ne pas laisser le hook inventer cette condition ou modifier un fichier non attribué. Le document backend/types/hook/lead doit préciser qui raccorde cette condition.

## DETAIL-CONTRACT-002 — P2 : réponse/projection et dépendances encore non contractuelles

Lignes11,14,22 :200«enregistrement validé», colonnesdossier«identiques à celles consommées», mais aucune enveloppe ni liste concrète pour intervention/site/org/devis, aucune borne documents/devis/payments. Le validateurworkspace actuel accepte essentiellementid/status pour interventions (offres redigées comprises) : «même validation» ne garantit pas un vrai détail. Les collections plafonnées peuvent masquer un devisaccepté/uneversion ciblée sans signal, même si le dossier est retrouvé.

Attendu : définir noms/champs/types/nullabilité d’une réponse unique, projection explicite de chaque table, caps/ordre/troncature et comportement des références devis utiles. Dépendance invisible via lecture réussie=>null/vide ; erreurDB/transport de dépendance=>erreur, jamais videparfallback. Préciser comment site/org récupérés horscaps100/50 restent confinés au périmètreactif de la vueentreprise sans changement silencieux d’organisation. Conserver participants via operationsRPC et métadonnéesdoc sanspathStorage ; aucun service_role.

Préciser aussi matriceerreurs réelle : dbError existant mappe certains SQLstates en403/404/429 et ne pose pas Retry-After ; apiError ne pose pas Cache-Control. Si le contrat veut503+Retry-After et no-store sur toutesréponses, la route doit l’appliquer explicitement et le tester, sans convertir une erreur enabsence.

## DETAIL-CONTRACT-003 — P2 : cache/vols pas suffisamment bornés au contexte

Lignes23–24 : clé cache inclutidentité/rôle/org/site/id, mais singleflight seulement(profileId,id). Un changement d’org/site peut donc rejoindre un ancienvol si l’implémentation suit cette clé ; rejeter sa réponse ne suffit pas à garantir une lecture nouvelle pour le nouveaucontexte. Aucun maximumLRU/âge ni politique404/invalidationdroits n’est donné. L’invalidation viaRealtime ne peut pas être l’unique chemin fiable : son efficacité est précisémentOPEN dans l’autrecontrat.

Attendu : borne explicite du cachepositif/négatif, suppression réelle des ancienscontextes, nouvellelecture aprèschangementcontexte ou causefraîche sans rejoindre unvol antérieur, invalidation/revalidation aprèsréaffectation/révocation et sansRealtime fonctionnel. Définir ce qui reste affiché sur503 : pas d’effacement trompeur du détailprécédemmentvérifié, pas de404. Tests hook intégré avec anciensvols retardés, cacheancien hors100 aprèsworkspacefresh, et changement droits/identité/org/site/id ; ne pas se limiter à une fonctionpure de décision.

## Clarification non bloquante à inclure

Lignes10/12 : «jamais d’offre nonattribuée» doit viser l’artisan nonparticipant recevant la projectionavailable_missions, pas un filtreartisan_idNOTNULL global. Le clientcréateur peut lire son propre dossierrequested sansartisan selon RLS009. Ajouter ce cas200, faceà404 pour artisan simplementéligible à uneoffre. Le404 pourUUIDinvalide est une décision explicite du contrat (différente des422 routesexistantes), acceptable si validée parROOT ; authentifier et garder un corps constant, pas de divulgation d’existence.

## Conforme dans la proposition

Diagnostic des limites100/50/200 correct ; nouvelleGETleaf distincte d’operations ; authenticatedClient/RLS009 clientprivé/artisanassigné/membresites/admin, sanspolicy/RPCdefiner nouveau ; dépendances liées au seuldossier ; pas de servicekey/offrespleintexte ; état503 distinct404, cache indépendantdeslistes, génération et annulation prévus. Séparation fichiersbackend/types/hook et câblagelead cohérente, à compléter par les interfaces ci-dessus.

Pas de test d’implémentation exécuté : livraison DOCSseulement. La future recette doit distinguer fauxclientunitaire et refusRLSréels sousROOT, avec protocoleborné avantfixtures. Aucun verdict de sécurité/présence ancienne acquis par cette simple revue documentaire.
