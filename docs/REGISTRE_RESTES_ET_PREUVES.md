# Registre unique des restes et des preuves

Ouvert le 22 novembre 2026. **Ce fichier est le seul registre courant** de ce qui reste à faire et de ce qui est prouvé. Les documents antérieurs (`RESTE_A_LIVRER_ACTUEL.md`, `ETAT_LIVRAISON_COURANT.md`, `FINALISATION_STATUS.md`, `MISSIONS.md`) restent comme historique ; ils ne sont plus mis à jour.

## Règles de tenue

- Une ligne n’est **PROUVÉ** que si une preuve datée existe (commande, sortie, commit, déploiement). Sinon elle reste à son état réel.
- Un test isolé (PGlite, tests unitaires) prouve le code, pas la base de recette ni un fournisseur. Les deux sont notés séparément.
- Expo Go ne valide pas un binaire final. Les builds et simulateurs tournent sur le Mac de Codex (`mini-brafa`, stockage externe), jamais sur le mini de Claude.
- Aucun paiement réel, aucune activation live, aucun secret publié, aucune donnée commerciale inventée. Les paiements TEST déjà documentés ne sont pas rejoués à l’aveugle.
- Un blocage d’accès est consigné ici avec ce qui manque, puis le lot suivant est pris.

États : `OUVERT` · `CODÉ` (code et tests isolés verts, pas encore joué sur la recette) · `PROUVÉ` · `BLOQUÉ` (accès ou fournisseur) · `DÉCISION` (attend le propriétaire).

## Référence de départ

| Élément | Valeur vérifiée le 22 novembre 2026 |
|---|---|
| Dépôt | `claude972/depannage-electricite` |
| `main` distant | `c102f63a` |
| Dernier déploiement connu de la recette | `846e28d3` (5 commits avant `main`) |
| Candidat du rapport de qualification | `bda85303` (4 commits avant `846e28d3`, 9 avant `main`) |
| Branche de travail | `claude/terminaison-20261122`, worktree isolé, créée depuis `c102f63a` |
| Matrice | [MATRICE_PARCOURS_2026-11-19.csv](qa/MATRICE_PARCOURS_2026-11-19.csv) : 118 PASS sur 228 cellules ; aucune cellule en échec ouvert |
| Rapport | [RAPPORT_QUALIFICATION_2026-11-22.md](qa/RAPPORT_QUALIFICATION_2026-11-22.md) |

**Écart de qualification.** Les neuf commits `bda85303..c102f63a` ne sont pas couverts par le rapport. Quatre d’entre eux (`50cb1dcc`, `2cadd0d7`, `1d4b8a96`, `846e28d3`) sont déployés sur la recette ; cinq (`31956ccb`, `4cca957b`, `594d25f5`, `43b55a91`, `c102f63a`) ne sont ni déployés ni rejoués. Tout ce qu’ils annoncent est `CODÉ` jusqu’à preuve.

## Poste de vérification

| Besoin | Où | État |
|---|---|---|
| Tests unitaires, typage, revues SQL isolées | `mini-brafa` par SSH, worktree sur le stockage externe, PGlite 0.5.13 hors application | Disponible, utilisé pour le lot 1 |
| Builds natifs et simulateurs | `mini-brafa` uniquement | Non lancés dans cette session |
| Base de recette (migrations) | CLI Supabase connectée sur le mini de Claude, projet `depannage-web-pwa` | Lecture prouvée ; écriture non tentée (voir R-ACC-01) |
| Base de production | Projet `depannage-production` visible | **Aucune écriture.** |
| MacBook Intel (Docker) | `macbookpro` | Injoignable le 22 novembre (délai dépassé) |

## 1. Finance et rapprochement

| ID | Reste | État | Preuve ou prochaine action |
|---|---|---|---|
| R-FIN-01 | Le rapprochement manuel écrivait une commission estimée pour un paiement dont la commission est déjà prélevée | **PROUVÉ en ligne** | Migration `20261122120000`, appliquée à la recette. Joué dans l’écran Finance sur `a9db467b` : +10 règlements, +2 estimations seulement (8 paiements à commission prélevée épargnés), second clic sans effet. [preuves du 23 novembre](qa/preuves-2026-11-23-terminaison/README.md) |
| R-FIN-02 | Total des estimations remplacées calculé côté navigateur, plafonné à 1 000 lignes | **PROUVÉ en ligne** | La base renvoie `commission_estimated_superseded` (3 écritures, 34,72 €) et l’écran Finance l’affiche. [preuves du 23 novembre](qa/preuves-2026-11-23-terminaison/README.md) |
| R-FIN-03 | Écritures de commission estimée en double sur la recette | Clos, non supprimable | Journal immuable : les 3 doublons anciens restent et sont comptés à part. Plus aucun règlement en attente depuis le rapprochement du 23 novembre (14 règlements au journal, 6 estimations dont 3 remplacées, 11 commissions prélevées). |
| R-FIN-04 | `INT-5B12D9` : rapprochement historique | PROUVÉ (antérieur) | Commit `e595ba2e` : relié, commission 2 213 c, sans doublon. Ne pas rejouer. |
| R-FIN-05 | Écriture automatique du règlement à la confirmation du paiement | CODÉ, **appliqué à la recette, non rejoué en ligne** | Migration `20261122130000`. Le rejouer demande un nouveau paiement Stripe TEST, que cette session ne joue pas sur un environnement hébergé. À faire au prochain paiement TEST : vérifier que « Règlements au registre » n’annonce aucun règlement en attente sans clic. Point relevé à la relecture : une déclaration de règlement sur place reçoit désormais son écriture dès la déclaration (auparavant au clic suivant) — même écriture, sans attente d’un opérateur. |
| R-FIN-06 | État de l’empreinte bancaire après capture | CODÉ (affichage) ; base sans changement | Affichage : la phrase « ce n’est pas un débit » n’est plus montrée sur un dossier réglé par empreinte (`components/role/client-space.tsx`). En base, `phone_booking_requests.provider_state` est la preuve figée de l’autorisation (les gardes de finalisation l’exigent à `requires_capture`) ; la capture est tracée dans `guest_settlements` (`charge_id`, `captured_at`, état). Le réécrire affaiblirait ces gardes : laissé tel quel, volontairement. Empreinte TEST de 180,00 € en attente sur `INT-88FF28` (dossier annulé) : non touchée. |
| R-FIN-07 | Commission des empreintes au grand livre (`GUEST_SETTLEMENT_LEDGER_COMMISSION_ENABLED`) | DÉCISION | Code écrit, désactivé : réutilise une fonction prévue pour les événements Stripe. |
| R-FIN-08 | Remboursement Stripe TEST de bout en bout (FIN-04) | BLOQUÉ | Exige la double authentification sur le compte admin de recette. |
| R-FIN-09 | Versement bancaire à l’artisan observé (FIN-06) | BLOQUÉ | Non observable en mode TEST sans versement réel. |
| R-FIN-10 | Facture de commission (FIN-05, ADM-05) | DÉCISION | Taux et numéro de TVA de l’exploitant manquants. |
| R-FIN-11 | Session de paiement réellement expirée | OUVERT | Prouvée par simulation seulement. |
| R-FIN-12 | Litiges FIN-04 (commit `31956ccb`) | CODÉ | À rejouer sur la recette après déploiement. |
| R-FIN-13 | Majoration d’urgence de 25 % affichée mais non appliquée à la fourchette enregistrée | DÉCISION | Le texte publié dit que la majoration est « indiquée sur le devis précis ». L’appliquer aussi à la fourchette d’estimation est une règle de prix : à confirmer avant de modifier la fonction SQL. |
| R-FIN-14 | Pays Stripe Connect : mentions autrichiennes à l’inscription | DÉCISION | À vérifier dans le tableau de bord Stripe par le propriétaire. |

## 2. Comptes et notifications

| ID | Reste | État | Preuve ou prochaine action |
|---|---|---|---|
| R-CPT-01 | Inscription artisan : e-mail de confirmation (PUB-07) | BLOQUÉ | La recette n’a ni SMTP ni boîte de test. |
| R-CPT-02 | Double authentification du compte admin de recette (ADM-09) | BLOQUÉ | Activation par le titulaire du compte. |
| R-CPT-03 | Périmètre de la double authentification (factures, avoirs, rapprochement, taux, zone, garantie, approbation artisan non soumis) | DÉCISION | — |
| R-CPT-04 | Notification à la proposition et à la décision d’un avenant (CLI-07) | CODÉ (par `2cadd0d7`) | Déjà traité côté application après le rapport : `lib/features/quote-documents/amendment-notifications.ts`, appelé par la route des avenants, texte avec référence et montant, libellé d’avenant dans le centre de notifications. Déployé avec `846e28d3`, non requalifié à l’écran. **Rectification :** le déclencheur SQL ajouté au lot 5 (`20261122140000`) faisait double emploi ; avec la même clé d’unicité il n’aurait pas créé de doublon mais aurait remplacé ce texte par un texte plus pauvre. Il a été retiré au lot 7 avant toute application. |
| R-CPT-05 | Artisan informé d’un refus d’approbation | **PROUVÉ en ligne** (circuit simple) | Migration `20261122150000`, appliquée à la recette. Parcours joué sur `a9db467b` avec les comptes synthétiques : une seule notification « Devis non approuvé par le client », visible à l’écran, sans note interne ; autre artisan : rien ; lecteur 403 ; refus sans commentaire 422. [preuves du 23 novembre](qa/preuves-2026-11-23-terminaison/README.md) Non rejoué : circuit avancé, libellé mobile. Limites relevées à la relecture : le texte de la migration dit « interne à l’application », mais la file d’envoi externe prendrait cette notification si l’envoi était activé et le canal ouvert par l’artisan (contenu : référence du dossier seulement) ; un second refus de la même approbation simple n’est pas ré-annoncé (même clé d’unicité, comme pour le demandeur). |
| R-CPT-06 | Préférences de notification (commit `31956ccb`) | CODÉ | À rejouer sur la recette. |
| R-CPT-07 | Notifications système natives | OUVERT | Hors de portée d’Expo Go : binaire de développement requis. |
| R-CPT-08 | Envoi externe e-mail et push (file privée inactive) | BLOQUÉ | Configuration fournisseur absente. |
| R-CPT-09 | Protection Supabase Auth contre les mots de passe compromis désactivée sur la recette | DÉCISION | Réglage du tableau de bord Supabase (selon l’offre souscrite) ; à activer aussi en production. |

## 3. Règles serveur et isolation

| ID | Reste | État | Preuve ou prochaine action |
|---|---|---|---|
| R-SRV-01 | Motif et refus définitif d’une candidature artisan (ADM-02) | **PROUVÉ en ligne**, un suivi ouvert | Migration `20261122170000`, appliquée à la recette. Prouvé : appel direct de la commande SQL refusé par la base (`P0001`, sonde sans écriture) ; par la route : refus sans motif 422, resoumission 409 et dossier inchangé, réouverture qui lève le refus. [preuves du 23 novembre](qa/preuves-2026-11-23-terminaison/README.md) Non vu à l’écran : le formulaire de candidature d’un artisan refusé. **Suivi (R-SRV-19).** |
| R-SRV-02 | Signal « aucun artisan disponible » dans une commune couverte (CLI-03) | CODÉ, **API PROUVÉE en ligne** | `2cadd0d7` : `GET /api/public/coverage/availability`. Lecture publique sur la recette le 22 novembre : `97217` → `none`, `97240` → `available`, conforme au constat du rapport (aucun artisan sur 97217). Affichage web et mobile câblé (`components/features/coverage/model.ts`, `apps/mobile/src/components/coverage-notice.tsx`), non rejoué à l’écran. |
| R-SRV-03 | Suppression réelle d’une photo de demande (CLI-02) | **PROUVÉ en ligne** | Suppression par le client tant que la demande est ouverte : 200, ligne supprimée, retrait de l’offre (l’artisan ne la voit plus) ; tiers 404. [preuves du 23 novembre](qa/preuves-2026-11-23-terminaison/README.md) La course avec une acceptation simultanée (R-SRV-16) reste ouverte. |
| R-SRV-04 | Confirmation d’un créneau (CLI-04) | DÉCISION | Le serveur n’a pas de notion de créneau « confirmé » : le client voit le créneau proposé et peut le modifier (web PASS au rapport). Ajouter une confirmation explicite est un choix de parcours. |
| R-SRV-05 | Journal d’audit plafonné à 100 événements | **PROUVÉ en ligne** | Journal unifié : 600 événements lus sur 6 pages par curseur, aucun doublon, total 648 ; client 403. [preuves du 23 novembre](qa/preuves-2026-11-23-terminaison/README.md) |
| R-SRV-06 | Exécution de l’effacement des données (SYS-09) | DÉCISION | Durées de conservation à fournir (SYS-06). |
| R-SRV-07 | Refus inter-comptes et inter-organisations | PROUVÉ (antérieur) | Matrice, colonne `serveur_permissions`, recette du 21-22 novembre sur `bda85303`. À rejouer sur le candidat final. |
| R-SRV-10 | Trois fonctions de garde avec `search_path` modifiable (`platform_deny_mutation`, `platform_guard_grant_update`, `platform_guard_last_super_admin`) | **CODÉ** | Source : conseiller de sécurité Supabase lu sur la recette le 22 novembre (lint 0011). Migration `20261122160000_guard_functions_search_path.sql`. Test `tests/sql-function-search-path-review.mjs` : rouge avant (exactement ces trois fonctions), 10 contrôles verts après, invariant « aucune fonction publique sans `search_path` » désormais tenu par la CI. **Appliquée à la recette le 22 novembre** (voir « Application à la recette »). |
| R-SRV-11 | Conseiller de sécurité Supabase, recette | PROUVÉ (lecture du 22 novembre) | Aucune alerte de niveau erreur : aucune table exposée sans RLS. Avertissements : les 3 fonctions de R-SRV-10 ; 4 fonctions publiques voulues (`read_indicative_prices`, `read_public_coverage`, `read_public_operator_profile`, `read_public_warranty_terms`) ; 221 fonctions `security definer` appelables par un membre connecté (modèle RPC du projet, chacune contrôle ses droits) ; protection contre les mots de passe compromis désactivée (R-CPT-09). |
| R-SRV-13 | Revue indépendante des routes utilisant le client de service (13 fichiers ajoutés ou modifiés entre `bda85303` et `c102f63a`) | PROUVÉ par lecture, 22 novembre | Aucune route ne permet de lire ou modifier les données d’un autre compte ou d’une autre organisation en fournissant un identifiant. Contrôle de rôle fait avec la session de l’appelant avant tout usage du client de service. Constats : R-SRV-01 (corrigé), R-SRV-14 à R-SRV-18. Non vérifié : la base déployée (lecture des migrations seulement), les réglages de cookies, toute limitation de débit en bordure. |
| R-SRV-14 | Le journal unifié donne à un opérateur `audit_read` ce que les règles RLS réservent aux administrateurs : actions de tous les dossiers, nom et rôle des acteurs, existence d’une habilitation | DÉCISION | Voulu d’après le commentaire du code (`app/api/platform-operations/audit/route.ts`). Ni e-mail, ni téléphone, ni adresse. À confirmer : un opérateur d’audit non administrateur doit-il voir les noms ? |
| R-SRV-15 | Exécution d’un effacement : `command_id` exigé mais non utilisé, pas de sérialisation entre deux administrateurs simultanés | OUVERT, faible | Aucune frontière d’autorisation franchie. À traiter avec SYS-09 quand les durées de conservation seront fournies. |
| R-SRV-16 | Suppression d’une photo de demande : course entre la vérification d’état et la suppression si un artisan accepte au même instant | OUVERT, faible | Données du même propriétaire uniquement. Une suppression atomique demande une commande SQL. |
| R-SRV-17 | Route publique de disponibilité : aucune limitation de débit ; sur une commune servie par un seul artisan, elle révèle quand il se rend disponible | OUVERT, faible | Réponse strictement oui ou non. Limitation de débit à poser en bordure ou dans la route. |
| R-SRV-18 | Copies PDF rendues (`rendered/<compte>/…`) jamais supprimées, non purgées par l’effacement | OUVERT | Conservation, pas exposition. À rattacher à SYS-06. |
| R-SRV-19 | Le refus définitif reposait sur une écriture faite par la route **après** la décision : en cas d’échec, aucun refus n’existait et la garde en base ne voyait rien | **CODÉ** | Migration `20261123090000_artisan_decision_with_reason.sql` : `record_artisan_application_decision` applique la décision et écrit son entrée de journal (motif, « définitif ») dans la même transaction, avec les mêmes règles que la route. Revue `tests/sql-artisan-decision-reason-review.mjs`, 21 contrôles, dont : journal en échec ⇒ décision annulée, rejeu sans double écriture, garde du refus active immédiatement. La route appelle cette commande et ne garde l’ancien chemin en deux temps que pour une base qui ne l’a pas encore. **Non appliquée à la recette au moment de ce commit.** Non traité : « définitif » n’entre pas dans l’empreinte de rejeu de la commande d’origine (un rejeu du même identifiant garde la première écriture). |
| R-SRV-21 | Rejeu d’une décision d’administration : l’empreinte ne couvre que l’action et la version ; un rejeu avec un autre motif ou un autre « définitif » répond `reason_recorded: true` en gardant la première écriture | OUVERT, faible | Relecture de la PR `#13`. Comportement identique à l’ancienne route. Correction : inclure motif et « définitif » dans l’empreinte, ou comparer la ligne existante avant de répondre. |
| R-SRV-22 | Longueur du motif : la route comptait en unités UTF-16, la base en caractères | **CODÉ** | La route compte désormais en caractères (`[...motif].length`), comme `char_length` en base ; test : 5 émojis refusés avant toute commande SQL, 300 émojis acceptés. |
| R-SRV-23 | Repli de la route d’administration vers l’ancien chemin en deux temps quand la base n’a pas `record_artisan_application_decision` | OUVERT, à retirer | Gardé volontairement tant que le projet Vercel qui suit `main` (R-PROD-08) n’a pas la migration ; à retirer une fois la migration présente partout. |
| R-SRV-20 | Le compteur `commission_skipped_withheld` du journal d’audit est un total courant, pas « ce que ce passage a épargné » | OUVERT, mineur | Détail d’audit seulement ; résultat et écritures du rapprochement non concernés. |
| R-SRV-12 | 17 politiques RLS réévaluent `auth.uid()` à chaque ligne (conseiller de performance) | OUVERT, non bloquant | Optimisation (`(select auth.uid())`) sans effet sur les droits. À faire en un lot dédié avec les tests de refus, pas à la volée : `profiles`, `documents`, `notifications`, `artisan_profiles`, `quote_drafts` et 12 autres. |
| R-SRV-09 | Après un refus interne, le devis reste « envoyé » et le dossier « devis reçu » | DÉCISION | Faut-il rendre la main à l’artisan (devis refusé, nouveau devis possible) ou laisser l’organisation rouvrir ? Règle métier à fixer avant tout changement d’état. |
| R-SRV-08 | En-tête CSP en mode observation | PROUVÉ en code | Présent sur `main` (`next.config.ts`). Le correctif non commité de la copie Atelier est donc caduc ; il n’a pas été touché. |

## 4. Parcours client, artisan, entreprise, administration

| ID | Reste | État | Preuve ou prochaine action |
|---|---|---|---|
| R-PAR-01 | L’artisan ne voyait pas dans l’offre les photos partagées par le client (web) | **PROUVÉ en ligne** | Sur la recette `a9db467b` : l’artisan éligible ouvre l’offre et voit « Photos choisies par le client » avec l’image. [preuves du 23 novembre](qa/preuves-2026-11-23-terminaison/README.md) |
| R-PAR-02 | Filtre « Site » de la recherche d’interventions | **PROUVÉ en ligne** | Sur `a9db467b`, le filtre liste « ent Site archivé Dostaly (archivé) ». [preuves du 23 novembre](qa/preuves-2026-11-23-terminaison/README.md) |
| R-PAR-03 | Limite de missions simultanées expliquée à l’artisan | CODÉ | `43b55a91`, à rejouer. |
| R-PAR-04 | ART-10 ponctualité | OUVERT | Non développé. |
| R-PAR-05 | ENT-06 restauration : tableau de bord, échéance par ticket | CODÉ partiel | `846e28d3` (tests d’échéance), déployé, non requalifié. |
| R-PAR-06 | ENT-16 factures et intégrations entreprise | CODÉ partiel | `846e28d3` (lien dossier sur les factures), déployé, non requalifié. |
| R-PAR-07 | ENT-11 SLA (commit `31956ccb`) | CODÉ | À rejouer. |
| R-PAR-08 | PUB-08, PUB-09, ADM-08 : rubriques vides, profil opérateur non publiable | DÉCISION | E-mails de contact, téléphone, hébergeur, TVA, équipe, durées de conservation, montant du barème horaire, frais de déplacement. |
| R-PAR-09 | Durée de garantie absente du texte publié (le logiciel accepte un an) | DÉCISION | — |
| R-PAR-10 | Rappel public activé sur la recette | DÉCISION | À confirmer avant ouverture. |

## 5. Responsive et accessibilité

| ID | Reste | État | Preuve ou prochaine action |
|---|---|---|---|
| R-A11Y-01 | Android : icônes d’onglets rognées à 150 % de police (SYS-08) | OUVERT | — |
| R-A11Y-02 | Android : le clavier masque « Vérifier » dans Aide | OUVERT | — |
| R-A11Y-03 | iOS : barre « Terminer » du clavier absente | OUVERT | — |
| R-A11Y-04 | iOS : une bande au-dessus de la barre d’onglets intercepte des appuis | OUVERT | — |
| R-A11Y-05 | Tables entreprise débordant à 768 px | **PROUVÉ en ligne** | À 768 px aucune page ne déborde ; les tables sont dans une zone défilable focalisable et nommée (la table des rapports par `aria-labelledby`, vérifié dans le code). [preuves du 23 novembre](qa/preuves-2026-11-23-terminaison/README.md) |
| R-A11Y-06 | Perte réseau non rejouée sur les parcours | OUVERT | Colonne `erreurs_reprise` de la matrice : partiel partout. |

## 6. Versions mobiles finales

| ID | Reste | État | Preuve ou prochaine action |
|---|---|---|---|
| R-MOB-01 | Binaires de développement ou de distribution iOS et Android | EN COURS ailleurs | Un binaire simulateur iOS Debug a été construit le 22 novembre par une autre session sur `mini-brafa` (`~/dev/domdep-qa/build`, schéma `depannageelectrique://` enregistré). Sa recette n’est pas dans ce registre tant que cette session ne l’a pas publiée. Aucun binaire Android ni binaire signé constaté. |
| R-MOB-02 | Retour de paiement par lien profond `depannageelectrique://` (FIN-03) | OUVERT | Vérifiable seulement sur binaire. |
| R-MOB-03 | iOS : carte de l’étape d’adresse blanche | OUVERT | Cause non identifiée sous Expo Go ; à rejouer sur binaire. |
| R-MOB-04 | iOS : page de retour Stripe affichant un formulaire de connexion web | OUVERT | — |
| R-MOB-05 | iOS : « Nouvelle demande » rouvre sur la confirmation précédente | OUVERT | — |
| R-MOB-06 | Android : « Paiement en attente de confirmation » après abandon | OUVERT | — |
| R-MOB-07 | Lot mobile `4cca957b` (43 fichiers) | CODÉ | Non rejoué sur appareil ni simulateur. |
| R-MOB-08 | Écrans natifs absents : carte, création de site, adresses, PDF, avis, écritures d’administration | OUVERT | Renvoi vers le web aujourd’hui (`N/A_NATIF`). |
| R-MOB-09 | Trois cellules iOS non testées (FIN-04, FIN-05, FIN-06) | OUVERT | — |
| R-MOB-10 | Appareil physique | OUVERT | Aucun essai. |

## 7. Production et livraison

| ID | Reste | État | Preuve ou prochaine action |
|---|---|---|---|
| R-PROD-00 | CI de `main` rouge depuis `2cadd0d7` | **PROUVÉ** | CI de `main` verte sur le commit de fusion `a9db467b` (2 contrôles sur 2), première exécution verte depuis `50cb1dcc`. |
| R-PROD-08 | **Le projet Vercel `depannage-electricite` se déploie automatiquement en cible « production » à chaque poussée sur `main`** (`depannage-electricite-seven.vercel.app`) et **n’utilise pas la base de recette** : aucune zone publiée, aucun artisan, aucun profil d’exploitant | DÉCISION | Constaté le 23 novembre par lecture publique. La fusion de la PR `#12` y a donc déployé `a9db467b`, comme chacun des commits précédents de `main`. Aucun domaine personnalisé, aucune action de cette session sur sa base. À confirmer par le propriétaire : quelle base ce projet utilise, et s’il doit continuer à suivre `main` automatiquement. Les cinq migrations du 22 novembre n’y sont pas appliquées ; le code de `main` reste compatible sans elles. |
| R-PROD-01 | Déployer le candidat final sur la recette et requalifier les commits non couverts | PARTIEL | `a9db467b` déployé sur le projet de recette (`dpl_BbjkXcKKn5QKx9JdsnKWxW8w9vth`) et alias `domdepannage-recette-20261112.vercel.app` pointé dessus le 23 novembre (précédent : `dpl_5MVRHpbWCQbJt39S5n42t88oXBUK`, `846e28d3`, pour un retour arrière). Accueil et routes publiques 200. Requalifiés : les parcours de la branche de terminaison. Restent à requalifier à l’écran : les correctifs `31956ccb`, `4cca957b`, `43b55a91`, `c102f63a` (en cours dans une autre session). |
| R-PROD-02 | Appliquer les migrations en attente à la recette | **PROUVÉ** | 139 migrations appliquées, identiques à `main` depuis la fusion de la PR `#12`. |
| R-PROD-03 | Sauvegarde, restauration, alertes (SYS-09) | BLOQUÉ | Procédure écrite (`EXPLOITATION_REPRISE.md`, `594d25f5`), jamais exécutée. |
| R-PROD-04 | Base de production | OUVERT | Aucune écriture dans cette session. État des migrations inconnu. |
| R-PROD-05 | Activation Stripe live, domaine, ouverture commerciale | DÉCISION | Interdits dans cette session. |
| R-PROD-06 | PR brouillons `#8` et `#9` encore ouvertes | OUVERT | À fermer ou rebaser après accord : leur contenu a été fusionné le 21 novembre selon `FINALISATION_STATUS.md`. |
| R-PROD-07 | Comptes et dossiers synthétiques laissés sur la recette | OUVERT | Nettoyage à planifier avant toute copie vers la production. |

## Application à la recette — 22 novembre 2026

Accord du propriétaire donné en séance. Base `depannage-web-pwa` uniquement ; aucune action sur la production.

| Étape | Résultat |
|---|---|
| CI de la branche avant application | Verte sur `c761a8fb` (2 contrôles sur 2) |
| Passage à blanc | Exactement cinq migrations : `20261122120000`, `130000`, `150000`, `160000`, `170000` |
| Application | Cinq migrations appliquées sans erreur |
| Données avant / après | Identiques : 14 paiements réglés, 20 écritures au journal (4 règlements, 4 estimations, 11 commissions prélevées), 380 notifications |
| Structure après | 3 nouveaux déclencheurs ; 0 fonction publique à `search_path` modifiable (3 avant) ; garde du refus présente |
| Droits | `submit_artisan_application` : membre connecté oui, anonyme non ; fonction interne, lecture du refus et fonction du déclencheur de règlement : non appelables par un membre |
| Comportement prouvé en ligne | Refus définitif appliqué par la base (R-SRV-01) ; rapport financier avec le total des estimations remplacées (R-FIN-03) |
| Comportement non rejoué en ligne | Écriture de règlement à la confirmation (demande un nouveau paiement TEST) ; notification de refus interne (demande une décision d’approbation) ; rapprochement manuel (clic d’opérateur) |
| Application déployée | Inchangée (`846e28d3`), compatible : les migrations ne retirent ni ne renomment rien de ce qu’elle appelle |

## Fusion et recette en ligne — 23 novembre 2026

| Étape | Résultat |
|---|---|
| Relecture indépendante du diff de la PR `#12` | Aucun blocage ; fonctions remplacées identiques aux originales hors ajouts prévus ; suivis R-SRV-19 et R-SRV-20 |
| Contrôles sur le dernier commit `c0000f76` | 2 sur 2 verts ; `main` sans règle de protection ; aucune protection contournée |
| Fusion | Commit de fusion `a9db467b`, CI de `main` verte |
| Déploiement de recette | `a9db467b` construit par Vercel sur le projet de recette, alias stable pointé dessus après vérification |
| Parcours rejoués avec les comptes synthétiques | Rapprochement, rapport financier, filtre de site, refus interne d’un devis, refus définitif et réouverture d’une candidature, état de paiement côté artisan — voir [preuves du 23 novembre](qa/preuves-2026-11-23-terminaison/README.md) |
| Effets de bord sur la recette | 10 règlements et 2 estimations écrits au journal par le rapprochement (attendu) ; un dossier de test `INT-B1D949` et un `INT-17E204` créés puis annulés ; compte `adm-artisan-rej` resoumis par erreur de test puis remis à « compléments demandés » (trois décisions ajoutées à son historique) |

## Accès

| ID | Accès | État |
|---|---|---|
| R-ACC-01 | Écriture SQL sur la base de recette | **PROUVÉ** : lecture et application possibles depuis le mini de Claude (`supabase db push --project-ref kcpyjzndybfdlnhvscbs`). Utilisé le 22 novembre après accord du propriétaire. |
| R-ACC-02 | `macbookpro` (Docker Intel) | Injoignable le 22 novembre. |
| R-ACC-03 | EAS | CLI absente des deux Mac joignables. |
| R-ACC-04 | Recette à l’écran avec comptes de test | Non faite dans cette session : les identifiants de la cohorte restent sur le poste de recette et ne sont pas saisis par cette session. Les lignes `CODÉ` côté interface attendent une requalification à l’écran. |
| R-ACC-05 | Lecture de la base de production (état des migrations, sauvegardes) | **BLOQUÉ** : refusée par le garde-fou de la session le 22 novembre. Non contournée. R-PROD-04 reste donc inconnu. |
| R-ACC-06 | Mac de Codex partagé | Une autre session y travaille le 22 novembre (`~/dev/domdepannage` sur `main` `c102f63a` avec des modifications mobiles non commitées, Expo et simulateur iOS actifs, résultats `ios3`, `android3`, `web17-*`, binaire simulateur Debug construit à 10 h 23). Cette session-ci n’y lance ni build ni simulateur et ne touche pas au mobile. |
| R-ACC-07 | Application de la migration `20261123090000` à la recette | **BLOQUÉ** : refusée par le garde-fou de la session le 23 novembre (classée action destructive), alors que les cinq migrations précédentes avaient été appliquées après accord explicite. Non contournée. Vérifié en lecture seule : non appliquée (140 migrations au dépôt, 139 en base). La route garde son repli (R-SRV-23) : l’application déployée fonctionne sans elle, avec l’ancienne fenêtre de perte du motif. Commande à lancer par le propriétaire ou après accord : `supabase db push --project-ref kcpyjzndybfdlnhvscbs`. |

## Journal des lots

| Lot | Date | Contenu | Vérification |
|---|---|---|---|
| 1 | 22 novembre 2026 | R-FIN-01, R-FIN-02 : rapprochement manuel idempotent face à une commission prélevée ; total des estimations remplacées calculé en base | Sur `mini-brafa`, Node 26.13.1 : `npm test` 2 515 tests, 2 217 réussis, 298 ignorés, 0 échec ; `tsc --noEmit` propre ; 5 revues SQL isolées vertes dont la nouvelle (15 contrôles). Non déployé, migration non appliquée. |
| 2 | 22 novembre 2026 | R-FIN-05 : écriture de règlement posée à la confirmation du paiement | Rouge sans la migration, 18 contrôles verts avec. Les 97 revues SQL rejouées : 92 vertes ; 1 alignée (`sql-adv-rollback-review`, 346 lignes PASS) ; 1 instable sous charge et verte deux fois seule (`sql-guest-settlement-review`, n’exécute pas la nouvelle migration) ; 3 rouges aussi sur `main`, traitées au lot 3. |
| 3 | 22 novembre 2026 | R-PROD-00 : réparation de la CI de `main` (signature de route, lecture optionnelle des remboursements, fixtures de motif) | `npm run check` sur `mini-brafa` : sortie 0, 2 516 tests, 2 218 réussis, 0 échec, builds Turbopack et webpack compilés. Trois revues `sql-phase2-lot-a-*` vertes (1, 3 et 4 tests). |
| 4 | 22 novembre 2026 | R-PAR-02 : site archivé marqué dans le filtre de recherche des interventions | Test UI rouge puis vert. Code poussé ; non vérifié à l’écran. |
| 5 | 22 novembre 2026 | R-CPT-04 : notifications internes à la proposition et à la décision d’un avenant | Rouge sans la migration, 16 contrôles verts avec. Ensemble après lots 4 et 5 sur `mini-brafa` : 98 revues SQL sur 98 vertes, `npm test` 2 517 tests, 2 219 réussis, 0 échec, typage propre. Code poussé ; migration non appliquée à la recette. |
| 6 | 22 novembre 2026 | R-CPT-05 : l’artisan est informé d’un refus interne de son devis ; tri des restes serveur (R-SRV-01 à 05, R-FIN-06) contre le code de `main` | Rouge sans la migration, 14 contrôles verts avec ; 99 revues SQL sur 99 vertes sur `mini-brafa`. Lecture publique de la recette pour R-SRV-02. Code poussé ; migration non appliquée à la recette. |
| 7 | 22 novembre 2026 | R-SRV-10 : `search_path` fixé sur trois fonctions de garde ; R-SRV-11 et R-SRV-12 : conseillers Supabase lus sur la recette ; **retrait du déclencheur d’avenant du lot 5** (double emploi avec `2cadd0d7`) ; libellé du refus interne dans le centre de notifications | Sur `mini-brafa`, état final : 99 revues SQL sur 99 vertes ; `npm run check` sortie 0, 2 518 tests, 2 220 réussis, 0 échec, deux builds compilés. Code poussé ; migrations non appliquées à la recette. Leçon appliquée : avant tout déclencheur, chercher l’équivalent applicatif sur `main` (les lots 1, 2 et 6 ont été revérifiés : aucun). |
| 8 | 22 novembre 2026 | R-SRV-13 : revue indépendante de l’isolation des routes à client de service ; R-SRV-01 : garde en base du refus définitif | Sur `mini-brafa` : `npm run check` sortie 0, 2 519 tests, 2 221 réussis, 0 échec, deux builds ; 99 revues SQL sur 100 vertes au premier passage. L’échec était `sql-guest-settlement-review`, instable (horodatage `now()` pouvant égaler la valeur d’origine à la milliseconde) : rendue déterministe (`+ 1 seconde`, même exigence de refus), verte 6 fois sur 6. Code poussé ; migration non appliquée à la recette. |
| 9 | 22 novembre 2026 | Application des cinq migrations à la recette et preuves par relecture | Voir « Application à la recette ». Production non touchée. |
| 10 | 23 novembre 2026 | Relecture et fusion de la PR `#12`, déploiement de `a9db467b` sur la recette, parcours rejoués en ligne | Voir « Fusion et recette en ligne ». |
| 11 | 23 novembre 2026 | R-SRV-19 : décision d’administration et motif en une seule transaction | Sur `mini-brafa` : revue isolée 21 contrôles verts ; `npm run check` sortie 0, 2 520 tests, 2 222 réussis, 0 échec, deux builds ; revues SQL toutes vertes après ajout de la nouvelle commande aux listes blanches des revues HTTP `sql-phase2-lot-a-p2` et `p3` (leur faux serveur refusait tout nom non listé). Code poussé ; migration non appliquée à la recette au moment du commit. |
