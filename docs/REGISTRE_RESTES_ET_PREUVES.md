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
| R-FIN-01 | Le rapprochement manuel écrit une commission estimée pour un paiement dont la commission est déjà prélevée (double ligne de commission ; corrigé à l’affichage seulement) | **CODÉ** | Migration `20261122120000_reconcile_skips_withheld_commission.sql`. Test `tests/sql-reconcile-withheld-review.mjs` : échec reproduit avant correctif (`[1,1]` au lieu de `[1,0]`), 15 contrôles verts après. Régressions : `sql-platform-operations-review`, `sql-checkout-link-review` (88), `sql-checkout-charge-proof-review` (78), `sql-platform-deferred-checkout-review` (72) verts. **Non appliquée à la recette.** |
| R-FIN-02 | Total des estimations remplacées calculé côté navigateur, plafonné à 1 000 lignes | **CODÉ** | Même migration : `platform_finance_report` renvoie `commission_estimated_superseded` sur tout le journal ; la route Finance le préfère et garde l’ancien calcul en repli. Tests de route verts. |
| R-FIN-03 | Écritures de commission estimée en double sur la recette | OUVERT, non supprimable | Relevé en lecture seule du 22 novembre : 14 paiements réglés, 4 règlements au journal, 11 commissions prélevées, **3 estimations en double (34,72 €)**, 10 règlements à rapprocher. Le journal est immuable : elles restent et sont comptées à part par R-FIN-02 une fois la migration appliquée. **Ne pas cliquer « Rapprocher » avant application : avec l’ancienne fonction, les 10 règlements en attente recevraient chacun une estimation en double.** |
| R-FIN-04 | `INT-5B12D9` : rapprochement historique | PROUVÉ (antérieur) | Commit `e595ba2e` : relié, commission 2 213 c, sans doublon. Ne pas rejouer. |
| R-FIN-05 | Écriture automatique du règlement (`payment_settled`) sans clic de rapprochement | **CODÉ** | Migration `20261122130000_settlement_entry_at_confirmation.sql` : déclencheur sur `payments`, rejeu sans effet, un échec d’écriture ne bloque jamais la confirmation (journalisé `settlement_entry_failed`, compté dans `missing_settlement`). Test `tests/sql-settlement-at-confirmation-review.mjs` : rouge sans la migration, 18 contrôles verts avec. Pas de rattrapage : les paiements antérieurs restent à rapprocher. **Non appliquée à la recette.** |
| R-FIN-06 | État de l’empreinte bancaire après capture | CODÉ partiel | Affichage : la phrase « ce n’est pas un débit » n’est plus montrée sur un dossier réglé par empreinte (`components/role/client-space.tsx`). Reste en base : `phone_booking_requests.provider_state` demeure `requires_capture` après capture. Empreinte TEST de 180,00 € en attente sur `INT-88FF28` (dossier annulé) : à libérer dans Stripe TEST ou laisser expirer, non touchée. |
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
| R-CPT-04 | Notification à la proposition et à la décision d’un avenant (CLI-07) | **CODÉ** | Migration `20261122140000_amendment_notifications.sql` : déclencheur sur `quote_amendments`, types de notification existants réutilisés (aucun changement côté web, iOS, Android), texte sans montant. Test `tests/sql-amendment-notifications-review.mjs` : rouge sans la migration, 16 contrôles verts avec (auteur non notifié, type coupé respecté, tiers sans lecture). Notification interne à l’application seulement. **Non appliquée à la recette.** |
| R-CPT-05 | Artisan informé d’un refus d’approbation | **CODÉ** | Migration `20261122150000_approval_refusal_notifies_artisan.sql` : notification interne à l’auteur du devis quand l’approbation simple ou le circuit avancé passe à « refusé » ; rattachée au dossier seulement, sans note interne ni nom de décideur ; une approbation interne ou une demande d’information n’annonce rien. Test `tests/sql-approval-refusal-artisan-review.mjs` : rouge sans la migration, 14 contrôles verts avec. Le devis reste « envoyé » après un refus interne : comportement inchangé, voir R-SRV-09. **Non appliquée à la recette.** |
| R-CPT-06 | Préférences de notification (commit `31956ccb`) | CODÉ | À rejouer sur la recette. |
| R-CPT-07 | Notifications système natives | OUVERT | Hors de portée d’Expo Go : binaire de développement requis. |
| R-CPT-08 | Envoi externe e-mail et push (file privée inactive) | BLOQUÉ | Configuration fournisseur absente. |

## 3. Règles serveur et isolation

| ID | Reste | État | Preuve ou prochaine action |
|---|---|---|---|
| R-SRV-01 | Motif et refus définitif d’une candidature artisan (ADM-02) | CODÉ | `31956ccb` et `c102f63a` : motif obligatoire (422 sans motif), conservé dans l’historique des décisions, refus définitif qui ferme la soumission jusqu’à réouverture. Fixtures de test alignées au lot 3. Non déployé, à rejouer à l’écran. |
| R-SRV-02 | Signal « aucun artisan disponible » dans une commune couverte (CLI-03) | CODÉ, **API PROUVÉE en ligne** | `2cadd0d7` : `GET /api/public/coverage/availability`. Lecture publique sur la recette le 22 novembre : `97217` → `none`, `97240` → `available`, conforme au constat du rapport (aucun artisan sur 97217). Affichage web et mobile câblé (`components/features/coverage/model.ts`, `apps/mobile/src/components/coverage-notice.tsx`), non rejoué à l’écran. |
| R-SRV-03 | Suppression réelle d’une photo de dossier (CLI-02) | CODÉ | `2cadd0d7` : `DELETE /api/documents` tant que la demande est en recherche d’artisan (retrait de l’offre, suppression de la ligne puis du fichier privé, trace d’audit). Déployé avec `846e28d3`, non requalifié. |
| R-SRV-04 | Confirmation d’un créneau (CLI-04) | DÉCISION | Le serveur n’a pas de notion de créneau « confirmé » : le client voit le créneau proposé et peut le modifier (web PASS au rapport). Ajouter une confirmation explicite est un choix de parcours. |
| R-SRV-05 | Journal d’audit des paramètres plafonné à 100 événements | CODÉ | `31956ccb` : journal unifié paginé par curseur (`/api/platform-operations/audit?journal=…`). Non déployé, à rejouer. |
| R-SRV-06 | Exécution de l’effacement des données (SYS-09) | DÉCISION | Durées de conservation à fournir (SYS-06). |
| R-SRV-07 | Refus inter-comptes et inter-organisations | PROUVÉ (antérieur) | Matrice, colonne `serveur_permissions`, recette du 21-22 novembre sur `bda85303`. À rejouer sur le candidat final. |
| R-SRV-09 | Après un refus interne, le devis reste « envoyé » et le dossier « devis reçu » | DÉCISION | Faut-il rendre la main à l’artisan (devis refusé, nouveau devis possible) ou laisser l’organisation rouvrir ? Règle métier à fixer avant tout changement d’état. |
| R-SRV-08 | En-tête CSP en mode observation | PROUVÉ en code | Présent sur `main` (`next.config.ts`). Le correctif non commité de la copie Atelier est donc caduc ; il n’a pas été touché. |

## 4. Parcours client, artisan, entreprise, administration

| ID | Reste | État | Preuve ou prochaine action |
|---|---|---|---|
| R-PAR-01 | L’artisan ne voit pas dans l’offre les photos partagées par le client (web) | CODÉ | Déjà traité par `2cadd0d7` (galerie montée dans l’offre et dans la mission, `components/role/artisan-space.tsx`), déployé avec `846e28d3`, postérieur au rapport : à rejouer à l’écran. |
| R-PAR-02 | Filtre « Site » de la recherche d’interventions liste le site archivé sans le signaler | **CODÉ** | Filtre de lecture sur des dossiers passés : le site reste sélectionnable et est marqué « (archivé) », comme dans le sélecteur de portée. Test `tests/ui/enterprise-archived-site-filter.test.ts` rouge puis vert. À rejouer à l’écran. |
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
| R-A11Y-05 | Tables entreprise débordant à 768 px | À revérifier | Constat du 14 novembre ; à rejouer sur le candidat final. |
| R-A11Y-06 | Perte réseau non rejouée sur les parcours | OUVERT | Colonne `erreurs_reprise` de la matrice : partiel partout. |

## 6. Versions mobiles finales

| ID | Reste | État | Preuve ou prochaine action |
|---|---|---|---|
| R-MOB-01 | Binaires de développement ou de distribution iOS et Android | OUVERT | Toute la recette native a été faite sous Expo Go : elle ne valide pas les binaires. À construire sur `mini-brafa`. |
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
| R-PROD-00 | **CI de `main` rouge depuis `2cadd0d7`** (cinq exécutions en échec, dernière verte : `50cb1dcc`) | **PROUVÉ (branche)** | Causes lues dans les journaux CI : (1) build refusé, `GET(request?: Request)` dans `app/api/admin/artisans/route.ts` ; (2) revue SQL E80 en 503 : la lecture optionnelle des remboursements faisait tomber tout l’état de paiement quand le client de service est indisponible ; (3) revues E34 et E36 non alignées sur le motif obligatoire (ADM-02). Corrigé au lot 3 ; `npm run check` vert sur `mini-brafa`. **PROUVÉ sur la branche** : CI GitHub de la PR `#12` verte sur `23bb77be` (2 contrôles sur 2, Node 24). `main` reste rouge tant que la branche n’est pas fusionnée. |
| R-PROD-01 | Déployer le candidat final sur la recette et requalifier les neuf commits non couverts | OUVERT | — |
| R-PROD-02 | Appliquer les migrations en attente à la recette | OUVERT | Voir R-ACC-01. |
| R-PROD-03 | Sauvegarde, restauration, alertes (SYS-09) | BLOQUÉ | Procédure écrite (`EXPLOITATION_REPRISE.md`, `594d25f5`), jamais exécutée. |
| R-PROD-04 | Base de production | OUVERT | Aucune écriture dans cette session. État des migrations inconnu. |
| R-PROD-05 | Activation Stripe live, domaine, ouverture commerciale | DÉCISION | Interdits dans cette session. |
| R-PROD-06 | PR brouillons `#8` et `#9` encore ouvertes | OUVERT | À fermer ou rebaser après accord : leur contenu a été fusionné le 21 novembre selon `FINALISATION_STATUS.md`. |
| R-PROD-07 | Comptes et dossiers synthétiques laissés sur la recette | OUVERT | Nettoyage à planifier avant toute copie vers la production. |

## Accès

| ID | Accès | État |
|---|---|---|
| R-ACC-01 | Écriture SQL sur la base de recette | **Lecture prouvée** le 22 novembre depuis le mini de Claude (`supabase migration list` et `supabase db query --linked`) : 134 migrations appliquées, identiques au dépôt ; les deux migrations du 22 novembre sont les seules en attente. Écriture non tentée : l’application à la recette attend l’accord du propriétaire (base partagée avec les sessions de recette en cours). |
| R-ACC-02 | `macbookpro` (Docker Intel) | Injoignable le 22 novembre. |
| R-ACC-03 | EAS | CLI absente des deux Mac joignables. |
| R-ACC-04 | Recette à l’écran avec comptes de test | Non faite dans cette session : les identifiants de la cohorte restent sur le poste de recette et ne sont pas saisis par cette session. Les lignes `CODÉ` côté interface attendent une requalification à l’écran. |

## Journal des lots

| Lot | Date | Contenu | Vérification |
|---|---|---|---|
| 1 | 22 novembre 2026 | R-FIN-01, R-FIN-02 : rapprochement manuel idempotent face à une commission prélevée ; total des estimations remplacées calculé en base | Sur `mini-brafa`, Node 26.13.1 : `npm test` 2 515 tests, 2 217 réussis, 298 ignorés, 0 échec ; `tsc --noEmit` propre ; 5 revues SQL isolées vertes dont la nouvelle (15 contrôles). Non déployé, migration non appliquée. |
| 2 | 22 novembre 2026 | R-FIN-05 : écriture de règlement posée à la confirmation du paiement | Rouge sans la migration, 18 contrôles verts avec. Les 97 revues SQL rejouées : 92 vertes ; 1 alignée (`sql-adv-rollback-review`, 346 lignes PASS) ; 1 instable sous charge et verte deux fois seule (`sql-guest-settlement-review`, n’exécute pas la nouvelle migration) ; 3 rouges aussi sur `main`, traitées au lot 3. |
| 3 | 22 novembre 2026 | R-PROD-00 : réparation de la CI de `main` (signature de route, lecture optionnelle des remboursements, fixtures de motif) | `npm run check` sur `mini-brafa` : sortie 0, 2 516 tests, 2 218 réussis, 0 échec, builds Turbopack et webpack compilés. Trois revues `sql-phase2-lot-a-*` vertes (1, 3 et 4 tests). |
| 4 | 22 novembre 2026 | R-PAR-02 : site archivé marqué dans le filtre de recherche des interventions | Test UI rouge puis vert. Code poussé ; non vérifié à l’écran. |
| 5 | 22 novembre 2026 | R-CPT-04 : notifications internes à la proposition et à la décision d’un avenant | Rouge sans la migration, 16 contrôles verts avec. Ensemble après lots 4 et 5 sur `mini-brafa` : 98 revues SQL sur 98 vertes, `npm test` 2 517 tests, 2 219 réussis, 0 échec, typage propre. Code poussé ; migration non appliquée à la recette. |
| 6 | 22 novembre 2026 | R-CPT-05 : l’artisan est informé d’un refus interne de son devis ; tri des restes serveur (R-SRV-01 à 05, R-FIN-06) contre le code de `main` | Rouge sans la migration, 14 contrôles verts avec ; 99 revues SQL sur 99 vertes sur `mini-brafa`. Lecture publique de la recette pour R-SRV-02. Code poussé ; migration non appliquée à la recette. |
