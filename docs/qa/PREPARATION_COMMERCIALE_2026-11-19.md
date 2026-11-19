# Préparation commerciale et contrôles du 19 novembre 2026

Statut : recette en cours, ouverture commerciale non validée. Consigne du propriétaire : créer les documents manquants comme brouillons modifiables et poursuivre exclusivement sur les appareils virtuels.

## Documents livrés

Le dossier [lancement](../lancement/README.md) contient identité/offre, prix/commissions, conditions de service, confidentialité et exploitation/ouverture. Aucun de ces textes n'est chargé automatiquement par l'application. Les données réelles restent à renseigner ; aucune identité, couverture, garantie, commission ou assistance n'a été publiée.

## Corrections et preuves

- Fixtures du webhook de paiement et de la commission adaptées à la nouvelle relecture Stripe ; test de reprise après échec ajouté. Test webhook ciblé : 3/3. CI201 : contrôle applicatif réussi ; scénario signé E72 réussi ; suite SQL arrêtée par sa limite de dix minutes pendant des contrôles réussis. Limite portée à vingt minutes sans retrait de scénario.
- Test React monté du rattachement intégré depuis le commit Claude 07124e0b : 2/2 exécutés avec Chromium sur le mini, quatre mutations détectées. Sur CI sans Chromium, ces tests sont explicitement ignorés, jamais comptés comme exécutés.
- Next.js fixé à 16.4.6. Audit npm Web après mise à jour : zéro vulnérabilité. TypeScript et builds Turbopack/Webpack réussis localement. Sources des avis : [GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h), [GHSA-vc7v-qv4w-wrv8](https://github.com/advisories/GHSA-vc7v-qv4w-wrv8).
- Défaut du harnais local corrigé : 78 fichiers de tests convertissent désormais leurs URL en chemins avec fileURLToPath, au lieu de conserver %20 pour les espaces de « Stockage 2 ». Après correction, 2 116 tests passent sur cette copie ; les deux échecs restants (chemin relatif et métadonnées Git absentes de la copie) sont résolus et leurs suites ciblées passent : 22 succès, un contrôle privé ignoré. TypeScript passe après retrait du cache de types dev obsolète. Les 288 tests ignorés restent explicitement distincts des tests exécutés.
- Audit mobile : trois signalements modérés liés à la chaîne Expo/fingerprint/minimatch ; aucune vulnérabilité haute ou critique observée. La solution automatique proposée rétrograde Expo de 58 vers 52 : non appliquée. Une correction compatible reste à vérifier ; [avis minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249).

## Recette virtuelle supplémentaire

Android API36, compte client synthétique existant : demande planifiable créée depuis l'interface, numéro INT-ECF5C4, description explicite RECETTE-CODEX-20261119-ANDROID. Confirmation de l'estimation avant envoi ; dossier serveur affiché ; application arrêtée puis relancée et demande retrouvée. Adresse et téléphone fictifs, aucun paiement supplémentaire. L'APK préexistant pointe vers la preview bswte5fe6 : ce contrôle ne prouve pas un nouveau binaire de distribution ni le dernier backend.

Le simulateur iOS a ensuite relu ce même dossier Android avec le compte client, vérifié son identifiant et sa description, puis restauré la session après relance et déconnecté le compte : XCTest réussi.

Le client a annulé INT-ECF5C4 depuis Android après confirmation ; le statut Annulée est affiché, le bouton d’annulation disparaît et l’historique reste lisible.

La recette physique a été interrompue à la demande du propriétaire qui reprend son iPhone. Aucune validation physique complète n'est revendiquée.

## Conditions d'ouverture encore absentes

Voir l'[audit de configuration](AUDIT_EXPLOITATION_2026-11-19.md) pour les constats de recette datés : profil/garantie non publiés, couverture inconnue, barème fermé, environnement commercial et domaine absents, notifications externes inactives. Restent également Stripe LIVE distinct, preuve de restauration hébergée avec fichiers privés, réception d'alertes, liens Auth/e-mail distribués, signatures et dossiers des stores. Le paiement et le rapprochement TEST réussis ne remplacent pas ces preuves.

## Actualisation de la recette

- GitHub Actions run 44462059347 (commit 5e35d461) : contrôles applicatifs et suite SQL isolée réussis.
- Preview de sécurité READY : https://domdepannage-recette-20261112.vercel.app, déploiement dpl_G8TQpwy2NZj9PeLiq5AL1iCkxv9x. Rapport du mini : 35/35 contrôles administratifs, largeurs 1440 et 390, contrôle du refus client, aucune erreur JavaScript. Cela ne ferme pas tous les parcours des quatre rôles.
- Défaut tactile reproduit dans les fenêtres de profil natives. Ajout du pont RNHostView requis par Expo UI : Android vérifie la fermeture des fenêtres Adresses, Sécurité et Mes données et le lancement du navigateur par le lien du carnet. Le navigateur du simulateur affiche son premier démarrage : aucune gestion d’adresse web encore validée.
- iOS : après reproduction dans ios-sheet-fix-v2-20261119, le pont RNHostView et son enfant non aplati (collapsable=false) corrigent les appuis. XCTest ios-sheet-fix-v3-20261119 réussit : fermeture Adresses/Sécurité/Mes données, prénom vide interdit, fermeture du formulaire et déconnexion. Les nouveaux binaires ciblent l’alias de recette courant.

La demande du propriétaire de vérifier tous les parcours est suivie dans le plan complémentaire et la matrice des 76 capacités. Les brouillons commerciaux ne remplacent pas ces contrôles.

## Passe complémentaire des rôles natifs

Sur le binaire iOS reconstruit avec l’alias de recette courant et HOME_SUPPORT_PREVIEW=false, XCTest ios-three-roles-final-20261119 réussit pour client, artisan et entreprise : connexion, demandes/missions/devis/sites selon rôle, restauration de session après relance et déconnexion. La boîte système de sauvegarde du mot de passe est refusée par « Plus tard » ; aucun mot de passe n’est enregistré. Ces contrôles ne valident pas toutes les écritures métier natives.

Les correctifs web D1/D3/D4/D5 et la reprise réseau D2 sont documentés dans CORRECTIFS_PARCOURS_2026-11-19.md. Les tests GitHub du premier lot passent intégralement (run 206).
