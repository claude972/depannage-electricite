# WEB-PWA-SUPPORT-001 — assistance privée persistante

Base :254d497e92b2e6e6286dbb59254660dc39aa27f3. Branche codex/web-pwa-backend. **Plan/contrat publiés avant code ; pas encore implémenté à cette révision.**

## Plan et périmètre

1. Migration011 additive : tickets, messages et événements immuables, accès privé et commandes transactionnelles contrôlées.
2. Routes /api/support et /api/support/[id] : création, liste/détail paginés, réponse et état ; aucune ancienne route, migration ou fonction financière changée.
3. Tests SQL (RLS/tiers/retrait/version/auteur/transition/rollback), tests HTTP et étape CI isolée ; revue Claude puis recette QA dédiée en ligne après autorisation d’application du schéma.

Aucun appel téléphonique, email, SMS, notification push, formulaire anonyme ou délai/SLA promis. Les informations évoluent dans l’app par lecture/rafraîchissement de ces API ; ce lot n’ajoute pas un centre de notifications non-lues ni une surveillance automatique. Aucun nouveau rôle opérateur : l’administration plateforme existante traite les tickets ; aucune note interne dans ce premier lot et aucun accès supplémentaire à la messagerie des interventions.

## Confidentialité et identité

Ticket lisible seulement par son créateur et l’administration plateforme. Si intervention_id est renseigné, **le créateur doit encore avoir accès à ce dossier** pour lire/répondre ; retrait de membre, réduction de portée site et réaffectation artisan retirent cet accès. Un autre membre du même site/organisation ou l’artisan affecté ne lit pas le ticket d’un tiers. Un ticket ne donne aucun droit d’action sur l’intervention liée.

Auteur, type user/admin, dates et versions sont produits côté serveur. Messages/événements sans mutation directe authenticated/anon ; seuls les RPC contrôlés peuvent insérer. Aucune identité, coordonnées ou email client supplémentaire projeté : pour l’utilisateur, les réponses opérateur peuvent être affichées « Assistance ». Toutes les réponses/erreurs privées/no-store. 401 sans session ;403 rôle/droit refusé ;404 détail inconnu/non lisible ;409 version/transition/contenu de clé idempotente en conflit ;422 schéma ;429 limite ;503 fournisseur.

## Cycle d’états et versions

Création : open, version1, message initial et événement ticket_created.

Changements explicites **admin uniquement** : open → in_progress/awaiting_user/resolved ; in_progress → awaiting_user/resolved ; awaiting_user → in_progress/resolved ; resolved → in_progress. Même état ou autre transition refusée409. Chaque commande exige expected_version exact et incrémente version ; une réponse concurrente oblige l’opérateur à relire avant changement d’état.

Réponse créateur : en open/in_progress garde l’état ; en awaiting_user ou resolved **réouvre à open**. Réponse admin : conserve l’état, mais resolved doit être explicitement réouvert avant réponse. Toutes ces décisions sont visibles dans l’historique, pas d’état implicite non tracé. Chaque réponse crée exactement un message et un événement replied pour sa nouvelle version. Une répétition avec l’ancienne version est409, pas un double message. Préserver le texte local après un conflit ; ne pas le renvoyer automatiquement.

Verrous : organisation liée → intervention liée → ticket ; création verrouille aussi le profil créateur avant insertion pour sérialiser la clé idempotente. L’accès courant est recontrôlé après ces verrous. Aucune action financière ou opération de chantier dans ces commandes.

## Création

`POST /api/support` :
```
{request_id:UUID,subject:string,body:string,intervention_id:UUID|null}
```
subject4..160 caractères, body10..4000 caractères après trim. Le serveur crée et lie uniquement un dossier actuellement lisible, ou aucun dossier. Clé request_id UUID aléatoire générée une fois pour cette création : même créateur+clé+contenu répété rend le ticket existant avec replayed:true, sans doublon message/événement ; même clé avec contenu différent est409. Un accès dossier révoqué n’est pas contourné par cette clé. Limite technique5 nouvelles créations/minute/compte, hors relecture d’une clé identique.

Réponse : `{ticket,initial_message,replayed:boolean}`. Ticket={id,creator_id,intervention_id,subject,status,version,created_at,updated_at,last_message_at}. Message={id,ticket_id,author_id,author_kind:"user"|"admin",version,body,created_at}. Aucun identifiant d’auteur/état/version fourni par le navigateur accepté.

## Liste

`GET /api/support` : limit1..100 (défaut25), cursor opaque ; scope mine/all (défaut mine pour utilisateur, all pour admin ; all interdit hors admin) ; status enum ; intervention_id UUID ; q recherche littérale sujet2..80 caractères, alphabet lettres Unicode/accents/chiffres/espaces/tirets/apostrophes, pas de wildcard/délimiteur de filtre. Paramètres inconnus/dupliqués refusés422.

Réponse : `{tickets,page:{limit,total,has_more,next_cursor},filters:{scope,status,intervention_id,q}}`. Tri created_at DESC,id DESC, curseur versionné conservant microsecondes exactes et lié aux filtres normalisés. Total COUNT exact avant curseur/RLS, jamais taille de page. Le COUNT et la page ne sont pas un snapshot transactionnel commun en présence de modifications concurrentes. Changer un filtre exige de repartir sans curseur ; limite peut changer.

## Détail et historique

`GET /api/support/[id]?limit=50&after_version=0` ; limit1..100, after_version entier≥0 ; seuls ces paramètres sont admis. Réponse :
```
{ticket,messages,events,
 permissions:{can_reply:boolean,can_set_status:boolean},
 page:{limit,after_version,next_after_version:number|null,has_more,total_events,total_messages}}
```
Événements par version ASC, un événement par version. La page contient jusqu’à limit événements après after_version et les messages de ces mêmes versions, sans réclamer tous les messages historiques en une fois. Totaux serveur exacts de tout le ticket. Event={id,ticket_id,actor_id,kind:"ticket_created"|"replied"|"status_changed",from_status:null|Status,to_status:Status,version,message_id:UUID|null,created_at}. Aucun corps de note interne ou champ caché partagé.

## Réponse et traitement

`POST /api/support/[id]` :
```
{action:"reply",expected_version:number,body:string}
{action:"set_status",expected_version:number,status:Status}
```
body1..4000 caractères après trim ; version entière1..2147483647. Limite30 commandes réussies/minute/compte ; erreurs transactionnelles ne consomment pas un faux succès. Réponse `{ticket,message:Message|null,event}` avec auteur et nouvelle version serveur. Un rôle non admin ne peut pas imposer un statut ni se présenter comme opérateur ; aucun champ d’auteur/type/dates supplémentaire admis.

## Limites de ce lot

Pas de suppression/archivage automatique, pièces jointes, attribution aux équipes, séparation support/finance, import email, contact public ou export intégral implicite. Les commandes n’annulent ni ne remboursent une intervention. Une copie déjà lue ne peut pas être révoquée à distance ; les requêtes suivantes suivent la RLS courante. La recette doit distinguer tests isolés, Auth/PostgREST réels et UI/preview.
