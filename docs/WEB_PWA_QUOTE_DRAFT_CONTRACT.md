# WEB-PWA-QUOTE-DRAFT-001 — brouillons privés persistants

Base : d85da0657586f152ee9bba941d67345b4eead616. Branche : codex/web-pwa-backend. **Plan et contrat publiés avant implémentation dans de6091d ; code et tests locaux livrés, en attente de revue et de recette intégrée en ligne.**

## Plan du lot et règles conservées

1. Migration010 additive : un brouillon privé par couple dossier/artisan, avec version optimiste monotone et tombstone après envoi/abandon ; RLS et mutation seulement par commande contrôlée.
2. Route dédiée save/load/discard/send, schémas stricts ; autorisations actuelles et verrous organisation → intervention → profil → dossier artisan → brouillon. Aucune ancienne migration, route frontend ou règle de paiement changée.
3. Envoi transactionnel par `intervention_action(...,'send_quote',...)` existante : montants recalculés par les règles serveur, devis antérieur modifié seulement à l’envoi réussi, consommation du brouillon dans la même transaction.
4. Vérifications : refus des tiers/suspension/réaffectation, version obsolète, devis envoyé externe changé, données invalides, rollback après échec de publication, devis accepté immuable ; revue et recette intégrée ensuite. Aucun nouveau barème, taux, durée de validité ou signature certifiée.

## Autorisation et portée

`GET/POST /api/interventions/[id]/quote-draft` : seul l’artisan **actuellement attribué**, approuvé avec dossier approved et non suspendu, peut lire/gérer le brouillon lorsque l’intervention est assigned ou quoted. Client, manager/owner B2B, autre artisan et admin ne lisent pas ce contenu via cette route ou RLS. Les états accepted/in_progress/completed/paid/cancelled ne permettent pas cette gestion ; un devis accepté n’est jamais modifié.

La disponibilité immédiate n’est pas requise pour travailler sur une mission déjà affectée. Une réaffectation ferme les droits ; un jeton d’attribution versionne les événements applicatifs d’acceptation/réaffectation pour empêcher un ancien onglet d’agir même si l’artisan initial est ensuite réaffecté. Ce jeton n’est pas une permission secrète : le serveur vérifie toujours l’acteur et l’état. Les mises à jour manuelles du service hors commandes auditées ne sont pas un parcours métier pris en charge.

Toutes réponses/erreurs privées/no-store. Pas de secret service-role au navigateur. 401 sans session,403 acteur non autorisé/suspendu,404 dossier inconnu,409 état/version/attribution/devis courant modifié,422 données invalides,429 limite technique de commandes atteinte,503 service indisponible.

## Chargement

`GET` renvoie :
```
{draft: Draft|null, version:number, assignment_token:string, current_quote_id:UUID|null}
Draft = {intervention_id,artisan_id,version,assignment_token,base_quote_id:UUID|null,
         lines:[{label,quantity,unit_price_cents}],tax_rate:number|null,updated_at}
```
`version=0` uniquement sans ligne persistée antérieure. Après abandon/envoi, draft=null mais version reste monotone (pas de retour à0). current_quote_id est le devis actuellement sent, jamais un devis accepté implicite. En cas d’ancienne attribution, draft=null et un nouveau jeton est fourni ; une nouvelle sauvegarde explicite avec la version et le jeton courants peut commencer un brouillon.

## Sauvegarde explicite

`POST` :
```
{action:"save",expected_version:number,assignment_token:string,base_quote_id:UUID|null,
 lines:[{label:string,quantity:number,unit_price_cents:number}],tax_rate:number|null}
```
Réponse : enveloppe de chargement avec la nouvelle version. expected_version doit égaler la version courante ; base_quote_id doit égaler le devis courant envoyé (ou null sans devis envoyé), afin de ne pas écraser silencieusement une proposition publiée par un autre canal. Le jeton d’attribution doit être courant.

Brouillon incomplet autorisé :0..30 lignes, label vide ou160 caractères maximum, quantity entier1..1000, prix entier0..10000000 centimes, TVA null ou valeur déjà supportée0/5.5/10/20. Un total nul, une ligne sans label ou une TVA absente restent **non publiables** ; aucune estimation de brouillon n’est du chiffre d’affaires. Aucun champ de total navigateur accepté. Les limites finales de publication sont celles du calcul serveur existant.

## Abandon et envoi

```
{action:"discard",expected_version:number,assignment_token:string}
{action:"send",expected_version:number,assignment_token:string}
```
Les deux exigent un brouillon actif, la version exacte et l’attribution actuelle. `discard` efface son contenu privé, conserve seulement une ligne de version et renvoie draft=null avec version incrémentée. Il ne change aucun devis envoyé.

`send` ne reçoit ni lignes ni montant : lit le brouillon stocké, recontrôle base_quote_id, puis appelle la commande métier existante. Succès : `{draft:null,version,assignment_token,current_quote_id,quote_id:UUID,intervention}` ; quote_id est précisément le devis créé par cette publication, current_quote_id lui correspond. Le brouillon est consommé et son contenu privé effacé uniquement si toute la transaction réussit. Répéter l’ancienne version donne409 et ne publie aucun doublon. Échec de validation, suspension, réaffectation ou trigger métier : aucun devis antérieur ni brouillon/version consommé. Aucun audit client des sauvegardes privées ; seul l’envoi réel suit l’historique métier existant.

## Intégration et preuves attendues

L’éditeur doit charger cette enveloppe avant sauvegarde, conserver version/assignment_token/base_quote_id, traiter409 comme conflit avec action de rechargement, et ne jamais présenter une sauvegarde comme un envoi. Après publication, relire workspace/devis et sélectionner quote_id exact. Pas d’autosave ou de résolution automatique de conflit imposé par ce contrat. Les tests SQL isolés et HTTP seront distingués des futures preuves Auth/RLS/rollback en ligne sur données QA.
