# ENT-12 — Approbations avancées du devis initial

Contrat backend depuis 4c9d7a1. Aucun cloud, fournisseur ou UI livré dans ce lot. Types importables : `lib/features/advanced-approvals/contract.ts`.

## Politique explicite par site

`GET /api/sites/<id>/approval-policy` retourne `{site_id,policy,can_manage}`. `policy` vaut null ou `{version,enabled,threshold_cents,steps}`.

`POST /api/sites/<id>/approval-policy` :

```ts
{
  command_id: string; expected_version: number | null;
  enabled: boolean; threshold_cents: number;
  steps: ({role: "owner" | "manager"} | {user_id: string})[];
}
```

Seul le propriétaire canonique courant, membre owner de l’organisation, configure. Chaque étape choisit un rôle exact ou un membre nommé, jamais les deux. Un owner n’est pas implicitement manager. Un membre nommé doit avoir accès au site ; il ne reçoit aucun autre droit de gestion ou d’acceptation commerciale. Une à dix étapes ; seuil entier en centimes, explicitement choisi, de 0 à 100 000 000. Le circuit s’applique au total du devis strictement supérieur au seuil.

Première version attendue null. Réponse `{site_id,version,replayed}`. Les politiques actives remplacent la règle simple sur ce site. Sans politique avancée active, les règles simples restent utilisées. Désactiver recrée les lignes d’approbation simples nécessaires aux devis encore envoyés. Aucun effet rétroactif sur les devis déjà acceptés.

## Dossier d’approbation

`GET /api/quotes/<quoteId>/approval?after=<version>` retourne :

- `quote_id,site_id,required,approved_current` ;
- `policy` courante ou null ;
- `workflow` null ou `{version,policy_version,state,current_step,steps,snapshot_matches}` ;
- `permissions:{can_submit,can_decide,can_respond}` ;
- `events:[{version,actor_id,action,note,created_at}]`, `next_after` (null ou dernière version de la page, 50 éléments maximum).

Lecture selon les droits existants du dossier. Aucun élargissement RLS. Les événements conservent acteur/date/commentaire, sans exposer d’email ou coordonnées. Le stockage privé conserve aussi les instantanés complets des circuits et propositions pour l’audit.

`POST /api/quotes/<quoteId>/approval` :

```ts
{
  command_id: string; expected_version: number | null;
  action: "submit" | "approve" | "reject" | "request_information" | "respond";
  note: string; // 2 000 caractères maximum
}
```

Réponse `{quote_id,version,state,current_step,replayed}`. Conserver le command_id avant soumission et lors d’une reprise réseau. Un changement du corps avec le même UUID est refusé. Recharger après reçu historique/rejeu ou conflit.

1. Un membre ayant le droit de gérer le site soumet le devis envoyé courant (`submit`). Première soumission : version null. Une nouvelle soumission avec la version courante remet explicitement toutes les étapes à zéro et conserve l’historique.
2. Seul un approbateur de l’étape courante peut approuver, rejeter ou demander un complément. Les identités, rôle et accès au site sont revérifiés en SQL.
3. `request_information` suspend l’étape. Note obligatoire. L’artisan titulaire approuvé ou un gestionnaire du site répond (`respond`, note obligatoire), puis la même étape redevient en attente.
4. `approve` avance d’une étape ; la dernière rend le circuit approuvé. `reject` clôt cette soumission (motif obligatoire). Une nouvelle soumission explicite reste possible.
5. L’accord commercial utilise ensuite **l’endpoint et `intervention_action(...,'accept_quote',...,quote_id)` existants**. Une approbation interne ne vaut jamais acceptation client et n’en confère pas les droits.

Le garde d’acceptation exige le devis exact, ses lignes/taxes/montants/validité, la version de politique et les autorités actuelles des approbateurs. Modifier la proposition ou la politique exige une nouvelle soumission. Les verrous organisation → intervention → devis sérialisent décisions, politique, conditions et acceptation. Aucun remboursement ou mouvement financier.

## Limites et erreurs

Ce lot concerne le **devis initial**. Les avenants passent par un chemin différent ; validation de réception de travaux, de facture et nouvelles pièces jointes ne sont pas ajoutées ici. Les documents et conditions du devis existants restent consultables selon leurs droits.

401 session ; 403 autorité ; 404 objet non accessible ; 409 révision/état/proposition périmés ; 422 saisie ; 429 limite ; 503 vérification indisponible. États vides honnêtes : aucune politique, aucune soumission ou aucun événement. Réponses privées sans cache. L’UI doit recharger après conflit et ne pas déclarer d’accord optimiste définitif.

Preuves locales : handlers réels avec frontière SQL simulée, exécution des migrations et fonctions sous PGlite avec Auth/Storage/cron simulés, accord final via la fonction commerciale réelle. Interleavings séquentiels uniquement ; recette hébergée et concurrence multi-connexion restent à vérifier.
