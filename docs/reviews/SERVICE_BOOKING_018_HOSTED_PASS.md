# Fiche et réservation publique — contrôle réel ROOT

Application `018a482c6d18733c2938eeaf4b40937255a19d92`, preview READY `dpl_Fc9LbHKZwRBGMRutHpqGYW2dr8yf`, Flight `nZ8rCAgV-5R34wSTX_qQT`. URL publique sans Vercel : https://depannage-electricite-kdr9m0qj1-brafas-projects.vercel.app/prestations/plusieurs-prises-sans-courant . Exception limitée à ce déploiement.

ROOT Chromium neuf : **8/8 PASS**, 360/390/1280/1440 × clair/sombre. Bandeau fixe avec prestation, estimation indicative et Confirmer ; CTA44+, pied de page accessible au défilement maximal, prix et bouton sans chevauchement. Confirmer ouvre urgence → coordonnées → adresse → récapitulatif → Auth ; choix Non/Demain, erreurs obligatoires, retour conservant coordonnées, saisie manuelle, clic unique après texte/téléphone/ville sans blur artificiel. Prestation et email repris à la connexion ; aucune coordonnée automatique dans la description publique, aucun POST ni erreur JS/débordement. Captures390 réellement inspectées.

Preuve privée `service-booking-public-proof-v3.json`, driver v3. Historique conservé : v1 comportait un mauvais locator Auth ; v2 a confirmé un léger recouvrement du footer mobile ; diagnostic séparé a reproduit le clic perdu lors du changement static/fixed au blur. Correctif d6240c6 : position stable, CTA empilé et réserve calculée depuis la hauteur de barre. Contrôles ciblés finaux22PASS/TypeScript strict PASS ; suite avant ce correctif957PASS/1SKIP HTML optionnel, pas présentée comme suite exacte du dernier SHA.

Bornes : parcours anonyme jusqu’à Auth ; aucune nouvelle preuve d’envoi authentifié, d’email effectivement reçu, de paiement ou de clavier physique iPhone. Aucune cohorte QA créée pour ce contrôle. Les preuves métier antérieures restent bornées à leurs sources.
