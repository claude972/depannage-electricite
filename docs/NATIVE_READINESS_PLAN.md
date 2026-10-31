# Préparation iOS/Android — lecture seule, aucun démarrage natif

État constaté le31 octobre2026 à03:27UTC. Sources applicatives : checkout d’intégration `b8a277afeaac85eec8867d67b236303579e0ec88` au moment de lecture ; helpers Auth, routes, config et templates lus directement. AGENTS.md et DESIGN.md respectés. Ce document prépare la suite et ne déclare ni le Web livré ni une application native existante.

## 0. Porte d’entrée obligatoire

**Web/PWA vérifié avant scaffold, projet EAS ou build natif.** Le Web a encore des corrections/recettes ; le pilote signale un quota Vercel24h et l’accès Stripe test reste indisponible. Ces contraintes ne sont pas contournées en annonçant le natif terminé. À partir du31 octobre00:00 America/Martinique, Claude possède tout le codage avec1–10 agents ; Codex pilote, revoit et teste. Préparer maintenant les contrats ne démarre pas leur implémentation.

La référence produit garde l’électricité et les rôles distincts. Les priorités natives sont client et artisan. L’entreprise cliente requiert une décision de périmètre mobile explicite ; ne pas attribuer silencieusement à son owner des droits plateforme. Super Admin et back-office desktop restent Web dans la proposition, sans les retirer du produit. Un éventuel écran DOM transitoire n’est pas un écran natif livré ; une webview/PWA n’est pas une application native finale.

## 1. Versions vérifiées, à revalider au démarrage

Lecture officielle et métadonnées npm sans installation : `expo` tag latest **58.0.21**, `eas-cli` **27.2.0**, `create-expo-app` **5.0.0**. SDK58 est une sortie stable annoncée le15 octobre2026 ; la matrice officielle l’associe à React Native0.88 et React19.3.0. L’environnement Node24.15.0 observé satisfait les engines Expo `^24.3.0` et EAS. Ne pas recopier le React19.3.1/Next du Web dans le package mobile. [Changelog SDK58](https://expo.dev/changelog/sdk-58), [matrice SDK58](https://docs.expo.dev/versions/v58.0.0/), [registry Expo](https://registry.npmjs.org/expo/latest), [registry EAS](https://registry.npmjs.org/eas-cli/latest), [registry create-expo-app](https://registry.npmjs.org/create-expo-app/latest).

Le changelog signale un décalage de disponibilité Expo Go et recommande un development build pour SDK58. Ne pas déduire qu’un Expo Go installé accepte le SDK choisi ; recontrôler à la date du scaffold. Bibliothèques natives via `expo install`, versions fixées par le SDK et lockfile ; pas de canary/next choisi par accident. Lire la documentation `/versions/v58.0.0/` si ce SDK reste retenu. [Sortie SDK58](https://expo.dev/changelog/sdk-58).

**Inventaire machine :** `command -v eas` ne trouve aucun exécutable ; aucun compte EAS interrogé, aucun token lu, aucun login/projet créé. `agent-browser` et `argent` ne sont pas trouvés non plus. Aucune installation effectuée. Lors du démarrage autorisé : installer/choisir la CLI épinglée, lire `--help`, puis `whoami` sans afficher de token ; vérifier l’organisation et les ressources avant `init`. Un compte Expo ne prouve pas l’accès Apple/Google ni les quotas de builds/simulateurs.

## 2. Contrats serveur à préparer après la porte Web

### A. Auth native sans cookies de navigateur

**Blocage réel :** `lib/supabase/server.ts` construit un client SSR depuis `next/headers.cookies()` ; `authenticatedClient()` appelle ensuite `getUser()` sans JWT. Aucune branche Authorization Bearer n’existe. Les routes `/api/workspace`, `/api/interventions`, actions, documents, artisan, organisations et paiements utilisent ce helper. Envoyer un token depuis React Native ne les authentifiera donc pas actuellement.

**Contrat proposé :** branche serveur explicite pour un unique `Authorization: Bearer <access-token-Supabase>` ; valider le token contre Auth et exécuter lectures/RPC avec ce même JWT utilisateur, sous RLS. Sans Bearer, conserver le flux cookie SSR du Web. Bearer malformé/invalide ne retombe pas sur un cookie ambigu. Ne jamais autoriser par un user_id, rôle, header de plateforme ou simple décodage JWT client ; aucun service_role pour contourner les droits natifs. `getUser(jwt)` est l’API officielle de vérification distante. [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser).

Préserver `assertOrigin` et la protection des mutations Web. React Native peut ne pas envoyer Origin, mais ce n’est pas une autorisation ; le JWT vérifié et les contrôles métier restent obligatoires. Définir et tester les demandes mixtes cookie+Bearer,401/403, token expiré, autre projet, rôle retiré et requêtes anonymes. Vérifier toutes les routes utilisateur ; `/api/payments/webhook` garde son contrat de signature Stripe, sans Bearer utilisateur requis.

**Autre blocage :** une preview Vercel protégée ne devient pas accessible à l’app par la seule Auth Supabase. Choisir un endpoint QA natif stable, autorisé et joignable avec ses protections prévues. Aucun secret d’automation/bypass Vercel ne doit être intégré au binaire ou à `EXPO_PUBLIC_*`, ni protection globale désactivée pour faciliter une démo. La restriction quota Vercel n’est pas une raison de déployer la production.

### B. Sessions, mémoire et cycle de vie

Client Supabase natif séparé du client SSR/browser : URL et clé publishable publiques uniquement. Adapter son stockage à SecureStore pour jetons/session ; aucun refresh token en AsyncStorage/SQLite non chiffré/logs. Traiter les erreurs de taille/écriture du stockage sécurisé, la réinstallation/restauration et la suppression de session ; ne pas stocker de dossiers/photos dans une grosse valeur SecureStore. La documentation prévoit un stockage persistant, `detectSessionInUrl:false` et la gestion AppState pour le renouvellement. [Supabase React Native](https://supabase.com/docs/guides/auth/quickstarts/react-native), [SecureStore SDK58](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/).

Hydrater la session avant les décisions de navigation. Rafraîchissement de token single-flight,401 puis une réauthentification bornée ; pas de boucle. À logout, changement d’utilisateur ou permissions : annuler/ignorer anciennes requêtes, vider caches et photos temporaires, remonter l’arbre autorisé. À chaque retour AppState active, revalider workspace, membership/site scope et sessions. Les réponses tardives de A ne modifient jamais B. Les query keys incluent identité/organisation/site ; aucune démo ne devient session live.

### C. Liens Auth : confirmation et récupération

**Blocage constaté :** `supabase/templates/confirmation.html` et `recovery.html` envoient toujours vers `{{ .SiteURL }}/auth/confirm?token_hash=...`; `supabase/config.toml` n’autorise que les routes Web. Le handler `app/auth/confirm/route.ts` consomme le token puis pose une session cookie Web ; il ne fournit pas une session native. Un `emailRedirectTo` natif seul ne corrige pas ces templates.

Prévoir des callbacks Web et natifs distincts, schémas/Universal Links/App Links autorisés, identifiants application et domaines vérifiés. Le flux retenu doit conserver l’association à la demande (PKCE lorsqu’applicable), traiter lancement à froid/à chaud, type signup/recovery exact, expiration/usage unique et absence de session. Ne pas consommer le token dans un handler Web avant l’échange natif ; aucun transfert de cookie ou refresh token par URL. Le reset natif ne s’ouvre en mode autorisé qu’après vérification de la session recovery. Préserver les parcours Web et leurs templates ; tout RedirectTo passe par allowlist stricte, jamais un return_url arbitraire. [Liens mobiles Supabase](https://supabase.com/docs/guides/auth/native-mobile-deep-linking?platform=react-native), [URLs autorisées](https://supabase.com/docs/guides/auth/redirect-urls).

### D. Photos privées et fichiers

`app/api/documents/route.ts` reçoit multipart `file` et `intervention_id`, limite4194304octets et vérifie les signatures JPEG/PNG/WebP/PDF. Les téléchargements sont signés60secondes après contrôle utilisateur. HEIC/AVIF ne sont pas acceptés par ce serveur ; picker MIME/extension parfois absents ne font pas autorité. [ImagePicker SDK58](https://docs.expo.dev/versions/v58.0.0/sdk/imagepicker/).

Contrat natif : permission caméra/galerie au besoin, annulation/refus/restriction gérés ; décoder puis convertir les photos HEIC en JPEG à l’aide d’ImageManipulator, redimensionner/compresser avec taille mesurée, nom/MIME cohérents et fichier final≤4MiB. Rejeter explicitement si conversion/taille échoue ; ne pas seulement renommer l’extension ni changer MIME. Vérifier orientation, transparence, photos iCloud non locales et content:// Android ; tester la suppression des métadonnées sensibles selon traitement retenu. Aucune base64 en JSON de gros fichier. [ImageManipulator SDK58](https://docs.expo.dev/versions/v58.0.0/sdk/imagemanipulator/).

Rattacher après création du dossier autorisé, retry uniquement pièces échouées sans doubler la demande. Pas d’upload automatique après révocation/session changée. Fichiers temporaires privés et purge à logout/fin ; ne pas conserver d’URL signée dans un cache durable ou un outil analytique. Pour les justificatifs PDF : picker document et mêmes bornes/contrôles serveur, sans conversion photo. Les limites serveur et requêtes déjà en vol restent documentées.

### E. Paiement test et retour navigateur

Réutiliser `/api/payments/checkout`, `/connect`, `/status` et webhook côté serveur. Les clés secrètes/commissions/destinataire/montant restent serveur. Les routes actuelles produisent `success_url`, `cancel_url`, refresh/return Connect à partir de `appUrl()` Web uniquement ; aucune destination native prévue. Ajouter un contexte de retour serveur allowlisté, sans URL arbitraire et sans changer l’autorité des montants.

Première intégration proposée : ouvrir l’URL Stripe hébergée dans le navigateur système, revenir par lien supporté ou retour explicite à l’app, puis relire le statut serveur. Toute fermeture, annulation, faux lien success ou retour sans webhook garde un état non confirmé. Le retour Connect ne prouve pas les capacités ; relire l’état fournisseur côté serveur. Ne pas installer un SDK de paiement natif comme simple remplacement des comptes v2/Checkout existants sans étude dédiée. L’accès compte Stripe test, pays/commission/responsabilités et payeur restent prérequis ; aucun paiement réel ni fausse réussite native.

## 3. Backend réutilisable et UI native attendue

Garder Next/API hébergé et Supabase partagé ; pas de migration vers EAS Hosting nécessaire à ce plan. Réutiliser les règles/types de domaine purs lorsqu’ils ne dépendent pas du DOM ; réécrire les composants React/CSS en composants natifs. Packages et TS configs isolés (par exemple `apps/mobile`) pour ne pas faire compiler les modules RN par Next ni imposer son React au Web. Choix final à documenter sans restructurer le Web existant.

| Acteur / référence | Écrans natifs | Contrats existants à réutiliser après adaptation Bearer |
| --- | --- | --- |
| Client M61 |4onglets Accueil/Demandes/Messages/Profil ; CTA demande, états récents | GET workspace ; POST interventions ; profile ; messages |
| Client V8-C06/C07 | Dossier/timeline, devis exact et accord/refus, documents, avis | interventions/[id]/actions +operations ; documents ; reviews ; payments/status/checkout |
| Artisan M35 |5onglets Tableau de bord/Missions/Devis/Messages/Profil, missions du jour et performance honnête | workspace/available_missions ; artisan/performance ; operations |
| Artisan M34/M67 | Offre anonymisée, accept/refus, mission, devis/brouillon, rendez-vous, rapport terrain | actions ; operations ; interventions/[id]/quote-draft (contrat récent à revalider au SHA natif) |
| Artisan M65/M14/M36 | Candidature société, pièces, disponibilité, profil et Connect | artisan ; documents ; profile ; payments/connect |
| Entreprise M66 | À décider : consultation mobile/site/demande/approbation seulement ou périmètre plus large | organizations ; site-access ; invitations/accept ; sites ; professional ; reports |
| Support | Ticket natif uniquement si contrat Web validé | support et support/[id] récents, sans accès messages privés élargi |

Pas de copie de cadres téléphone/barres système, fausse distance/ETA, taux ou certification. Préserver la hiérarchie métier navy/blanc/bleu et les libellés des références, avec composants natifs, tailles de texte accessibles et adaptation Android/iOS. Expo Router pour stacks/tabs et gardes ; `@expo/ui` consulté pour formulaires/sheets/menus, listes virtualisées pour volume. Composants/types/utilitaires hors des fichiers de routes. Les fonctionnalités absentes du Web ne deviennent pas présentes par l’existence d’un onglet mobile.

## 4. Réseau/offline et mutations

Politique initiale sûre : aucun cache persistant de workspace, contacts, messages, photos/documents privés ou données professionnelles. Cache mémoire par session, purgé lors de changement de droits/compte. Hors ligne : notice explicite et brouillon local privé seulement si sa conservation est choisie/testée ; pas d’état « envoyé/accepté/payé » sans réponse serveur. Pas de queue offline pour accepter mission/devis, approbation, réassignation, paiement ou clôture.

Ne pas appliquer les retries GET aux POST non idempotents. Après timeout d’une mutation, résultat incertain : relire avant reprise et demander une action consciente ; création de demande n’a pas de clé d’idempotence générale aujourd’hui. Les tokens de version/assignment du brouillon doivent être renvoyés, jamais reconstruits. Annulation au changement de compte,401/403 centralisés et état vide distinct d’une panne. Pas de log de Bearer, URLs signées, liens Auth ou identifiants financiers sensibles.

## 5. Lots futurs et critères EAS cloud

1. **Contrats et gate** — faire accepter le checkpoint Web par preuves, inventorier API/Bearer/retours et périmètre natif. Publier mission GitHub par propriétaire/branche avant codage.
2. **Fondation après gate** — Claude scaffold natif séparé via standard create-expo-app adapté au SDK effectivement choisi ; theme/router/session/Bearer et écrans client/artisan natifs. Vérifier aucun secret ni dépendance RN dans le bundle Web.
3. **Parcours terrain** — demande/photos, mission/devis, pièces/messages/rapport et rôle/permissions. Écrans loading/error/empty/content ; clavier, lecteurs d’écran, contrastes, Dynamic Type, cibles tactiles et réduction animations.
4. **EAS non-production** — après accès vérifié, projet exact/owner connu, CLI `init` et `build:configure` avec revue du diff ; profils development/preview, variables publiques pointant QA. `update:configure` officiel pour runtime/channels, jamais URL/runtime inventés à la main. [EAS Build](https://docs.expo.dev/build/introduction/), [EAS Update setup](https://docs.expo.dev/eas-update/getting-started/).
5. **Builds réels** — iOS simulateur cloud et Android émulateur/cloud, puis Android APK interne et iOS device ad hoc/TestFlight selon accès. Un build simulator iOS n’est pas installable sur iPhone. Device iOS exige signature/provisioning/UDID ou TestFlight ; Android APK interne exige keystore ; AAB n’est pas un APK d’installation directe. Aucune publication publique. [Distribution interne](https://docs.expo.dev/build/internal-distribution/).
6. **Preuves par plateforme** — build ID, SHA, bundle/package ID, runtime/channel, liens EAS, captures/scénarios datés. Au minimum coldstart/session persistante, signup/recovery liens froid/chaud/expirés, A→logout→B avec réponse retardée, révocation site, mission concurrente deux sessions, devis version exacte/brouillon conflit, photo HEIC/iCloud/grosfichier/refuspermission, offline/retry sans doublon, Stripe test retour/fermeture/webhook différé, document intercompte refusé. Vérifier Android retour matériel/permissions et iOS gestes/clavier/rotation. Une compilation ou QR ne prouve pas ces scénarios.
7. **OTA preview** — publication JS/assets seulement sur runtime compatible déjà installé ; ajout module/permission/SDK exige nouveau build. Tester coldlaunch, téléchargement puis second coldlaunch, rollback et conservation du travail. Pas d’Update production. [Compatibilité runtime](https://docs.expo.dev/eas-update/runtime-versions/).

EAS Simulator agent-driven est adapté à la demande de tests cloud : lire le skill et help effectifs avant chaque commande, session nommée bornée, installer le build du bon SHA, capturer puis arrêter la session créée et nettoyer sa configuration. Accès/quota non confirmés actuellement ; aucun simulateur n’a été lancé. Les actions réelles requièrent l’outillage disponible et les instructions du skill ; ne pas fabriquer une preuve appareil depuis une capture Web.

## 6. Séparation des décisions et accès

**Décisions techniques réalisables par Claude après gate :** package natif isolé, adaptation Bearer sous RLS, stockage sécurisé, navigation native, conversion photos, erreurs/revalidation, tests et previews sur comptes existants autorisés.

**Informations/accès externes non acquis :** compte/organisation Expo et quotas, Apple Developer/signatures/UDID ou App Store Connect, Google Play pour track interne si retenu (non requis pour APK direct), domaine/identifiants définitifs et association liens, accès Stripe test et données commerciales, SMTP/délivrabilité. Ne pas inventer une marque/bundle ID appartenant à autrui, un taux, un payeur ou une couverture.

**Choix produit à conserver ouverts :** étendue mobile entreprise, garanties/remboursements/factures, géolocalisation/GPS et notifications push, stockage offline de données sensibles. Le diagnostic IA/abonnements digitaux/integrations n’est pas ajouté implicitement au natif.

**Statut final de cette mission :** préparation seule terminée ; aucun fichier du dépôt, compte, skill global, projet EAS ou application native modifié/créé. Aucun build, test appareil ou livraison native annoncé.


## Addendum — préparation sans dépendance à Vercel/Stripe

Le propriétaire a explicitement différé Vercel et Stripe et demande d’avancer sur les autres lots avant08h. Cela autorise la préparation et les contrôles de comptes/outils ; la présente mission ne scaffold toujours aucune application. Le pilote doit consigner toute révision de la porte Web-first avant démarrage natif effectif, et conserve Claude seul auteur du code à partir de00:00.

### Option directe Supabase : proposition pour les fonctions non financières

Un client natif authentifié `@supabase/supabase-js` peut utiliser directement le même projet dédié, ses tables sous RLS et ses RPC métier publiques autorisées. Cela évite la couche HTTP Next cookie-only et la protection de preview Vercel pour ces fonctions, sans reproduire un backend métier parallèle. Ce n’est pas une obligation de rendre Vercel public. La proposition est une décision technique future, pas un raccordement réalisé.

Inventorier puis réutiliser les signatures/grants effectifs : create_intervention, available_missions, intervention_action, decline_mission, reject_intervention_quote, rendez-vous/déplacement/rapport et participants ; save/submit artisan/availability, artisan_performance ; memberships/invites/site scopes ; manage_quote_draft et support si ces migrations récentes sont revues/appliquées. Ne jamais appeler une fonction interne renommée ou révoquée ni ouvrir un nouveau grant pour contourner le serveur. Les vérifications SQL, montants, verrouillages, rôle courant et propriétaire restent autoritaires. Les projections/orchestrations de workspace deviennent des lectures utilisateur minimales sous RLS, avec états/pagination explicites. Les schémas d’API restent à inventorier : tout contrôle actuellement uniquement Next (format, limites, antiabus) doit être conservé côté frontière serveur/SQL, pas seulement recopié dans l’app. Les vues admin, appels Stripe et service_role restent hors de cette voie native directe.

**Uploads privés :** les policies existantes autorisent les lectures contrôlées, pas un upload public libre équivalent à la route Next. Ajouter une passerelle Edge authentifiée revue, avec validation partagée des octets magiques/MIME, taille≤4MiB et borne de multipart, quotas/rate-limit, contrôle du dossier/rôle, puis Storage privé. Auth côté Edge doit vérifier le JWT et garder les opérations ordinaires dans le contexte RLS de l’utilisateur ; tout secret d’administration nécessaire reste exclusivement Edge. Une commande SQL finale doit revérifier l’autorisation courante (avec les mêmes verrous organisation/site) avant de rattacher la metadata ; sur refus/échec retirer uniquement l’objet créé par cette opération. Prévoir identifiant d’opération user-scoped/idempotence, retry sûr, journal expurgé et réconciliation des objets orphelins. Ne pas rendre le bucket public ni distribuer de service key pour permettre un upload natif. [Sécurisation Edge Functions](https://supabase.com/docs/guides/functions/auth).

### PKCE natif et templates conditionnels : préserver le SSR Web

Proposition à prototyper/tester, aucun template/provider modifié ici : garder l’exacte branche Web token_hash→/auth/confirm→cookie SSR. Pour des RedirectTo natifs explicitement allowlistés (schéma/domaine et chemin fixes), utiliser une branche de template Go conditionnelle qui choisit le lien ConfirmationURL fourni par Supabase ; pour les autres RedirectTo reconnus Web, conserver le contenu SSR actuel. Ne pas choisir selon une user_metadata.platform contrôlée par le client, ni injecter librement RedirectTo dans un href non vérifié. Les templates officiels exposent RedirectTo et ConfirmationURL et supportent les conditions ; l’allowlist Auth reste indispensable. [Variables et conditions templates](https://supabase.com/docs/guides/auth/auth-email-templates).

Configurer le futur client natif avec flowType pkce et stockage sécurisé du verifier ; après lien de confirmation/recovery, traiter le code une seule fois dans le callback autorisé, puis exchangeCodeForSession avec le verifier de la demande lancée sur ce même appareil. La documentation précise une durée5minutes du code et un usage unique. Éviter les flows simultanés tant que leur association n’est pas testée avec le SDK épinglé ; le support expérimental d’overlapping flows ne doit pas être adopté par défaut. Ouvrir le mail sur un autre appareil sans verifier doit produire une reprise explicite, sans faux succès de session. Tester webSSRsansrégression, natif froid/chaud, mauvais scheme/path/type, code expiré/rejoué, recovery sans session, mail scanner et réseau interrompu ; aucune URL de token dans logs/crash-report. Les problèmes de délivrabilité restent distincts d’un callback correct. [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [deep links natifs](https://supabase.com/docs/guides/auth/native-mobile-deep-linking?platform=react-native).

Ce chemin permet de travailler sur Auth, missions, données et UI natives non financières sans attendre Stripe ni l’accès à une preview HTTP protégée. Les paiements restent explicitement différés jusqu’à accès test et vérification du cycle fournisseur ; aucune simulation n’est promue en live.


### Résultat du prévol compte/outils ultérieur

Le prévol autorisé a exécuté EAS27.2.0 via npx dans un cache temporaire interne (pas de CLI globale installée) : whoami exit0, compte claude972 connecté, Owner sur claude972 et claude972s-team. Quotas/builds/signatures Apple/Google non vérifiés. Inventaire local : Xcode26.3, runtime iOS26.3 arrêté ; AndroidAVD36/ADB37 et JDK17. SDK58 exige Xcode26.4+ et compileSDKAndroid37, donc la compilation locale ne peut pas être réputée prête. Cloud build avec images adaptées reste une route possible, à vérifier sur le compte/projet exact ; aucun projet/build/simulateur lancé. Voir `/tmp/depannage-native-build-preflight.md` pour sorties bornées et limites. [Compatibilité SDK58](https://docs.expo.dev/versions/v58.0.0/).
