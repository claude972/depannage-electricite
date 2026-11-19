# Vérifications complémentaires du 19 novembre 2026

## Rapports entreprise

21 contrôles API réussis sur quatre sites : CSV et JSON concordants au centime, totaux recalculés, filtres par site, refus client/artisan tiers et paramètres invalides. Le téléchargement réel par le bouton de l’interface donne exactement le CSV servi, quatre lignes de sites. Preuves externes : `preuves/reports-closure-20261119.json`, `preuves/closure-ui.json`.

## Devis et grille versionnée

Publication synthétique d’une version 2 : le devis existant conserve sa référence version 1, son montant et son statut. Vérification API puis affichage réel dans l’espace entreprise. Voir `DEVIS_GRILLE_API_2026-11-19.md`.

## Retours de connexion et paiement

Défaut reproduit : la navigation effaçait les explications de lien expiré et de retour Stripe sans session. Correctif : navigation avant affectation du message. Le paramètre `auth=confirmed` n’annonce plus une adresse confirmée à lui seul. Régression montée avec les composants réels : 22 tests ciblés réussis, aucun ignoré ; TypeScript réussi. Source locale `d69eeb13`, GitHub `6d596159383ae6abfb59487cf1634a5ed6849a81`.

Sur la recette, une URL « cancelled » sur le dossier déjà réglé affiche le règlement confirmé par le serveur ; une URL « pending » sur le dossier encore impayé affiche une attente de confirmation. Aucune écriture API ni nouveau paiement. Preuve : `preuves/payment-return-live.json`.

## Limites conservées

Ces contrôles ne prouvent pas la réception des emails d’inscription ni les remboursements réels. Les coordonnées exploitant, couverture, conditions et barème commercial restent à valider ; les brouillons ne sont pas publiés. La configuration de production, Stripe LIVE, domaine, notifications et publication des applications restent des réserves de lancement. La recette Android ne progresse pas tant que l’émulateur ne démarre pas ; les contrôles web indépendants continuent.

## Vérification en ligne

Déploiement `dpl_82camfvvPCKjbaD2aCxoDGwGWhC3` READY, puis alias de recette : les trois retours anonymes (lien expiré, paramètre confirmé, Stripe) affichent le message attendu, sans écriture API. Preuve externe `preuves/auth-return-audit.json`.

Le correctif responsive Claude `cb7c3e60` du bloc de grille est intégré localement en `abfc085b` : la colonne peut rétrécir même avec un intitulé long. Il complète les mesures responsive précédentes qui ne couvraient pas cet état précis.
