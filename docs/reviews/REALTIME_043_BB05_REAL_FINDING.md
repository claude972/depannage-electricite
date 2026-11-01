# Realtime — mesure réelle du 1 novembre 2026

Source QA043cdbc0164d255e5b8a9bac04da6c68d41345d3 ; intégrationfe6d825. Runbb05bf739898, rapport privé /tmp/depannage-realtime-043-live/report.json. Sonde navigateur SDK2.118.0 isolée : ce résultat ne prouve pas encore le comportement de l’interface applicative.

- app-4 (interventions/quotes/messages/payments) : SUBSCRIBED puis erreur système « Unable to subscribe to changes with given parameters » ; INSERT confirmé mais aucun événement dans la fenêtre10s.
- pub-3 : abonnement et événement reçus. int-1 : abonnement et événement reçus.
- app-4-wait : CHANNEL_ERROR, aucun INSERT émis.
- Conclusion mesurée H1b ; payments absent de la publication déjà confirmé par lecture seule. Correctif applicatif demandé : trois tables publiées, wait et état de connexion honnête. LIVE-WORKSPACE-001 reste ouvert jusqu’à recette de l’application déployée, même document et création externe.

Processus terminé exit0 ; cleanup du runner ok, quatre intentions terminées. ROOT a relu puis exécuté le postflight indépendant (hashd76f22d5def97054706e5beb6d304cfaa368759f019db46d561bd0fd0b17838a) : 28/28PASS à01:24:28.989UTC, dont Auth404 exact,26 lectures REST0 et Storage0. Sortie ROOT transcrite sans nouveau réseau dans independent-postflight.json. Pas d’autre cohorte QA connue active à cette vérification ; aucun compte propriétaire concerné.
