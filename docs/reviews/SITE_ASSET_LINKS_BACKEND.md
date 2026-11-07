# ENT-07/08 — liens explicites dossier / actif

Branche backend fondée sur `64c9186` (cycle de vie des sites), claim `df3a2fc`. Migration `20261107142109_site_asset_intervention_links.sql`. Aucun fournisseur, secret, déploiement ou écran ajouté.

## Contrat pour l’interface

`GET /api/sites/{site_id}/asset-links?kind=equipment|area&asset_id={uuid}` retourne les dossiers déjà liés à cet actif. Variante exclusive : `?intervention_id={uuid}` pour les actifs d’un dossier. Ajouter `cursor` opaque pour la suite. Une page contient au plus 50 lignes ; `page.has_more`, `next_cursor` et `complete` indiquent uniquement la pagination, sans total inventé. `complete` est vrai seulement pour une première page sans suite. Les droits courants figurent dans `permissions.can_write`, et `site_archived` signale le site en lecture seule.

Une ligne expose `id, site_id, intervention_id, kind, asset_id, active, version, created_at, updated_at, detached_at`, plus `asset_archived` et `intervention: {id, category, status, created_at}`. Aucun contact, adresse, description ou auteur d’audit n’est exposé. Les libellés des actifs restent fournis par les API existantes. Les curseurs sont liés au site, utilisateur et filtre ; ils ne constituent pas une autorisation. La pagination n’est pas un instantané : rafraîchir après une mutation.

`POST` sur la même URL, JSON strict :

```json
{"command_id":"uuid créé avant soumission","intervention_id":"uuid","kind":"equipment","asset_id":"uuid","action":"link","expected_version":null}
```

`kind` accepte `equipment` ou `area`; `action` accepte `link` ou `unlink`. Première liaison : version attendue `null`. Détachement ou réactivation : version actuelle obligatoire. Réponse `{record, replayed}`. Conserver exactement la commande et son UUID lors d’un retry ; un UUID réutilisé avec un autre contenu est refusé. Un replay retourne le reçu initial immuable, pas nécessairement l’état actuel : relire après succès. Un retrait des droits empêche même ce replay. Une nouvelle intention exige un nouvel UUID.

## Invariants

- Membre courant autorisé du site pour lire ; droit courant de gestion pour écrire. Un administrateur extérieur sans adhésion ne contourne pas ce contrôle.
- Dossier et actif du même site, imposé aussi par clés étrangères composites. Plusieurs actifs possibles ; aucune modification des dossiers historiques et aucun remplissage automatique.
- Historique des dossiers liés conservé après détachement, retrait d’équipement, archivage de zone ou de site. Ce service ne constitue pas un journal public détaillé de tous les événements ; les reçus d’audit sont privés.
- Nouveaux liens refusés sur actif archivé/retiré ; nouvelles mutations refusées sur site archivé. Les relations historiques empêchent le déplacement ou la suppression physique des objets référencés.
- Limites techniques explicites : 50 liens actifs et 100 actifs distincts historiquement par dossier, 60 actions par minute selon le mécanisme existant. Réactivation d’un lien existant possible au plafond historique. Aucun tarif, SLA ou télémétrie ajouté.
- Verrouillage organisation/site puis dossier/actif ; contrôle de version et reçu unique atomique. Les rôles API n’ont aucun accès direct aux tables ; projections strictes via fonctions contrôlées.

## Vérification

- TypeScript strict : PASS.
- Sept tests des vrais handlers HTTP : PASS (curseurs, permissions, origin/auth, corps strict, projections étrangères/PII, archivage et reçus).
- Revue SQL dédiée : 209 assertions PASS, 45 migrations réelles sous PGlite, Auth/Storage/cron simulés ; contrôle nominal, refus inter-sites/inter-organisations, lecteur, retrait de droits, admin non membre, audit unique, reçus, caps et pagination.
- Régressions ciblées zones (58 assertions) et cycle de vie sites : PASS.
- Pas de preuve multi-connexion ni de vérification cloud/preview. Les entrelacements de versions sont testés séquentiellement ; une recette interface et une vérification sur PostgreSQL déployé restent des contrôles d’intégration.
