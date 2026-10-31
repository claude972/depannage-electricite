# WEB-PWA-ADMIN-LISTS-001 — contrat des dossiers administrateur

Base : f132f6a. Branche : codex/web-pwa-backend. **Contrat publié avant implémentation ; route non encore disponible à cette révision.** Aucune migration SQL prévue : utiliser les politiques RLS et les lectures utilisateur existantes, sans service-role.

## Autorisation et données

`GET /api/admin/interventions` : session Auth vérifiée et rôle plateforme admin requis avant toute lecture des dossiers. Client, artisan, manager, owner B2B ne gagnent aucun accès via ce point d’entrée. Réponses et erreurs `Cache-Control: private, no-store`. Aucun secret, coordonnées de contact, pièce ou revenu fictif ajouté.

## Liste

Paramètres facultatifs (noms inconnus ou doublons refusés422) :
- `limit` : entier1..100, défaut25.
- `cursor` : curseur opaque base64url renvoyé par cette même API ; pas un offset. Toute modification des filtres exige de repartir sans curseur. Changer la limite ne change pas les filtres.
- `status` : requested/assigned/quoted/accepted/in_progress/completed/paid/cancelled.
- `category` : outage/panel/socket/lighting/diagnostic.
- `urgency` : urgent/scheduled.
- `site_id`, `artisan_id` : UUID exacts.
- `created_from`, `created_to` : dates ISO8601 complètes avec timezone, bornes inclusives, jusqu’à6 décimales de secondes. Début après fin refusé.
- `q` : texte normalisé de2..80 caractères, recherche littérale insensible à la casse dans description, ville et code postal. Lettres Unicode/accents/chiffres/espaces/tirets/apostrophes autorisés ; métacaractères de filtre et wildcards refusés. Un UUID complet est interprété comme référence exacte de dossier, pas comme texte. Valeur vide efface la recherche.

Réponse :
```
{
  interventions: [{id,client_id,artisan_id,site_id,category,city,postal_code,urgency,status,created_at,updated_at}],
  page: {limit,has_more,next_cursor:string|null,total:number},
  filters: {status,category,urgency,site_id,artisan_id,created_from,created_to,q}
}
```
`total` est un COUNT exact sous RLS, sur **tous les filtres et avant le curseur**, jamais le nombre de lignes de la page. Le COUNT et la page sont deux lectures : en présence de modifications concurrentes, ils ne constituent pas un snapshot transactionnel commun. Les lignes et filtres reflètent leurs lectures serveur respectives.

Tri : `created_at DESC, id DESC`, identifiants comme départage stable des dates égales ; un élément supplémentaire détermine has_more. Le curseur conserve le timestamp PostgreSQL exact (microsecondes incluses), l’UUID et une empreinte des filtres normalisés ; format/version/valeurs/empreinte invalides donnent422. Ce curseur n’est ni un jeton de permission ni une signature : les contrôles admin/RLS restent obligatoires à chaque page. Pas de doublons/omissions sur un jeu inchangé ; les nouvelles insertions/modifications entre pages nécessitent une actualisation pour une vue courante complète.

## Détail d’un dossier ancien

`GET /api/admin/interventions?id=UUID` : mode détail, `id` seul admis. Réponse `{intervention,quotes,quotes_limit:50,quotes_limited:boolean}` : dossier métier (dont adresse/description autorisées à l’opérateur), jusqu’aux50 derniers devis par created_at/id décroissants ; chaque devis garde son ID exact/version et ses lignes/montants. Aucun total d’historique extrapolé ; quotes_limited signale une troncature.

Pour contacts, rendez-vous, rapport et historique des opérations, compléter avec `GET /api/interventions/[id]/operations` existant sous les mêmes droits. Les listes workspace/dashboard bornées à100 restent inchangées. Le frontend doit ouvrir le résultat renvoyé par cette route, pas rechercher seulement l’ancien dossier dans workspace100. La messagerie et les documents commerciaux exhaustifs ne sont pas élargis par ce lot.

## Erreurs et vérification attendue

401 sans session,403 hors admin,404 dossier inconnu,422 paramètres/curseur invalides,503 fournisseur indisponible. Vérifier >100 dossiers avec dates égales et microsecondes distinctes : toutes les pages sans doublon, total filtré invariant sur jeu fixe, filtres avant limites ; refus interrôles, recherche malveillante, curseur malformé et bornes invalides. Aucun test local ne remplace la recette Auth/PostgREST et UI en ligne du checkpoint intégré.
