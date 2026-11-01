# MESSAGE-HISTORY-001

Backend additive à partir de `0c2e66a`. Le POST existant est conservé ; aucune migration ni modification des droits SQL. Le frontend appartient au lot distinct de messagerie.

`GET /api/messages?intervention_id=UUID&limit=25&cursor=OPAQUE` requiert une session. `limit` accepte 1–100 (25 par défaut). Paramètres inconnus, répétés ou invalides refusés.

Réponse : `{messages:[{id,intervention_id,author_id,body,created_at}],page:{limit,has_more,next_cursor}}`. Ordre récent vers ancien : `created_at DESC,id DESC`. Un groupe peut être inversé pour affichage chronologique. `next_cursor` vaut null à la fin ; sinon transmettre ce curseur opaque tel quel avec le même `intervention_id`. Ne pas le construire côté UI. Le curseur est versionné, validé et lié au dossier ; il ne donne aucun droit. Les précisions PostgreSQL jusqu’à la microseconde sont conservées. La pagination ne fige pas un instantané : les nouveaux messages arrivent sur la première page ; une suppression ne bloque pas le curseur.

Le dossier est d’abord lu sous JWT utilisateur ; dossier absent ou non visible → même 404, sans lecture des messages. La lecture suivante applique à nouveau la RLS `messages_read / can_access_intervention`, notamment les droits de site révoqués. Aucun client service-role.

- 200 vide : `messages:[]`, `has_more:false`, `next_cursor:null`.
- 401 : connexion requise, avant validation des filtres.
- 404 : dossier introuvable.
- 422 : filtres/curseur invalides ou d’un autre dossier.
- 503 : lecture indisponible ou réponse incohérente ; `Retry-After: 2`.

Toutes les réponses GET portent `Cache-Control: private, no-store`. Une erreur ne retourne ni données partielles ni détails SQL.

Validation locale : `tsx --test tests/message-history.test.ts` (6 groupes, dont 237 messages, ex aequo/microsecondes, curseur après suppression, insertions récentes, accès caché, vide, erreurs et POST existant) ; `tsc --noEmit --incremental false`. Ces tests utilisent le client Supabase réel sur transport simulé ; ils ne prouvent pas la RLS hébergée. ROOT doit vérifier la preview après intégration et exécuter les refus client/artisan/organisation/site dans le projet QA dédié.
