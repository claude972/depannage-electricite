# Données personnelles : contrôles API du 19 novembre 2026

36 contrôles réussis sur l'alias de recette avec les comptes synthétiques client, artisan et entreprise, via leurs sessions propres. Aucune clé de service, aucun changement de permission ni demande d'effacement.

Pour chaque rôle, neuf sections sont lues : compte, adresses, demandes, localisation des demandes, messages, documents, assistance, demandes d'effacement et rappels de paiement. Réponses privées non mises en cache publiquement ; identité et e-mail du compte conformes ; champs de propriétaire présents dans les lignes conformes à la session.

Trois requêtes invalides par rôle sont refusées avec 422 : paramètre user_id ajouté, section inconnue et curseur invalide. Aucun sélecteur de compte arbitraire n'est accepté.

Preuves : `preuves/privacy-readback-20261119.json` (résultats sans contenu des comptes) et `.log`. Le script ne publie ni jetons ni données exportées.

Limites : contrôles API, pas nouveau téléchargement par l'interface ; les pages suivantes ne sont pas parcourues ; aucun effacement demandé ou exécuté. Les champs absents de la projection ne sont pas présentés comme un contrôle d'identité supplémentaire. Le texte légal reste un brouillon à valider.
