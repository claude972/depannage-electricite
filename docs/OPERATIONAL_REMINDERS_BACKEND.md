# SYS-04 / ART-03 / ENT-14 — Rappels personnels d’échéance

Sources : `artisan_credentials.expires_on` et `compliance_records.due_on`. Aucun délai commercial, échéance de facture, SMS/email ou notification externe inventés. Le rappel ne certifie ni validité du justificatif ni conformité du site.

## Routes et contrat

- `GET/POST /api/artisan/credentials/<id>/reminder` : artisan propriétaire du justificatif et de son document personnel. Un dossier professionnel suspendu peut préparer ses justificatifs ; aucun droit d’intervention ne lui est donné.
- `GET/POST /api/compliance/<id>/reminder` : membre courant autorisé à lire le site, même lecteur. Chacun ne gère que son propre rappel, jamais ceux des autres membres. Aucun élargissement de ses droits d’écriture sur la conformité.

Types importables : `lib/features/operational-reminders/contract.ts`.

GET retourne `{kind,record_id,source:{version,due_on},record,eligibility,can_schedule,scheduled_for_current_source}`. `record` vaut null ou :

```ts
{
 id: string; kind: "credential" | "compliance"; record_id: string;
 source_version: number; due_on: string; remind_at: string; version: number;
 status: "scheduled" | "cancelled" | "sent" | "invalidated" | "expired" | "muted";
 notification_id: string | null; processed_at: string | null; updated_at: string;
}
```

`eligibility` : available / no_date / closed / elapsed. Une absence d’expiration de justificatif reste `no_date`, sans date proposée automatiquement.

POST programmation : `{action:"schedule",command_id,expected_version,source_version,due_on,remind_at}`. Première version attendue null ; ensuite version du record courant. `source_version` et `due_on` proviennent du GET. `remind_at` est l’instant explicitement choisi, ISO avec fuseau. Il doit être futur et **strictement avant le jour de l’échéance en heure de Martinique**. Les sources sont des dates sans heure : cette règle place le rappel avant cette date, sans inventer une heure contractuelle d’expiration. Aucun délai minimal fixe.

POST annulation : `{action:"cancel",command_id,expected_version}`. Réponse : `{record,replayed}`. Conserver le command_id avant soumission et pour un retry incertain ; un changement du corps avec le même UUID est refusé. Un reçu rejoué est historique : recharger le GET. Annuler n’efface jamais une notification déjà émise.

## Invalidation et traitement

La source a une révision monotone : toute modification invalide les rappels en attente. Suppression, changement de rôle, changement du périmètre d’organisation/site et archivage du site les invalident aussi. Un rétablissement ultérieur ne les réactive pas ; reprogrammer explicitement. Une modification conservatrice du périmètre peut imposer cette reprogrammation même si l’utilisateur conserve finalement l’accès.

Avant émission, le worker vérifie à nouveau l’identité, le rôle pertinent, le document personnel ou le périmètre actuel, la date, la révision et l’état non terminé/non archivé. Le jour de l’échéance déjà atteint produit expired ; il ne déclenche pas une notification tardive présentée comme anticipée. Les préférences réelles peuvent produire muted. Sent signifie qu’une notification interne a été créée, jamais qu’un utilisateur l’a lue.

`emit_due_operational_reminders(limit)` est réservé au service, lots de 1 à 100 ; verrou worker, commande stable, version et clé de notification empêchent les doubles effets. Maximum 200 rappels programmés par compte, 30 commandes/minute. Les notifications de conformité portent le scope du site et deviennent invisibles après retrait de ce périmètre. Les messages ne contiennent ni nom de document ni contenu privé.

## Planification et recette

La migration dédiée définit **depannage_operational_reminders_v1 INACTIF**. Aucun nouveau worker ne s’exécute par cette livraison. Sa cadence technique prévue est la minute, sans promesse de délai. L’activation sera une étape explicite de recette hébergée. Les jobs de rendez-vous et de rétention GPS ne sont pas modifiés.

Tests locaux : vrais handlers à frontière SQL simulée, migrations/fonctions réelles dans PGlite (Auth/Storage/cron simulés), émission et déduplication vérifiées. Le test de métadonnées cron ne prouve pas un scheduler réel. Interleavings séquentiels uniquement ; pas de concurrence multi-connexion ni d’activation cloud.

Erreurs : 401 session, 404 source non accessible, 409 révision/état changé, 422 saisie, 429 limite, 503 vérification indisponible. Réponses privées sans cache ; aucun succès optimiste définitif après échec réseau.
