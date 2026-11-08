# Contexte de décision entreprise exact

GET `/api/quotes/[id]/decision-context?organization_id=UUID&site_id=UUID` (site facultatif).
Manager courant, membre et site accessibles sous RLS comme le point destinataire. Réponse privée no-store :
`{quote_id,intervention_id,site_id,can_write,simple_rule,simple_approval,validity}`.
`simple_rule`: null (absence prouvée) ou `{enabled,threshold_cents,required_role}`.
`simple_approval`: null (absence prouvée) ou `{id,status}` (pending/approved/rejected).
`validity`: `{valid_until:null|YYYY-MM-DD,state:"unspecified"|"valid"|"expired"}` selon UTC existant.
`can_write` exige can_manage_site et site non archivé ; ne signifie pas acceptation autorisée.
Le front combine le point devis exact (version courante, statut sent, dossier quoted), ce contexte, et GET approval avancé existant via acceptanceDecision. Seuil simple strictement supérieur ; aucune absence inférée d’une erreur. Les commandes existantes restent seules autorités de mutation.
401 session,403 rôle,404 absence/périmètre,422 paramètres,503 incohérence/indisponibilité avec Retry-After:2. Refus et erreurs jamais assimilés à absence.

Plan : réutiliser le reader destinataire et ses contrôles avant/après ; lectures bornées règle/décision/termes/droits ; tests HTTP de projection, absence, statuts, droits et échecs, régressions reader et TypeScript. Aucun SQL, UI, cloud ou nouvelle politique.
