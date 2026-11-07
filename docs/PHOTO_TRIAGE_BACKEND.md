# SYS-10 — triage visuel privé, fournisseur inactif

Baseb8d8a96 ; migration CLI `20261107211940_private_photo_triage.sql`.

Ce lot classe seulement l’objet visible et la lisibilité. Il ne fournit **aucun diagnostic, conseil de sécurité, estimation, certification ou décision métier**. L’assistance/revue humaine existante reste indépendante. L’ouverture fournisseur, les clauses de transmission et l’évaluation représentative restent à recetter avant activation.

## Contrat UI

`GET /api/interventions/:id/photo-review` et tous les POST réussis répondent :

```ts
{
 provider_available: boolean,
 can_request: boolean,
 items: Array<{
  id: string; document_id: string; version: number;
  status: 'requested'|'withdrawn'|'uncertain'|'awaiting_review'|'validated'|'rejected'|'invalidated';
  can_withdraw: boolean; can_review: boolean;
  result: null | {
   category: 'panel'|'socket'|'lighting'|'other'|'undetermined';
   readability: 'readable'|'limited'|'unusable';
  };
 }>;
}
```

Libellés : tableau / prise / éclairage / autre / indéterminée ; lisible / limitée / inexploitable. Ne pas employer « installation sûre » ou « diagnostic terminé ». `uncertain` signifie que transmission/résultat n’a pas pu être confirmé ; ne pas proposer un renvoi automatique.

- Demande : `{action:'request',document_id,command_id,expected_version:0,consent:true}`. UUID stable conservé avant appel. Consentement explicite pour **cette photo** ; pas de consentement implicite du simple dépôt. Une nouvelle demande après retrait reprend la version courante et une nouvelle commande ; aucune nouvelle demande n’est permise après transmission possible.
- Retrait : `{action:'withdraw',review_id,command_id,expected_version}`. Seulement avant réservation de transmission (`requested`). Il ne prétend pas effacer une photo déjà transmise au fournisseur.
- Validation artisan : `{action:'review',review_id,command_id,expected_version,decision:'validate'|'reject'}`. Seulement l’artisan actuellement attribué et approuvé, sur `awaiting_review`.

Rôles exacts : propriétaire client de la photo et du dossier personnel (`site_id=null`) déjà attribué ; artisan actuel pour la validation. Aucun droit org/manager/admin implicite. JPEG/PNG/WebP liés au même dossier, réellement lisibles via la session RLS. Le fichier original est déjà visible selon les droits documentaires existants ; aucune nouvelle URL signée n’est créée.

Le client reçoit `result:null` jusqu’à `validated`. L’artisan actuel voit la proposition uniquement en attente de sa validation (ou déjà validée). Refus et invalidation n’exposent aucun texte fournisseur. Limite technique20photos demandées par dossier ; liste complète bornée, aucune pagination cachant des éléments.

401 session absente,403 accès/rôle/document refusé,409 version/attribution modifiée ou état non compatible,422 consentement/commande/image invalide,503 résultat non confirmé. Relire GET après une réponse perdue. `provider_available:false` et `requested` sont des états réels, pas une analyse simulée.

## Sécurité, transmission et preuve

Schéma privé sous RLS, aucun grant direct API. Les commandes client et artisan sont sérialisées sur le dossier et munies de versions/reçus. Seule la RPC de service peut réserver et enregistrer une proposition fournisseur ; les utilisateurs ne peuvent donc pas fabriquer un résultat en appelant la base directement. Aucun statut du dossier, devis ou paiement n’est modifié.

La réservation durable passe à `uncertain` **avant** le fetch. Le même document ne peut être envoyé une seconde fois par rejeu, timeout, retour HTTP perdu ou crash. Absence de fournisseur : demande enregistrée sans réservation, retrait possible. Activer une configuration ne lance aucun worker : un appel utilisateur explicite de la demande encore non transmise est nécessaire.

Session Auth validée par `getUser`, empreinte du jeton serveur comparée avant/après ; lecture du fichier par le client Supabase de **cette session**, jamais avec le service role. Chemin exact validé, MIME attendu et signature réelle, taille≤4MiB. SHA256 des octets contrôlé après le retour par une nouvelle lecture RLS. Les identités document/propriétaire/dossier/artisan sont revérifiées avant réservation, immédiatement avant transmission et à la réception. Une réattribution A→B→A ou modification d’identité du document invalide durablement le résultat ; paiement seul ne supprime pas la lecture. Une session ou un contenu changé pendant l’appel entraîne un refus et aucun classement affiché.

Le seul appel externe possible est POST HTTPS fixe `https://api.openai.com/v1/responses`, redirections refusées, sans SDK/retry implicite. Conditions cumulatives : `PHOTOTRIAGE_ENABLED=true`, `PHOTOTRIAGE_MODEL` explicite (aucun modèle par défaut), `OPENAI_API_KEY` serveur. Rien n’est activé ou configuré par cette migration.

Corps : image en data URL base64 en mémoire, consigne générique, `store:false`, schéma strict à deux enums, sortie bornée. Aucun nom de fichier, URL signée, upload Files API, identifiant client/dossier/document, métadonnée métier, montant, outil, historique de conversation ou log de contenu n’est ajouté. Les pixels et éventuelles métadonnées intrinsèques de la photo font partie du fichier choisi : l’interface et la recette de consentement ne doivent pas prétendre que la photo est anonymisée. Aucune image n’est écrite dans un fichier temporaire par ce code.

Réponse complète et texte strictement conformes aux deux enums uniquement ; refus, texte supplémentaire, JSON invalide, réponse trop grande, timeout ou erreur deviennent un résultat incertain. Seuls les enums sont persistés, pas le texte brut du modèle. `store:false` ne constitue pas une promesse de zéro rétention fournisseur : les contrôles/conditions de conservation et de données doivent être revus avant ouverture.

## Vérification locale

- `tests/sql-photo-triage-review.mjs` : migrations complètes PGlite, consentement et retrait, idempotence, versions, refus intercomptes/rôles, preuve fournisseur non falsifiable depuis authenticated, classement masqué au client avant validation, réattribution et modification document.
- `tests/photo-triage.test.ts` : vrais handlers et fetch injecté ; réservation avant appel, contenu exact transmis, configuration inactive, réponse perdue sans renvoi, refus/texte non conforme, session/contenu changés, taille/magie et absence de fuite de chemin.

Aucun appel OpenAI réel, clé, compte, achat, migration cloud ou preview n’a été utilisé. Pas de verdict de qualité du modèle ni de complétude du diagnostic IA.

Références officielles consultées : [images/vision](https://developers.openai.com/api/docs/guides/images-vision), [sorties structurées](https://developers.openai.com/api/docs/guides/structured-outputs), [données et conservation](https://developers.openai.com/api/docs/guides/your-data).
