# Compteurs exacts du tableau de bord entreprise

`POST /api/enterprise/overview` est une lecture seule authentifiée. En-tête `Origin` obligatoire et égal à l'origine de la requête. Corps exact :

```json
{"organization_id":"UUID","site_id":null}
```

`site_id` peut être un UUID du site courant. Réponse :

```json
{"organization_id":"UUID","site_id":null,"counts":{"open":123,"urgent":61},"captured_at":"2026-11-07T00:00:00Z"}
```

Les nombres d'exemple sont synthétiques. `open` compte requested/assigned/quoted/accepted/in_progress, exactement comme `OPEN_STATUSES` dans l'espace entreprise ; `urgent` est le sous-ensemble urgency=urgent. Les completed/paid/cancelled sont exclus. Aucun filtre temporel, aucune limite bootstrap100, aucune pagination nécessaire pour ces agrégats. Les deux nombres sont calculés dans le même snapshot SQL, entiers positifs ou nuls, urgent ≤ open.

Rôle courant exact manager, membre actuel de l'organisation, site éventuel visible et appartenant à cette organisation. Fonction SECURITY INVOKER soumise aux RLS des sites et dossiers. Un membre viewer limité à certains sites peut lire leurs compteurs sans recevoir de droit d'écriture. Sans site sélectionné, la portée comprend uniquement les sites accessibles de l'organisation ; aucun site accessible donne zéro. Un site explicitement inaccessible ou hors organisation donne 404. L'archivage ne change pas les sémantiques historiques de recherche ni les statuts des dossiers.

401 session absente ; 403 origine/rôle ; 404 périmètre inaccessible ; 422 corps invalide ; 503 résultat invérifiable. Réponses privées sans cache. L'UI doit invalider l'ancien résultat quand le contexte change ; erreur/chargement ne signifient jamais zéro. Utiliser ces compteurs pour les cartes globales du périmètre, pas comme total d'une liste ayant d'autres filtres.

Ce delta ne fournit ni budget, ni engagement financier, ni SLA, ni échéances/approbations. `siteBudgetBars` et `dashboardFigures` utilisent notamment devis acceptés + avenants acceptés ; aucun recalcul ou changement de cette règle n'est introduit.

Contrôles : SQL migré isolé avec 123 dossiers ouverts sur site sélectionné (61 urgents), 134/72 sur organisation entière ; site viewer lecture seule, comptes/organisations/sites étrangers, statuts fermés, retrait du site, rôle et adhésion. Vraie route testée avec DB injectée, schéma strict et refus sans origine. Aucun cloud ni test UI dans ce lot.
