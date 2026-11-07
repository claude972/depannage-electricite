# SYS-07 / ADM — examen des demandes d’effacement

Base `140fede`, branche `codex/data-erasure-requests`, migration CLI `20261107214517_data_erasure_requests.sql`. Aucun fournisseur, suppression ou exécution de rétention. L’export de données personnel existant reste inchangé pour ses sections précédentes ; ce lot ne prétend pas étendre sa couverture à toutes les données du système.

## Parcours personnel

`POST /api/profile/data` conserve `{action:'request_erasure',request_id:uuid,confirmed:true}`. L’UUID doit être créé avant appel puis réutilisé après une réponse perdue. La réponse conserve `{ticket_id,status,replayed}` pour le parcours existant et ajoute :

```ts
request: {
 id: string; ticket_id: string;
 state: 'requested'|'in_review'|'needs_information'|'approved'|'rejected';
 execution_state: 'not_started'; version: number;
 created_at: string; updated_at: string;
}
```

`status` est uniquement l’état du ticket de discussion. La demande possède son état indépendant. Ni `approved` ni un ticket `resolved` ne signifient données effacées. Aucune API de ce lot ne peut modifier `execution_state`.

`GET /api/profile/data?section=erasure_requests[&after=uuid]` retourne `{section,rows:Request[],next_cursor:uuid|null}`, page de 100 maximum, ordre UUID ascendant stable comme l’export existant. Liste strictement limitée au compte courant, y compris si celui-ci détient un scope opérateur. Le contenu, le titre, les messages du ticket et l’identité des opérateurs ne figurent pas dans cette projection.

Le serveur conserve la liaison structurée `(account_id, request_id) → request.id → ticket_id`. Il réutilise `create_support_ticket` avec la commande exacte et ses paramètres constants, dans la même transaction. Une ancienne demande qui possède encore son UUID peut ainsi retrouver son ticket exact et créer le suivi associé sans doublon. Aucune recherche par titre, aucun backfill historique ni adoption automatique d’un ticket ambigu. Un UUID déjà utilisé pour un autre contenu échoue 409. Les tickets restent privés sous leurs permissions existantes et leurs plafonds existants.

## Examen opérateur

- `GET /api/admin/data-requests?limit=25&after=uuid` : liste privée paginée, limit 1–100, scope courant `support_read` obligatoire.
- `GET /api/admin/data-requests/[id]` : `{request,history,can_decide}` ; journal ordonné `{id,actor_id,from_state,to_state,reason,version,created_at}`. Aucun message ou titre du ticket.
- `POST /api/admin/data-requests/[id]` : `{command_id:uuid,expected_version:number,state:'in_review'|'needs_information'|'approved'|'rejected',reason:string}` → `{request,replayed}`. Motif explicite de 1 à 1000 caractères, sans texte juridique prérempli.

`support_read` **et** `support_status` courants sont requis pour décider ; la fonction existante verrouille les habilitations pour sérialiser la révocation. Les règles existantes du super administrateur sont conservées. Un opérateur financier, un opérateur sans lecture support ou le propriétaire seul ne peut pas décider ni consulter le journal d’un autre compte. Toute reprise revérifie les droits.

L’ordre de verrouillage reprend habilitations → ticket → demande. La création reprend le verrou de profil compatible avec les FK du support. Chaque décision exige la version exacte ; un rejet concurrent laisse la transaction intacte. La commande et le journal sont uniques, dans la transaction qui change l’état. Un rejeu exact renvoie l’état actuel sans nouvelle entrée ; un rejeu divergent est refusé. Les états approuvé/rejeté sont terminaux pour cette décision. La limite de 100 versions est une borne technique du journal, sans durée ou obligation légale.

Schéma `data_request_private` non exposé, RLS de défense et aucun droit direct aux tables. Seules les RPC autorisées aux sessions authentifiées effectuent les lectures et mutations, en recalculant propriétaire ou scope. La session ne reçoit aucun choix libre de compte cible dans la création.

## Vérifications et limites

Tests SQL isolés : création/rejeu, collision de commande, liaison historique exacte, liste personnelle et pagination, refus anonymes/intercomptes/scopes, révocation réelle, décision versionnée, clôture support indépendante et exécution toujours non commencée. Tests des routes réelles avec dépendances injectées : export préservé, paramètres, projection sans contenu du ticket, consentement/origine, refus SQL et retour opérateur. Aucun test cloud ou fournisseur.

La suppression effective reste un chantier distinct : inventaire des données concernées, exclusions et dépendances validées, autorisation d’exécution, preuve durable des opérations et reprise partielle. Ce lot ne fixe aucun délai légal et n’annonce jamais un effacement réalisé.
