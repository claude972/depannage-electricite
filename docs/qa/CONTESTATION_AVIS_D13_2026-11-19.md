# D13 — contestation d’avis par l’artisan

Correspond à W1 signalé par Claude : la commande serveur existait, mais aucun contrôle de l’espace artisan ne l’exposait.

Le dossier artisan affiche désormais l’avis chargé, son historique de contestation et un formulaire motivé. La lecture précise de l’avis vérifie l’attribution du dossier puis limite l’historique aux 50 dernières contestations du même artisan. Aucun accès de modération n’est accordé, aucune migration ou modification de RPC.

Le motif exige 10 à 2 000 caractères. Un verrou empêche deux soumissions simultanées. Après une réponse perdue, le bouton reprend exactement la même clé de requête et le même motif ; le serveur existant assure l’idempotence et l’unicité d’une contestation ouverte. Le formulaire indique explicitement qu’aucun masquage automatique n’a lieu. Une contestation ouverte ferme le formulaire et la décision peut être actualisée. Les avis masqués restent soumis aux règles RLS existantes.

Le panneau est isolé par identité, génération de session et avis. Une réponse tardive après changement de compte ne s’applique pas. En démonstration, aucune commande réelle n’est envoyée.

## Vérification locale

- 7 tests du contrat HTTP plateforme réussis, dont nouveau contrôle de lecture artisan, refus tiers/admin sans attribution, filtre acteur/avis, tri et plafond.
- Interface React réelle en Chromium à 390/1280 : erreur/reprise de lecture, motif court refusé sans POST, réponse perdue puis reprise avec la même clé, double soumission, décision relue et changement de compte en cours d’envoi.
- TypeScript réussi après ajustement final du refus 422.

Les avis du dossier sont issus du workspace chargé : cette correction ne crée pas une liste exhaustive d’avis ni un point de lecture pour un dossier hors de cette fenêtre. Vérification sur preview encore nécessaire avec les comptes synthétiques de la recette W1.
