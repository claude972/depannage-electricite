# Contrat009 — périmètre des sites

Checkpoint backend additif, base `1d93445`, branche `codex/web-pwa-backend`. Ce contrat précède l'implémentation. Aucun ENT02 complet, écran ou fournisseur distant n'est annoncé livré.

## Plan et décisions
1. Ajouter des portées de membre `all` ou `selected` et des attributions de site (lecture, écriture opérationnelle). L'absence de portée signifie `all` pour préserver les membres existants. Seul l'owner canonique modifie ces droits ; cet owner conserve toujours tous les sites. Une attribution d'écriture ne dépasse jamais le rôle courant owner/manager ; viewer reste en lecture.
2. Appliquer la portée aux sites, dossiers et projections liées, règles/approbations/conformité et rapports. Les contrats et le journal professionnel sont des données d'organisation : un membre selected ne les lit/modifie pas, pour éviter les informations sur d'autres sites. Les contrôles d'administration des membres restent owner uniquement.
3. Protéger les RPC opérationnelles par le site réel, et la création de site/les contrats par une portée all avec écriture. Les anciens helpers renommés restent privés. Les helpers publics dérivent exclusivement `auth.uid()`.
4. Autoriser les invitations selected avec attributions enregistrées avant acceptation : création et acceptation transactionnelles, aucune fenêtre all. Préserver les invariants006 de hash, email Auth vérifié, expiration, usage unique et transfert d'owner. Toute limitation découverte sera déclarée avant livraison.
5. Vérifier migration et refus SQL dans PostgreSQL isolé (Auth/Storage explicitement simulés), contrôles application, puis revue indépendante. Fournisseurs réels et interface restent hors preuve.

## Modèle et API
- Tables `organization_member_site_scopes` et `organization_member_site_grants`, liées par FK à l'appartenance et au site ; suppression d'appartenance/site supprime les attributions. Chaque site doit appartenir à l'organisation ciblée.
- RPC `can_access_site(p_site_id)` pour la lecture et `can_manage_site(p_site_id)` pour les opérations. Aucun paramètre d'identité cible. Le rôle plateforme admin et l'artisan assigné conservent leurs accès métier existants.
- RPC owner `set_organization_member_site_access(p_organization_id,p_user_id,p_scope,p_grants)` : remplacement atomique ; `p_grants` tableau d'objets `{site_id,can_write}` ; `all` exige un tableau vide. Owner non restreignable, membres supprimés sans accès résiduel.
- GET `/api/organizations/site-access?organization_id=…` : portée propre au membre, et toutes les portées seulement pour l'owner/admin. POST même route : `{organization_id,user_id,scope,grants}` ; authentification, validation stricte, origine, no-store ; seule autorité serveur.
- Invitation : champs optionnels `site_scope` (`all` par défaut), `site_grants` (`[]`) sur l'action create_invitation. Portée et attributions appliquées dans la transaction d'acceptation. L'invitation ne délègue jamais un pouvoir financier.
- Verrou commun : organisation avant appartenance/invitation/attributions. Les RPC opérationnelles verrouillent l'organisation avant contrôle et mutation pour sérialiser les retraits de droits.

## Exceptions métier préservées
La lecture du dossier est préalable aux contributions personnelles existantes (chat, avis et garantie du créateur). Le paiement reste réservé au créateur selon les règles existantes, y compris un créateur viewer lorsqu'il peut encore lire le dossier ; aucun nouveau payeur délégué. Les restrictions de site retirent cette lecture au créateur d'un dossier B2B exclu. Les artisans assignés gardent leurs accès d'exécution. Les documents personnels sans dossier restent personnels. Les URL Storage déjà signées gardent leur TTL ; les copies déjà vues ne sont pas révocables.

## Preuves attendues et limites
Deux organisations et deux sites ; owner, manager all, manager selected en écriture/lecture, viewer, compte exclu, attribution obsolète et membre révoqué ; aucun contournement direct ou ancien helper ; invitations atomiques et refus inter-organisations. Contrôler aussi dossiers, devis, paiements, documents/Storage, rendez-vous/rapports, règles/approbations, conformité et rapports. Ce checkpoint ne constitue ni une migration Supabase distante ni une recette UI/cloud.
