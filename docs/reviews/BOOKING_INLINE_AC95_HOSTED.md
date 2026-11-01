# Bouton de suite dans le formulaire — ac95

Demande propriétaire : conserver la barre inférieure et ajouter aussi « Continuer » à la suite des champs. Source d47f8a2 intégrée/poussée ac95eaf65d6ce79bee50235e8b3f0a5b0f68d21e. Un submit natif dans chaque formulaire, mêmes STEP_ACTION/handler/validation ; data-booking-submit demeure unique sur la barre, nouveau hook inline distinct. Bouton48px, focus, largeur mobile et libellé long adaptable. Aucun changement API/Auth/session/brouillon/SQL.

ROOT revue diff,19 tests ciblés PASS et TypeScript strict PASS. Nouvelle preview GitSource exacte READY dpl_42AP1ByKVyZsTrVyoQrTsMfdg3fX, publique5v7lmsvpy, Flight jt1GKwxk76MX2_hppaOiX. Alias de branche HTTP200/même Flight vérifié.

ROOT navigateur neuf **8/8PASS** :360/390/1280/1804 × clair/sombre, hauteur desktop646. Barre volontairement masquée dans le HARNAIS pour prouver le bouton du formulaire seul : validation urgence/contact/adresse, clavier Entrée, quatre étapes, retour avec valeurs conservées, récapitulatif exact puis Auth prérempli ; hit-test/48px/absence débordement,0POST/0erreurJS. GET adresse503 simulé pour secours manuel ; aucune preuve GPS. Preuve privée booking-inline-ac95-public-proof.json.

**2/2PASS supplémentaires sans modification CSS** :390 et1804, les deux boutons visibles normalement, clic inline avance vers coordonnées,0POST. Capture réelle booking-inline-normal-desktop.png relue ROOT (bouton sous les champs et barre en bas). Aucun compte/dossier/email créé ; pas de nouveau test connecté/SMTP/paiement déduit de cette correction.

Sur l’ancienne source210, ROOTChrome1804x646/DPR2 voyait la barre : la cause exacte de son absence dans la capture propriétaire n’a pas été reproduite. Le propriétaire a ensuite précisé l’emplacement souhaité dans le contenu ; cette correction répond à cette demande sans inventer une cause Safari/zoom.

CI41318091842 : deux jobs SUCCESS (check et PostgreSQL isolé), terminé14:52:49UTC. Aucun compte QA/cohorte ni donnée métier créés dans cette correction.
