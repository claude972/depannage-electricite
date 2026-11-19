# D18 — Motif de contestation explicite

L'observation O6 de la recette web relevait un message Zod en anglais pour un motif de moins de dix caractères. La route répond désormais en français et précise la limite applicable : au moins 10 caractères et au plus 2 000. Le caractère nul est également refusé avec un message français. Les permissions et les commandes de modération restent inchangées.

Les huit tests de routes des opérations plateforme passent, dont les deux bornes de longueur avec réponse 422 et absence d'appel en base. Preuve : `review-validation-d18-20261119.log`. Vérification sur preview à effectuer après déploiement.
