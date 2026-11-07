# Résumé professionnel entreprise exact

`POST /api/enterprise/overview/professional` — lecture authentifiée, Origin exact obligatoire. Corps strict `{organization_id:UUID,site_id:UUID|null}`. Aucun paramètre de date contrôlé par le navigateur.

```ts
{
 organization_id:string,site_id:string|null,
 counts:{approvals_pending:number,deadlines30:number},
 amounts:{accepted_commitment_cents:number,reference_budget_cents:number,currency:'eur'},
 window:{from:'YYYY-MM-DD',to:'YYYY-MM-DD',time_zone:'America/Martinique'},
 captured_at:string
}
```

Manager courant, membre actuel de l'organisation, sites et données sous SECURITY INVOKER/RLS. Un viewer de sites sélectionnés peut lire les chiffres accessibles. Sans site sélectionné, agrégation des seuls sites visibles ; un site explicite inaccessible ou étranger donne404. Aucun nom/contact/dossier ni liste de sites n'est transmis. L'archivage ne supprime pas le périmètre historique accessible.

- `approvals_pending` : lignes `approvals.status=pending` des sites du périmètre, comme `dashboardFigures`. Compte les demandes simples, pas les étapes individuelles d'approbation avancée.
- `deadlines30` : `compliance_records.status<>completed`, date due entre aujourd'hui et aujourd'hui+30 inclus. Date calculée côté SQL à partir du même statement_timestamp dans America/Martinique ; échéances déjà dépassées exclues. Aucun délai inventé : horizon30 de l'indicateur existant, aujourd'hui local explicite.
- `accepted_commitment_cents` : somme des devis de base acceptés et avenants acceptés liés au même devis/dossier/artisan, règle exacte de `accepted_quote_totals` (027). Les bases rejetées et avenants proposés/rejetés sont exclus. Pas de filtre d'exercice, pas de déduction des paiements/remboursements, pas de revenu ni de consommation budgétaire.
- `reference_budget_cents` : somme indépendante de `sites.budget_cents` ; zéro peut représenter un budget non renseigné. Aucun rattachement à un exercice fiscal ou aux lignes de budget. Ne pas l'afficher comme un solde disponible.

Une seule instruction SQL produit tous les agrégats et le timestamp ; aucune fenêtre100/200 ni pagination. Le total financier hors entier sûr échoue explicitement. Schéma HTTP strict, périmètre et fenêtre temporelle revérifiés. 401 session,403 origine/rôle,404 périmètre,422 corps,503 données invérifiables. Réponse privée sans cache ; état erreur/chargement ne vaut pas zéro.

`professional_report` reste l'autorité financière détaillée par site, avec règles supplémentaires de preuve des paiements/remboursements. Il n'est pas appelé ici pour ne pas faire dépendre les compteurs d'approbation/conformité de ces états ; seuls les engagements027 sont calculés. Aucun SLA, état de conformité réglementaire, facture ou exercice n'est redéfini. L'endpoint `/api/enterprise/overview` existant n'est pas modifié.

Tests SQL :123 devis+avenants acceptés et120 échéances sur site sélectionné, limites J0/J30 et exclusions J-1/J31/terminée, équivalence au RPC027, devis rejeté/avenant proposé exclus, autre site/org, viewer readonly, retrait de portée/rôle/adhésion. Vraie route avec DB injectée : bornes entiers sûrs, données privées supplémentaires refusées, jour Martinique avant/après04hUTC. Aucun UI/cloud.
