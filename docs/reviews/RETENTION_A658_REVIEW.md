# Recheck rétention020 — a658087

Source exacte `a658087a6232746e08c432f1df20fc0b39a78538`, checkout propre avant/après ; contrat356ba08 relu. Diff020 seul et test associé revus contre282edc1.019 inchangée.

**Verdict : aucun P1/P2 identifié. Accord borné à root pour apply020 après ses préflights et contre-revue, puis exécution des trois SQL privés sous les préconditions décrites ci-dessous. Aucun succès scheduler n’est acquis par cet avis.**

Le LOCKcron.job et row_security=off sont retirés. Aucun grantDML/global sur tablescron ne subsiste ; USAGEpostgres reste limité au bloc installation natif. Préflight SELECTcron.job/EXECUTEschedule et absence USAGEanon/authenticated refusent explicitement si incompatibles. RLS reste active. Le lock advisory transactionnel try, clé namespace/base/owner/nom, coordonne uniquement les installateurs coopératifs ; root doit interdire un écrivain administratif concurrent de ce même espace. Lecture explicitement username=current_user. Homonyme autre propriétaire = clé distincte laissée intacte ; collision du propriétaire courant = refus si métadonnées nonconformes ; job conforme non reschedulé. Pas de prétention de visibilité globale ni protection contre un administrateur qui contourne le protocole. Purge/index/ACLservice-only inchangés.

Exécuté : tests/sql-tracking-retention-review.mjs avec PGlite cache existant PASS. Le stub utilise un propriétairecron distinct et installer non-super avec SELECT seul sous RLS ; il reproduit l’ancien42501 sur LOCK, puis création par API, réapplication sansupsert, homonyme étranger invisible préservé, refus collisions/missingSELECT/clientUSAGE. Purge1000 puis1 puis0, deux points frais conservés, métier inchangé. nodecheck et gitdiffcheck PASS. Aucun test de worker réel, concurrence interconnexion ou installationnative réussie revendiqué.

## SQL privés et protocole

Fichiers lus entièrement, sans modification ni exécution :
- `/tmp/depannage-retention-live-manifest.json` — SHA256 `7d770913890351f4392e55fa90d6bcc4b8f30c715f49c7776345d488c5acbc11`, mode0600.
- `/tmp/depannage-retention-live-setup.sql` — SHA256 `68246dcf6b445074679e836c0d242d76c72f7309d2cef7ef2924587af6fd27ac`, mode0600.
- `/tmp/depannage-retention-live-readback.sql` — SHA256 `946dd2d12b5a745cf7d2c40d1087c19ad3470a7af7bc3c5e486018cc5caf5cf2`, mode0600.
- `/tmp/depannage-retention-live-cleanup.sql` — SHA256 `bfc960a172af425ce1566482aa792fe1b8618e01237b7642f29db6639bf6907b`, mode0600.
- `/tmp/depannage-retention-live-protocol.md` — SHA256 `fc1583004719fbef537cf9612addb68f4c4e2e44d99dae1074f8bd3315683bc7`, mode0600.

Le manifeste préexiste au seeding, correspond au run2ee4b485-65ae-4d27-b1fc-32c6651aa9ba et aux six UUID, emails QA et sourcea658087. Le hash intégré dans les trois SQL est celui du fichier exact. Aucun secret présent.

Setup : vérifications rôle/base/migration/extension/job et collisions IDs/emails avant fixture ; compte client/artisan QA sans motdepasse, approbation synthétique explicitement déclarée, deux dossiers/points exacts, état initial en_route. Timing15..35 et borne de durée avantCOMMIT ; métadonnées durables avantcommit et borne DB observée aprèscommit. La seconde phase peut être interrompue aprèscommit : manifeste et cleanup restent nécessaires, jamais présumer rollback. Aucun paiement/admin/grant permanent ou provider.

Readback : BEGINREADONLY ; identité/cohorte/owners et preuve temporelle relues. Vrai job_run_details postbaseline et start≥borne DB aprèscommit, succeeded, owner/base/commande/durée cohérents. Expiré cinq champsNULL et frais strictement inchangé avantfresh_at+60s ; QA002 si fenêtre ratée et QA003 si pas de succès terminé. Ne jamais appeler tracking_snapshot/purge pour fabriquer la preuve. La requête finale affiche les métadonnées sans coordonnées.

Cleanup : transaction, exactUID/email/run/hash/projet/kind/roles et liens dossiers/tracking validés avantdelete. Enfants inattendus documents/devis/support ou histoire immuable bloquent ; aucun nettoyage histoireplateforme. Suppression limitée aux enfants mutables des IDs QA validés, puis dossiers/profils/Auth ; FK inattendue annule. Ni jobcron/historiquecron/budget global ni table étrangère supprimés. Readback aprèsCOMMIT compte les reliquats ; root doit constater les0 et le job préservé, puis faire sa lecture indépendante.

Préconditions : root vérifie réellement CLI--project-ref kcpyjzndybfdlnhvscbs (nomdatabase seul ne prouve pas le projet), migration020 appliquée et métadonnéesjob exactes, absence autre écrivain de cette cohorte, bon timingDB. Après toute issue inconnue/transport, lire et réconcilier plutôt que supposer absence. Les gardes ne prétendent pas résister à un administrateur concurrent modifiant la cohorte après validation ; le protocole exclut cet écrivain. Une fenêtre ratée reste une nonpreuve, nouveau run seulement après nettoyage.

Aucun fichier auteur, compte, bail6466, cloud, credential ou migration distante touché.
