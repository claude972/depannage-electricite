# Recette Web/PWA des quatre rôles et rapprochement avec les 76 capacités (19/11/2026)

Auteur : Claude (mini). Candidat : `dpl_G8TQpwy2NZj9PeLiq5AL1iCkxv9x` (qeqpc4bbs, commit 214ec0d2, Next 16.4.6), servi par l'alias `domdepannage-recette-20261112.vercel.app`. Base de recette `kcpyjzndybfdlnhvscbs`, Stripe TEST.
Comptes synthétiques de recette seulement (fichiers privés hors Git, identifiants jamais journalisés). **Aucun paiement, aucune session Stripe créée** (le clic « Payer » a été retiré du scénario), aucune notification externe (envoi désactivé), aucune modification du runtime, aucune production.
Matrice de référence : `docs/qa/MATRICE_PARCOURS_2026-11-19.csv` du clone Codex. Chromium headless local, 390 px et 1440 px. Android/iOS : Codex.

Preuves : `livraison/preuves/recette-roles-20261119/` — `roles/` (journal JSON + captures 1440 + script), `particulier-artisan/` (journaux s1–s5b, captures), `entreprise/` (journaux b1–b8, captures). Aucune donnée secrète.

## 1. Passe transversale des rôles (6 comptes × 390/1440)
Comptes : particulier, second particulier (tiers), artisan, gestionnaire entreprise, lecteur entreprise (sites limités), admin synthétique.

| Contrôle | Résultat |
|---|---|
| Connexion réelle, rôle serveur (`/api/workspace`) | PASS ×12 |
| Toutes les vues du rôle : titre, aucune erreur 5xx, aucun débordement, aucune erreur JS | PASS (réserves ci-dessous) |
| Vues d'un autre rôle (3 par rôle) : écran « Cette page ne fait pas partie de votre espace », aucun appel | PASS |
| Sondes serveur d'autres rôles (admin, plateforme, artisan) | 403 partout ; `GET /api/artisan/performance` répond 422 (validation avant droits) sans donnée |
| Même route sans session | 401 |
| Organisation tierce : compteurs refusés au particulier et à l'artisan ; gestionnaire 200 sur la sienne | PASS |
| Reprise après rechargement sur vue profonde | PASS ×12 |
| Service worker actif et contrôlant la page | PASS ×12 |
| Hors ligne : message explicite + « Réessayer », jamais d'écran vide | PASS |
| Retour réseau | voir défaut D2 |
| Déconnexion : stockage privé `courant-private*` vidé, vue protégée refermée | PASS (1440 ; à 390 le bouton est dans le menu) |
| Changement de compte A→B dans le même onglet : aucune référence INT de A chez B | PASS |
| Lecteur entreprise : « Création de demande non autorisée sur ce périmètre », contrats cadres refusés avec motif | PASS (comportement attendu) |

## 2. Parcours nominaux de bout en bout (écritures synthétiques)
**Particulier → artisan** (INT-CDD097, 390 client / 1440 artisan) : 32/35 PASS ; les 3 écarts sont des attentes périmées des scripts, vérifiées à part :
- demande : adresse vide refusée sans envoi, récapitulatif + estimation « fourchette, pas un prix garanti », double-clic ⇒ un seul dossier (1 POST 201), dossier unique dans « Mes demandes » ;
- offre anonymisée (ville, 972**, pas d'adresse ni description) puis adresse après acceptation ;
- devis : aucun taux TVA présélectionné, 150 HT + 8,5 % = 162,75 TTC ; tiers : acceptation 403 ; motif < 5 caractères refusé ; refus v1 ; motif reçu par l'artisan dans la conversation (« Devis refusé : … ») ; v2 120 HT → 130,20 TTC acceptée, v1 restée refusée (serveur) ;
- démarrage avec confirmation explicite ⇒ « en cours » ; clôture impossible sans compte rendu ni photos ; 2 photos privées, compte rendu, terminée (serveur) ;
- client : « À régler » 130,20 € ; tiers : signature 403 ; accusé de réception signé (serveur + interface) ; bouton « Payer » présent, **non cliqué**.

**Entreprise** (dossier d8ea9913…, site office) :
- règle d'approbation > 100 € TTC (propriétaire) enregistrée ; demande créée sur le site « office » ;
- acceptation avant approbation : 409 avec la vraie raison ; soumission au circuit ⇒ étape « en attente » ; rejet sans commentaire refusé ; lecteur : aucune commande d'approbation ni d'acceptation ; étape approuvée ⇒ « Approuvé en interne. Ce n'est pas une acceptation » ; devis accepté ensuite (serveur `accepted`) ;
- intervention : 2 photos privées, compte rendu, terminée (serveur), aucune erreur.

**Admin** : 35/35 sur ce candidat (écrans admin et plateforme à 1440/390, recherche INT-5B12D9/INT-6C3682, aucune erreur JS, routes admin refusées au particulier) — `preuves/securite-next-1646/`.

## 3. Défauts constatés (non corrigés : consigne « aucune modification runtime »)
| # | Gravité | Constat | Reproduction |
|---|---|---|---|
| D1 | Moyenne | Artisan › Missions : l'erreur de lecture du rayon (role=alert + « Réessayer ») est dans le panneau replié « Zone de recherche » ; invisible tant que l'artisan ne l'ouvre pas. Une fois ouvert, « Réessayer » rétablit (GET mission-radius 200). | hors ligne → #missions → retour réseau |
| D2 | Basse | Retour réseau : aucun rafraîchissement automatique ; l'artisan doit cliquer « Réessayer » sur 3–4 blocs, l'admin une fois. Messages clairs. | idem |
| D3 | Basse (a11y) | Écran de refus « Cette page ne fait pas partie de votre espace » sans `h1`. | `#admin` en particulier |
| D4 | Basse | Admin : `#support` mène à l'écran de refus alors que la table d'accès l'autorise ; l'admin dispose de « Messages » et de la file d'assistance. Décider : retirer de l'accès ou monter la vue. | admin → `#support` |
| D5 | Info | Formulaire entreprise : un « Site professionnel » vide est bloqué par la validation native du navigateur (bulle navigateur), alors que le particulier a des messages applicatifs `aria-invalid`. | #new entreprise sans site |

## 4. Rapprochement Web avec la matrice (cellule `web`)
Légende : **PASS** (preuve de ce jour sur ce candidat) · **PARTIEL** (partie prouvée, reste nommé) · **BLOQUÉ** (dépend du propriétaire) · **DÉSACTIVÉ** (porte fermée volontairement) · **NON VÉRIFIÉ** (pas de preuve courante).

| Id | Web | Preuve / reste |
|---|---|---|
| PUB-01 | PARTIEL | Accueil, prestations, conseils, suivi 200 ; navigation publique détaillée non rejouée |
| PUB-02 | BLOQUÉ | Fourchette de référence affichée « indicative » ; barème non validé, publication fermée |
| PUB-03 | BLOQUÉ | Couverture `unknown` pour tout code postal (0 version publiée) |
| PUB-04 | NON VÉRIFIÉ | Rappel public : seul le refus d'origine étrangère (403) prouvé ; `PUBLIC_CALLBACK_INTAKE_ENABLED` absent |
| PUB-05 | NON VÉRIFIÉ | — |
| PUB-06 | BLOQUÉ | Conditions de garantie non publiées |
| PUB-07 | NON VÉRIFIÉ | Candidature artisan non rejouée |
| PUB-08 | BLOQUÉ | Mentions « À renseigner par l'exploitant » (identité non publiée) |
| PUB-09 | BLOQUÉ | Idem |
| PUB-10 | NON VÉRIFIÉ | Page confidentialité dépend de l'identité ; choix utilisateurs non rejoués |
| CLI-01 | PASS | s1 (validation, récapitulatif, double-clic, unicité) ; variante photo non rejouée |
| CLI-02 | NON VÉRIFIÉ | Photos à la création non rejouées (photos de compte rendu prouvées) |
| CLI-03 | PARTIEL | Offre reçue par artisan disponible, anonymisée ; hors zone/indisponible non rejoué |
| CLI-04 | NON VÉRIFIÉ | — |
| CLI-05 | NON VÉRIFIÉ | — |
| CLI-06 | PARTIEL | Adresse transmise seulement après attribution (côté artisan) |
| CLI-07 | PASS | s3 : refus motivé, v2, v1 restée refusée, tiers 403 ; expiration non rejouée |
| CLI-08 | PARTIEL | Documents et versions lisibles ; ancienne version au-delà des fenêtres non rejouée |
| CLI-09 | PARTIEL | Vues profil/adresses chargées ; modification non rejouée |
| CLI-10 | NON VÉRIFIÉ | — |
| ART-01 | PASS | Toutes les vues artisan 390/1440 |
| ART-02 | PARTIEL | Vue candidature chargée ; création/correction non rejouée |
| ART-03 | NON VÉRIFIÉ | — |
| ART-04 | PARTIEL | Disponibilité activée ⇒ offre reçue ; défaut D1 sur le rayon |
| ART-05 | PARTIEL | Acceptation ; concurrence et refus individuel non rejoués |
| ART-06 | PARTIEL | Adresse après attribution ; distance : « aucune source de mesure » affichée |
| ART-07 | PASS | Devis v1/v2, TVA non présélectionnée, totaux exacts |
| ART-08 | PASS | Vues et routes des autres rôles refusées |
| ART-09 | PASS | s4c/s4d (particulier) et b8 (entreprise) |
| ART-10 | PARTIEL | Vue performance chargée ; recalcul sur jeu connu non rejoué |
| ART-11 | NON VÉRIFIÉ | Exige un paiement ; non rejoué (aucune opération financière) |
| ART-12 | NON VÉRIFIÉ | — |
| ENT-01 | PASS | Organisation active affichée, cloisonnement inter-organisation (compteurs) |
| ENT-02 | PARTIEL | Lecteur limité : refus prouvés ; invitation/retrait non rejoués |
| ENT-03 | PARTIEL | Vue sites chargée ; demande rattachée au site |
| ENT-04 | NON VÉRIFIÉ | — |
| ENT-05 à ENT-10 | NON VÉRIFIÉ | Vues sectorielles non rejouées ; `site-operations` fermée pour ces comptes (à qualifier) |
| ENT-11 | NON VÉRIFIÉ | — |
| ENT-12 | PASS | b3–b6 : seuil, soumission, 409 avant approbation, commentaire obligatoire, lecteur sans commande, approbation puis acceptation |
| ENT-13 | PARTIEL | « Aucune grille autorisée » affiché ; grille versionnée non rejouée |
| ENT-14 | NON VÉRIFIÉ | — |
| ENT-15 | NON VÉRIFIÉ | — |
| ENT-16 | NON VÉRIFIÉ | Vue factures chargée seulement |
| ADM-01 | PARTIEL | Tableau chargé ; concordance KPI non recalculée |
| ADM-02 | PARTIEL | Annuaire artisans ; décision de candidature non rejouée |
| ADM-03 | PARTIEL | Recherche et fiche INT ; réaffectation non rejouée |
| ADM-04 | PARTIEL | Annuaire clients/entreprises |
| ADM-05 | PARTIEL | Finance plateforme ; FIN-06 rapproché (5zggqivyj) |
| ADM-06 | PARTIEL | Avis/modération chargés |
| ADM-07 | PARTIEL | Messages, file d'assistance chargés ; D4 |
| ADM-08 | PARTIEL | Paramètres chargés ; modification versionnée non rejouée (données commerciales bloquées) |
| ADM-09 | PARTIEL | Journal d'audit chargé ; habilitation support limitée non rejouée |
| ADM-10 | PARTIEL | Garantie chargée ; politique non publiée |
| FIN-01 | PARTIEL | Bouton plateforme présenté ; Checkout TEST prouvé le 18/11 (INT-5B12D9), pas rejoué |
| FIN-02 | PARTIEL | Webhook non signé 400 sur ce candidat ; rejeu sans double effet prouvé le 19/11 (relink) |
| FIN-03 | NON VÉRIFIÉ | — |
| FIN-04 | NON VÉRIFIÉ | — |
| FIN-05 | NON VÉRIFIÉ | — |
| FIN-06 | PARTIEL | Rapprochement TEST 13 020 c / 2 213 c (5zggqivyj) + test monté du bouton ; finance 35/35 sur ce candidat |
| FIN-07 | DÉSACTIVÉ | Abonnements `enabled=false`, 0 offre |
| FIN-08 | NON VÉRIFIÉ | Paiement enregistré `live_mode=null` |
| SYS-01 | PARTIEL | Comptes et dossiers réels persistants, refus inter-comptes |
| SYS-02 | PASS | Déconnexion vide le stockage privé ; A→B sans fuite |
| SYS-03 | PARTIEL | Organisation tierce refusée ; membre retiré non rejoué |
| SYS-04 | PARTIEL | Message de refus reçu par l'artisan ; notifications en base (envoi externe désactivé) |
| SYS-05 | NON VÉRIFIÉ | — |
| SYS-06 | PARTIEL | Photos privées liées au dossier |
| SYS-07 | PARTIEL | Recherche admin INT au-delà de la première page |
| SYS-08 | PARTIEL | 390/1440, PWA (SW, manifeste) ; D3 ; clavier non rejoué |
| SYS-09 | BLOQUÉ | Cible de restauration et destinataire des alertes à qualifier (constat Codex) |
| SYS-10 | DÉSACTIVÉ | Pas de configuration IA (`PHOTOTRIAGE_*` absents) |

Totaux Web (76 capacités, recomptés sur le tableau) : PASS 9 · PARTIEL 32 · BLOQUÉ 6 · DÉSACTIVÉ 2 · NON VÉRIFIÉ 27 (ENT-05 à ENT-10 comptés 6). L'application **n'est pas** déclarée complètement fonctionnelle : cellules non vérifiées et partielles restantes.

## 5. Prochaines vérifications Web proposées (indépendantes du propriétaire)
Candidature artisan (PUB-07/ART-02/03/ADM-02), photos à la création (CLI-02), rendez-vous (CLI-04), concurrence d'acceptation (ART-05), réaffectation admin (ADM-03), invitation/retrait de membre (ENT-02/SYS-03), vues sectorielles entreprise (ENT-05 à 10), avis (CLI-10/ADM-06), temps réel (SYS-05), clavier (SYS-08). Les flux financiers (FIN-01/03/04/05, ART-11) demandent une autorisation explicite de paiement TEST.
