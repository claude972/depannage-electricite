# Règlement sur place — preview65b, 1 novembre2026

App intégrée/poussée `65b77af9a0a4263ee78324be89e20b30ff69c269`, READY `dpl_GcBmwRXF8dkqvccVQR2Di1R3ZoGB`, publique https://depannage-electricite-9tkfx4ge7-brafas-projects.vercel.app . GitSource GitHub/refintegration/web-pwa exact, Flight `YU8RxvQCnh-wOUDL1rR_1`, exception publique ce seul déploiement. CI41337851150 deuxjobsSUCCESS. Suite intégrée1120PASS0FAIL, unHTMLoptionnel qualifié séparément55/55PASS0skip ; TypeScript strictPASS. Fondation/thème et routes existantes conservés.

## Parcours réel

Run `c114b680211d`, harnais privé V2 SHA256 `f29f0ba818727a0ebb101b0ed81353d3a30df4de37b1dcb7ced4fa9cdcf168a3`, contexte Chromium1280×900. **26/26 preuves PASS, exit0**. Trois comptes synthétiques (2clients,1artisan approuvé comme fixture QA), un dossier on_site créé via API authentifiée ; acceptation mission, brouillon privé, publication devis120€, accordclient, démarrage/fin et déclaration reçue par vrais clicsUI. Avenant30€ proposé/accepté via API des utilisateurs, explicitement horsUI. Montant serveur final150€, devis120€ inchangé, avenant accepté figé. Clientpropriétaire etclienttiers POST403 ; artisan avantaffectation404. Client ne peut jamais déclarer lui-même reçu.

Un clicUI (doubleclic tenté) émet une demande ; le harnais la transmet deuxfois concurrentiellement. DeuxHTTP200 cohérents puis replay200 : un reçu, un paiement/historique avec `method=on_site_declared` et référence `onsite:<jobUUID>`, un quota/audit de déclaration. Jobpaid/paid_at après déclaration artisan, distinct d'une preuve bancaire. Client voit « Déclaré reçu sur place ». Aucun transfert d'argent/SMS/email/provider effectué.

Cleanup terminé : trois suppressions financières exactes (reçu d'abord),24étapesB1PASS,26readbacks internes0, drain0/intentsréglés. **ROOT indépendant80/80PASS**,3Auth404 stricts(code404/error_codeuser_not_found/msgnonvide),74REST0,3préfixesStorage0, tousartifacts5hashes figés et relus après réseau. Aucune cohorte de ce run conservée. Preuves privées sous `/Volumes/Stockage/depannage-qa-private/onsite-received-connected-c114b680211d` ; aucun secret dansGit.

## Backend et vérifications bornées

Migrations024/025 puis026 appliquées par ROOT ;001–023 inchangées. 024 SHA256`140072986b7950103cb92beed0a3da3dfeb5c0f4ec3823faf880a584b51a0d4a`,025`56aae842ae8622091d7e3074dde90aab528882137095dbddc47b5be024c225b1`,026`2e33d78f3482b9c89d68747a10479c7e225e993d3c2c61a856e82cff0b5bb92d`. Root45readbacks ACL/RLS/search_path024–025 PASS ;026 metadata/gardes/ACL relus. 49assertions SQL024 et57SQL025 ;62SQL026, puis63 avec export optionnel de vraies lignes RPC locales. Factures cash/card produites sous PGlite→rendererPDF réel :1page/2lignes/150TTC/125HT/25TVA, inspection visuellelisible ; pas factureopérateur cloud. MultiTVA/plus30lignes/arrondis nonreprésentables/écarts paiements ou snapshots bloquent l'émission, explicationFR, jamais facture approximative.

Carte : capture exacte+transfertConnect+reprises idempotentes codés, compte/net/montants vérifiés serveur, flagsOFF. Tests provider injectés uniquement. SDK23.1.0 utilise API2026-10-28.endive ; testobserve header réel du constructeur avectransportfactice. P1partialcapture initialement soulevé en revue RETIRÉ après [changelogBasil officiel](https://docs.stripe.com/changelog/basil/2025-03-31/remove-refund-from-partial-capture-and-payment-cancellation-flow) : libération d'autorisation partielle n'ajoute plus amount_refunded. Tout remboursementréel/dispute/étatinconnu reste refusé ou àrevérifier. Pas capture/transfert bancaire réel qualifié tant que propriétaire diffère Stripe.

## Historique et limites

Run1e2a69aba431 resteINCOMPLETEexit3 : lecture financière multitable avant réponseUI pendantcommit, malgré deuxPOST200 ensuiteexactementvalidés. Cleanupok/root80PASS, originalconservé. V2 attend renduissu de la réponse déjàvalidée puis mêmesassertions ;132selfchecks et contre-revue indépendantediffcausalGO, pas changementproduitpourpasser. DeuxP2frontend (réponseancienneaprèschangementUID/montantsmalformés) corrigés et contre-revus28tests/2montages. CI d1f échec supportJSONhistorique conservé ; correctiontests-only conserveACL/périmètre/totaux et vérifie nouveauxchamps, CI525 puis65bverte.

SMS/Stripe différés restentOFF. Pas SuperAdmin réel/promotionsubstitut, paspreuveopérateurHTTP/UI, niGPSphysiqueiPhone/PWAveille/native/stores/production. BudgetB2B engagébasehorsavenants est un défaut distinct en correction027 ; ce rapport ne le clôtpas. Ni applicationcomplète ni zéroerreurannoncés.
