# Recheck A5 ab52b6b

Source exacte `ab52b6b63a6dddc8bf397738685f4e21025d4de7`, worktree partagé propre à l'ouverture et au dernier contrôle. Diff depuis181b919 inspecté, aucun WIP utilisé. Aucun cloud/credential/install/build/édition source.

## Deux anciens P2 fermés

- A5-ASSEMBLY-001 : contrôles de changement de statut ajoutés à TicketDetail. Ils dépendent du droit serveur can_set_status, proposent les seules transitions011, demandent confirmation, envoient expected_version exact ;409 devient conflit explicite sans resend automatique. Contrôles désactivés pendant sending ; ConfirmAction possède aussi pending et le runner sérialise les mutations.
- A5-ASSEMBLY-002 : TicketDetail a désormais une clé incluant ticket/queue et les trois capacités assistance de /me. Retrait reply avec read conservé remonte une nouvelle instance ; effet active est arrêté à l'unmount, ancien état/formulaire et promises de l'ancienne instance ne sont pas appliqués à la nouvelle. Identité A→B reste protégée par sessionKey au niveau espace.

## Nouveau P2 A5-STATUS-PERMISSIONS

`components/role/support-tickets.tsx:656–660` : après succès de set_status, setDetail conserve `...d` dont d.permissions, tout en remplaçant ticket. Le droit can_reply dépend aussi du statut du ticket (018 refuse la réponse opérateur sur resolved).

Scénario : opérateur read+reply+status ouvre ticket open avec can_reply=true, puis le résout. Le ticket devient resolved, mais permissions.can_reply reste true et le formulaire de réponse reste proposé. Inversement, rouvrir resolved→in_progress conserve le can_reply=false d'avant réouverture et n'affiche pas le formulaire avant Actualiser. Backend protège toujours la mutation : aucun bypass serveur, mais les contrôles deviennent incohérents après la propre action réussie.

Attendu : relire le détail et ses permissions serveur après un changement de statut réussi (et après erreur de droit connue), ou obtenir ces permissions dans une réponse autoritative ; ne pas conserver les permissions de l'ancien statut. Test rendu/données : open→resolved retire la réponse, resolved→in_progress la rétablit uniquement si le serveur l'autorise. Ne pas dériver les droits du rôleadmin.

## Tests et limites

**27 tests ciblés PASS**, support authority/status/lists + routes support historiques/opérateurs ; **tsc --noEmit --incremental false PASS**. Les nouveaux tests sont des unités de helpers/clés/transitions, pas un montage React ni une simulation de double clic/promesse tardive. La sécurité de remount est étayée par le câblage source, sans prétendre l'avoir exercée dans un navigateur.

Captures de contrôles et recette authentifiée réelle manquantes, explicitement conservées comme limite (démo capabilitiesfalse). Aucun grant live déduit des mocks. Verdict : anciens findings fermés, nouveau P2 à corriger avant clôture A5.
