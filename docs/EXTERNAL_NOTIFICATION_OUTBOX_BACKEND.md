# SYS-04 — file externe e-mail/push inactive

Base 436e168 ; migration CLI `20261107200835_external_notification_outbox.sql`.

## Ce qui existe

Uniquement pendant une activation explicite de la porte, après insertion d’une nouvelle notification interne, une ligne privée par notification/canal est créée seulement si le destinataire a opté pour le canal, n’a pas masqué le type et possède encore tous les scopes. Pas de scan historique, pas de déclenchement sur modification des préférences ou lecture. SMS exclu. Les notifications internes restent indépendantes : une panne d’enfilement est isolée et consignée dans `notification_delivery_private.enqueue_failures` (SQLSTATE uniquement). Ces échecs ne sont pas rejoués automatiquement ; un historique n’est jamais envoyé rétroactivement.

La porte `notification_delivery_private.control.enabled` est livrée **false** : aucune ligne n’est créée pendant sa désactivation. Chaque changement de porte incrémente automatiquement sa génération ; claim et begin refusent toute ligne d’une génération antérieure, même après réactivation. Le stock ancien n’est donc jamais ressuscité. Les lignes déjà parties restent acceptées/incertaines selon leur preuve, sans reprise automatique après changement de génération. Aucun endpoint d’activation, scheduler, appel HTTP, fournisseur, secret, inscription push ou collecte de destinataire supplémentaire. Le registre de fournisseurs existant reste vide et l’interface continue d’annoncer les canaux indisponibles. Les tables sont dans un schéma privé, sous RLS, sans grants client ; seul le service peut lire et appeler les trois RPC.

- `claim_external_notification(channel, provider, idempotent)` : un candidat, verrou `FOR UPDATE SKIP LOCKED`, bail 60 secondes, fournisseur fixé dès la première réservation. Refus si l’adaptateur ne garantit pas l’idempotence.
- `begin_external_notification(id, lease)` : relecture de la porte, du bail, de l’opt-in, des types masqués et de `notification_scope_visible` sous l’identité du destinataire (contexte appelant restauré). Incrémente le nombre réel de tentatives ; retourne uniquement une identité de compte opaque, canal et clé stable.
- `finish_external_notification(id, lease, outcome, reference)` : résultat attaché au bail courant non expiré. `accepted` signifie **accepté par le fournisseur**, jamais livré ou lu. `retryable` exige la preuve de non-acceptation ; timeout, exception et perte de réponse sont `uncertain`. Une incertitude antérieure n’est pas effacée par un refus ultérieur. Trois émissions maximum ; reprises au plus tôt après 60 secondes, baux expirés récupérables. Au plafond, une incertitude reste à examiner, sans nouvel envoi automatique.

`processExternalNotifications` dans `lib/features/notifications/external-delivery/worker.ts` nécessite un client RPC de service et un adaptateur explicitement injecté. Maximum 25 candidats ; délai d’appel fournisseur maximum 10 secondes. Avant chaque émission, nouvelle vérification SQL. Un refus ou retrait avant `begin` supprime l’émission ; un envoi déjà parti ne peut pas être annulé par la base et reste traité comme fait accepté/incertain selon la preuve.

L’adaptateur futur doit garantir durablement la déduplication de la même clé, du même destinataire et du même contenu, y compris après crash et changement de coordonnées. Il résout seulement des destinations courantes vérifiées côté serveur. Le simple contrat historique `NotificationChannelAdapter.send` est insuffisant et n’est pas branché ici. Aucun fournisseur de ce type n’existe dans ce lot.

Texte externe constant : « Une notification est disponible » / « Connectez-vous à votre espace pour la consulter. ». Aucun titre/corps de notification interne, dossier, lien privé, montant, adresse, type métier ou pièce jointe n’est transmis. L’identité opaque sert exclusivement à la résolution privée du destinataire par l’adaptateur.

## Preuves locales et limites

`tests/sql-external-notification-review.mjs` installe les migrations dans PGlite, vérifie les ACL réelles, absence de backfill, opt-in, retrait de scope, refus entre réservation et émission, exclusivité des baux, expiration, même fournisseur/clé, plafond, panne d’enfilement et restauration du contexte. Il exécute aussi le vrai worker sur les RPC SQL avec un adaptateur de test incertain puis accepté.

`tests/external-notification-worker.test.ts` couvre le contenu exact, porte inactive, retrait, refus d’adaptateur non idempotent, timeout/exception/réponse invalide, résultat non confirmé et bornes.

Ces contrôles ne prouvent ni un envoi externe réel, ni un déploiement, ni une recette hébergée. Le stub pg_cron du banc de migrations concerne uniquement les installations existantes ; ce lot ne change aucun job.
