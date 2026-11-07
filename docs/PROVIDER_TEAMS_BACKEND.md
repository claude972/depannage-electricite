# ART-12 — Équipes prestataires

Contrat backend isolé depuis cb90544. Les comptes restent dans leur rôle global existant. Une équipe appartient à un artisan déjà approuvé ; elle ne remplace ni l’organisation cliente ni l’attribution atomique d’une intervention.

## Routes privées

Toutes nécessitent une session courante, sans cache. Les écritures utilisent POST, une origine conforme, un `command_id` UUID conservé lors des retries et un corps strict. Aucun message externe n’est envoyé.

- `GET /api/provider-teams?after=<uuid>` : équipes dont le compte est membre actif.
- `POST /api/provider-teams` : `{action:"create",team_id,command_id,name}`. UUID de l’équipe choisi une fois avant soumission.
- `GET /api/provider-teams/<id>?section=members|invitations|missions&after=<uuid>` : `{team,section,records,next_after}`. Défaut members. Pages de 50, continuation exclusive.
- `POST /api/provider-teams/<id>` : commandes ci-dessous.
- `GET /api/provider-teams/<id>/missions/<interventionId>` : `{team_id,intervention,appointment,assignment,permissions}`. Aucun téléphone client, donnée financière ou document.
- `GET /api/provider-team-invitations?after=<uuid>` : invitations en attente, non expirées et correspondant à l’email confirmé du compte.
- `POST /api/provider-team-invitations` : `{action:"accept_invitation"|"decline_invitation",team_id,invitation_id,command_id}`.

Types et schémas importables côté UI : `lib/features/provider-teams/contract.ts`.

## Commandes d’équipe

Chaque corps inclut `action,command_id`.

| Action | Champs supplémentaires | Autorisation |
|---|---|---|
| rename | expected_version, name | propriétaire |
| invite | expected_version, invitation_id, email, role, expires_at | propriétaire |
| revoke_invitation | expected_version, invitation_id | propriétaire |
| set_role | expected_version, user_id, role | propriétaire |
| remove_member | expected_version, user_id | propriétaire |
| assign | expected_version (null au premier enregistrement visible), intervention_id, technician_id | propriétaire / coordinateur |
| unassign | expected_version, intervention_id | propriétaire / coordinateur |
| progress | expected_version, intervention_id, state, note | technicien actuellement affecté |

`role` vaut coordinator ou technician. `expires_at` est explicitement choisi par le propriétaire, futur ; aucune durée juridique ou commerciale n’est présumée. Le compte invité accepte lui-même. L’email n’est visible que par le propriétaire ayant saisi les invitations. Le roster d’un technicien est limité à son propre membre.

`expected_version` est la version de l’équipe pour les cinq commandes administratives ; celle de l’affectation pour assign/unassign/progress. Réponse : `{team_id,action,team_version,entity_id,entity_version,state,replayed}`. Le rejeu exact retourne le reçu initial après nouvelle vérification des droits. Changer le corps avec le même UUID est refusé. Après 409, recharger les données ; une nouvelle intention reçoit un nouvel UUID. Après résultat réseau incertain, rejouer l’UUID initial.

Une affectation concerne seulement un dossier déjà attribué à l’artisan propriétaire. Le technicien peut confirmer (`acknowledged`) puis terminer (`done`) son suivi interne ; cette dernière étape exige une intervention globalement en cours ou terminée. Elle ne termine pas le dossier commercial. Devis, paiement, documents, attribution globale et commandes commerciales restent à l’artisan titulaire.

Retrait, changement de rôle, suspension de l’artisan ou nouvelle attribution globale sont réévalués au serveur. Le retrait efface l’affectation courante, jamais les événements historiques. Le changement de propriétaire du dossier ne transmet pas les notes de l’ancienne équipe. Pas de transfert de propriété d’équipe dans ce contrat.

## États et erreurs

401 session absente ; 403 droit refusé/suspension ; 404 objet non accessible ; 409 version/intention/état en conflit ; 422 validation ; 429 limitation ; 503 lecture ou reçu non vérifiable (réessayer). Interface : afficher les vraies réponses et recharger après conflit/retrait, sans succès optimiste définitif.

Limites : 100 membres actifs par équipe, 50 équipes actives par compte, 100 invitations en attente par équipe, 40 commandes/minute par acteur. Le serveur fait autorité. Les données sont exposées uniquement par fonctions vérifiées ; les six tables privées n’ont aucun accès direct authenticated/anon/service_role.

## Vérification et limites

Tests des vrais handlers avec frontière Supabase simulée, et migration complète exécutée sous PostgreSQL embarqué avec contrôles d’identité SQL. Les interleavings sont séquentiels : ce n’est pas une preuve de concurrence multi-connexion. Auth/Storage/pg_cron sont simulés dans ce contrôle. Aucune migration cloud, recette hébergée ni UI annoncée livrée par ce lot.
