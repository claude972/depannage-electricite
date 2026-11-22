# Recette native du 18 novembre 2026

## Version et environnement

Code applicatif `1483d4b8`. La source mobile est identique à `e0526c1` ; le checkpoint documentaire Claude `7555820b` a été repris dans ce clone. Builds et simulateurs exécutés sur mini-brafa, Mac de Codex, avec fichiers et caches dédiés sur les volumes externes Stockage et Stockage 2.

API de recette : https://domdepannage-recette-20261112-bswte5fe6-brafas-projects.vercel.app. Contrôle direct HTTP 200 pour l’accueil, les prix indicatifs et le profil public. Comptes exclusivement synthétiques ; aucune transaction réelle.

## Correction du build Android

L’ancien APK `e0526c1` (SHA-256 `620214e841784d51346b1d4b52c687f8c34e3a10c9e249505c433f1d94d7a720`) était réellement installé, mais refusait la connexion : « L’environnement mobile n’est pas configuré ». Le bundle ne contenait pas la configuration Supabase requise. Cette cause est distincte des problèmes de mémoire observés précédemment.

Reconstruction avec les trois variables publiques validées, sans modification du code applicatif. Node officiel 24.15.0 utilisé : le Node embarqué dans ChatGPT refusait le chargement de Lightning CSS par validation de signature macOS. Aucune protection système modifiée.

Nouvel APK : `domdepannage-android-1483d4b8-configured.apk`, SHA-256 `85cc2ea648abae77a54678e313803ad532faa28308ce4fc2ac9f2ea3edb41c0d`. Certificat existant du projet, préfixe `ad0407ea`. APK installé relu intégralement : empreinte identique. Les trois variables publiques sont présentes dans le bundle.

## Résultats Android

| Contrôle réellement exécuté | Résultat |
| --- | --- |
| Lancement à froid et accueil invité | PASS |
| Client : connexion et onglets Profil/Demandes/Messages/Aide | PASS |
| Client : liste et détail INT-5B12D9, montant à régler 130,20 €, estimation initiale 80–180 € distincte | PASS |
| Artisan : connexion, onglets dédiés, missions et devis acceptés/refusés chargés | PASS |
| Entreprise : connexion, onglets dédiés, organisations et dossier INT-6C3682 à 162,75 € | PASS |
| Client, artisan, entreprise : session restaurée après arrêt complet et relancement | PASS |
| Client, artisan, entreprise : déconnexion et retour aux onglets invités | PASS |
| Entreprise : réseau coupé, erreur explicite, puis rechargement des conversations par Réessayer | PASS |

Wi-Fi et données de l’AVD réactivés après le test. Émulateur arrêté après la recette. Aucune disponibilité artisan, capacité, intervention ou configuration métier modifiée.

Limites : ces contrôles mobiles couvrent la lecture et la session. Ils ne prouvent pas les écritures de bout en bout, le paiement Stripe, le cloisonnement inter-organisations sur client natif, ni le comportement sur appareil physique. Les preuves web existantes restent qualifiées comme preuves web.

## iOS

Build Release simulateur réussi, exécutable et bundle présents, trois variables publiques vérifiées. Accueil rendu et capturé sur iPhone 18 Pro simulé (iOS 27.2). Le build initial non signé échouait dans Expo SecureStore lors de la connexion : entitlement manquant. Reconstruction avec signature locale ad hoc et équipe existante, sans création de certificat/profil. Recette XCTest client complète depuis l’état déconnecté : connexion, dossier INT-5B12D9, restauration après relancement et déconnexion PASS. Artisan : connexion, missions/devis acceptés, restauration et déconnexion PASS. Entreprise : connexion, dossiers, organisations/sites, restauration et déconnexion PASS. Exécution complète `ios-three-roles-v1` : XCTest réussi, trois rôles validés. Les itérations précédentes du pilote sont conservées comme diagnostics et ne sont pas comptées comme réussites. Le test utilise un jeu de simulateurs dédié via `-DVTSimulatorSetLocation`, sans modifier le jeu de simulateurs de l’utilisateur.

## Preuves et livrables

Racine locale : `/Volumes/Stockage/dev/Atelier/codex/depannage-finalisation-20261118`.

- `livraison/domdepannage-android-1483d4b8-configured.apk`.
- `preuves/native-build-manifest.json` et `preuves/android-recipe-result.json`.
- Arbres UI expurgés, captures, journaux de compilation et tests expurgés dans `preuves/`.
- Journaux XCTest bruts et résultats contenant potentiellement les identifiants synthétiques conservés privés hors Git.
- Archive iOS simulateur signée : `/Volumes/Stockage 2 /Atelier-Deux-Mac/codex-depannage-builds-20261118/livraison/DomDepannage-1483d4b8-ios-simulator-signed.zip` (SHA-256 `3b5a25a2fd6a36752e4e47af10b01f7e8b0c8ebcb408a6f3e74b9e3c0f893a54`).
- Build iOS : `/Volumes/Stockage 2 /Atelier-Deux-Mac/codex-depannage-builds-20261118/DerivedData/Build/Products/Release-iphonesimulator/DomDepannage.app`.

## Complément web : paiement Stripe TEST

Le propriétaire a confirmé précisément la soumission du compte Stripe TEST après son envoi prématuré par Claude ; cet incident et sa chronologie restent consignés dans FINALISATION_STATUS.md. Aucun nouvel envoi du formulaire.

L’alias https://domdepannage-recette-20261112.vercel.app pointe désormais sur la candidate `bswte5fe6` ; contrôle Codex indépendant : HTTP 200 et mêmes 17 scripts que la preview. Ancien déploiement conservé pour retour arrière.

Codex a soumis dans Chrome local le paiement fictif du dossier `INT-5B12D9`, sur une page Stripe explicitement « Sandbox · Environnement de test », pour 130,20 €, avec la carte de test officielle Stripe et des coordonnées synthétiques. Aucun moyen de paiement enregistré. Référence : https://docs.stripe.com/testing.

Contrôle après paiement par Claude : `payments`, `payment_attempts` et `interventions` à `paid`, 13 020 centimes EUR, horodatage `2026-11-19T00:04:09Z` (18 novembre 20:04 en Martinique). Événement `checkout.session.completed` enregistré ; trois appels webhook observés sans erreur HTTP. Dossier client à 390 et 1440 px : « Terminée et réglée », confirmation de 130,20 €, bouton Payer absent, zéro erreur JS. Rapport JSON et capture mobile relus par Codex. Ces preuves concernent le paiement web de test, pas un débit réel ni une nouvelle recette native.

## Dépendances encore ouvertes

GitHub : accès réparé. Le rechargement a révélé que seuls six dépôts étaient réellement autorisés ; ajout du seul dépôt depannage-electricite, sauvegarde, puis persistance à sept dépôts vérifiée. Le connecteur retourne désormais le dépôt avec droits pull/push. Le diagnostic précédent de cache était trop affirmatif. Le commit applicatif 1483d4b8 reste absent du dépôt distant (422), aucun push effectué à ce checkpoint. La commission TEST de 22,13 € (taux existant 17 %, non modifié) est confirmée dans Stripe : événement application_fee.created livré avec HTTP 200, puis présent dans stripe_financial_observations. Commission et transfert sont enregistrés en needs_review (fee_reference_not_bound / unlinked_transfer) : réception réussie, rattachement comptable non établi. Aucune facture ni écriture comptable créée manuellement.

Cause identifiée dans le code versionné : `match_stripe_financial_observation` (migration `20261107175422_stripe_financial_reconciliation.sql`) classe systématiquement les frais en `fee_reference_not_bound` et ne rapproche les transferts que via `guest_settlements.transfer_id`. Le paiement contrôlé suit `platform_checkout`, ce qui explique le transfert non lié ; aucune autre définition de cette fonction dans les migrations. Ce constat décrit la limite du rapprochement automatique existant, sans modifier les règles comptables.
