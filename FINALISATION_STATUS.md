# DomDépannage — suivi de finalisation (Claude)

Mis à jour : 2026-11-15 ~05:20 AST — Claude Opus 5.5 (Fable non utilisé : quota épuisé ; aucune facturation ni crédit EAS consommé).

## Base et version testée

| Élément | Valeur vérifiée |
|---|---|
| Copie Claude | `/Volumes/Stockage/dev/Atelier/claude/depannage-electricite/repo`, clone isolé, push vers l'intégration désactivé |
| Branche / base | `claude/finalisation-20261114` depuis `b424c8d` (`codex/figma-responsive-20261114`) ; aucun commit plus récent dans l'intégration du mini |
| Travaux planning Codex non commités (MacBook) | non intégrés, non touchés |
| **Version candidate** | commit **`e0526c1`** (branche `claude/finalisation-20261114`) — preview https://domdepannage-recette-20261112-lizw2oi45-brafas-projects.vercel.app (cible *preview*) |
| Previews de la recette réelle | `4jadwewvm` (`15a9775`, parcours complet), `5sivte8w3` (`a382c28`, paiement), `fexnt9wgj` (`68b5646`, B2B) |
| Alias de recette | `domdepannage-recette-20261112.vercel.app` → `dpl_5HgGE477…` (12/11), **non modifié** |
| Backend des previews | Supabase `kcpyjzndybfdlnhvscbs` (URL publique lue dans le bundle ; aucune clé lue) |
| Comptes de recette réelle | comptes synthétiques `@example.test` d'Astra (13/11, `audit-20261113-astra/ui-accounts.private.json`) : client, artisan, tiers, entreprise, lecteur. Le compte « admin » a été rétrogradé en client par Astra (`super_admin: false`) |

Légende : **synthétique** = mode démo (localStorage, aucun serveur) · **réel** = Supabase de recette avec comptes synthétiques · **preview** = déploiement Vercel non aliasé.

## Tableau de suivi (version candidate `e0526c1`)

| Parcours | Web/PWA | iOS | Android | Preuve / version | Défaut restant |
|---|---|---|---|---|---|
| Accueil public | **vérifié** (320/390/768/1440, comparé à l'alias) | compilé (Release non signée, Codex) ; non exécuté | **vérifié** démarrage (émulateur API 36) | `comparatif-avant-apres-20261115.pdf`, `android-accueil-emulateur.png` | bandeau « 20 min » réservé aux builds de recette |
| Particulier : demande → offre → devis → refus → v2 → acceptation → intervention → clôture → accusé de réception | **vérifié réel** (`INT-5B12D9`) | à faire (appareil) | **connexion + liste + détail du dossier réel vérifiés** (montants 130,20 €, devis refusé visible) | `recette-reelle/log-s1…s5*.json`, `android-*.png` | paiement : voir ci-dessous |
| Paiement plateforme | **refus serveur vérifié** (compte Stripe artisan de test non validé) ; message exact corrigé `a382c28` | — | — | `s5-pay-refused-explained-390.png` | transaction Stripe réelle **non testée** : nécessite un artisan de test avec compte Connect validé (mode test) |
| Entreprise : demande sur site → circuit d'approbation → acceptation → intervention → clôture | **vérifié réel** (`INT-6C3682`) | à faire | à faire | `recette-reelle/log-b*.json` | — |
| Entreprise : 12 vues ; lecteur (lecture seule, 403) ; cloisonnement (404 tiers/lecteur) | **vérifié réel** | à faire | à faire | `real-sweep`, `real-viewer`, `real-isolation` | — |
| Artisan : missions, devis, planning (écriture réversible), photos, compte rendu | **vérifié réel** | à faire | à faire | `real-art`, `real-plan`, `s2`, `s4*` | — |
| Admin | **vérifié synthétique** (44 tests UI dont banc « live » sur API simulée ; tableau de bord, artisans, interventions, devis, clients, avis) | à faire | à faire | `tests/ui/admin*.test.ts` | **réel bloqué** : aucun compte admin de recette autorisé (fixture Astra rétrogradée, non réactivée) |

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
- `npm test` complet : 2 357/2 372 en parallèle sur `7da0632` ; échecs rejoués séquentiellement : tous PASS. Après les corrections de la recette réelle, suite élargie 2 503/2 508 (2 échecs hors périmètre : `restore-drill.test.mjs` exige `@electric-sql/pglite` absent ; notifications instable, PASS seul). Nouveaux tests : `quote-refusal-revision`, `checkout-refusals`, `approval-refusals`, `enterprise-request-site`, `whatsapp-dock`.
- Recette réelle sur la preview candidate `lizw2oi45` : client/artisan/entreprise/lecteur × 390/1440 → connexion, espace, déconnexion, 0 erreur API, 0 erreur de page ; WhatsApp arrimé (69 positions, 0 écart).
- Android : APK de test (`04138064`, API `1aav2k9it`) — connexion réelle du particulier synthétique, compte, « Activité » (reprise après « Connexion interrompue » OK), détail `INT-5B12D9` cohérent avec le serveur. Rebuild aligné sur la candidate en cours.

## Distribution (inventaire en lecture seule)
- **iOS** : Mac mini — 1 identité valide « Apple Distribution » (équipe `24U98C9WKS`) ; le seul profil local concerne une autre application (KNOWROK), inutilisable. Les identifiants DomDépannage (certificat, profil ad hoc, iPhone de test) sont **sur Expo** (`claude972`, `credentialsSource: remote`, `--freeze-credentials`). MacBook : compile mais 0 identité locale. Voie sans crédits cloud : `eas build --local --profile device` sur le MacBook (récupère les identifiants Expo existants) — à exécuter par Codex (contrôle iOS). Aucun certificat créé ni renouvelé.
- **Android** : keystore du projet existant (même fichier dans 3 copies, empreinte `510ac251…`). APK interne signé avec ce keystore : `livraison/domdepannage-android-interne-04138064-keystore-projet.apk` (SHA-256 `6ad24d74…`), **même certificat que l'APK interne Codex précédent** (`ad0407ea…`) → s'installe en mise à jour. Identifiant `.preview` : **distribution interne uniquement**, aucune soumission Play (exigerait un AAB et l'accès Play Console).

## Incident (corrigé localement, décision requise)
- Un `vercel deploy` lancé par erreur depuis `apps/mobile` a créé un projet Vercel **« mobile »** (`prj_bMnxe0221GYLhNkw3pGxnZV9PMfE`, URL `mobile-roan-omega.vercel.app`) contenant les sources de `apps/mobile` (184 fichiers, aucun secret : pas de keystore, `credentials.json` ni `.env`, seulement `.env.example`). Liaison locale supprimée, `.gitignore` restauré. **Suppression du projet à confirmer** par le propriétaire (action définitive).

## Restant / blocages exacts
- **iOS** : compilation résolue (Codex, Xcode 26.5) ; restent build signé ad hoc avec les identifiants Expo existants, installation sur l'iPhone de test inscrit, recette native.
- **Admin réel** : besoin d'un compte admin de recette autorisé (périmètre limité). Test à exécuter : connexion admin → candidatures (approuver / demander des corrections) → interventions (réaffecter avec motif) → devis & factures → modération d'avis → paramètres ; vérifier les refus pour un non-admin.
- **Paiement Stripe** : nécessite un artisan de test avec compte Connect validé en mode test ; alors rejouer « Payer » sur `INT-5B12D9` jusqu'à la page Stripe test (sans carte réelle) et le retour.
- **Android natif** : écart à requalifier sur appareil (barre de navigation invitée observée après connexion, liste « Activité » via la recherche publique) ; émulateur saturé (swap hôte ~7,5 Go) : défilement et actions non poursuivis.
- **Version unique** : APK Android en reconstruction sur `e0526c1` / preview `lizw2oi45` ; iOS Codex compilé sur `04138064` (même source mobile : aucun changement de code mobile depuis `7da0632`).
