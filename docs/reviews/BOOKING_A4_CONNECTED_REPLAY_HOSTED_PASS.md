# Réservation connectée, concurrence et reprise — a4b6f31

Source application `a4b6f3177bd6e326bda9324ac7297f074e5ae1c0`, preview publique ix2rkpc6h, déploiement READY `dpl_9tnfmuqieh48xhEAX8XGAME7QvDK`, Flight `4KsRbx0ZO5gyyXjblsH8O`. Alias de branche vérifié HTTP200 avec le même Flight. CI41312089858 : check et PostgreSQL isolé SUCCESS.

## Corrections intégrées

- Migration021 : clé idempotente privée par acteur/demande, sérialisation transactionnelle, droits courants revalidés au rejeu ; même clé/payload différent refusé. Route POST compatible avec les anciens clients sans clé. Source4f9e42e revue ROOT : 69 assertions SQL isolées, trois groupes de tests route et TypeScript PASS. Migration021 seule appliquée par ROOT ; readback cloud RLS/ACL/présence version PASS. Aucune modification001–020, main, production ou Edge.
- Front4649b07 : UUID stable conservé avec le brouillon dans cet onglet, prouvé durable avant émission, réutilisé après erreur/rechargement ; aucune nouvelle clé silencieuse. Pas de coordonnées ajoutées automatiquement dans la description publique.
- Frontb144fc1 : Confirmer désactivé avec « Préparation du formulaire… » avant hydratation. ROOT a retenu les scripts réseau : 1280 et390, bouton désactivé avant JS puis un clic ouvre le formulaire après JS, zéro écriture. Le défaut ancien820 de clic perdu avant hydratation reste conservé comme preuve séparée.

## Vraie recette connectée

Run `3c1b681539d4`, writer24475 terminé exit0 : **19/19 PASS** sur cette preview, deux clients QA préconfirmés synthétiques et un dossier créé uniquement via l’UI. Fiche → urgence/créneau → coordonnées → adresse manuelle → récapitulatif → login réel → confirmation explicite ; aucun POST automatique.

Erreur profil503 interceptée localement : brouillon conservé, aucun dossier. Puis deux vrais POST concurrents avec la même clé donnent201 et le même UUID ; la réponse est volontairement coupée avant l’UI après commit confirmé. Brouillon et clé restent présents. Rechargement même identité, nouvel essai/double clic :201, même UUID. Trois POST réseau au total, **un seul dossier, un seul audit de création et une seule consommation de quota**. Brouillon consommé uniquement au succès final. Profil privé exact, estimation serveur80–180€ indicative ; client propriétaire200, tiers et inexistant404 uniformes/private,no-store.

Attestation ROOT API/HTML collectée13:39:49.297UTC avant credentials. Driver privéV3 SHA256 `d429914ed696c904591e344d42c24dbabca9217c7f02d9da7bc65f9622eafc20`, 77 contrôles injectés sans réseau/credentials/navigateur. Cleanupok, drain0, dix intentions toutes réglées, aucun inconnu. Preuves privées dans booking-connected-v3-3c1b681539d4 ; aucune donnée personnelle ni credential dans Git.

Après FIN/drain/cleanup, ROOT a exécuté un contrôle READONLY indépendant : **45/45 PASS**, deux Auth404 stricts, 41 scopes REST vides dont les clés idempotentes par acteur et parent, deux préfixes Storage vides. Script SHA256 `f6828e3419e8ed0581967bd1b6c2fa16b66b5a107ed4795e8adf6b097f83e670`. Aucune cohorte QA connue maintenue après ce readback.

## Limites et tentatives conservées

Le précédent run315e08 app243 reste16/16PASS avec nettoyage indépendant43/43. Le runb52 app820 est INCOMPLETE avant toute création de dossier : deux comptes nettoyés puis28/28 readbacks indépendants PASS ; sa cause précise ne se déduit pas du défaut d’hydratation reproduit séparément. Aucun échec requalifié.

Adresse provider503 simulé pour vérifier le secours manuel ; pas de preuve GPS dans ce run. Comptes QA préconfirmés : pas de livraison SMTP/inbox démontrée. Stripe et premier vrai SuperAdmin restent différés. Cette recette valide le parcours décrit, pas l’application entière ni l’absence absolue de bugs.
