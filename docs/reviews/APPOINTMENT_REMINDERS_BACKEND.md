# ENT-14 / SYS-04 — rappel personnel dans l’application

Base `610b13f`, branche `codex/appointment-reminders`, claim `5a92372`. Aucun SMS, email, push externe, délai métier par défaut, intervention cloud ou notification réelle dans ce lot. Les seules modifications du contrat d’affichage existant ajoutent le type et le libellé « Rappel de rendez-vous » au centre/préférences ; aucun nouvel écran.

## Contrat HTTP

`GET /api/interventions/{id}/reminder` retourne :

- `appointment: {version,starts_at,ends_at}|null` : créneau réellement enregistré, sans note privée ;
- `record|null` : rappel personnel, avec `id, intervention_id, appointment_version, starts_at, ends_at, remind_at, version, status, notification_id, processed_at, updated_at` ;
- `eligibility` parmi `no_appointment`, `closed`, `elapsed`, `available`, et `can_schedule` ;
- `scheduled_for_current_slot` : vrai seulement pour un rappel encore programmé sur la version ET les instants actuels du créneau. Ne pas afficher une promesse d’émission à partir du seul état stocké `scheduled` si ce booléen est faux.

`POST` sur la même URL, commande stricte :

```json
{"command_id":"UUID créé avant soumission","action":"schedule","expected_version":null,"appointment_version":1,"remind_at":"instant ISO avec fuseau choisi par la personne"}
```

Première programmation : `expected_version=null`. Modification ou nouvelle programmation après un résultat terminal : version actuelle du rappel obligatoire. L’instant doit être strictement futur selon l’horloge du serveur et strictement antérieur au début du créneau. Aucune avance minimale ou durée commerciale imposée. Le serveur refuse un créneau modifié ou un dossier hors des états `assigned`, `quoted`, `accepted`.

Annulation : `{command_id,action:"cancel",expected_version}` uniquement. Elle ne concerne que le rappel personnel encore `scheduled`. Le créneau métier n’est pas annulé. Un changement de rendez-vous ne reprogramme pas automatiquement le rappel.

Réponse `{record,replayed}`. Conserver le même UUID et les mêmes paramètres après une réponse perdue. Le reçu rejoué est immuable et peut précéder une émission ou modification ultérieure : relire le GET après succès. Une perte d’accès interdit même le rejeu. Une version périmée renvoie un conflit ; aucune double notification sur un retry.

Les routes n’acceptent aucun destinataire fourni par le client. Seuls le client titulaire du dossier (avec accès actuel au site pour un dossier d’organisation) et l’artisan actuellement affecté gèrent leur propre rappel ; un lecteur d’organisation ou un administrateur non participant ne gagne pas ce droit. Aucun accès direct aux tables par anon/authenticated/service_role ; RPC étroites et projections privées hors cache.

## Traitement et états réels

Un seul rappel courant par destinataire/dossier ; client et artisan ont des lignes indépendantes. Chaque commande possède un reçu unique. Le créneau reçoit une version dédiée incrémentée à chaque écriture, y compris deux écritures dans une transaction ; les instants sauvegardés sont également revérifiés avant émission.

`emit_due_appointment_reminders(limit)` est réservé au service et au propriétaire SQL. Limite 1 à 100, défaut 100. Un verrou de worker évite deux traitements simultanés ; les verrous suivent l’ordre organisation → dossier → créneau → rappel. Les droits actuels, l’affectation, le scope du site, le statut et la version/les instants du créneau sont vérifiés à nouveau sous verrou.

- `sent` : notification réellement insérée/retrouvée via sa clé unique, pas une preuve de lecture ;
- `muted` : la préférence existante a empêché l’insertion ;
- `invalidated` : accès perdu, dossier fermé ou créneau changé/disparu ;
- `expired` : début du créneau déjà atteint, aucune émission tardive ;
- `cancelled` : annulation personnelle confirmée ;
- `scheduled` : intention enregistrée en attente, à croiser avec `scheduled_for_current_slot`.

Le contrôle du début du créneau est répété après l’attente éventuelle du verrou de préférences. Aucun contenu privé de description/adresse/note n’est copié dans la notification. Le centre conserve ses RLS de scope : une réaffectation ou un retrait de droits masque les notifications liées. Programmer de nouveau après une émission est une nouvelle intention explicite, avec nouvelle version.

## Planification dédiée, sans changement du suivi GPS

Migrations : `20261107145358_appointment_reminders.sql` puis `20261107145359_appointment_reminders_schedule.sql`. La seconde réutilise **l’extension pg_cron déjà installée**, sans modifier l’installation native ni le job de rétention GPS. Nom indépendant `depannage_appointment_reminders_v1`, commande `select public.emit_due_appointment_reminders(100);`, cadence technique une minute. Ce n’est pas une garantie d’émission à la seconde demandée : un worker retardé marque le rappel expiré si le créneau a commencé.

L’installateur vérifie les ACL, le propriétaire et la cible de son seul job ; une collision incompatible fait échouer la migration sans écraser le job. Le job de rétention GPS est conservé exactement. L’automatisation de rapports Codex supprimée est sans rapport avec ces jobs produit.

Aucune migration appliquée à distance ici. Le pilote doit effectuer la recette du worker/scheduler réel sur le commit assemblé ; le lot local ne prouve pas que le minuteur tourne en ligne.

## Preuves locales

TypeScript strict PASS ; 5 tests des vrais handlers PASS et 32 régressions notifications/planning/préférences PASS. Tests des vrais handlers : nominal/vide, accès, origine, corps strict, identité serveur, versions, reprise, projections et erreur sans faux succès. SQL PGlite : 51 contrôles PASS sur 51 migrations réelles, et revue SQL planning/notifications PASS. Couverture : émission unique, rejouabilité, annulation, version et remplacement du créneau, réaffectation, retrait d’adhésion et de scope, préférences muettes, expiration, limites de batch, refus de privilèges et métadonnées du scheduler. L’adaptation isolée ne remplace que le bloc natif de migration020 déjà épinglé par SHA256 ; les nouvelles migrations s’exécutent intégralement. Aucun worker cron réel et aucune concurrence multi-connexion ne sont revendiqués.
