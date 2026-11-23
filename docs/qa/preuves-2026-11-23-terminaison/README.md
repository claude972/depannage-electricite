# Preuves de la recette de terminaison — nuit du 22 au 23 novembre 2026

Candidat : `main` au commit de fusion `a9db467b` (PR `#12`), déployé sur le projet Vercel de recette (`dpl_BbjkXcKKn5QKx9JdsnKWxW8w9vth`), base Supabase de recette, comptes synthétiques uniquement. Aucun paiement, aucune action sur la production.

Parcours pilotés depuis le poste de recette (`~/dev/domdep-qa/agents/term/`) avec Playwright (Chromium) : connexion par l’écran de connexion réel, puis écran ou routes de l’application sous la session de l’utilisateur ; état relu en base. Les captures (`term-*.png`) restent sur le poste de recette, dans `~/dev/domdep-qa/shots/`.

| Fichier | Parcours | Résultat |
|---|---|---|
| `explore.json` | Entreprise : filtre « Site » de la recherche d’interventions ; administration : rapport financier | Le site archivé est listé « (archivé) » ; le rapport renvoie 3 estimations remplacées (34,72 €) |
| `reconcile.json` | Administration > Finance > « Rapprocher les règlements », puis second clic | +10 règlements, +2 estimations (les 8 paiements à commission prélevée n’en reçoivent pas) ; second clic : 0 et 0 |
| `approval.json` | Demande entreprise sur un site à seuil 200 €, devis artisan 325,50 €, refus par le responsable | Refus sans commentaire 422 ; lecteur 403 ; l’artisan reçoit une notification « Devis non approuvé par le client », sans la note interne, visible à l’écran ; un autre artisan ne voit rien ; devis resté « envoyé » ; dossier annulé en fin de test |
| `refusal.json` | État de paiement lu par l’artisan d’un dossier réglé | 200 pour l’artisan du dossier, 404 pour un autre. **Ce fichier trace aussi une erreur de test** : le compte `adm-artisan-rej` n’était pas refusé définitivement et a été resoumis ; corrigé par `refusal2.json` |
| `refusal2.json` | Refus définitif par l’administration, tentative de resoumission, réouverture | Refus sans motif 422 ; resoumission 409 et dossier inchangé ; réouverture qui lève le refus ; compte revenu à « compléments demandés » |
| `journeys.json` | Photo de demande partagée, offre artisan, suppression ; journal d’audit unifié ; tables entreprise à 768 px | L’artisan éligible voit « Photos choisies par le client » et l’image dans l’offre ; suppression par le client 200, ligne et partage supprimés, tiers 404 ; journal : 600 événements lus sur 6 pages, 0 doublon, total 648, client 403 |
| `tablet.json` | Tables entreprise à 768 px | Aucune page ne déborde ; chaque table est dans une zone défilable focalisable nommée « tableau à défilement horizontal », sauf celle des rapports (zone défilable sans nom accessible) |

Non couvert ici : l’écriture de règlement à la confirmation d’un paiement (demande un nouveau paiement Stripe TEST, non joué par cette session), le formulaire de candidature à l’écran pour un artisan refusé, tout parcours mobile.
