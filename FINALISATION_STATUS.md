# DomDépannage — suivi de finalisation (Claude)

Mis à jour : 2026-11-15 soir AST (recette PWA, correctif public, tests mobiles, transfert MacBook) — Claude Opus 5.5 (Fable non utilisé : quota épuisé ; aucune facturation ni crédit EAS consommé).

## Base et version testée

| Élément | Valeur vérifiée |
|---|---|
| Copie Claude | `/Volumes/Stockage/dev/Atelier/claude/depannage-electricite/repo`, clone isolé, push vers l'intégration désactivé |
| Branche / base | `claude/finalisation-20261114` depuis `b424c8d` (`codex/figma-responsive-20261114`) ; aucun commit plus récent dans l'intégration du mini |
| Travaux planning Codex non commités (MacBook) | non intégrés, non touchés |
| **Version candidate Web/PWA** | code applicatif du commit **`af47bb72`** (HEAD `076bfec9` : + tests seulement) — preview https://domdepannage-recette-20261112-77s96ixlc-brafas-projects.vercel.app (cible *preview*). Écart avec `e0526c1` : routes publiques en client anonyme (serveur uniquement). |
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
| Paiement plateforme | **refus serveur vérifié** (compte Stripe artisan de test non validé) ; message exact corrigé `a382c28` | — | — | `s5-pay-refused-explained-390.png` | transaction Stripe réelle **non testée** : nécessite un artisan de test avec compte Connect validé (mode test) |
| Entreprise : demande sur site → circuit d'approbation → acceptation → intervention → clôture | **vérifié réel** (`INT-6C3682`) | à faire | à faire | `recette-reelle/log-b*.json` | — |
| Entreprise : 12 vues ; lecteur (lecture seule, 403) ; cloisonnement (404 tiers/lecteur) | **vérifié réel** | à faire | à faire | `real-sweep`, `real-viewer`, `real-isolation` | — |
| Artisan : missions, devis, planning (écriture réversible), photos, compte rendu | **vérifié réel** | à faire | à faire | `real-art`, `real-plan`, `s2`, `s4*` | — |
| Admin | **vérifié isolé** : 77/77 tests routes + UI montée ; revues SQL pglite (tableau de bord 19/19, messagerie 20/20 ; ensemble des 92 revues `tests/sql-*review*.mjs` : 92/92, aucun saut, `preuves/admin-isole/sql-reviews-summary.txt`) ; preview candidate en démo : 14 vues à 390 et 1440, 0 erreur, 0 écriture serveur | à faire | à faire | `preuves/admin-isole/` | **réel bloqué** : aucun compte admin de recette autorisé (fixture Astra rétrogradée, non réactivée) ; approbation d'artisan non jouable en démo (dossier absent, refus attendu) |

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
