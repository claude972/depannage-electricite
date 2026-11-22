# D9 — journal du dossier administratif

Le rapport Web intermédiaire de Claude du 19 novembre appelle ce défaut D7. Dans le suivi consolidé, il porte D9 : D7 désigne déjà le transport multipart natif.

## Défaut et correction

La réaffectation était conservée dans `audit_log` et annoncée dans le fil, mais absente des historiques visibles de l’administration. Le détail administratif expose désormais les 50 dernières actions du seul dossier demandé, avec auteur et date. La limitation est explicite. Aucun changement de données, de migration ou de droits RLS ; la route exige le rôle administrateur avant la lecture.

Une erreur de lecture du journal laisse le dossier disponible et propose une reprise. Un journal réellement vide possède son propre message. Si toute la relecture du détail échoue, le journal précédent est signalé comme ancien. Les actions inconnues restent visibles sous un libellé générique.

## Vérifications locales

- 19 tests réussis, zéro ignoré : route administrative (13), interface réelle montée et fil/réaffectation (6), largeurs 390 et 1280 px.
- Autorisation avant lecture, filtre par dossier, projection minimale, ordre, plafond de 50, refus de lecture, reprise et état vide.
- Affichage de l’auteur, réaffectation, limite, erreur partielle et données anciennes après panne globale.
- TypeScript sans erreur avant le dernier ajustement de texte ; contrôle final effectué avant commit.
- Preuve hors Git : `preuves/admin-journal-regression-20261119.log` dans le dossier de livraison Codex.

La preuve déployée reste à obtenir sur INT-825B29. Aucun statut de lancement commercial n’est déduit de ces tests.
