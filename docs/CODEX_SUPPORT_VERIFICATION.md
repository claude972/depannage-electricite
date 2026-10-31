# WEB-PWA-SUPPORT-001 — rapport Codex

Branche codex/web-pwa-backend ; base applicative254d497e92b2e6e6286dbb59254660dc39aa27f3. Mission/corrections distantes lues, seule affectation assistance revendiquée. Plan et contrat publiés avant code dans **e7fb62d**, présence distante relue. Aucun frontend, paiement ou ancienne migration modifié ; uniquement migration011, deux routes nouvelles, tests, documents et une étape CI SQL dédiée.

## Livré

- Tickets privés, messages et événements append-only au niveau applicatif ; auteur/type user/admin/date/version produits par serveur, aucune note interne ou conversation d’intervention projetée.
- Créateur et administration plateforme seulement. Ticket lié : le créateur doit conserver l’accès courant au dossier ; autre membre/owner B2B ou artisan affecté ne lit pas un ticket tiers. Réduction de portée, retrait et réaffectation ferment les requêtes suivantes.
- Création idempotente par créateur+request_id, contenu identique rejoué sans doublon ; clé réutilisée avec contenu différent en conflit. Limites5 créations/30 mutations réussies par minute/compte, contrepartie transactionnelle.
- Réponses et états avec expected_version exact. Cycle open/in_progress/awaiting_user/resolved documenté : seuls opérateurs changent explicitement le statut ; réponse créateur awaiting/resolved réouvre à open ; admin doit réouvrir resolved avant de répondre. Historique d’une version par action ; erreur d’append annule aussi la modification de métadonnées.
- Liste serveur privée, périmètre mine/all réellement admin, filtres/recherche bornés, curseur created_at/id exact et lié aux filtres, COUNT avant curseur. Détail par versions d’événements croissantes avec messages correspondants et totaux serveur ; aucune fin d’historique extrapolée d’une fenêtre chargée.
- Toutes réponses/erreurs privées/no-store ; paramètres inconnus, doublons, wildcards/logique injectée, identités/états/versions usurpés et origine étrangère refusés.
- Verrouillage lié organisation → intervention → ticket ; création prend le profil en NO KEY UPDATE pour la clé idempotente, compatible avec les verrous KEY SHARE des FK de réponse afin d’éviter le cycle profil/ticket.

## Preuves fraîches

- `npm run typecheck` passe.
- `npm test` : **49 tests passent**, zéro échec, dont **6 tests HTTP support**. Ils exécutent les deux routes réelles et le validateur partagé en mémoire ; SDK Supabase réellement installé vers un fournisseur HTTP synthétique, session/erreurs isolées.131 tickets propres/147 globaux, dates égales et microsecondes, filtres/total avant limite, rôle scopeall, historique131 versions/66 messages sans doublon, bornes/curseurs, spoof auteur et conflits privés. Ce modèle HTTP ne remplace pas Auth/RLS cloud.
- SQL support : **8 groupes PASS**, exécution des onze migrations dans PostgreSQL isolé avec stubs Auth/Storage explicites. Couverture création/rejeu/conflit, auteur et immutabilité, transitions/CAS/réouverture, rollback induit de message après mise à jour ticket, quotas avec horloge transactionnelle fixe, RLS tiers/admin, portée site/retrait et réaffectation.
- Régressions SQL après011 : principal **29 groupes**, performance **6**, accès site **8**, brouillons **9**, tous PASS.
- `git diff --check` propre. Les commandes PGLITE_MODULE pointent vers le runtime0.5.13 déjà installé hors application ; aucun package ajouté ni build volumineux.

## Limites et étapes du pilote/Claude

- Aucun apply011, compte QA, envoi externe ou service distant modifié par cet agent. Après revue du SHA exact, le pilote décide de l’application à la seule base dédiée et de la recette réelle Auth/PostgREST/preview.
- Pas de build/npm run check complet revendiqué ici : checkout backend sans les nouveaux tests UI, volume presque plein et quota de previews atteint. CI intégrée et recette UI restent nécessaires ; aucune demande de dépassement payant.
- Le contrat précise rechargement après409, absence de snapshot commun métadonnées/pages/counts, distinction versions événement/message et confidentialité après révocation. Claude doit intégrer ces API et invalider les données de tickets devenues non lisibles ; une copie déjà vue ne s’efface pas à distance.
- Pas d’email/SMS/appel/push, utilisateur anonyme, promesse de rappel/SLA, centre non-lu, fichier joint, suppression automatique ou séparation support/finance. Aucun remboursement ni action sur l’intervention depuis ces tickets.
- Les tests séquentiels n’établissent pas toutes les interleavings de concurrence réelle. Recommandation QA : créations concurrentes avec la même clé, réponse/statut sur version commune, retrait de portée pendant mutation ; données synthétiques suivies et nettoyage exclusivement ciblé.
- Ordre de nettoyage des fixtures QA : événements support, messages, tickets, puis dossiers/profils/Auth utilisateurs concernés, afin de respecter les FK. Pas de suppression générale ou de données d’un autre lot.

## Configuration de déploiement

À la demande du pilote, commits config-only03197bae puis e0b0d9c cherry-pickés en f2dbc88/b83119f avant le prochain push groupé : `git.deploymentEnabled` désactive les previews de branches de travail, conserve main et integration/web-pwa. Aucune tentative Vercel supplémentaire ni upgrade effectuée. Cette configuration est distincte des fonctionnalités d’assistance.

## Ajustement de capacité autorisé par le pilote

011 enveloppe admin_overview existant en préservant garde/projection et change uniquement capabilities.support_tickets àtrue. L’ancien helper admin_overview_before_support est privé ; refus compte ordinaire et appel direct interne testés. Ce drapeau ne prouve pas que les routes Next/UI sont déjà publiées, le quota Vercel bloque actuellement les nouvelles releases. Aucun changement financier ou de débit. Régression SQL principale relancée après cet ajout.
