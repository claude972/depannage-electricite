# DomDépannage — suivi de finalisation (Claude)

Mis à jour : 2026-11-15 ~03:00 AST — Claude Opus 5.5 (Fable non utilisé : quota épuisé ; aucune facturation ni crédit EAS consommé).

## Base et version testée

| Élément | Valeur vérifiée |
|---|---|
| Copie Claude | `/Volumes/Stockage/dev/Atelier/claude/depannage-electricite/repo`, clone isolé, push vers l'intégration désactivé |
| Branche / base | `claude/finalisation-20261114` depuis `b424c8d` (`codex/figma-responsive-20261114`) ; aucun commit plus récent dans l'intégration du mini |
| Travaux planning Codex non commités (MacBook) | non intégrés, non touchés |
| **Preview testée (dernière)** | https://domdepannage-recette-20261112-4jadwewvm-brafas-projects.vercel.app — commit `15a9775`, cible *preview* |
| Previews précédentes | `dihimf53b` (`a03a864`), `5p8q4ca7f` (`bd58833`), `1aav2k9it` (`399c5a3`) |
| Alias de recette | `domdepannage-recette-20261112.vercel.app` → `dpl_5HgGE477…` (12/11), **non modifié** |
| Backend des previews | Supabase `kcpyjzndybfdlnhvscbs` (URL publique lue dans le bundle ; aucune clé lue) |
| Comptes de recette réelle | comptes synthétiques `@example.test` d'Astra (13/11, `audit-20261113-astra/ui-accounts.private.json`) : client, artisan, tiers, entreprise, lecteur. Le compte « admin » a été rétrogradé en client par Astra (`super_admin: false`) |

Légende : **synthétique** = mode démo (localStorage, aucun serveur) · **réel** = Supabase de recette avec comptes synthétiques · **preview** = déploiement Vercel non aliasé.

## Tableau de suivi

| Parcours | Web/PWA | iOS | Android | Preuve / version | Défaut restant |
|---|---|---|---|---|---|
| Accueil public | **vérifié** (preview, 320/390/768/1440, comparé à l'alias) | compilation réussie (Release non signée, Codex) ; non exécuté | vérifié démarrage (APK test, émulateur API 36) | `comparatif-avant-apres-20261115.pdf` ; `android-accueil-emulateur.png` | bandeau « 20 min » visible en preview et dans l'APK (réservé aux builds de recette) |
| Particulier : connexion, espace, dossier, menu compte, déconnexion | **vérifié réel** (390/1440) | à faire | connexion native non achevée (saisie ADB trop lente sous swap ; aucun défaut constaté) | `real.mjs` : 0 erreur API/page ; `real-dock.mjs` : 71 positions de défilement à 320/390, 0 écart | — (WhatsApp arrimé au menu : corrigé `a03a864`) |
| Particulier : demande → devis → acceptation → intervention → règlement | **vérifié synthétique** (local + preview) ; réel en lecture (dossier « À régler 108,50 € » d'Astra) | à faire | à faire | test E2E `interactive-journey` 390/1440 | nouvelle demande réelle non rejouée dans cette session |
| Particulier ↔ entreprise : approbation → acceptation | **vérifié synthétique** (local + preview) ; garde serveur `guard_quote_approval` (SQL) | à faire | à faire | `online-cross-*.png` | non rejoué en réel (aucune approbation en attente sur les comptes) |
| Entreprise : 12 vues (tableau de bord, interventions, sites, approbations, contrats, rapports, membres, facturation, messages, documents, assistance, profil) | **vérifié réel en lecture** (390/1440) : 0 erreur API, 0 débordement ; tableaux en cartes sur mobile | à faire | à faire | `real-sweep.mjs` | écritures entreprise (création demande/site, décision d'approbation) non rejouées en réel |
| Lecteur entreprise : droits | **vérifié réel** : aucun contrôle d'écriture, mention « lecture seule », POST `/api/sites` → **403** | à faire | à faire | `real-viewer.mjs` | — |
| Cloisonnement entre comptes | **vérifié réel** : dossier d'un particulier → propriétaire 200, tiers 404, lecteur 404, aucune donnée ; état d'interface honnête | — | — | `real-isolation.mjs` | — |
| Artisan : vue d'ensemble, missions, devis, planning, messages, documents, profil | **vérifié réel** (390/768, lecture) | à faire | à faire | `real-art.mjs` : 0 erreur | — |
| Artisan : planning (écriture) | **vérifié réel** (768) : erreur fin<début, création plage → « Libre », suppression → état vide | à faire | à faire | `real-plan.mjs` ; données restaurées | — |
| Admin | **vérifié synthétique seulement** (tableau de bord, en-tête mobile corrigé) | à faire | à faire | `admin-hdr.png` | **bloqué en réel** : aucun compte admin de test actif |

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
- Typecheck web et mobile : OK. `npm run build` : OK (`399c5a3`).
- `npm test` : base 2335/2372 → après corrections 2357/2372 en parallèle ; tous les échecs restants rejoués séquentiellement passent (instabilité sous charge CPU).
- Recette réelle Chromium sur preview (lecture + une écriture réversible planning) : client, artisan, entreprise, lecteur — 0 réponse API ≥ 400, 0 erreur de page ; rejouée sur `5p8q4ca7f` pour client/entreprise.
- Android : `./gradlew assembleRelease` **BUILD SUCCESSFUL in 49m 56s** (617 tâches). APK `livraison/domdepannage-android-test-04138064-debugsigned.apk`, 61 916 893 octets, SHA-256 `9c4eeea1db8611629accf0bf0052f2dec6d14ef6b1596ea8ae698c95694319d5`, `com.claude972.depannageelectrique.preview` 0.1.0 (15), API = preview `1aav2k9it`. **Certificat Android Debug : test uniquement, non publiable Play.** Installé et lancé sur émulateur Pixel API 36 : accueil rendu, aucun crash.

## Restant / blocages
- **iOS** : **compilation résolue** par Codex sur le MacBook (Xcode 26.5 / Swift 6.3.2, source `04138064`, Release iphoneos arm64, `CODE_SIGNING_ALLOWED=NO` : BUILD SUCCEEDED, sans patch ; reçu `ios-build-result.json`, archive `DomDepannage-ios-unsigned-v15.zip`). Application **non signée, non exécutée** : restent signature/provisioning Apple, build de distribution et recette sur iPhone. (Le Mac mini, Xcode 26.3, ne peut pas compiler ; contournements abandonnés.)
- **Admin réel** : besoin d'un compte admin de test actif — autorisation du propriétaire pour réactiver un compte synthétique `@example.test` avec un périmètre admin limité, ou compte admin de recette fourni. Aucune élévation faite.
- **Android natif connecté** : à rejouer (saisie manuelle ou machine moins chargée).
- **Distribution signée** (TestFlight / Play interne) : non réalisée ; accès Apple/Google ou EAS cloud à autoriser.
- Écritures réelles non rejouées dans cette session : nouvelle demande particulier, offre/devis artisan, décision d'approbation entreprise (couvertes en synthétique et par la recette Astra du 13/11).
