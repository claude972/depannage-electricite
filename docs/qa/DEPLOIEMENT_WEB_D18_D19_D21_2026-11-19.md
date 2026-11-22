# Vérification de la recette web D18/D19/D21

Rapport de la session distante, relu le 19 novembre à 15:14 UTC. READY et alias n2scdfas8 confirmés indépendamment par le connecteur Vercel.

## D18, D19 et D21 (19/11, ~15:00–15:11 UTC)
**Correctifs.** D18 (Codex d6c06ee) et D19 (Codex 5dea421) sont intégrés dans le commit Claude `34e6558f` ; les fichiers sont identiques à ceux de Codex. tsc 0, routes plateforme 8/8.

**Candidat n2scdfas8 (`dpl_4fH2yFC1WHEQPb6x9eb3r5sf9pYi`)**, READY, cible preview.
- **D18 :** les motifs de 9 et de 2 001 caractères reçoivent 422 avec un message en français. Aucune contestation créée (3 avant, 3 après).
- **D19 :**
  - à 390 et 1280 px, huit opérateurs distincts « Admin Recette · réf. xxxxxxxx » ;
  - un seul « (vous) », sur le compte courant `…cff732ca` ;
  - le nom accessible porte la référence complète ;
  - les tickets résolus sont en lecture seule, leur attribution n'a pas été modifiée ;
  - la liste a été vérifiée sur un ticket synthétique « RECETTE D19 », résolu ensuite sans attribution.
- **O11 :** l'historique de triage affiche l'auteur sous la forme « opérateur INT-2F07C2 » ; le préfixe `INT-` prête à confusion avec une référence de dossier.
- **Non-régression :** 16/16 ; Leaflet 0 erreur ; panneau D13 présent.

**Alias `domdepannage-recette-20261112.vercel.app` → `dpl_4fH2yFC1WHEQPb6x9eb3r5sf9pYi` (n2scdfas8).**

**D21 :** migration appliquée sur la recette seule et vérifiée en HTTP (voir `CORRECTIF-D21-PAUSE-SLA-20261119.md`).

## Migration D21

 (19/11, 15:07–15:11 UTC) — Supabase `kcpyjzndybfdlnhvscbs` uniquement
**Avant application**
- Comparaison de l'historique distant (`supabase_migrations.schema_migrations`, lecture seule) avec le dépôt : 133 versions distantes, 134 locales.
- **Seule `20261119140000` manquait**, et aucune version n'existait côté distant seulement.

**Application**
- Le dépôt n'est pas lié à la CLI sur le mini, donc `db push` est indisponible.
- Le fichier exact a été appliqué dans **une seule transaction**, avec l'insertion de sa ligne d'historique `schema_migrations(version='20261119140000', name='sla_pause_observed_dates', statements=[texte du fichier])`, comme le fait la CLI.
- Script conservé : `preuves/recette-web-suite-20261119/logs/apply-d21.sql`.

**Relecture**
- Version présente dans l'historique.
- Déclencheur `site_sla_pause_observed_dates` actif (`tgenabled=O`).
- **La pause future déjà observée (`SYNTH-SLA-B`, `8743f3d7…`, 16/11 20:40 → 23/11 12:10 UTC) est inchangée.** Elle est conservée comme historique, sans réécriture.

**Vérification HTTP** sur le candidat aliasé n2scdfas8, dossier `SYNTH-SLA-INT-B3B9AD` (`e18be779…`) :
| Action | Résultat |
|---|---|
| Début de pause futur | 422, version 1 → 1, 0 pause |
| Début de pause passé (14:41 UTC) | 200, version 2 |
| Reprise future | 422, version 2 → 2, pause toujours ouverte |
| Reprise passée | 200, version 3, pause close |

- Message 422 générique « Vérifiez les informations saisies. » (comme O3).
- Journal : `log-d21-http.json`.
- Aucun autre objet, aucune production, aucun LIVE.
