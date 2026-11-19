# Recette Web — suite, rapport intermédiaire v2 (19/11/2026, 13:35 UTC)

Auteur : Claude (mini). Ce rapport remplace la version de 12:20 UTC.

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

**Candidat courant : `dpl_844a9eCa6NKuRocFZF2ZyzrCtY13` (qay300bx3, commit `d00fd2d6`).**
- Cible preview, READY.
- L'alias `domdepannage-recette-20261112.vercel.app` pointe sur ce candidat depuis 13:28 UTC.
- Candidats intermédiaires :
  - 8k1jrui9o (D1–D5) ;
  - 6pwutkukc (+D2) ;
  - o4n1lx6jm (+D6) ;
  - ie7ir3uou (+D9, D10, non aliasé) ;
  - a0ajqcdgg (+D11, aliasé de 13:08 à 13:28) ;
  - 7ixt1hjfy (+D13 sans libellés, non aliasé).

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

## 2. Défauts et observations
| Id | État | Constat |
|---|---|---|
| D6 | Corrigé, vérifié | Message d'erreur du rayon résiduel |
| D9 (ex-D7) | Corrigé, vérifié | Réaffectation absente de l'historique visuel |
| D10 (ex-O4) | Corrigé, vérifié | Accès entreprise non actualisés sans rechargement |
| D11 (ex-W2) | Corrigé, vérifié | Erreur Leaflet `_leaflet_pos` après redimensionnement puis navigation |
| D13 (ex-W1) | Corrigé, vérifié | Pas d'interface de contestation pour l'artisan |
| O1 | Observation | La pastille d'une pièce reste « Transmis » après décision |
| O2 | Observation | Faux fichier image non signalé à la sélection (le serveur le refuse) |
| O3 | Observation | Date de créneau passée : message générique |
| O5 | Observation (UX, données) | Note 5/5 présélectionnée dans le formulaire d'avis |
| O6 | Observation | Message de validation en anglais sur `POST /api/platform-operations/reviews/[id]` |
| O7 | Observation | Contestation de 9 caractères : seule l'aide « De 10 à 2 000 caractères » reste affichée, sans message d'erreur explicite |

## 3. Données synthétiques créées ou modifiées (recette)
- **INT-825B29 :** photos, deux créneaux, réaffecté à « Artisan Recette » (`assigned`).
- **Pièces Kbis fictives v1 et v2** sur Audit Astra.
- **Lecteur :** retiré puis réinvité deux fois ; état final 2 membres, lecture limitée au site office.
- **Objets de site R1217 :** équipement, plan, exercice, calendrier, règle, contrôle ERP (réserve levée), grille publiée v1.
- **Avis 5/5 sur INT-5B12D9 :**
  - masqué puis rétabli (visible) ;
  - trois contestations, toutes rejetées.
- **Messages de test** dans le fil INT-CDD097.
