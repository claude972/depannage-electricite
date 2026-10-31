# WEB-PWA-20261030 — organisation et membres, checkpoint006

Branche : codex/web-pwa-backend. Contrat publié avant implémentation en fe0f4d3. Affectation distante lue et revendiquée ; scope de fichiers réservé au backend organisations, migration006 et testsSQL. Périmètre **organisation-level**, pas droits par site ni délégation de paiement. Aucun frontend Claude, service distant ou email réel modifié/envoyé.

## Plan et réalisation

1. Publier les contrats, vérifier les modèles Auth/organisation et les chemins RLS existants.
2. Ajouter les fonctions atomiques et permissions : projection minimale, invitation à usage unique, changement/retrait et transfert protégé du propriétaire.
3. Vérifier refus d’accès, identité email, rejeux/échéances, révocation des dossiers/pièces et propriétaire restant ; typecheck/tests/build puis revue indépendante avant intégration.

## Capacités implémentées

- GET /api/organizations pour les membres et la lecture opérateur plateforme ; noms/IDs/rôles projetés dans la seule organisation demandée, permissions explicites et indicateurs de listes limitées. Invitations seulement owner ; journal de gestion owner/admin. Aucun code ou hash dans les listes.
- Owner canonique (organizations.owner_id et membership owner) seul habilité à inviter, révoquer, modifier manager/viewer, retirer et transférer. Aucun paramètre ne peut attribuer admin ou créer directement owner.
- Invitations : randomBytes(32) côté serveur, code HEX64 révélé une seule fois avec URL fragment à partage manuel ; SHA-256 seulement en stockage, échéance serveur 1–14 jours (7 par défaut), réémission révoquant l’ancien lien. Aucun email automatique, aucune intégration SMTP prétendue.
- Acceptation SQL sous verrou organisation puis invitation ; empreinte calculée par SHA-256 core PostgreSQL depuis le code reçu. Email confirmé lu dans auth.users par auth.uid(), non dans métadonnées ou paramètres client. Exact destinataire normalisé, statut pending non expiré et usage unique exigés. Les tables d’invitations ne sont pas directement lisibles, même par owner : seule projection JSON expurgée.
- Un compte client accepté devient persona manager pour ouvrir le portail, mais ses droits restent ceux de sa membership (viewer n’écrit pas). Les comptes artisan/admin ne sont pas convertis ; le multi-rôle reste une décision distincte. Aucun gain de rôle administrateur plateforme.
- Retrait d’un membre par owner : anciennes lectures de dossiers B2B créés par ce membre et pièces liées sont refusées par les règles003. Invitations pendantes de ce destinataire révoquées. Les autres organisations et le rôle global sont préservés.
- Transfert vers membre manager/viewer à compte manager et email confirmé : nouveau owner canonique, ancien owner manager et révocation des invitations pendantes. Propriétaire actuel non supprimable/dégradable directement et pas de retrait de soi par ces commandes. Journal append-only pour les rôles applicatifs, acteur/objet/avant-après sans secret ni email.

## Références vérifiées

- Modèles existants : migrations001/003, organization_members, is_org_member, can_access_intervention/owns_intervention, politiques documents/storage et create_site.
- [Supabase Auth et données utilisateur](https://supabase.com/docs/guides/auth/managing-user-data), [modèle Auth officiel](https://github.com/supabase/auth/blob/master/internal/models/user.go) : email et email_confirmed_at autoritatifs, pas raw_user_meta_data.
- [PostgreSQL17 fonctions binaires](https://www.postgresql.org/docs/17/functions-binarystring.html) : encode(sha256(convert_to(token,'UTF8')),'hex'), vérifié dans PGlite sans ajouter d’extension crypto.
- Patterns projet authenticatedClient/assertOrigin/validated/db.rpc, erreurs JSON et no-store. Bibliothèques/stack épinglées conservées.

## Vérifications réellement exécutées

- npm run typecheck réussi.
- npm run check réussi sur le checkout partagé avec l’agent performance007 : **30 tests**, TypeScript et build Next.js. Ce résultat inclut ses fichiers de travail non possédés par cet agent ; aucun de ces fichiers n’est commité dans le lot006.
- tests/sql-review.mjs : **26 groupes PASS** (22 existants +4 nouveaux). Exécute toutes les migrations présentes au moment du contrôle avec stubs Auth/Storage explicites, pas une vraie API Supabase.
- Tests nouveaux : owner-only, absence de hash, mauvais destinataire, métadonnées email usurpées, email non vérifié, usage unique, expiration/révocation/réémission, rôle viewer non-écrivain, auto-escalade/dégradation owner/retrait de soi refusés, compte artisan non converti ; retrait effective de client_id/documents/Storage ; transfert canonique atomique avec un owner, invitations révoquées et ancien owner non gestionnaire des membres ; mutation directe/anon refusées.
- Les fixtures ont été corrigées avant succès : un mauvais choix de compte supposé extérieur appartenait déjà à l’organisation dans les tests précédents ; le stub Storage manquait aussi ses grants de lecture. Des assertions positives avant révocation garantissent que le refus ne résulte pas simplement de l’absence universelle de grant. Une erreur de quotes JS dans une assertion a été corrigée avant exécution.
- node --check du harness et git diff --check ciblé : passés. Pas de nouveau package, secret ou donnée distante.

## Limites et reprise obligatoire

- Auth/Storage réels, délivrance/acceptation du lien en navigateur, deux sessions DB réellement concurrentes, onboarding et contexte frontend ne sont pas vérifiés : création de la base dédiée bloquée par facturation. Une authentification par email doit être disponible et vérifiée avant usage réel.
- Révocation = refus SQL des requêtes suivantes. Elle ne retire pas une copie déjà lue ni un lien Storage déjà signé avant son échéance ; le frontend doit invalider organisation/site/caches professionnels à la disparition de membership et sur403. Aucune publication Realtime de membership ou notification externe ajoutée.
- Une membership viewer ne confère pas d’écriture organisationnelle ; les règles préexistantes propres au créateur (notamment Checkout encore créateur-only, avis et garantie) ne sont pas réécrites par006 et doivent être cadrées dans leur lot. Ne pas en déduire une interdiction universelle de toute action personnelle ou financière pour un viewer créateur.
- Les droits d’une membership valent pour l’ensemble de son organisation : **pas de rôles par site**, délégation d’approbateur/payeur, signature, identité de facturation, factures ou gouvernance multi-owner livrés. Ce checkpoint ne ferme pas à lui seul ENT-02 ou toute la phase7.
- L’URL /#join-organization/CODE demande un nouveau parcours frontend Claude ; ne pas afficher « invitation envoyée par email ». Code perdu = réémettre, ce qui révoque le précédent. Nettoyer le fragment après lecture en UI, ne pas stocker le code en log/analytics.
- Suivre WEB_PWA_CONTRACTS.md pour les schémas exacts. Claude doit relire workspace après acceptation (profil client devenu manager), supprimer le secret du fragment, gérer session/erreur/réessai sans renvoi automatique, et vérifier owner/viewer/ancien membre.
- Revue indépendante du SHA commité, revue croisée Claude et preview combinée restent requises avant statut done.
