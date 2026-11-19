# DomDépannage — suivi de finalisation (Claude)

Mis à jour : 2026-11-18 soir (consolidation Stripe test + recette native Codex) — Claude Opus 5.5.

## Base et version testée

| Élément | Valeur vérifiée |
|---|---|
| Copie Claude | `/Volumes/Stockage/dev/Atelier/claude/depannage-electricite/repo`, clone isolé, push vers l'intégration désactivé |
| Branche / base | `claude/finalisation-20261114` depuis `b424c8d` (`codex/figma-responsive-20261114`) ; aucun commit plus récent dans l'intégration du mini |
| Travaux planning Codex non commités (MacBook) | non intégrés, non touchés |
| **Version candidate Web/PWA (18/11)** | commit **`1483d4b8`** — preview https://domdepannage-recette-20261112-bswte5fe6-brafas-projects.vercel.app : admin réel 35/35, PWA 22/22. Précédente : `af47bb72` (HEAD `076bfec9` : + tests seulement) — preview https://domdepannage-recette-20261112-77s96ixlc-brafas-projects.vercel.app (cible *preview*). Écart avec `e0526c1` : routes publiques en client anonyme (serveur uniquement). |
| **Version candidate mobile** | source `apps/mobile` identique de `04138064` à HEAD. APK `e0526c1` (API embarquée `lizw2oi45`, équivalente pour les parcours mobiles : le client mobile n'envoie jamais de cookie, il n'est donc pas concerné par le correctif public). iOS : Codex sur MacBook, même source. |
| Previews de la recette réelle | `4jadwewvm` (`15a9775`, parcours complet), `5sivte8w3` (`a382c28`, paiement), `fexnt9wgj` (`68b5646`, B2B) |
| Alias de recette | `domdepannage-recette-20261112.vercel.app` → `dpl_5HgGE477…` (12/11), **non modifié** |
| Backend des previews | Supabase `kcpyjzndybfdlnhvscbs` (URL publique lue dans le bundle ; aucune clé lue) |
| Comptes de recette réelle | comptes synthétiques `@example.test` d'Astra (13/11, `audit-20261113-astra/ui-accounts.private.json`) : client, artisan, tiers, entreprise, lecteur. Le compte « admin » a été rétrogradé en client par Astra (`super_admin: false`) |

Légende : **synthétique** = mode démo (localStorage, aucun serveur) · **réel** = Supabase de recette avec comptes synthétiques · **preview** = déploiement Vercel non aliasé.

## Tableau de suivi (version candidate `e0526c1`)

| Parcours | Web/PWA | iOS | Android | Preuve / version | Défaut restant |
|---|---|---|---|---|---|
| Accueil public | **vérifié** (320/390/768/1440, comparé à l'alias) | compilé (Release non signée, Codex) ; non exécuté | **vérifié** démarrage (émulateur API 36) | `comparatif-avant-apres-20261115.pdf`, `android-accueil-emulateur.png` | bandeau « 20 min » réservé aux builds de recette |
| Particulier : demande → offre → devis → refus → v2 → acceptation → intervention → clôture → accusé de réception | **vérifié réel** (`INT-5B12D9`) | à faire (appareil) | APK candidat : installation vérifiée, accueil/compte invités ; **connexion native non prouvée** (observation antérieure faite sur une build périmée) — à rejouer sur MacBook | `recette-reelle/log-s1…s5*.json`, `android-candidat-e0526c1/` | paiement : voir ci-dessous |
| Paiement plateforme | **paiement test PASS** (`INT-5B12D9`, 130,20 €, `cs_test_`, webhook → paid, 19/11) ; avant : refus serveur expliqué `a382c28` | — | — | `s5-pay-refused-explained-390.png` | transaction Stripe réelle **non testée** : nécessite un artisan de test avec compte Connect validé (mode test) |
| Entreprise : demande sur site → circuit d'approbation → acceptation → intervention → clôture | **vérifié réel** (`INT-6C3682`) | à faire | à faire | `recette-reelle/log-b*.json` | — |
| Entreprise : 12 vues ; lecteur (lecture seule, 403) ; cloisonnement (404 tiers/lecteur) | **vérifié réel** | à faire | à faire | `real-sweep`, `real-viewer`, `real-isolation` | — |
| Artisan : missions, devis, planning (écriture réversible), photos, compte rendu | **vérifié réel** | à faire | à faire | `real-art`, `real-plan`, `s2`, `s4*` | — |
| Admin | **vérifié isolé** : 77/77 tests routes + UI montée ; revues SQL pglite (tableau de bord 19/19, messagerie 20/20 ; ensemble des 92 revues `tests/sql-*review*.mjs` : 92/92, aucun saut, `preuves/admin-isole/sql-reviews-summary.txt`) ; preview candidate en démo : 14 vues à 390 et 1440, 0 erreur, 0 écriture serveur | à faire | à faire | `preuves/admin-isole/` | **réel bloqué** : aucun compte admin de recette autorisé (fixture Astra rétrogradée, non réactivée) ; approbation d'artisan non jouable en démo (dossier absent, refus attendu) |

## Correctif rapprochement automatique Checkout — recette 19/11 : PASS
Commit `ed22f0a5` (revu Codex, points 1–11b), déploiement `dpl_9qgdnBYFk6brxrFd7XoAEUGmAssm` (`5zggqivyj`) sous l'alias de recette, migration `20261119120000_checkout_provider_link` appliquée seule à la recette. Paiement `INT-5B12D9` rattaché par le nouveau bouton : transfert et Fee associés, `commission_withheld` unique 2 213 c, règlements 23 870 c sans doublon, rejeu `existing`, droits 403/401, admin 35/35. Le rapprochement automatique traite désormais les futurs paiements depuis le webhook signé. Rapport : `livraison/preuves/stripe-test/correctif-checkout/RAPPORT.md` ; technique : `docs/CHECKOUT_AUTOMATIC_RECONCILIATION.md`.

## Consolidation 18/11 soir — Stripe test et recette native

### Incident de procédure (à lire)
**Claude a cliqué « Accepter et envoyer » sur l'onboarding Stripe du compte connecté de TEST AVANT la confirmation spécifique demandée pour le propriétaire.** Cet envoi vaut, pour ce compte de test, certification des informations (synthétiques), acceptation du *Contrat de comptes connectés Stripe* et consentement aux SMS automatisés. Engagements déjà pris plus tôt dans le même parcours : conditions d'utilisation et politique de confidentialité Stripe (en continuant après le téléphone de test) ; autorisation de type mandat SEPA sur le compte bancaire **de test** Stripe. Aucune transaction, aucune donnée réelle, aucun nouveau compte. Depuis : aucune autre soumission ni modification de configuration.

### Stripe — état vérifié en lecture
- Mode **test** prouvé (sessions `cs_test_` postérieures à la dernière modification de la clé ; pages Stripe « [test] », « compte de test avec des données de test »).
- Compte connecté de test existant de l'artisan synthétique (`acct_…` enregistré le 16/11) ; onboarding **soumis** le 18/11 avec uniquement les aides officielles de test : téléphone et code de test, date 01/01/1901, adresse `address_full_match`, site `accessible.stripe.com`, « Utiliser le compte de test » (STRIPE TEST BANK, IBAN saisi par Stripe, non tapé). Aucun hCaptcha à résoudre dans le navigateur visible.
- Côté base, la règle de paiement (`Recipient account not ready` : artisan approuvé + `stripe_account_id` valide) est satisfaite. **État côté Stripe (capacités, vérification) non constaté** : lisible seulement avec la clé secrète (non utilisée) ou via un webhook ; aucun journal d'exécution Vercel dans la fenêtre de rétention (1 h).
- **Paiement test non lancé** (en attente de décision).

### Cause de la redirection vers l'ancien alias (lecture du code)
`appUrl()` (`lib/supabase/stripe.ts`) lit `NEXT_PUBLIC_APP_URL`, qui vaut dans l'environnement *preview* Vercel l'alias `domdepannage-recette-20261112.vercel.app` (version du 12/11, `dpl_5HgGE477…`). Toutes les adresses de retour Stripe en dépendent : onboarding Connect (`app/api/payments/connect/route.ts`), Checkout (`lib/features/payments/checkout.ts`), réautorisation d'empreinte, moyens de paiement enregistrés, empreinte invité, Web Push. Conséquence : retour sur l'ancienne version, sans la session de la preview (autre origine) → écran de connexion ; un paiement test lancé depuis `bswte5fe6` reviendrait aussi sur l'ancienne version. Options (décision du propriétaire, non appliquées) : promouvoir la candidate sur l'alias, ou fixer `NEXT_PUBLIC_APP_URL` pour une preview précise avant redéploiement.

### Suite 18/11 (après la consolidation)
- **Accord du propriétaire reçu APRÈS la soumission** : « oui soumettre ce compte de test » (contrat de comptes connectés et SMS), donné après le clic « Accepter et envoyer ». La soumission n'a pas été répétée.
- **Alias de recette déplacé (décision technique autorisée)** : `domdepannage-recette-20261112.vercel.app` → `bswte5fe6` (`dpl_8G1VYtXVqdkiicodD81DTJkx69FZ`, commit `1483d4b8`). Vérifié : l'alias sert les mêmes 17 scripts que `bswte5fe6` (empreinte `58b52063`, ≠ ancien `21b6d1ef`) ; route publique avec cookie invalide → 200 (correctif présent). Ancien déploiement conservé et « Ready » : `dpl_5HgGE477YoDeCreCL4TpQvtjV38X` (`…-8110o35yn-…`). **Retour arrière** : `vercel alias set domdepannage-recette-20261112-8110o35yn-brafas-projects.vercel.app domdepannage-recette-20261112.vercel.app`. Conséquence voulue : `NEXT_PUBLIC_APP_URL` (= alias) renvoie désormais les retours Stripe vers la candidate.
- **Paiement test `INT-5B12D9` : PASS (mode test, 19/11 00:04 UTC).** Carte de test officielle 4242 saisie par Codex (Chrome local, aucun moyen enregistré) sur la session `cs_test_` ouverte par Claude ; retour vers l'alias candidat (`payment=pending`, puis connexion faute de session locale). Vérifié en lecture par Claude : 3 `POST /api/payments/webhook` sur l'alias à 00:04:07–00:04:12 UTC, 0 réponse 4xx/5xx sur `/api/payments` ; `stripe_events` = `checkout.session.completed` (00:04:09) ; `payments`, `payment_attempts` et `interventions` = **paid**, 13 020 c EUR, `paid_at` 00:04:09 UTC, `failure_code` nul. Particulier (390/1440) : « Terminée et réglée », « Ce dossier est réglé sur la plateforme », 130,20 €, bouton Payer absent, 0 écriture, 0 erreur. Non créés **par conception** : écriture `payment_settled` (rapprochement admin `finance_write`) et facture plateforme (émission admin). **Commission (conclusion corrigée)** : instantané `platform_checkouts` `fee_bps` 1700 / `fee_cents` 2 213. Preuve Codex (`livraison/commission-stripe-codex.json`, tableau de bord Stripe sandbox) : `application_fee.created` `evt_1UdIpk…`, 2 213 c EUR, `livemode` false, livré au webhook de l'alias avec **200** à 20:04:13 AST. Vérifié en lecture par Claude dans `stripe_financial_observations` (distincte de `stripe_events`, alimentée par `ingest_stripe_financial_observation`) : l'événement est **observé** (00:04:13 UTC, 2 213 c EUR) ainsi que `transfer.created` (00:04:11 UTC, 13 020 c EUR), mais **les deux sont en `needs_review`** — motifs `fee_reference_not_bound` et `unlinked_transfer`, sans `quote_id` / `intervention_id` / `settlement_id`. Donc : commission livrée et reçue ; **rattachement automatique au paiement non obtenu → revue manuelle requise, rapprochement automatique non prouvé** (cause à analyser : liaison frais/transfert ↔ paiement dans le modèle de charge à destination). Aucun rejeu, aucune modification, aucun taux changé, aucune facture créée. Preuves `livraison/preuves/stripe-test/` (`paiement-test-INT-5B12D9.json`, captures 01–03).
- *Historique* — **Paiement test `INT-5B12D9` — démarré, non finalisé** : particulier synthétique sur l'alias → « Payer 130,20 € sur la plateforme » → `GET /api/payments/link` 200, `POST /api/payments/checkout` 200 → Stripe Checkout « Sandbox · Environnement de test », session `cs_test_…`, 130,20 €. Serveur (lecture) : `payments` et `payment_attempts` = `pending`, 13 020 c EUR, `cs_test_`, `paid_at` nul. **Saisie de la carte de test non faite par Claude** (règle : pas de saisie de carte, même de test, sur un environnement hébergé) : page ouverte dans le navigateur visible ; lien privé `/Volumes/Stockage/depannage-qa-private/claude-20261116/checkout-int-5b12d9.private.txt` (600). Reprise propriétaire : carte de test Stripe 4242 4242 4242 4242, date future, CVC quelconque, e-mail synthétique, sans cocher « Enregistrer mes informations » ; puis Claude vérifie le retour et le statut serveur (`paid`).
- **GitHub** : accès enregistré par le propriétaire, connecteur toujours en 404 ; reconnexion demandée au propriétaire. Aucune action GitHub par Claude.

### Rapprochement du paiement test `INT-5B12D9` (19/11, via l'interface existante)
- **Portes ouvertes temporairement, puis refermées** : SQL `charge_proof_private.control.enabled` (true → false) et variable *preview* `STRIPE_CHARGE_PROOF_ENABLED=true` (ajoutée puis supprimée) ; mode live inchangé. Redéploiement du même code (`a06g6yjg0`, `dpl_BDC9ukjf…`, provenance « Redeploying `dpl_8G1VYtXV…` » = `bswte5fe6`, sources listées identiques 206/206), alias vérifié avant usage, puis **alias rendu à `bswte5fe6`**. Aucune double authentification requise par ces routes ; aucun facteur MFA créé, aucun autre admin utilisé.
- **Preuve de charge : QUALIFIÉE** (UI Finance › Preuves, admin synthétique) — mode test, `ch_3UdIpe…`, 13 020 c, commission figée 2 213 c, compte `acct_1UcWCT…`, 00:44:15 UTC.
- **Preuve de commission : QUALIFIÉE** — `fee_1UdIpi…` 22,13 €, remboursé 0,00 €, Charge plateforme `ch_3UdIpe…` / connectée `py_1UdIph…`, 00:45:56 UTC.
- **Ledger des règlements : RAPPROCHÉ** par le bouton normal « Rapprocher les règlements » après vérification du périmètre (2 paiements test synthétiques) : `payment_settled` 13 020 c (`INT-5B12D9`) et 10 850 c (`ae5ff8…`, « Demande de recette Stripe uniquement »). Pas d'estimation de commission (taux non configuré).
- **Idempotence** : 2ᵉ qualification charge et commission → 1 preuve chacune, horodatages inchangés ; 2ᵉ rapprochement → toujours 2 écritures.
- **Transfert** : `transfer.created` `tr_3UdIpe…` comparé en lecture — charge source = Charge prouvée, destination = compte Stripe exact de l'artisan du dossier, 13 020 c EUR, test, sans reprise (`reversed` false, 0). Note factuelle auditée via « Enregistrer une revue » (version 1 → 2, sans forçage) ; **résultat historique conservé `needs_review / unlinked_transfer`** : le rapprochement automatique ne prend pas en charge les transferts Checkout.
- **À distinguer** : la commission est **qualifiée** (preuve relue chez Stripe) mais **pas inscrite au ledger** — aucune écriture `commission_withheld` (non créée directement, conformément à la consigne) ; l'observation `application_fee.created` reste `needs_review / fee_reference_not_bound`. Aucun nouveau paiement, remboursement, transfert ni facture. Preuves : `livraison/preuves/stripe-test/paiement-test-INT-5B12D9.json` et `finance-ui/`.

### Recette native (Codex, mini-brafa) — rapport `livraison/RETOUR_CODEX_20261118.md`
- Nouvel APK `domdepannage-android-1483d4b8-configured.apk` (racine Codex `/Volumes/Stockage/dev/Atelier/codex/depannage-finalisation-20261118/livraison/`), SHA-256 `85cc2ea648abae77a54678e313803ad532faa28308ce4fc2ac9f2ea3edb41c0d`. **Contrôle Claude indépendant (lecture)** : empreinte identique, `verify-mobile-bundle.sh` 4 × OUI (API `bswte5fe6`, projet Supabase, clé publique `a8d31a3c…`, aucune clé secrète), certificat `ad0407ea`.
- Android (rapport Codex) : accueil, connexion et onglets par rôle client / artisan / entreprise, dossiers `INT-5B12D9` (130,20 €) et `INT-6C3682` (162,75 €), restauration de session après relance, déconnexion vers onglets invités, coupure réseau puis « Réessayer » : PASS.
- iOS (rapport Codex) : build Release simulateur configuré (3 variables vérifiées), signature locale ad hoc (entitlement SecureStore), XCTest `ios-three-roles-v1` trois rôles PASS ; build : `/Volumes/Stockage 2 /Atelier-Deux-Mac/codex-depannage-builds-20261118/DerivedData/Build/Products/Release-iphonesimulator/DomDepannage.app`.
- Limites déclarées par Codex : lecture et session seulement ; pas d'écritures de bout en bout, de paiement, de cloisonnement inter-organisations natif ni d'appareil physique. L'APK `e0526c1` reste non configuré et ne doit plus être utilisé.

## Checkpoint 18/11 — à lire en premier
- Dépôt `/Volumes/Stockage/dev/Atelier/claude/depannage-electricite/repo`, branche `claude/finalisation-20261114`, HEAD `1483d4b8` (+ ce commit de statut). `origin` = clone local d'intégration, push désactivé (non modifié) : lire le dépôt directement.
- **Admin réel (16–18/11) : PASS 35/35** sur `bswte5fe6`. Compte synthétique dédié `audit-claude-admin-…@example.test` créé sur la recette (`kcpyjz…`) avec l'accord du propriétaire, promu admin par SQL avec entrée d'audit ; identifiants : `/Volumes/Stockage/depannage-qa-private/claude-20261116/admin.private.json` (600). 14 vues × 390/1440 sur données réelles, 0 erreur ; recherche `INT-5B12D9` / `INT-6C3682` → 1 dossier chacun, fiches ouvertes (130,20 € / 162,75 €, « À régler ») ; particulier refusé sur 5 routes admin (403/404). Aucune action d'écriture admin sur les données d'autrui. Écrans plateforme lus sans MFA ; actions plateforme (MFA aal2) non testées. Preuves `livraison/preuves/admin-reel-bswte5fe6/`.
- **Défaut corrigé `1483d4b8`** : la recherche admin « INT-… ou ville » ignorait la référence `INT-XXXXXX` (0 résultat) ; filtre par plage d'identifiants, test (échoue sans le correctif) ; vérifié en ligne.
- **PWA : PASS 22/22** rejouée sur `bswte5fe6` (`livraison/preuves/pwa-bswte5fe6/`).
- **Android (mis à jour, voir « Consolidation 18/11 soir ») : APK `1483d4b8` configuré, recette native Codex PASS en lecture/session ; l'APK `e0526c1` est **non configuré** (variables Supabase absentes du build local ; constat mini-brafa : « L'environnement mobile n'est pas configuré »). Recette de build, fichier privé des variables publiques, garde-fou `verify-mobile-bundle.sh` (3 × NON sur cet APK) et script de signature : `livraison/transfert-macbook/LISEZMOI.md` §0. Reconstruction en cours côté mini-brafa (clone isolé Codex).
- **iOS** : `build-ios/` du mini = tentative échouée (inexploitable). Seul build valide : MacBook Codex (`04138064`, non signé), probablement non configuré lui aussi → vérifier avec le garde-fou. Chemins exacts dans le LISEZMOI.
- **Stripe : mode TEST prouvé** (clé modifiée le 12/11 17:06:59 UTC ; sessions `cs_test_` créées après, aucune `cs_live_` ; page Stripe : « Vous utilisez un compte de test avec des données de test »). Compte connecté de test créé pour l'artisan synthétique (`acct_…` enregistré). **Bloqué par un hCaptcha** sur l'onboarding Stripe : non résolu (interdit). Reprise manuelle : se connecter en artisan synthétique sur `bswte5fe6` (identifiants `ui-accounts.private.json`, rôle `artisan`), Profil → « Configurer mes règlements Stripe » (réutilise le compte existant, génère seulement un nouveau lien, l'ancien expire en quelques minutes), compléter le hCaptcha et les écrans avec les boutons « données de test » de Stripe, sans accepter de conditions réelles. Ensuite seulement : rejouer « Payer » sur `INT-5B12D9` en mode test.
- **Tests locaux (mini)** : binaires natifs du dépôt (`esbuild`, `fsevents`) bloqués à `_dyld_start` par la vérification de signature macOS depuis le redémarrage du 16/11 (aucune protection désactivée). Contournement sans effet sur le dépôt : `ESBUILD_BINARY_PATH=/Users/claudebrafa/rea/node_modules/@esbuild/darwin-arm64/bin/esbuild node --import ./node_modules/.cache/claude-tests/register.mjs --test <tests>`. Typecheck propre ; tests ciblés PASS ; suite complète non relancée depuis.

## Recette Web/PWA complémentaire — preview `77s96ixlc` (réel, comptes synthétiques) — 15/11 soir : **22/22 PASS**
Script reproductible `livraison/transfert-macbook/scripts/pwa-recette.mjs` ; journal et captures `livraison/preuves/pwa-77s96ixlc/`.
- Manifeste (`standalone`, `start_url`/`scope` `/`, icônes 192/512/maskable en 200), balises `manifest`/`theme-color`/`apple-touch-icon` : PASS.
- Service worker activé ; cache limité à `offline.html`, `offline-request.html`, `offline-request.js` ; navigation hors ligne → page publique « La connexion est indisponible » ; note locale hors ligne ; `/api/*` jamais servie depuis le cache : PASS.
- Reprise réseau (visiteur) : accueil complet avec **WhatsApp et « Appelez-nous »** : PASS.
- Rechargement sur vue profonde (particulier `#requests`, entreprise et lecteur `#requests`, artisan `#missions`) : vue et session conservées : PASS.
- Coupure réseau connectée (4 rôles) : bannière « Connexion interrompue… », pas de page blanche ni de déconnexion ; au retour, chaque bloc revient par « Réessayer » (1 clic particulier/artisan, 5 entreprise/lecteur), 0 alerte résiduelle, 0 erreur JS : PASS. *Limite connue (non bloquante)* : pas de relecture automatique au retour du réseau, conforme à la règle « aucune action rejouée automatiquement » ; amélioration possible : marquer les réessais de **lecture** pour les relancer sur l'événement `online`.
- Session expirée / révoquée (cookies altérés) : message « Votre session a expiré. Reconnectez-vous… » ou « Connectez-vous pour accéder à cet espace », aucune donnée privée : PASS.
- **Défaut trouvé et corrigé (`af47bb72`)** : avec une session révoquée, `/api/public/indicative-prices` et `/api/public/operator-profile` répondaient **403** (le cookie invalide était transmis à PostgREST) → l'accueil public perdait tarifs et informations exploitant. Correctif : `publicClient()` anonyme pour les 4 lectures publiques (fonctions accordées à `anon`, sans dépendance à l'utilisateur). Vérifié sur `77s96ixlc` : 200/200 après révocation et expiration. Test `tests/public-routes-anonymous.test.ts` (échoue sans le correctif, passe avec).

## Mobile — preuves CODE (≠ recette native)
`tests/mobile-session-network.test.ts` (5/5) + `tests/mobile-session-navigation.test.ts` (3/3) : jeton Bearer uniquement vers l'origine API configurée, jamais de cookie ni de redirection ; visiteur sans en-tête d'autorisation ; perte réseau / abandon / délai 20 s / réponse incomplète → messages explicites ; 401/403/503 → motif serveur affiché ; restauration (stockage sécurisé, rafraîchissement piloté par l'état de l'app, messages d'échec), déconnexion locale avec oubli des reprises, pile remontée par compte, aucune lecture d'un autre compte affichée, onglets par rôle (jamais le menu invité une fois connecté). *Limite* : un 401 serveur sur mobile affiche le motif sans déconnecter automatiquement (l'utilisateur garde « Se déconnecter ») — non modifié pour ne pas diverger de la source des builds candidates. **La recette native connectée reste à jouer** (voir transfert MacBook).

## Recette métier réelle (Supabase de recette, comptes synthétiques, dossiers « AUDIT SYNTHETIQUE ») — 15/11

Scripts : `livraison/scripts-recette/` (lib.mjs + s1…s5, b1…b9, cleanup). Preuves : `livraison/preuves/recette-reelle/` (captures + journaux JSON `log-*.json`).

### Particulier ↔ artisan — dossier `INT-5B12D9` (`5b12d947-…`) : **PASS (hors paiement)**
| Étape | Résultat |
|---|---|
| Demande (390 px) : champs vides refusés, récapitulatif avec fourchette 80–180 € « pas un prix garanti », règlement « après intervention », double clic → 1 seul POST, 1 seul dossier | PASS |
| Artisan (1440) : disponibilité activée, offre anonymisée (« 972** », sans adresse ni description), prise en charge → adresse visible | PASS |
| Devis v1 150 € HT + TVA 8,5 % = 162,75 € TTC ; tiers → accept 403 | PASS |
| Refus client : motif < 5 caractères refusé ; refus enregistré (serveur `rejected`) | PASS serveur — **défaut UX trouvé** (message générique, artisan sans motif) → corrigé `97d87d0` |
| Devis v2 120 € HT = 130,20 € ; acceptation ; serveur `accepted:13020`, v1 `rejected:16275` | PASS |
| Démarrage avec confirmation ; « Terminer » désactivé tant que compte rendu + photos avant/après manquent | PASS |
| 2 photos privées + compte rendu → clôture `completed` ; tiers → signature 403 ; accusé de réception signé par le client | PASS |
| Paiement « Payer 130,20 € » | **Refusé par le serveur** : `Recipient account not ready` (compte Stripe Connect de l'artisan de test non validé). Aucune session de paiement créée, aucun débit. Message trompeur « Actualisez la page » → corrigé `a382c28`, rejoué en réel PASS. Mode du fournisseur (test/live) **non observable** sans session ; aucun paiement tenté. |

### Entreprise avec approbation — dossier `INT-6C3682` (`6c3682c7-…`), site « office » : **PASS**
| Étape | Résultat |
|---|---|
| Règle d'approbation (> 100 € TTC, propriétaire) créée par l'interface | PASS (désactivée ensuite) |
| Demande entreprise sur le site ; artisan : prise en charge + devis 162,75 € | PASS |
| Le site a un **circuit avancé** actif : la liste « simple » est vide à juste titre ; chronologie « Approbation en attente » | PASS |
| Acceptation avant approbation → serveur 409 | PASS serveur — **message trompeur** « Actualisez » → corrigé `68b5646`, rejoué en réel PASS (« doit d'abord être approuvé dans le circuit… ») |
| Soumission au circuit ; rejet sans commentaire bloqué (message rendu `role=alert` + lié au champ, `68b5646`) ; lecteur : aucune commande | PASS |
| Étape approuvée (« ce n'est pas une acceptation ») → « Accepter le devis » → serveur `accepted:16275` | PASS |
| Démarrage, 2 photos, compte rendu, clôture `completed` | PASS |
| **Défaut trouvé** : demande entreprise sans site → dossier personnel invisible des listes de l'organisation, non annulable dans l'espace | corrigé `22e5b60` (site obligatoire + site actif présélectionné), vérifié en réel |

### Nettoyage
- Dossiers de test ouverts **annulés** : `681ab977-…` (sans site, annulé via l'API par son propriétaire de test), `02599580-…` (B2B en attente). Dossiers terminés conservés comme preuves : `5b12d947-…` (INT-5B12D9, « À régler »), `6c3682c7-…` (INT-6C3682).
- Règle d'approbation de test désactivée ; artisan de test remis « non disponible » (état initial).
- Aucune suppression de données ; aucun compte créé ni élevé.

### Corrections issues de la recette réelle
- `97d87d0` — confirmations explicites par action, devis refusé expliqué au client, bandeau artisan + lien vers le motif ; test `quote-refusal-revision` (390/1440).
- `a382c28` — refus de paiement connus expliqués (« Rien n'a été débité ») ; test `checkout-refusals`.
- `68b5646` — « approbation requise » au lieu de « actualisez » ; message de commentaire du circuit accessible ; test `approval-refusals`.
- `22e5b60` — site obligatoire et présélectionné dans l'espace entreprise ; test `enterprise-request-site`.

## Corrections concrètes (commits)
1. `bd77d50` — Espace particulier mobile : menu ☰ restauré (paramètres, aide, assistance, déconnexion inaccessibles < 1024 px ; régression liée au retrait du logo/thème). Vérifié synthétique **et réel**.
2. `0593a98` — `Alerts` partagé : message hors champ ramené à l'écran ; dossier sans artisan sans bouton « Contacter ».
3. En-tête public compact (121 → ≤110 px à 320–939 px ; ≤76 px desktop).
4. `6c270f7` — En-tête admin mobile harmonisé.
5. `7da0632` — Mobile : titres d'en-tête natifs en Jakarta Medium.
6. `bd58833` — Planning artisan : suppression du retrait natif de 40 px de la liste des jours (cartes 696 → 736 px à 768).
7. `a03a864` — **WhatsApp arrimé à droite du menu flottant** (< 1024 px, espace particulier + pages publiques secondaires) : il ne recouvre plus les actions de la page (« Contacter »…). Accueil (Appelez-nous + WhatsApp) et desktop inchangés. Nouveau test `whatsapp-dock` (320/390/768, défilement complet).
8. `15a9775` — Frise d'étapes du dossier contenue dans sa carte à 320 px (césure française « Interven-tion »).
9. Tests UI périmés réalignés (dont `399c5a3`) — aucun test supprimé.

## Tests réellement passés
- Typecheck web et mobile : OK. `npm run build` : OK.
- `npm test` complet : 2 357/2 372 en parallèle sur `7da0632` ; échecs rejoués séquentiellement : tous PASS. Après les corrections de la recette réelle, suite élargie 2 503/2 508 (2 échecs hors périmètre, **résolus** le 15/11 : `restore-drill.test.mjs` PASS avec `PGLITE_MODULE` (pglite 0.5.13 installé hors dépôt, procédure `docs/QA.md`, aucune dépendance ajoutée) ; `notification-center-pages` : attentes fixes remplacées par « délai + DOM stable » (plafond 4 s), 1/1 seul et 8/8 en parallèle). Nouveaux tests : `quote-refusal-revision`, `checkout-refusals`, `approval-refusals`, `enterprise-request-site`, `whatsapp-dock`.
- Recette réelle sur la preview candidate `lizw2oi45` : client/artisan/entreprise/lecteur × 390/1440 → connexion, espace, déconnexion, 0 erreur API, 0 erreur de page ; WhatsApp arrimé (69 positions, 0 écart).
- Android : **rectification** — la connexion réelle du particulier observée le 15/11 (~04:30, liste, détail `INT-5B12D9`) s'est faite sur une build **antérieure à `bd48db0d`** restée installée (installation masquée), pas sur l'APK `04138064` : elle ne vaut pas preuve pour la candidate. APK candidat `e0526c1` : installation vérifiée + accueil/compte invités PASS ; connexion native **non prouvée** à ce jour.
- Suite complète sur `af47bb72` (15/11 soir, `--test-concurrency=4`, avec `PGLITE_MODULE`) : 2 377/2 385, 2 sautés (Chromium absent n'est jamais compté PASS), 6 échecs : 5 dus à la charge, PASS en séquentiel (`admin-history`, `admin-settings-coverage`, `artisan-performance-mounted`, `provider-teams-browser`, `site-records`/`enterprise-overflow`), 1 test statique réaligné sur `e0526c1` (`explicit-tax-ui`, 7/7). + `public-routes-anonymous` 2/2, `mobile-session-network` 5/5.

## Distribution (inventaire en lecture seule)
- **iOS** : Mac mini — 1 identité valide « Apple Distribution » (équipe `24U98C9WKS`) ; le seul profil local concerne une autre application (KNOWROK), inutilisable. Les identifiants DomDépannage (certificat, profil ad hoc, iPhone de test) sont **sur Expo** (`claude972`, `credentialsSource: remote`, `--freeze-credentials`). MacBook : compile mais 0 identité locale. Voie sans crédits cloud : `eas build --local --profile device` sur le MacBook (récupère les identifiants Expo existants) — à exécuter par Codex (contrôle iOS). Aucun certificat créé ni renouvelé.
- **Android** : keystore du projet existant (même fichier dans 3 copies, empreinte `510ac251…`). APK interne signé avec ce keystore : `livraison/domdepannage-android-interne-04138064-keystore-projet.apk` (SHA-256 `6ad24d74…`), **même certificat que l'APK interne Codex précédent** (`ad0407ea…`) → s'installe en mise à jour. Identifiant `.preview` : **distribution interne uniquement**, aucune soumission Play (exigerait un AAB et l'accès Play Console).

## Incident Vercel « mobile » — audité puis restreint (15/11)
- `mobile-roan-omega.vercel.app` est **public** (200 sans authentification sur `/app.json`, `/eas.json`, `/src/lib/config.ts`) ; les deux autres URL redirigent vers l'authentification Vercel (protection standard, qui ne couvre pas ce domaine de production).
- 184 fichiers exposés, identiques à la copie locale : 160 sources suivies de `apps/mobile` + 24 icônes de cache. Absents : `credentials.json`, `.jks`, `.env`, `android/`, `ios/`. Variables du projet : 0.
- Recherche de secrets sur le contenu exact (Stripe, JWT, Supabase, PEM, AWS, Google, GitHub, Expo, affectations password/token) : **aucun**. Exposition : code source propriétaire, identifiants publics Expo/app.
- **Restriction appliquée le 15/11 (autorisée)** : projet `mobile` (`prj_bMnxe0221GYLhNkw3pGxnZV9PMfE`, identité revérifiée : nom `mobile`, 1 déploiement `dpl_ANjPdfjSuCdZLDWHwHh7dyPb5GM3`) **mis en pause** (gratuit ; la protection « All Deployments » est une option payante). Vérification sans authentification : les 3 domaines × 6 chemins (`/`, `/app.json`, `/eas.json`, `/src/lib/config.ts`, `/README.md`, `/package-lock.json`) → **503 `DEPLOYMENT_PAUSED`**, aucun contenu. Recette légitime : alias 200, preview candidate `lizw2oi45` 200 (non touchées). Rien supprimé. Retour arrière : `unpause_project` / Vercel → mobile → Settings → Resume. Suppression définitive : décision du propriétaire. Détail : `livraison/preuves/incident-vercel-mobile/audit-20261115.md`.

## Accès vérifiés (lecture seule, 15/11 soir)
- Admin : le compte « admin » du fichier synthétique se connecte mais son rôle serveur est **`client`** (rétrogradé) → aucun accès admin réel autorisé ; non élevé.
- Stripe : variables de recette présentes par leur nom (clé secrète, secrets de webhook, pays Connect, garde-fou `STRIPE_LIVE_PAYMENTS_ENABLED`), valeurs non lues (mode test non confirmé par lecture). L'artisan synthétique est approuvé mais n'expose aucun compte Connect ; l'activer passe par `POST /api/payments/connect`, qui **crée** un compte connecté Stripe → nécessite une autorisation explicite (création de compte), non faite.

## Transfert MacBook
`livraison/transfert-macbook/LISEZMOI.md` : APK et empreinte, versions SDK/AVD/JDK/Gradle relevées, création d'AVD, rejeu borné (`android-install-verify.sh` puis `android-login-recette.py` paramétrable par `ACCOUNTS`/`ROLE`), résultats attendus par rôle, déconnexion et restauration.

## Restant / blocages exacts
- **iOS** : compilation résolue (Codex, Xcode 26.5) ; restent build signé ad hoc avec les identifiants Expo existants, installation sur l'iPhone de test inscrit, recette native.
- **Admin réel** : besoin d'un compte admin de recette autorisé (périmètre limité). Test à exécuter : connexion admin → candidatures (approuver / demander des corrections) → interventions (réaffecter avec motif) → devis & factures → modération d'avis → paramètres ; vérifier les refus pour un non-admin.
- **Paiement Stripe** : nécessite un artisan de test avec compte Connect validé en mode test ; alors rejouer « Payer » sur `INT-5B12D9` jusqu'à la page Stripe test (sans carte réelle) et le retour.
- **Android natif** : connexion native à rejouer sur MacBook/appareil (instructions `livraison/transfert-macbook/`).
- **Android natif — barre invitée après connexion : diagnostiquée, pas un défaut du code.** Les captures (`preuves/android-nav/`) montrent la liste particulier titrée « Activité », titre supprimé par `bd48db0d` (13/11) : l'émulateur exécutait une build antérieure à la navigation par rôle (`054def8b`). Cause probable : `adb install -r … | tail -1` a masqué un échec d'installation (certificat différent), l'ancienne app est restée. Source actuelle vérifiée : le menu dérive de la session (`spaceTabs`), pile remontée à la connexion. Garde-fous : `tests/mobile-session-navigation.test.ts` (3/3) et `livraison/scripts-recette/android-install-verify.sh` (échec si l'installation échoue ou si le bundle installé ≠ APK). **Rejeu sur l'APK candidat (15/11, après arrêt du Simulator inutilisé — aucun appareil démarré, aucune session active)** : installation vérifiée par le script (**PASS**, bundle installé = APK), accueil et compte invités rendus (**PASS**) ; **connexion non aboutie pour cause d'environnement** (hôte 8 Go, swap 7,6/8 Go : ANR de l'app puis des services Google de l'émulateur, appui non traité) ; émulateur arrêté. Preuves et scripts : `livraison/preuves/android-candidat-e0526c1/`. Reste : rejouer la connexion sur appareil réel ou MacBook 16 Go.
- **Version unique** : APK Android candidat reconstruit (`BUILD SUCCESSFUL in 26m 21s`) sur `e0526c1`, bundle pointant vers la preview `lizw2oi45` (vérifié dans `index.android.bundle`), signé avec le keystore du projet : `livraison/domdepannage-android-interne-e0526c1-candidate.apk`, SHA-256 `620214e841784d51346b1d4b52c687f8c34e3a10c9e249505c433f1d94d7a720`, certificat `ad0407ea…` (distribution interne). Recette native connectée de cet APK précis non rejouée (émulateur saturé) ; celle de l'APK `04138064` couvre le même code mobile. iOS Codex compilé sur `04138064` : même source mobile (aucun changement sous `apps/mobile` depuis).

## Préparation commerciale — 19/11 (Claude)
- Test monté React du bouton « Relancer le rattachement » : `tests/ui/checkout-relink-mounted.test.ts`, 2/2 PASS (Chromium local, StrictMode), 4 mutations des gardes détectées.
- Audit lecture seule de la configuration commerciale et de l'exploitation déployées : `livraison/AUDIT-COMMERCIAL-EXPLOITATION-20261119.md`. Constat principal : rien de commercial n'est publié (identité exploitant, garantie, zone desservie : `null`) ; barème de référence non validé ; aucune variable de production, aucun domaine commercial, aucun envoi email/push configuré ; portes fermées (preuves, barème, abonnements, notifications). Blocages listés pour le propriétaire ; rien d'inventé, Stripe live non activé.

## Correctif sécurité et recette des rôles — 19/11 (Claude)
- Next 16.4.3 → 16.4.6 (fichiers package de Codex, commit 214ec0d2) déployé en preview `dpl_G8TQpwy2NZj9PeLiq5AL1iCkxv9x` (qeqpc4bbs), alias de recette déplacé après smoke public/finance et admin 35/35 : `livraison/DEPLOIEMENT-SECURITE-RESULTAT-20261119.md`.
- Recette Web/PWA des quatre rôles sur ce candidat (6 comptes synthétiques, 390/1440 ; parcours particulier→artisan et entreprise de bout en bout, sans paiement) et rapprochement avec les 76 capacités : `livraison/RECETTE-WEB-PWA-ROLES-20261119.md`. Web : PASS 9, PARTIEL 32, BLOQUÉ 6, DÉSACTIVÉ 2, NON VÉRIFIÉ 27. Défauts D1–D5 consignés, non corrigés (aucune modification runtime demandée).

## Recette Web — suite et correctifs D1–D21 — 19/11 (15:16 UTC)
**Candidat de recette courant**
- `dpl_4fH2yFC1WHEQPb6x9eb3r5sf9pYi` (n2scdfas8, commit `34e6558f`), cible preview.
- Alias `domdepannage-recette-20261112.vercel.app`.
- Aucune production, aucun LIVE.

**Correctifs Codex intégrés à l'identique et vérifiés en ligne :** D1–D6, D9, D10, D11, D13, D15, D16 (+ largeur), D18, D19.

**D21 (pause de délai future)**
- Écrit ici : commit `ab4e0d5a`.
- Relu par Codex.
- Migration `20261119140000` appliquée sur la recette seule.
- Refus HTTP vérifiés sans mutation.

**Capacités prouvées côté Web dans ce lot, avec limites écrites**
- ART-03, CLI-02, CLI-04, ADM-03, ENT-02 / SYS-03 ;
- ENT-05, ENT-08, ENT-09, ENT-10, ENT-11, ENT-14, ENT-15 ;
- CLI-10, ADM-06, ADM-07 ;
- FIN-06, sur INT-44B1D4 en TEST.

**Capacités partielles :** ART-05, ADM-02, ENT-04, ENT-06, ENT-07, ENT-13, SYS-05, SYS-08.

**Capacités bloquées par le moyen de test :** PUB-07 et ART-02 (confirmation par e-mail).

**Sans preuve Web à ce stade**
- FIN-01, 03, 04, 05 et ART-11 ;
- ENT-16 ;
- ART-12 ;
- PUB-04, 05, 10 ;
- CLI-05.

L'application n'est pas déclarée complètement fonctionnelle.

**Rapports dans `livraison/`**
- `RECETTE-WEB-SUITE-INTERMEDIAIRE-20261119.md` (v4)
- `DEPLOIEMENT-PARCOURS-RESULTAT-20261119.md`
- `RAPPROCHEMENT-INT-44B1D4-20261119.md`
- `CORRECTIF-D21-PAUSE-SLA-20261119.md`

Preuves : `livraison/preuves/recette-web-suite-20261119/`.

### Mise à jour 15:50 UTC
- **Candidat courant :** `dpl_9gyPq1kJRNXMqzaZvC3gq5FJGEjB` (nn2dylxph, commit `b9002dd9`), aliasé.
- **Ajouts :**
  - D23 (Codex) ;
  - correctifs UX O1, O2, O3, O7 et O10 (Claude), vérifiés en ligne.
- **Finance Web :**
  - FIN-03, retour sans paiement : PASS ;
  - droits de règlement : PASS.
- **Limite d'outil :** aucun paiement par carte saisi par Claude sur le Web. FIN-01 (Web), FIN-04 et ART-11 restent sans preuve Web. FIN-05 et ENT-16 sont bloqués par l'émetteur de factures non configuré.
- **Détail :** `livraison/CORRECTIFS-UX-CLAUDE-20261119.md`.

## Responsive Web — 19/11 (17:50 UTC)
- **Candidat courant :** `dpl_GrLBkDt1HAckvjB8HkzUvKSoLBMA` (fdtb4motz, commit `dd3f260f`), aliasé. Aucune production.
- **Audit :** 72 écrans des cinq espaces à 8 largeurs (576 mesures par élément), passe ciblée de 185 états ouverts plus les neuf onglets Finance, menus à 320 et 768 px, redimensionnement continu sur 22 écrans.
- **Corrigé (CSS seul, 6 fichiers) :** 8 défauts reproduits avant correction — notifications, sélecteur de version de devis, tableau des rapports, étiquette de site, fiche artisan admin, paramètres admin, Finance › Observations et Remboursements.
- **Reste :** tableau des prestations de devis à 320 px, pris par Codex (`quote-documents`).
- **Non vérifié :** zoom navigateur sur petites largeurs, paysage mobile, thème sombre, mode démonstration, Safari et Firefox.
- **Détail :** `livraison/RESPONSIVE-RESULTAT-20261119.md`.
