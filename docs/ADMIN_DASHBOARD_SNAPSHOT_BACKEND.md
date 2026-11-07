# ADM-01 — aperçu exact et borné

`GET /api/admin/dashboard`, sans paramètres, session courante de rôle exact admin (Super Admin). Les simples opérateurs finance/support n'ont pas accès. Lecture SQL SECURITY INVOKER/RLS, snapshot unique ; réponses privées sans cache.

```ts
{
 counts: {interventions:number, active_interventions:number, pending_applications:number},
 active: Array<{id:string, artisan_id:string|null, category:string, city:string,
   urgency:'urgent'|'scheduled', status:string, created_at:string}>,
 pending: Array<{id:string, full_name:string, company_name:string,
   application_status:'submitted', account_created_at:string}>,
 limit:6, captured_at:string
}
```

Les trois compteurs reprennent les requêtes globales déjà exactes d'`admin_overview` : toutes interventions ; non closes (tout sauf paid/cancelled, donc completed inclus) ; tous profils professionnels avec application_status submitted. Aucun montant n'est calculé : la finance existante reste l'autorité.

La correction porte sur les lignes : `active` filtre les non-closes **avant** limite6 ; `pending` filtre les profils de rôle artisan avec candidature submitted **avant** limite6. Tri existant par création décroissante puis UUID croissant, explicitement stable. `account_created_at` est la date du compte, jamais une date de soumission. Le compteur historique des candidatures n'impose pas le rôle global artisan : en cas de changement de rôle il peut dépasser les candidatures affichables, règle historique conservée.

Ne pas déduire « aucune candidature » du tableau borné si le compteur est positif. Les identifiants permettent les ouvertures existantes ; aucun nouveau droit de détail. Projection sans téléphone, adresse, description, données client ou secret. Le prénom/nom du candidat et sa société sont déjà présents dans l'ancien DTO. L'UI doit traiter chargement/erreur comme non vérifié, puis remplacer la liste issue de l'ancienne fenêtre100.

401 sans session, 403 sans rôle, 422 paramètres, 503 résultat incohérent. Aucune modification des routes overview/interventions historiques. L'ancien total financier exact et ses distinctions restent inchangés.

Tests : 140 dossiers dont 12 actifs anciens et 130 artisans dont 9 candidatures anciennes ; l'ancien aperçu masque effectivement toutes ces lignes derrière ses 100 récents, le nouvel aperçu retrouve six de chaque. Comptages exacts, tri, données minimales, refus opérateur/client/artisan/manager/anon et retrait courant du rôle (avec un deuxième Super Admin conservé). Vraie route testée avec DB injectée, erreurs et état vide. Aucun cloud/UI dans ce lot.
