# Recette Web — suite, rapport intermédiaire v5 (19/11/2026, 15:50 UTC)

Auteur : Claude (mini). La v3 complète la v2 (13:35 UTC) : D15, D16 et sa correction de largeur, rapprochement INT-44B1D4, tickets d'assistance, ENT-05/09/14. Les sections antérieures sont conservées.

**Cadre**
- Comptes synthétiques existants seulement. Les identifiants viennent des fichiers privés et ne figurent dans aucun journal ; aucun code d'invitation n'est journalisé.
- Aucune opération LIVE, aucun paiement ni remboursement dans ce lot, aucune notification externe.
- Dossiers natifs Codex non touchés : INT-0E073E, INT-44B1D4 (hors lecture finance à venir) et INT-A9155E.
- **Les mentions PASS ne couvrent que ce qui est prouvé ici, avec les limites écrites dans chaque section.**

Preuves dans `preuves/recette-web-suite-20261119/` :
- `logs/` : journaux JSON horodatés à chaque étape ;
- `captures/` ;
- `scripts/`.

Les requêtes SQL citées sont en lecture seule.

## 0. Candidat et correctifs intégrés (tous copiés à l'identique depuis Codex)
Avant chaque copie, nos fichiers ont été comparés au parent Codex : aucune divergence n'a été écrasée. Les fichiers sont copiés depuis le commit exact. `tsc --noEmit` donne un code de sortie 0 à chaque lot.

| Correctif | Codex | Commit Claude | Tests ciblés (mini) |
|---|---|---|---|
| D1, D3, D4, D5 | 4935141 | c1ab347b, d471db1e | session + rayon 20/20 |
| D2 | 236f4ca | 56025232 | — |
| D6 | 0bcba56 | ec03dfb9 | 21/21 |
| D9 journal admin | 74f8ade + libellés 6bf9c1d | d2ec855c, d00fd2d6 | admin-interventions 13/13 |
| D10 accès entreprise | d52ac5c | 3ddc98b4 | revalidate + admin + session + rayon 39/39 |
| D11 carte (W2) | 791e40f | 3f280ae8 | — |
| D13 contestation (W1) | 8f24b37 | 9124a69a | routes plateforme 7/7 |
| D15 Bearer (notifications, assistance) | 897325c | 9b82c4ea | notifications + assistance 18/18 (harness patché) |
| D16 note explicite (O5) | 2f96aeb | d6c83695 | — |
| D16 largeur (W3) | 8caecfe | 65d2b78b | — |

**Candidat courant (v5) : `dpl_9gyPq1kJRNXMqzaZvC3gq5FJGEjB`, nn2dylxph, commit `b9002dd9` (D23 + correctifs UX O1/O2/O3/O7/O10), aliasé vers 15:48 UTC. Détail dans `CORRECTIFS-UX-CLAUDE-20261119.md`.**

**Candidat précédent (v4) : `dpl_4fH2yFC1WHEQPb6x9eb3r5sf9pYi`, n2scdfas8, commit `34e6558f` (D18 + D19), aliasé vers 15:05 UTC. Base de recette : migration D21 `20261119140000` appliquée à 15:07 UTC.**

**Candidat précédent (v3) : `dpl_GRTVMnRGoduvNRXB1UheT88t8P4e`**
- URL : `https://domdepannage-recette-20261112-hbqmw2992-brafas-projects.vercel.app` (commit `65d2b78b`), cible preview, READY.
- **Alias `domdepannage-recette-20261112.vercel.app` → hbqmw2992** (promu après non-régression, vers 14:20 UTC).
- Historique de l'alias : o4n1lx6jm → a0ajqcdgg (13:08) → qay300bx3 (13:28) → **60ifc6p9z / D15** (`dpl_3Xkx26iiUgfRs8Zpf9zWE5AF1mFV`, ~13:56) → hbqmw2992.
- **Non promus :** ie7ir3uou, 7ixt1hjfy, et miupzl34h (`dpl_DaSwkUB37E4F9rTWHCZZRaVxuiYR`, première version de D16, régression W3).

**D15 (60ifc6p9z) : PASS côté Web**
- Sessions Web par cookie (client, entreprise, artisan) : 200 sur notifications, préférences, résumé et assistance.
- Sans session : 401. Bearer invalide : 401.
- Bearer synthétiques et écrans natifs : vérifiés par Codex (21 contrôles).

**D16 : PASS fonctionnel (miupzl34h), PARTIEL pour la mise en page en ligne (hbqmw2992)**
- Aucune note cochée au départ ; envoi désactivé sans note.
- Note 4/5 choisie délibérément sur INT-44B1D4 (client synthétique) : transmise exactement, une seule fois (201). Tiers 403.
- **W3 constatée sur miupzl34h :** l'option « 5 » sortait de l'écran à 390 px (aide placée dans la ligne flex).
- Sur hbqmw2992, la page INT-44B1D4 ne déborde ni à 390 ni à 1280 px.
- **Limite exacte :** le formulaire n'a pas pu être réaffiché en ligne après correction. INT-44B1D4 a désormais un avis, aucun autre dossier réglé sans avis n'appartient au client synthétique, et le mode démonstration ne l'expose pas. La mise en page corrigée repose sur le test monté Codex avec le CSS réel (avant et après), et le diff ne déplace qu'un paragraphe.

**Non-régression sur hbqmw2992 :** D1–D5 et D15 passent (16/16) ; Leaflet 0 erreur sur 6 essais ; panneau D13 présent.

Vérifications sur ce candidat ou sur a0ajqcdgg, selon le cas :

**D1–D6 : PASS sur qay300bx3**, avec ces scénarios :
- erreur de rayon révélée dans le panneau, puis reprise GET sans POST ;
- h1 sur l'écran de refus ;
- `#support` admin refusé et file opérateur ouverte ;
- message de site obligatoire relié au champ ;
- aucun message résiduel après relecture, en manuel comme au retour réseau ;
- D2 vérifié sur 6pwutkukc et o4n1lx6jm (10/10).

**D9 : PASS (a0ajqcdgg et qay300bx3)**
- INT-825B29, « Journal du dossier » à 1280 et 390 px : « Artisan réaffecté · Vous (administrateur) · 19 nov., 08:07 » (12:07:12 UTC).
- Libellés « Demande créée » et « Rendez-vous enregistré » présents sur qay300bx3.
- L'API renvoie 5 actions, bornées à 50, toutes de ce dossier.
- `GET /api/admin/interventions?id=` : 403 pour le client comme pour l'artisan.
- Aucun débordement.
- Limite : seule INT-825B29 a été observée ; la mention « données anciennes » au-delà de 50 actions n'a pas été rejouée.

**D10 : PASS (a0ajqcdgg)**
- Le serveur refuse le membre retiré immédiatement (404).
- L'en-tête du lecteur retiré est corrigé sans rechargement en **4,4 s**, lors de la relecture périodique (au plus 30 s).
- Le journal du propriétaire affiche l'acceptation sans rechargement en **1,1 s**.
- Avant correctif (alias encore sur o4n1lx6jm) : rien n'était mis à jour en 90 s (journal `log-d10-access-AVANT-o4n1lx6jm.json`).
- État final : 2 membres.

**D11 : PASS (a0ajqcdgg et qay300bx3)**
- Scénario : étape 2 de la demande avec carte, redimensionnement, puis navigation.
- Avant correctif : `_leaflet_pos` en erreur 2 fois sur 2 à 390 px.
- Après correctif : 0 erreur sur 6 essais, sur chaque candidat (même largeur, 390 et 1280 px).

**D13 : PASS (qay300bx3)**
- L'artisan voit le panneau « Avis du client » sur INT-5B12D9, à 390 et 1280 px, sans débordement.
- Une contestation ouverte bloque toute nouvelle contestation, à l'interface comme au serveur (409).
- La décision admin est visible après « Actualiser la décision », sans rechargement.
- Un motif de 9 caractères n'est pas envoyé. Un double clic ne produit qu'un seul POST.
- Le tiers reçoit 404 en GET et 403 en POST.
- État final : aucune contestation ouverte.
- Note : mon motif « trop court » faisait exactement 10 caractères ; il était donc valide et a ouvert une contestation, tranchée ensuite.

## 1. Capacités vérifiées dans ce lot
| Id | Proposition Web | Preuve | Limites explicites |
|---|---|---|---|
| ART-03 | PASS | Kbis PDF fictif v1 → « Modifications demandées » avec motif obligatoire ; l'artisan voit le motif ; v2 « Acceptée » avec commentaire ; tiers 404 ; approbation inchangée (a1–a4) | Pièce expirée non rejouée |
| ADM-02 | PARTIEL | Décisions motivées par pièce, versionnées | Décision sur une candidature complète impossible : 9 artisans tous `approved` |
| PUB-07, ART-02 | BLOQUÉ (moyen de test) | — | Créer un compte artisan exige un lien de confirmation par e-mail (`/auth/confirm`), et modifier l'artisan approuvé le repasserait en brouillon. Il faut une boîte de test ou un compte artisan en brouillon avec identifiants. |
| CLI-02 | PASS | Plafond de 6 photos signalé ; 6 photos liées au dossier ; visibles après reconnexion et pour l'artisan attribué ; tiers 404 ; faux PNG refusé par le serveur (422) (c1) | O2 : faux fichier non signalé à la sélection |
| ART-05 | PARTIEL | Deux sessions du même artisan acceptent simultanément : une 200, une 403 avec message clair ; un seul `accept_mission` en SQL (r1) | Course entre deux artisans distincts et refus individuel d'offre non rejoués (un seul compte artisan avec identifiants) |
| CLI-04 | PASS | Date passée refusée (422) ; créneau saisi puis modifié ; deux `appointment_saved` ; client informé ; tiers 404/403 ; version périmée 409 (r2) | O3 : message générique pour la date passée ; proposition de créneau par le client non rejouée |
| ADM-03 | PASS | Réaffectation à motif obligatoire ; l'ancien artisan perd lecture (404) et écriture (403) ; rendez-vous supprimé comme annoncé ; motif dans le fil ; trace visible depuis D9 (r3, d9) | Escalades non rejouées |
| ENT-02 / SYS-03 | PASS | Retrait avec perte immédiate des droits ; réinvitation par code manuel ; lien invalide refusé ; acceptation après connexion ; code réutilisé 409 ; journal des accès (m1, m1b, d10) | Délégation de paiement non testée |
| ENT-04 | PARTIEL+ | Fiche site : équipements, plans, contrôles et historique relus | Contacts et documents de site non rejoués |
| ENT-07 | PARTIEL | Équipement critique avec référence, relu (e1) | Site restauration absent ; lien équipement → ticket non rejoué |
| ENT-08 | PASS (site Bureaux) | Équipement « Bâtiment A · étage 2 · zone nord » et plan mensuel lié, échéance du 15/12, relus après rechargement | Visite de maintenance non enregistrée |
| ENT-10 | PASS | Contrôle ERP déclaratif avec réserve, compteur à 1, levée datée, compteur à 0 ; mention « ne vaut pas certification » conservée (e1, e2) | — |
| ENT-11 | PARTIEL | Calendrier ouvré (America/Martinique, lundi 8 h–17 h) et règle 60/480 min enregistrés et relus | Aucun dossier suivi ; pause, reprise et dépassement non rejoués |
| ENT-13 | PARTIEL+ | Grille brouillon puis « Publier (irréversible) » : version 1 publiée et figée, « Préparer une nouvelle version » proposée ; historique « créé v1 / publié v2 » (e2) | Calcul d'un devis à partir de la grille non rejoué |
| ENT-14 | PARTIEL | Fin d'exercice avant le début refusée ; exercice 2026 : « Devis acceptés 434,00 € · 3 dossiers · Réglé 0,00 € », cohérent avec la fiche site | Lignes budgétaires et écart non saisis |
| Historique de site | PASS | Chaque objet tracé avec date, action, version et portée (e2) | — |
| Lecteur sur les sites | PASS | Site ERP non autorisé refusé ; fiche office sans commande ; écriture d'équipement bien formée refusée par le serveur (403) (e2, e3) | — |
| CLI-10 | PASS | Dossier non réglé : pas de bouton, serveur 403 ; avis enregistré sur INT-5B12D9 réglé ; second avis 409 ; tiers 403 (v1–v3) | O5 : note 5/5 présélectionnée ; un clic sans choix a créé un avis 5/5 sans commentaire |
| ADM-06 | PASS | Masquage à motif obligatoire, avis conservé et marqué « Masqué », exclu de la moyenne artisan ; rétabli avec motif (version 2) ; contestations tranchées avec note (v4–v9, d13) | O6 : la route de contestation renvoie un message zod en anglais (« Too small… ») ; l'interface D13 n'envoie pas sous 10 caractères |
| SYS-05 | PARTIEL+ | Messages artisan → client et client → artisan affichés en environ 1 s sans rechargement ; tiers sans notification et 404 (s1) ; accès entreprise par relecture périodique (D10) | Changements de statut et de devis en direct non rejoués ; moyenne artisan rafraîchie seulement au rechargement (observée) |
| SYS-08 | PARTIEL+ | Clavier seul : lien d'évitement en premier, focus visible, connexion par Tab et Entrée, demande jusqu'à l'étape 2 avec focus sur le titre d'étape, menu mobile fermé par Échap avec focus rendu (k1) ; focus du champ de recherche visible via `focus-within` (k2) | Lecteur d'écran non testé ; décision de distribution Web ou native reste au propriétaire |

### Restent ouverts (prochaines étapes, sans retour propriétaire)
- **ENT-05, ENT-06, ENT-09.** Création, par les parcours normaux, de sites explicitement synthétiques de type syndic et restauration, puis vérification de la saisie de consommation. Si un type ou une action n'existe pas, le manque sera documenté.
- **ENT-14.** Lignes budgétaires et écart.
- **ENT-11.** Dossier suivi par la règle de délai (pause, reprise, dépassement), si l'interface le permet.
- **FIN-06.** Rapprochement de INT-44B1D4, par « Relancer le rattachement » (lectures Stripe TEST) puis rejeu, pour prouver une commission inscrite une seule fois.
- **FIN-01, 03, 04, 05 et ART-11.** Flux de paiement TEST.


## 1 bis. Ajouts v3
| Id | Proposition Web | Preuve | Limites explicites |
|---|---|---|---|
| FIN-06 (INT-44B1D4) | PASS (TEST) | Liaison Checkout créée par le webhook à 13:12:33, Fee figée à 1 845 c (1 700 bps), Transfer brut 10 850 c. « Relancer le rattachement » + rejeu : commission inchangée (4 058 c au total). « Rapprocher les règlements » : `payment_settled` de 10 850 c écrit une seule fois ; rejeu sans effet (`RAPPROCHEMENT-INT-44B1D4-20261119.md`) | Aucune facture ni versement ; taux plateforme non configuré, donc aucune estimation |
| ADM-07 | PASS | Deux tickets synthétiques natifs (`9610e14b`, `55790d99`) : attribution et escalade à motif obligatoire, réponse, « Résolue », historique ; demandeur 200, tiers 404 (t2, t4) | O8 : opérateurs indiscernables (8 « Admin Recette ») |
| ENT-03 | PASS (création) | Deux sites **SYNTHETIQUE R1341** (syndic `313e4d0d…`, restauration `bb0126c4…`), adresse « Adresse fictive de recette », créés par « Nouveau site » (201) | Archivage non rejoué |
| ENT-05 | PASS | AG « Tenue » avec ordre du jour, compte rendu et décisions consignées (version 1) ; titre obligatoire ; parties communes « Hall A » et « Étage 1 » ; contact fictif `@example.test` (téléphone ou e-mail exigé), sans invitation ; mention « aucune convocation, aucun fonds, aucune validation juridique » ; lecteur refusé (n5, n5b, n9) | Appels de fonds non saisis |
| ENT-09 | PASS | Période avec fin avant début refusée. Septembre : facture, 1 234,5 kWh, 245,67 €. Octobre : relevé, 1 000,25 kWh, sans coût. Total 2 234,75 kWh avec « coûts incomplets » ; filtre 15/09–31/10 = 1 000,25 kWh (aucun prorata) ; source et référence affichées (n7) | Site Bureaux seulement |
| ENT-14 | PASS | Lignes Maintenance 300 € et Contrôles 100 € : budget 400 €, devis acceptés 434 € (3 dossiers), réglé 0, **écart −34,00 €** (budget − devis acceptés) (n8) | Un seul exercice |

## Prochaines étapes immédiates
- **ENT-06 et ENT-11 :** sur le site restauration synthétique, calendrier, règle et demande urgente synthétique suivie (échéance, pause, reprise).
- **ENT-07 :** équipement relié à un ticket.
- **Archivage de site (ENT-03).**

## 1 ter. Ajouts v4
| Id | Proposition Web | Preuve | Limites explicites |
|---|---|---|---|
| D18 | PASS | Motifs de 9 et de 2 001 caractères : 422 en français ; contestations 3 → 3 (d18-19) | — |
| D19 | PASS | 390 et 1280 px : huit opérateurs distincts par référence, un seul « (vous) », nom accessible complet ; attributions existantes non modifiées (d19b) | O11 : auteur du triage affiché « opérateur INT-xxxxxx » |
| D21 | PASS | Migration appliquée sur la recette seule ; début et reprise futurs : 422 sans mutation ; valeurs passées acceptées (d21-http, `CORRECTIF-D21-PAUSE-SLA-20261119.md`) | La pause future antérieure (`SYNTH-SLA-B`) est conservée telle quelle |
| ENT-06 | PARTIEL+ | Demande urgente synthétique INT-B3B9AD sur le site restauration, visible sur la fiche ; dossier de délai relié au ticket ; ouverture jeudi hors calendrier → réponse due lun. 23/11 09:00, résolution 12:00 (n16, n18) | O10 : la liste des interventions de la fiche site ne signale pas l'urgence ; pas de tableau de bord propre à la restauration |
| ENT-07 | PARTIEL+ | Équipement critique « chambre froide » sur le site restauration, relu (n10) | Aucun lien direct équipement ↔ ticket trouvé dans le formulaire de demande |
| ENT-11 | PASS | Calendrier lundi 08:00–17:00, règle 60/240 min. A : réponse « Respecté » (30 min), résolution « Dépassé » (6 h contre 4 h, échéance 13:00). B : échéances 23/11 08:30 et 11:30, puis 09:00 et 12:00 après 30 min ouvrées de pause. Réponse antérieure à l'ouverture refusée. Indicateurs : 2 mesurables, 1 dépassé, 1 en cours (n12, n14) | Calendrier d'un seul jour ; jours fermés non testés |
| ENT-15 | PASS | Écran : total 4 000,00 € / 434,00 € / 0,00 € / 5. CSV serveur (`/api/reports?format=csv`) : mêmes sommes par colonne. Énergie consolidée office 01/09–31/10 : 2 234,75 kWh avec « coût incomplet ». Lecteur limité à son site (p1, p2) | Filtres par site et comparaison de périodes non rejoués ; CSV énergie non relu |

**Données synthétiques ajoutées :**
- sites SYNTHETIQUE R1341 (syndic, restauration) et leurs objets ;
- INT-B3B9AD : demande urgente, **laissée en « Recherche d'un artisan »** ;
- dossiers de délai SYNTH-SLA-A, SYNTH-SLA-B et SYNTH-SLA-INT-B3B9AD ;
- ticket « RECETTE D19 » résolu ;
- avis 4/5 sur INT-44B1D4.

**Dossiers réservés Codex, non touchés :** INT-0E073E, INT-A9155E, INT-D0FA86. INT-44B1D4 n'a reçu que l'avis D16 et le rapprochement, tous deux demandés.

**Restent sans preuve Web :**
- flux de paiement TEST : FIN-01, 03, 04, 05 et ART-11 ;
- ENT-16 ;
- ENT-13 : devis calculé depuis la grille ;
- archivage de site (ENT-03) ;
- ART-12 ;
- PUB-04, 05, 10 ;
- CLI-05 ;
- PUB-07 et ART-02 : bloqués (confirmation par e-mail).

## 1 quater. Ajouts v5
| Id | Proposition Web | Preuve | Limites explicites |
|---|---|---|---|
| O1, O2, O3, O7, O10 | Corrigés (Claude), PASS en ligne | `u1-ux` ; `CORRECTIFS-UX-CLAUDE-20261119.md` ; patch `UX-O1-O2-O3-O7-O10-20261119.patch` | O3 entreprise non revu en ligne ; O1 : seul « Acceptée » observé |
| D23 | PASS | Historique de triage « opérateur réf. cff732ca » | — |
| FIN-03 | PASS (Web, retour sans paiement) | Checkout « Sandbox » à 130,20 € sur INT-CDD097, abandon sans saisie, serveur toujours non réglé (g1) | Retours « pending » et « reçu » non rejoués sur le Web |
| FIN-01 | PARTIEL | Ouverture de session Checkout TEST et droits : lecteur, tiers et artisan reçoivent 404 (g2) ; paiement abouti prouvé nativement par Codex et rapproché ici (INT-44B1D4) | Paiement abouti sur le Web non rejoué : limite d'outil (aucune saisie de carte) |
| ENT-16 | PARTIEL / BLOQUÉ | Droits de règlement prouvés ; aucune facture (émetteur plateforme non configuré) | Factures et payeur délégué : décision du propriétaire |
| FIN-04, FIN-05, ART-11 | NON VÉRIFIÉ (Web) | — | Exigent un paiement, un échec ou un remboursement, ou l'émetteur de factures |

## 2. Défauts et observations
| Id | État | Constat |
|---|---|---|
| D6 | Corrigé, vérifié | Message d'erreur du rayon résiduel |
| D9 (ex-D7) | Corrigé, vérifié | Réaffectation absente de l'historique visuel |
| D10 (ex-O4) | Corrigé, vérifié | Accès entreprise non actualisés sans rechargement |
| D11 (ex-W2) | Corrigé, vérifié | Erreur Leaflet `_leaflet_pos` après redimensionnement puis navigation |
| D13 (ex-W1) | Corrigé, vérifié | Pas d'interface de contestation pour l'artisan |
| O1 | **Corrigé (Claude b9002dd9), vérifié** | La pastille d'une pièce reste « Transmis » après décision |
| O2 | **Corrigé (Claude b9002dd9), vérifié** | Faux fichier image non signalé à la sélection (le serveur le refuse) |
| O3 | **Corrigé (Claude b9002dd9), vérifié** | Date de créneau passée : message générique |
| O5 | Observation (UX, données) | Note 5/5 présélectionnée dans le formulaire d'avis |
| O6 | Observation | Message de validation en anglais sur `POST /api/platform-operations/reviews/[id]` |
| W3 | Corrigé (D16 largeur), mise en page en ligne partiellement revérifiée | Option « 5 » hors écran à 390 px sur miupzl34h |
| O8 | Observation | Liste d'attribution d'assistance : opérateurs indiscernables |
| O9 | Corrigé (D21), vérifié | Pause de délai datée dans le futur acceptée |
| O10 | **Corrigé (Claude b9002dd9), vérifié** | Urgence non signalée dans la liste des interventions d'une fiche site |
| O11 | Observation | Auteur du triage affiché avec un préfixe `INT-` |
| O7 | **Corrigé (Claude b9002dd9), vérifié** | Contestation de 9 caractères : seule l'aide « De 10 à 2 000 caractères » reste affichée, sans message d'erreur explicite |

## 3. Données synthétiques créées ou modifiées (recette)
- **INT-825B29 :** photos, deux créneaux, réaffecté à « Artisan Recette » (`assigned`).
- **Pièces Kbis fictives v1 et v2** sur Audit Astra.
- **Lecteur :** retiré puis réinvité deux fois ; état final 2 membres, lecture limitée au site office.
- **Objets de site R1217 :** équipement, plan, exercice, calendrier, règle, contrôle ERP (réserve levée), grille publiée v1.
- **Avis 5/5 sur INT-5B12D9 :**
  - masqué puis rétabli (visible) ;
  - trois contestations, toutes rejetées.
- **Messages de test** dans le fil INT-CDD097.
