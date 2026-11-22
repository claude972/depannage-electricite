# Ticket et délai de restauration sur 955d36b

La preview sert `955d36bdea9c0f1a6025680dfbeb899c108aef6d` de `integration/web-pwa`. Vercel confirme `dpl_CGZSgrv6xZDHhFvSKTSpnaVUtbsL` et le HTML public confirme le build `qtuZQd1Lb6XBuJF3ZRz6A`. Les 56 tests ciblés et TypeScript strict passent. Les tests du formulaire couvrent la pagination, la conservation du lien après erreur, son retrait explicite, la lecture seule et le verrouillage à 390 et 1280 px. [Preview](https://depannage-electricite-41xmipfvx-brafas-projects.vercel.app) · [CI](https://github.com/claude972/depannage-electricite/actions/runs/42442906752)

La recette Chromium `22eeda72e134` a créé un site et une intervention de test. Les API utilisateur ont enregistré un équipement critique, son lien avec le ticket, un calendrier ouvré et une règle de délai. Dans l’interface à 390 px, le gestionnaire a sélectionné le même ticket en ouvrant le dossier de délai, puis modifié uniquement sa note. Les deux versions et leurs événements d’audit ont conservé le ticket exact.

Le calendrier de test ouvrait le lundi de 8 h à 12 h en Martinique, avec une cible de réponse de 60 minutes. Pour une ouverture à 8 h et une réponse à 8 h 30, le serveur a mesuré 30 minutes et l’écran a affiché l’échéance calculée à 9 h. Ce calendrier sert uniquement à la recette.

Pendant la retenue du reçu de modification, l’éditeur et le sélecteur étaient verrouillés et un second envoi artificiel n’a émis aucun POST. Une version périmée a reçu 409, le lecteur a pu consulter le dossier mais son écriture a reçu 403 et le tiers a reçu 403 en lecture et en écriture.

Le lien et son événement privés ont été nettoyés par une transaction bornée au site, au ticket, à l’équipement et à la commande de test. Les 49 étapes de nettoyage des parents, 51 lectures indépendantes et le contrôle SQL séparé du lien et de l’événement ont réussi. Le constructeur SQL a aussi passé une exécution isolée avec un autre site préservé et deux cas de refus avec rollback.
