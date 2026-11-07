# Demandes de rappel

Le canal reste fermé par défaut. Activer `PUBLIC_CALLBACK_INTAKE_ENABLED=true` après validation de la notice publique et du traitement par les opérateurs. Aucun SMS, appel automatique ni délai promis. Le numéro fourni est un contact à rappeler sans vérification d'identité.

- `GET /api/public/callback` renvoie `{available:boolean}`.
- `POST /api/public/callback` prend `{request_id,phone,reason,consent:true}` en JSON de même origine. Motifs `new_request`, `existing_request`, `other`. Consentement affiché avant envoi « J’accepte d’être rappelé à ce numéro au sujet de cette demande. » Reçu exact `{received:true}`, sans données privées. Réutiliser le même UUID pour réessayer exactement la même demande après une réponse perdue. Un autre contenu exige un nouvel UUID. Garder le numéro dans le formulaire en mémoire et hors URL, journaux et stockage navigateur. Bornes techniques en base de 30 nouvelles demandes par minute et trois par numéro par heure. Retour `429` avec `Retry-After`.
- `GET /api/support/callbacks?status=open|closed&page=1` exige `support_read` ou Super Admin. Renvoie `{items,total,can_close,page:{number,limit:25,pages}}`. Éléments `{id,phone,reason,version,created_at,closed_at}`. Version 1 ouverte, version 2 classée. Aucune lecture directe de la table par les utilisateurs.
- `POST /api/support/callbacks` prend `{id,expected_version:1}`, exige `support_read` et `support_status` ou Super Admin. Réponse exacte `{closed:true}`. Relecture après succès, réponse incertaine ou conflit `409`. L’audit garde l’identifiant interne et la version, sans numéro. Classer indique une action opérateur. Le résultat d’un appel reste inconnu.

Les réponses utilisent `private, no-store`. Les demandes restent accessibles aux opérateurs même si le canal public ferme. La durée de conservation du numéro et les modalités d’ouverture relèvent de la politique de l’exploitant.
