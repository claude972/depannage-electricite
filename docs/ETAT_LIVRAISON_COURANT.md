# État courant de livraison

Mis à jour le 2026-10-31T15:13:00-04:00 (America/Martinique). Les preuves ci-dessous sont bornées à leur SHA et à leur environnement. L'application complète des 76 capacités n'est pas déclarée terminée.

## Version et environnements

| Élément | État vérifié |
| --- | --- |
| Source intégrée et poussée | `integration/web-pwa`, `c7c27bf56e89b2fe161193a5ae2a5d59f5264c88` : A5 support, probes initiales documents/siteOps et backend GPS avec correctif de rétention a658. Avant ce dernier correctif, a89 : 433 tests et TypeScript PASS. CI a89 échoue dans le harnais SQL isolé sur le bloc pg_cron ; correction du harnais en revue, CI c7 en cours. |
| Serveur de recette local | Toujours `be17b24adbc0035d1ba82347c09f9045bac03d71`, build webpack réussi, port3017 ; assemblage récent pas encore rebâti. |
| Backend dédié | Supabase `kcpyjzndybfdlnhvscbs`, actif ; migrations001–019 appliquées. 020 ancienne version a échoué42501 puis rollback entier confirmé ; correctif a658 intégré, contre-revue Claude et apply réel encore attendus. |
| Transfert photo Edge | `native-document-upload`, version1, `verify_jwt=true`, source `d7abd8c` ; neuf scénarios réels antérieurs passent. |
| Site public seven.vercel.app | Ancien déploiement, inchangé. Aucune nouvelle preview Vercel annoncée. |
| Services différés | Vercel, Stripe et inscription du premier vrai SuperAdmin, sur instruction du propriétaire. Aucun débit réel ni publication production/store. |

## Preuves fonctionnelles acquises

- **Web principal** : sur `d9374fa` + backend017, droits viewer/read-grant/write-grant/owner, assistance A→B/réponse perdue et photos partielles/réponse perdue passent (huit scénarios). Le devis a ensuite été rejoué avec le harnais corrigé `5e1228f` : sauvegarde, conflit409, conservation de saisie, version3, envoi, sélection obligatoire du devis exact et refus de rejeu passent. Tous les comptes/documents/objets de ces cohortes ont été relus absents.
- **Planning et notifications** : `719ba46` sur app `6061272`, treize étapes API et navigateur passent. Vraies courses HTTP (un commit/un conflit), formulaire réel, suspension en lecture seule, retrait d'accès aux notifications, récupération par le vrai bouton Réessayer sans reload ni changement d'identité. Nettoyage33 étapes ; relecture indépendante27 portées à zéro et six comptes Auth absents.
- **PWA** : `31ac49d`, treize étapes passent avec deux vrais builds (`1be8f00`/SWv2 puis `a2faa02`/SWv3) à la même origine locale3020, deux onglets et saisies distinctes. Attente sans consentement, consentements A/B séparés, saisie de l'autre onglet préservée, cache tiers conservé, anciennes versions purgées, notice hors ligne et retour public en ligne, absence de routes privées en cache, console et largeurs360/1280. Deux PID enfants relus absents et port libéré. Le SW courant correspond au SW testé. Il s'agit d'une preuve publique locale : pas d'installation OS, d'authentification privée hors ligne ou de nouvelle preview déployée.
- **Photo sécurisée** : `ac72c38` sur la vraie Edge version1, neuf scénarios passent (JWT absent/invalide401, tiers/viewer403, JPEG propriétaire/artisan et pièce personnelle201, contenu falsifié415, taille413). Nettoyage40 étapes ; huit portées à zéro, cinq Auth et cinq préfixes Storage absents, trois documents/objets connus absents. L'expiration réelle a depuis été observée401 (qualification ouverte ci-dessous) ; la révocation pendant upload reste à recetter.
- **SQL avancé** : `d352fdd`,343 contrôles réels réussis dans une transaction annulée. Documents, finance préparée, rôles opérateur et B2B sous RLS ; absence des cohortes vérifiée après rollback. Ce résultat ne vaut pas paiement Stripe ni recette complète de chaque écran. Les séquences peuvent avancer malgré rollback et ne sont pas réinitialisées.

## Fidélité visuelle

Les interfaces entreprise M13/M4/M66, artisan M34–M36 et Super Admin M43 ont été revues et intégrées dans leur périmètre. Client M61/V8-C06/V8-C07 : paiement terminal corrigé (statut paid et date serveur requis). Artisan M14/M65 : pièces seulement Manquant/Transmis/À renouveler, candidature globale séparée ; nouvelle pièce et pièce expirée capturées. Accueil public : illustration issue de la référence fournie M41, équilibre titre/visuel M11 rétabli, légende Illustration ; aucun avis, tarif contractuel, qualification ou équipe inventé. Ces captures ne remplacent pas tous les parcours connectés.

Entreprise V5 : C01 est revu sans nouveau P1/P2 ; C08 conserve les permissions et l'ancrage documents. C05 n’affiche plus zéro quand les données professionnelles ne sont pas vérifiées ; le correctif `38326f0` est revu et intégré dans `be17b24`.

## Travail en cours et gates ouverts

1. **Assemblage** : support A5 et initial probes intégrés, backend GPS intégré. UI GPS corrigée `8bcee45` en contre-revue avant fusion ; aucune recette connectée du nouveau GPS encore déclarée. Les trois défauts077 (START interrompu, cadence/backoff route, cadrage mobile) ont une livraison Claude7b3 mais restent à fermer par preuve indépendante.
2. **Rétention GPS** : 019 appliquée ; ancien020 entièrement annulé après42501 LOCKcron.job. Correctif a658 sans ce verrou ni privilèges globaux, advisory coopératif et APIcron.schedule sous propriétaire courant. Revue indépendante et tests isolés PASS ; contre-revue Claude puis apply020 et vraie observation cron.job_run_details avec contraste expiré/frais restent requis. Stub ne vaut pas worker réel.
3. **Expiration JWT** : exécutée à15:06:31 Martinique avec le même token réellement expiré, Auth exact encore actif avant appel. Réponse401 `UNAUTHORIZED_ASYMMETRIC_JWT`, verdict **OBSERVED** tant que qualification stricte du code générique reste ouverte. Signature vérifiée indépendamment sous JWKS public actuel et claims cohérents. Bail consommé, cleanup8PASS et postflight indépendant Auth404/profil/documents/interventions/audits/Storage0. **Aucun client QA maintenu pour ce bail désormais ; ne pas rejouer le verify.**
4. **Révocation pendant upload** : harnais83fd accepté après revue74 tests/typecheck ; chaîne de propriété distante avant cleanup et observation objet exact/blockedPID corrigées. Prochaine preuve root : préparer cohorte, relire SQL rendus, vraie course sous pause3s. Aucune course réussie annoncée.
5. **Documents/B2B** : recette947 réelle surbe17 :1PASS/4FAIL/3ANOMALY, interruption130, cleanup24PASS/drain0 et root14portées0/4Auth404/4Storage0. Défaut app quoteDocuments inconnu jamais chargé corrigé1a77 et intégré, pas encore rebâti. Harnais c97 corrige navigation réelle devis et diagnostics ; revue35PASS mais reste deux P2 : drain expiré ne doit pas démarrer suppression avec producteurs en vol, et RPC après awaittoken doit revérifier stopgate. Corrections demandées au worker existant avant relance.
6. **QA tracking** : harnais8aa livré, seulement hors ligne. Root relève POST5xx incorrectement marqué refused au lieu d'inconnu et suivi in-flight incomplet ; correctif demandé. Ne pas lancer cloud avant ces fermetures.
7. **Support opérateur A5** : backend6062 et UI2a7/fa8 intégrés ;018 appliquée, matrice SQL réelle en rollback et contrôle négatif vérifiés, deux postflights11portées0. Aucun opérateur/admin permanent créé. Positif HTTP/UI avec vrai compte et certaines courses interconnexions restent non acquis ; inscription du propriétaire explicitement différée.
8. **Installation PWA desktop** : installation réellement obtenue mais pas preuve fenêtre OS/relance. Récupération f5 finit INCOMPLETE au timeout de résolution cible tab/page avant phase OSproof ; uninstall et registres absents confirmés. Profil test et deux métadonnées régénérées restent attribués et conservés ; nettoyage ciblé en préparation, pas suppression de profil utilisateur. Aucun résultat OS PASS. Ne pas changer3017 tant que protocole de récupération exige ancien build.
9. **Admin** : préflight95e réel BLOCKED1/PASS0 avantseed, aucun faux dernier administrateur. Compte propriétaire absent et création explicitement différée ; pas de remplacement ni promotion.

## Limites du périmètre global

Voir `docs/audit/ECARTS_LIVRAISON_D9374FA.md` : GPS/ETA, support opérateur cloisonné, certaines automatisations/notifications externes/verticales et extensions conditionnelles restent absents ou partiels. Ces manques ne sont pas tous résolus par Stripe/Vercel. Aucun pourcentage global ni achèvement des 76 capacités n'est déduit du nombre de tests. Aucun binaire iOS/Android n'est livré dans cette tranche ; la suite native conserve son ordre conditionnel après le checkpoint Web accepté.

## Coordination

Claude CLI lead unique `b4b555f0` ; commande terminal `claude attach b4b555f0`. Claude conserve les interfaces et ses modules ; Codex pilote/revoit/exécute/intègre et possède les modules A4 (PDF facture/avoir et harnais planning), A5 support et A6 backend GPS/tests dans leurs fichiers délégués. Réutiliser les agents, respecter les worktrees et préserver les WIP. Les rapports détaillés et corrections restent dans `CORRECTIONS.md` et `docs/reviews/`. Le suivi demandé toutes les15minutes est maintenu par l'automation existante, sans doublon.
