# DETAIL-READ — lecture ponctuelle autorisée d’un dossier hors des 100 récents (proposition, aucun code)

Base `58b76414` ; branche `claude/web-remaining-contracts`. **Docs seulement** ; revue root avant tout code. Aucune modification de la recette 28b ni des fichiers UI réservés au lead (layout, globals, thème).

## 1. Constat
`app/api/workspace/route.ts` lit `interventions` `order(created_at desc).limit(100)` (plus les offres artisan). Une vue `#detail/<id>` / `#mission/<id>` d’un dossier plus ancien que les 100 plus récents visibles reste « introuvable » après le rafraîchissement causal (`docs/CLAUDE_DEEPLINK_TRUNCATION.md`), alors que le dossier existe et est lisible sous RLS.

## 2. Contrat
- **Route** : `GET /api/interventions/<id>` (nouveau fichier backend), utilisée **seulement** quand l’id est absent d’un instantané **limité**. Une requête par id ; pas de liste, pas de recherche.
- **Autorisation** : client utilisateur `authenticatedClient()` existant (jeton de session, aucune clé serveur) ; lecture **sous RLS** uniquement : `interventions_read` = `can_access_intervention(id)`, qui couvre déjà client direct (`client_id`, dossier sans site), artisan attribué (`artisan_id`), périmètre organisation/site (`can_access_site`) et admin. **Aucun élargissement** : une offre non attribuée reste invisible ici (elle n’existe que via `available_missions`, sans adresse) ; aucun `security definer` nouveau, aucune policy modifiée.
- **Champs** : exactement la forme d’un élément du workspace pour ce dossier — la ligne `interventions` (mêmes colonnes que le workspace) et, filtrés par `intervention_id`, les lignes liées que le workspace expose déjà, avec **les mêmes colonnes et les mêmes plafonds** (`quotes`, `messages` (≤ 500), `documents` (`id,intervention_id,owner_id,name,mime_type,created_at`), `payments` (`id,quote_id,total_cents,currency,status,created_at,paid_at`), `intervention_appointments` (mêmes colonnes, ≤ 200)) ; aucun champ nouveau, aucune finance nouvelle, aucun taux.
- **Réponses** :
  - `200` + enregistrement validé ;
  - `404` « introuvable » **sans divulgation** : id inexistant, invalide (non UUID ⇒ 404 aussi) ou non visible sous RLS sont **indiscernables** (même corps, même code) ;
  - `401` session absente/expirée (comme les autres routes) ;
  - `503` + `Retry-After` court pour une erreur de transport/base (`dbError` existant) : **distinct** de 404, le consommateur peut réessayer une fois ; jamais converti en « introuvable ».
  - `Cache-Control: private, no-store`.
- **Débit** : aucune nouvelle limite/compteur ; une lecture par id demandé et par génération (voir §3).

## 3. Consommateur et réponses périmées
- **Fichiers séparés** : backend `app/api/interventions/[id]/route.ts` ; types/validation `lib/features/workspace/detail-read.ts` (schéma de la réponse, même validation que les éléments du workspace) ; consommateur front `lib/features/workspace/use-detail-read.ts` (hook sans UI) ; câblage dans la vue par le lead.
- **Contexte / génération** : chaque demande porte `(profileId, id, generation)` ; la génération est incrémentée à chaque changement de session, de profil ou de rafraîchissement du workspace. Une réponse arrivant pour une génération ou un profil antérieurs est **ignorée** (périmée) ; une seule requête en vol par `(profileId, id)` ; annulation (`AbortController`) au démontage ou au changement de hash.
- **Fusion** : un 200 n’est **pas** fusionné dans la liste des 100 (le compteur « limité » reste exact) ; il alimente uniquement la vue de détail de cet id. Un événement realtime ou un rafraîchissement ultérieur invalide le cache ponctuel de cet id.
- **États UI** (texte au lead) : chargement ; 404 ⇒ « introuvable ou non accessible » ; 503 ⇒ « momentanément indisponible, réessayer » ; 401 ⇒ reconnexion.

## 4. Tests attendus (avant toute recette)
Unitaires de la route avec faux client : 200 pour client direct, artisan attribué, membre d’organisation/site ; 404 identique pour inexistant, non UUID, autre client, ancien artisan après réaffectation, membre retiré, offre non attribuée ; 503 sur erreur base ; aucune colonne hors liste ; consommateur : réponse périmée ignorée, une requête en vol, annulation. Revue SQL non requise (aucun SQL).
