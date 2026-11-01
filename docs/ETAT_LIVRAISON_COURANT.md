# État courant — fastsplit

## Version publique de référence
https://depannage-electricite-ikdqc7xpm-brafas-projects.vercel.app — READY, public sans connexionVercel. Source07022152b267ec236d9f9c4382effe43ffbfade5 ;déploiementdpl_3C5sbNFEdBmRHNhLYamrUT1gjWJq GitSourceGitHublié/brancheintegration/web-pwa.

Nouveau thème validé sur ACCUEIL + DEMANDE3ÉTAPES + AUTH(login/signup/reset). Composants métier inchangés, CSSopt-in/Chromecommun. Nominalroot8cas36039012801440xlightdarkPASS,erreursrequired/typephoto,catégoriepréremplie,draft→Auth,saisieetétapeconservéessurtoggle,aucunPOST/consoleerror/overflow,cookies0. Preuve /tmp/depannage-public-request-hosted-proof.json checkedAt2026-11-01T00:53:06.224Z. Authmodes+avisartisan+busy+erreurconnexionSIMULÉEprovider2themesPASS /tmp/depannage-fastsplit-auth-modes-proof.json ;aucuncompte/SMTPcréé. Les anciens liens restent immuables.

SourceClaude c9d9f12 revue23testsciblésPASS + vraisformulaireslocaux ;rootintégration070 ciblés23+tscPASS,CI41258581524SUCCESS,buildVercelREADY. Imagesréellespublic-request-step1/auth-{light,dark}-{390,1440}.png ;authdark390visuellementcontrôlée.

## Code intégré après cette preview
Intégrationa8d033939300d2d4e77f9a4ee51a9ddd2a58ae6dPOUSSÉE/tscPASS/CI41258626503SUCCESS ajoutebackenddetailCodexa44ca07. P2Claudequotesextras/stringnumericcorrigé,contre-revue14routes+21casPASS. CeGETid/workspacelimits n’estPASdanspreview070etlefrontcap100n’estPASlivré.

## Ajouts demandés au parcours client — prénom et adresse

- Prénom cohérent aux endroits manquants : accueil/en-têtes mobile et ordinateur, profil et reprise ; source profil réel, aucun nom de démonstration en mode connecté.
- Adresse : bouton « Utiliser ma position » avec permission explicite, suggestions de proximité à confirmer ; saisie manuelle conservée en cas de refus/échec.
- Saisie assistée : suggestions après saisie, choix qui préremplit adresse/code postal/ville, correction manuelle et brouillon préservés.
- Mission FASTSPLIT-CLIENT-ADDRESS-NAME-001 : lead Claude responsable du parcours/UI, Codex backend. Recherche+inverse IGN codés3cbb345 et intégrésf8fd66b014a7135708d4f338a6f58818d67bfc50/tscPASS ;recherche et inverse via le module intégré ont réellement répondu200 sur des coordonnées de test publiques en Martinique. Ce sont des contrôles du fournisseur via code local, pas encore une livraison du champ sur la preview.
- UI AddressField et raccordement/prénom en cours chez Claude ; aucune nouvelle adresse ou position utilisateur collectée par ces contrôles. Pas encore annoncé utilisable dans la version publique070.

## Checkpoint du 31 octobre — 21h27 Martinique

Intégrationdd4fde3 poussée : composant adressecf60799 et prénom8aea536 relus,21 tests ciblés et TypeScript strictPASS. Le champ adresse n’est pas encore raccordé au formulaire publié. Thèmeclient2fa relu CSS/wrapper, consumerdetail encore en correction sur délai passif après503/401 ; pas annoncé livré.

Sonde Realtime réelle043/bb05 terminée : abonnement4tables en erreur sans événement, témoins3tables et1table reçoivent leurs événements. H1b mesuré, correctif applicatif demandé ; aucune preuve UI par cette sonde SDK isolée. Cleanup runner et ROOT28lectures indépendantesPASS à01:24:28.989UTC. Rapport REALTIME_043_BB05_REAL_FINDING.md.

## En cours
- LeadClaude :consumerpointread/cache/contexte + raccordementclient/artisan/entreprise,codeobservéenpréparationuse-detail-presence/détailreadonly.
- WorkerUIexistant :styleclientSCOPÉCSS,leadseulclient-space/wrapperthème pouréviterconflitconsumer. MissionFASTSPLIT-CLIENT-THEME-001.
- Claude : corriger abonnement Realtime applicatif (trois tables publiées), raccordement adresse/prénom et finition thème client ; ROOT recette et preview ensuite.

Pasdenouvelleautomatisation15min. AucunecohorteQAconnueactive ;bauxexpirydéjàconsommésnettoyés,pasrejouer. Stripe/premierSuperAdminexplicitementdifférés. Pasproduction/main/transactionréelle/stores/natif. Rôlesetautrespagespubliquespasencoreentièrementmigrés ;applicationcomplètenonannoncée.

Historique et preuves complémentaires : CORRECTIONS.md, MISSIONS.md et docs/reviews/ ; anciens états conservés dans Git.
