# État courant de livraison

Mis à jour le 2026-10-31T14:38:49-04:00 (America/Martinique). Les preuves ci-dessous sont bornées à leur SHA et à leur environnement. L'application complète des 76 capacités n'est pas déclarée terminée.

## Version et environnements

| Élément | État vérifié |
| --- | --- |
| Source intégrée et poussée | `integration/web-pwa`, `6c67644af48b899857256d2211a843cd67efc608` ; harnais planning719 puis QA/PWA95e revus et fusionnés (16 tests planning, 88 tests QA/PWA PASS). Code applicatif inchangé depuis be17b24 : 115 tests UI et typecheck strict y passent. CI6c deux jobs PASS, run41229624334. |
| Serveur de recette local | `be17b24adbc0035d1ba82347c09f9045bac03d71`, build webpack réussi, port3017, HTTP200 vérifié ; inclut les derniers visuels artisan, entreprise et illustration. |
| Backend dédié | Supabase `kcpyjzndybfdlnhvscbs`, actif ; migrations001–017 appliquées et historique relu. |
| Transfert photo Edge | `native-document-upload`, version1, `verify_jwt=true`, source `d7abd8c` ; neuf scénarios réels passent. |
| Site public seven.vercel.app | Ancien déploiement, inchangé. Aucune nouvelle preview Vercel n'est annoncée. |
| Services différés | Vercel et Stripe, sur instruction du propriétaire. Aucun débit réel ni publication en production/store. |

## Preuves fonctionnelles acquises

- **Web principal** : sur `d9374fa` + backend017, droits viewer/read-grant/write-grant/owner, assistance A→B/réponse perdue et photos partielles/réponse perdue passent (huit scénarios). Le devis a ensuite été rejoué avec le harnais corrigé `5e1228f` : sauvegarde, conflit409, conservation de saisie, version3, envoi, sélection obligatoire du devis exact et refus de rejeu passent. Tous les comptes/documents/objets de ces cohortes ont été relus absents.
- **Planning et notifications** : `719ba46` sur app `6061272`, treize étapes API et navigateur passent. Vraies courses HTTP (un commit/un conflit), formulaire réel, suspension en lecture seule, retrait d'accès aux notifications, récupération par le vrai bouton Réessayer sans reload ni changement d'identité. Nettoyage33 étapes ; relecture indépendante27 portées à zéro et six comptes Auth absents.
- **PWA** : `31ac49d`, treize étapes passent avec deux vrais builds (`1be8f00`/SWv2 puis `a2faa02`/SWv3) à la même origine locale3020, deux onglets et saisies distinctes. Attente sans consentement, consentements A/B séparés, saisie de l'autre onglet préservée, cache tiers conservé, anciennes versions purgées, notice hors ligne et retour public en ligne, absence de routes privées en cache, console et largeurs360/1280. Deux PID enfants relus absents et port libéré. Le SW courant correspond au SW testé. Il s'agit d'une preuve publique locale : pas d'installation OS, d'authentification privée hors ligne ou de nouvelle preview déployée.
- **Photo sécurisée** : `ac72c38` sur la vraie Edge version1, neuf scénarios passent (JWT absent/invalide401, tiers/viewer403, JPEG propriétaire/artisan et pièce personnelle201, contenu falsifié415, taille413). Nettoyage40 étapes ; huit portées à zéro, cinq Auth et cinq préfixes Storage absents, trois documents/objets connus absents. L'expiration réelle d'un JWT et la révocation pendant upload restent à recetter.
- **SQL avancé** : `d352fdd`,343 contrôles réels réussis dans une transaction annulée. Documents, finance préparée, rôles opérateur et B2B sous RLS ; absence des cohortes vérifiée après rollback. Ce résultat ne vaut pas paiement Stripe ni recette complète de chaque écran. Les séquences peuvent avancer malgré rollback et ne sont pas réinitialisées.

## Fidélité visuelle

Les interfaces entreprise M13/M4/M66, artisan M34–M36 et Super Admin M43 ont été revues et intégrées dans leur périmètre. Client M61/V8-C06/V8-C07 : paiement terminal corrigé (statut paid et date serveur requis). Artisan M14/M65 : pièces seulement Manquant/Transmis/À renouveler, candidature globale séparée ; nouvelle pièce et pièce expirée capturées. Accueil public : illustration issue de la référence fournie M41, équilibre titre/visuel M11 rétabli, légende Illustration ; aucun avis, tarif contractuel, qualification ou équipe inventé. Ces captures ne remplacent pas tous les parcours connectés.

Entreprise V5 : C01 est revu sans nouveau P1/P2 ; C08 conserve les permissions et l'ancrage documents. C05 n’affiche plus zéro quand les données professionnelles ne sont pas vérifiées ; le correctif `38326f0` est revu et intégré dans `be17b24`.

## Travail en cours et gates ouverts

1. Dernier assemblage visuel be17b24 compilé et servi ; poursuivre les recettes connectées sur cet assemblage. CI deux jobs PASS, run41227086308.
2. Harnais Codex `719ba46` accepté par revue croisée Claude et intégré dans0f57d96 ; harnais Claude PWA/core attend encore la garde admin et sa revue. Le planning conserve ses limites : ses limites (certaines courses rendez-vous et critères HTTP) restent explicites. L'ancien fixture admin doit être refusé avant seeding sur un schéma protégé par014 (mission QA-ADMIN-PREFLIGHT-001).
3. **Expiration JWT** : correctif `6466b8a` revu, 57 tests purs PASS. Préparation réelle faite : UN client QA volontairement conservé, zéro document/objet. Verdict PREPARED, pas preuve d’expiration. Expiration15:05:23 Martinique ; vérification root après15:06:23 et avant16:05:22, avec checkout épinglé6466 et bail privé. Aucun token publié, TTL inchangé. Les cohortes antérieures sont nettoyées ; ce bail est la seule exception attendue.
4. **Révocation pendant upload** : protocole sous verrou de la seule cohorte à amender/revoir avant code et exécution ; pas de hook Edge, d'admin fictif permanent ni de nouvelle migration.
5. **Documents et B2B** : nouvelle recette UI/API isolée demandée au worker B2B existant (QA-DOCUMENTS-B2B-004), contrat avant code ; aucune fixture finance immuable.
6. Adresse du premier vrai SuperAdmin confirmée par le propriétaire (gardée hors rapport Git). Recherche Auth exacte : compte absent. Le propriétaire diffère explicitement inscription/confirmation car absent du PC ; activation différée sans bloquer les autres travaux. Confirmation requise avant promotion atomique ; aucune activation annoncée, aucun mot de passe demandé, aucun administrateur fictif permanent créé.
7. **Support opérateur A5** : backend6062f92 poussé, revu root et Claude ; SQL isolé18 et six unités passent, migration018 non appliquée. Interface Claude181→e2→ab52 ferme deux défauts ; nouveau P2 après changement de statut : relire les permissions pour retirer/rétablir le formulaire. Correctif2a7f1ea en attente de revue, pas de fusion ni de preuve live déclarée.
8. **GPS/ETA A6**, ajouté par ordre du propriétaire : contrat804a807 publié avant code, backend Codex en cours sur codex/gps-eta, migration019 réservée. UI Claude contrat a7a1fed revu avec amendements, feuilles tracking et QA dédiées ; code UI pas encore livré. IGN public routage et géocodage Martinique répondent200 sur lieux publics ; cela ne prouve pas encore le circuit applicatif. Pas de trafic en temps réel ou GPS arrière-plan garanti.
9. **Installation PWA desktop** : contrat3a96df0 revu, harnais Codex isolé en cours. Aucun navigateur ni installation lancé ; preuve OS à exécuter seulement après revue du code. Six captures be17, M35/M43/M66 à360/1280, passent ; démo explicitement isolée, pas preuve connectée.

## Limites du périmètre global

Voir `docs/audit/ECARTS_LIVRAISON_D9374FA.md` : GPS/ETA, support opérateur cloisonné, certaines automatisations/notifications externes/verticales et extensions conditionnelles restent absents ou partiels. Ces manques ne sont pas tous résolus par Stripe/Vercel. Aucun pourcentage global ni achèvement des 76 capacités n'est déduit du nombre de tests. Aucun binaire iOS/Android n'est livré dans cette tranche ; la suite native conserve son ordre conditionnel après le checkpoint Web accepté.

## Coordination

Claude CLI lead unique `b4b555f0` ; commande terminal `claude attach b4b555f0`. Claude conserve les interfaces et ses modules ; Codex pilote/revoit/exécute/intègre et possède les deux modules A4 (PDF facture/avoir et harnais planning). Réutiliser les agents, respecter les worktrees et préserver les WIP. Les rapports détaillés et corrections restent dans `CORRECTIONS.md` et `docs/reviews/`. Le suivi demandé toutes les15minutes est maintenu par l'automation existante, sans doublon.
