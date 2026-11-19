# Parcours complémentaires — 19 novembre 2026

## Contrôles réalisés en ligne

- Matching : dossiers fictifs dans et hors zone ; offre hors zone absente (404), attribution refusée (403). Artisan indisponible : offre absente et attribution refusée. Deux requêtes concurrentes du même artisan : un succès et un refus. Disponibilité initiale restaurée, deux dossiers fictifs annulés (200). Cela ne remplace pas le test concurrent avec deux artisans distincts. Preuve externe `preuves/matching-closure.json`.
- Membre entreprise : page de dossier déjà ouverte, retrait par le propriétaire, lecture serveur refusée (403), données retirées après reprise de focus sans rechargement. Mauvais destinataire de l’invitation refusé (403), invitation acceptée par le destinataire et rôle viewer/portée de site restaurés à l’identique. Aucune erreur JavaScript. Preuve `preuves/member-revocation-live.json`.
- Site archivé : paramètres, contacts, parties communes et assemblées encore lisibles par le propriétaire ; tiers refusé (404). Requête de modification des paramètres bien formée et nouvelle intervention refusées (409). Preuve `preuves/archived-site-guards.json`.

## Défauts corrigés

W4 intégré depuis Claude : un site archivé n’est plus dans le tableau des sites actifs.
W5 : les panneaux contacts, parties communes et copropriété étaient masqués sur la fiche archivée. Ils sont désormais consultables avec une restriction explicite de lecture seule, même lorsque leur API annonce can_write. Le passage en lecture seule recrée le panneau et supprime toute commande en attente. Les actions et contrôleurs de modification restent désactivés. Ce correctif concerne la consultation web ; il ne constitue pas un audit complet de toutes les commandes serveur sur des sites archivés.

## Tests locaux

23 tests de reprise/expiration/session/offre perdue/idempotence réussis ; 12 tests de cycle des sites et de remboursement réussis ; 24 tests ciblés des panneaux d’archives et six tests de fiche directe réussis. Aucun test ignoré. TypeScript et vérification du diff réussis. Les tests simulés de remboursement ne prouvent pas une opération Stripe réelle.

## Réserves précises

- Aucun remboursement de recette disponible dans la liste administrateur lors de la lecture : aucune exécution financière supplémentaire réalisée ni politique de remboursement inventée.
- Inscription avec réception réelle d’email, nouveau dossier artisan, deux artisans distincts en concurrence, variantes Checkout Android, versement bancaire, restauration hébergée et alertes restent non clôturés.
- Les mesures responsive précédentes ne constituent pas une recette complète Safari/Firefox.
- Les informations commerciales et la configuration production restent distinctes de cette recette technique.
