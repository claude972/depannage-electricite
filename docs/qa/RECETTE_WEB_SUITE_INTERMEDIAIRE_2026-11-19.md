> Rapport source Claude, candidat o4n1lx6jm. Ses PASS concernent les scénarios listés uniquement ; la matrice consolidée garde PARTIEL pour les variantes restantes. Son D7 correspond au D9 consolidé.

# Recette Web — suite, rapport intermédiaire (19/11/2026, 12:20 UTC)

Auteur : Claude (mini).

**Cadre**
- Candidat : `dpl_CraUJc16vLbXGG1nDYYCpxX5bmmb` (o4n1lx6jm, commit `ec03dfb9`, D1–D6 inclus). L'alias `domdepannage-recette-20261112.vercel.app` pointe dessus.
- Base de recette : `kcpyjzndybfdlnhvscbs`.
- Comptes synthétiques existants uniquement. Les identifiants sont lus dans les fichiers privés et n'apparaissent dans aucun journal. Le code d'invitation n'a jamais été journalisé.
- Aucun LIVE, aucun paiement dans ce lot, aucune notification externe.
- Les dossiers natifs Codex INT-0E073E et INT-44B1D4 n'ont pas été touchés.
- Ceci est un rapport intermédiaire : **aucune capacité n'est déclarée close au-delà de ce qui est prouvé ci-dessous.**

Preuves : `preuves/recette-web-suite-20261119/` (`logs/` journaux JSON horodatés par étape, `captures/`, `scripts/`). Les requêtes SQL ci-dessous sont en lecture seule.

## Résultats par capacité

### ART-03 — Justificatifs et examen : PASS (variante expiration non rejouée)
Journaux : a1–a4.
- L'artisan dépose `kbis-v1-synthetique.pdf` (PDF fictif) et le relie comme Kbis, avec une expiration au 31/12/2027.
- L'admin ne peut pas enregistrer de décision sans motif : aucun envoi. Il enregistre « Modifications demandées » avec un motif ; la version 2 est ensuite proposée.
- L'artisan voit la décision et le motif. Un client tiers reçoit 404 sur les décisions et sur le document.
- L'artisan remplace la pièce par v2. L'admin l'« Accepte » avec un commentaire (le champ s'appelle alors « Commentaire »). L'artisan voit v2 acceptée.
- L'approbation de la candidature reste `approved` du début à la fin.
- Non rejoué : pièce expirée.
- Observation O1 : la pastille de la pièce reste « Transmis » après la décision ; la décision s'affiche dessous.

### ADM-02 — Décision sur dossier artisan : PARTIEL
- Prouvé : décisions motivées par pièce, historique versionné (ART-03).
- Non rejoué : décision sur une candidature complète. Les 9 dossiers artisans synthétiques sont tous `approved` (lecture SQL), et en créer un exige un lien de confirmation par e-mail (`/auth/confirm`).

### PUB-07 et ART-02 — Candidature créée et corrigée : BLOQUÉ (moyen de test)
- Pas de boîte de réception de test pour confirmer un nouveau compte artisan, et confirmer enverrait un e-mail externe.
- Modifier le dossier de l'artisan approuvé le repasserait en brouillon, et il est de toute façon verrouillé par ses missions ouvertes. Non fait.
- Débloquer demande soit une boîte de test, soit un compte artisan synthétique en brouillon fourni avec ses identifiants.

### CLI-02 — Photos à la création : PASS
Journaux : c1, c1b, c1c. Demande INT-825B29 (`825b29bd…`).
- 7 photos sélectionnées : le message « Six photos au maximum. » s'affiche. La sélection est cumulative et plafonnée à 6.
- Demande créée avec 6 téléversements `POST /api/documents 201`, puis relue côté serveur avec 6 photos liées au dossier.
- Après reconnexion, le client voit la liste « Photos (6) ». L'artisan attribué voit les 6 photos.
- Un client tiers reçoit 404 sur le dossier et sur la photo.
- Un faux PNG (octets non image) envoyé au serveur est refusé (422, « contenu ne correspond pas à un format autorisé »).
- Observation O2 : à la sélection, le formulaire accepte le faux fichier sans signalement ; seul le serveur le refuse.

### ART-05 — Offres et concurrence : PARTIEL+
Journal : r1.
- Deux sessions du même artisan acceptent la même offre simultanément : une réponse 200, une réponse 403 avec le message « Cette offre n'est plus disponible avec vos droits actuels. ».
- La lecture SQL confirme une seule ligne `accept_mission`.
- Non rejoué : course entre deux artisans distincts (un seul compte artisan dont j'ai les identifiants) et refus individuel d'une offre.

### CLI-04 — Rendez-vous et changements : PASS
Journaux : r2, r2b.
- Un créneau dans le passé est refusé (422).
  - Observation O3 : le message reste générique (« Vérifiez les informations saisies. »).
- Créneau du 25/11 de 9 h à 11 h enregistré, avec une note visible du client. Il est ensuite modifié au 26/11 de 14 h à 16 h, heure de Martinique (18:00 UTC).
- Historique serveur : deux `appointment_saved` dans `audit_log` et deux `intervention_operation_events`.
- Un tiers reçoit 404 en lecture et 403 en écriture. Une version périmée reçoit 409, sans écrasement silencieux.

### ADM-03 — Réaffectation : PASS côté serveur et droits ; défaut de traçabilité visuelle D7
Journal : r3.
- La réaffectation sans motif est refusée, avec le message « au moins 10 caractères ». Elle est ensuite enregistrée vers « Artisan Recette ».
- L'ancien artisan perd la lecture privée (404) et l'écriture (403), et son interface affiche « Dossier non chargé ».
- Le rendez-vous est supprimé, comme annoncé. Le motif est partagé dans le fil, signé « Exploitant ».
- `audit_log` contient bien `admin_reassigned` à 12:07:12 UTC.
- **D7 (qualification demandée par Codex) — défaut mineur de traçabilité d'interface, pas un échec serveur.**
  - Le bloc « Historique » de la fiche admin lit uniquement `intervention_operation_events`. Il est restreint par conception aux types rendez-vous et compte rendu (`components/role/admin-space.tsx:3666`). Il n'affiche donc ni la réaffectation, ni la suppression du rendez-vous qu'elle provoque.
  - Le « Journal d'audit » admin (`#platform-audit`) lit les actions de plateforme et de finance : aucune trace de INT-825B29.
  - Seule trace visible : le message système « Réaffectation : <motif> » dans le fil du dossier, et le changement d'artisan affiché.
  - En résumé, il y a un succès serveur prouvé (droits et `audit_log`), mais aucun écran ne présente la trace d'audit de la réaffectation.

### ENT-02 et SYS-03 — Membres, retrait, invitation : PASS
Journaux : m1, m1b.
- Le lecteur lit le dossier INT-D8EA99 (site office) : 200.
- Le propriétaire retire le lecteur. Dans la même session, le lecteur reçoit aussitôt 404 sur ce dossier, et la liste n'affiche plus les dossiers de l'organisation.
- Réinvitation en lecture, limitée au site office :
  - aucun e-mail automatique, le code est remis manuellement ;
  - un lien invalide est refusé de façon explicite ;
  - l'invitation est acceptée automatiquement après connexion ;
  - l'accès revient (200), toujours sans aucune commande d'écriture ;
  - un code réutilisé reçoit 409.
- Le journal des accès trace `member_removed`, `invitation_created` et `invitation_accepted` après rechargement.
- Observation O4 (rattachée à SYS-05) :
  - l'onglet propriétaire déjà ouvert n'a pas affiché l'acceptation sans rechargement ;
  - l'en-tête du membre retiré a continué d'afficher son ancien accès jusqu'au rechargement, alors que le serveur refusait déjà.

### ENT-04, 07, 08, 10, 11 et 14 — Opérations de site : PARTIEL+
Journal : e1 (exécution R1217).
- Équipement « tableau divisionnaire », criticité critique, emplacement « Bâtiment A · étage 2 · zone nord » : refusé sans désignation (message de champ), puis enregistré et relu après rechargement.
- Plan de maintenance mensuel lié à l'équipement, prochaine échéance le 15/12/2026 : relu.
- Exercice budgétaire 2026 :
  - une fin antérieure au début est refusée avec un message explicite ;
  - après enregistrement, l'écran affiche « Devis acceptés 434,00 € · 3 dossiers · Réglé 0,00 € ». Ce montant est cohérent avec la fiche site (434,00 € engagés) ; aucune ligne budgétaire n'est saisie.
- Calendrier ouvré (America/Martinique, lundi de 8 h à 17 h) et règle de délai (réponse 60 min, résolution 480 min) : relus.
- Contrôle ERP déclaratif (site ERP) avec une réserve : 1 réserve ouverte comptée, avec la mention « ne vaut pas certification ».
- Deux échecs bruts viennent de mes expressions de détection (casse de « critique », libellé « Devis acceptés »). Le contenu relu est conforme.
- Restent à faire :
  - levée de la réserve ERP (ENT-10) ;
  - grille publiée et versionnée (ENT-13) ;
  - onglet Historique ;
  - refus du lecteur sur ces écrans ;
  - dossier réellement suivi par une règle de délai : pause, reprise, dépassement (ENT-11) ;
  - budget saisi par ligne et écart (ENT-14).

### Non couverts sur les comptes existants
- **ENT-05, ENT-06, ENT-09 :** aucun site de type syndic ou restauration, et aucune saisie de consommation trouvée sur les fiches.
- **`#site-operations` :** refusé pour le propriétaire, car la vue est fermée par capacité. À qualifier côté Codex.

## Défauts et observations de ce lot
| Id | Gravité | Constat | État |
|---|---|---|---|
| D6 | mineur | Message d'erreur du rayon résiduel après relecture réussie | **Corrigé par Codex, vérifié sur o4n1lx6jm** |
| D7 | mineur (traçabilité) | Réaffectation absente de l'historique visuel et du journal d'audit admin ; présente seulement dans `audit_log` et le fil | Ouvert (Codex) |
| O1 | UX | Pastille de pièce « Transmis » après décision | Observation |
| O2 | UX | Faux fichier image non signalé à la sélection (refusé par le serveur) | Observation |
| O3 | UX | Créneau passé : message générique | Observation |
| O4 | SYS-05 | Membres et accès non rafraîchis sans rechargement (propriétaire et membre retiré) | À instruire en SYS-05 |

## Données synthétiques créées (recette)
- **INT-825B29** (photos, rendez-vous, réaffecté à « Artisan Recette », statut `assigned`).
- **Pièces Kbis fictives v1 et v2** sur Audit Astra.
- **Lecteur retiré puis réinvité** : état final identique, 2 membres.
- **Objets de site R1217** : équipement, plan, exercice, calendrier, règle, contrôle ERP.

## Suite immédiate
- Fin des opérations de site : réserve levée, grille, historique, refus du lecteur.
- Avis (CLI-10, ADM-06).
- Temps réel (SYS-05).
- Clavier (SYS-08).
- Flux TEST de paiement (FIN-01, 03, 04, 05, ART-11), désormais autorisés en Stripe TEST seulement.
