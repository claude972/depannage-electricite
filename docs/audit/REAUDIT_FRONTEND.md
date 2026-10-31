# Nouvelle collecte frontend — audit statique

## Sources consultées

- AGENTS.md fourni dans le contexte, DESIGN.md intégralement.
- docs/audit/FRONTEND_BACKOFFICES.md et ARCHIVES_CODE.md ; les sections du premier rapport relatives aux menus, client/artisan et transverses/accessibilité ont été relues ; la sortie collective étant tronquée, je ne prétends pas à une nouvelle lecture intégrale de toutes ses matrices.
- app/page.tsx, app/layout.tsx ; package.json intégralement ; inventaire rg --files app.
- components/courant-app.tsx : état/chargement/Auth/hash/nav 660–980, liste 1581–1668, détail 1900–2075, documents 2119–2185, sites 2310–2440, profil 2480–2560, Auth/admin/coque 2640–2944, formulaire demande 3070–3162, messagerie 3439–3556, documents 3944–4100, pilotage 4239–4390 et contrat 4560–4595 ; Field 500–519 ; export 1094–1137. Recherches globales de setProfessional, onAuthStateChange, query, aria states.
- CSS mobile 2523–2565, reduced motion 3291–3300 ; recherches globales ciblées des masquages et tailles.
- app/auth/reset-password/page.tsx lignes 1–125.
- Métadonnées de tous les cinq tar ; lecture directe des HomePage.jsx, styles.css, animations.css, tailwind.config.js de CODES_CSS_ANIMATIONS avec numéros de lignes. Les autres membres ne sont pas nouvellement relus ici, leur contenu et doublons étant recensés dans le manifeste précédent.
- `git diff 46aac2a -- app components package.json` : vide. Les constats applicatifs antérieurs restent donc pertinents ; aucune prétention à une nouvelle vérification navigateur, cloud ou compte réel.

## Conclusion et corrections du plan

Le manque essentiel est inchangé : une SPA à vues hash et coque commune, avec peu de distinction opérationnelle par acteur. Les archives livrent des compositions, aucun nouveau service. Ne pas consacrer un lot entier à recopier leurs écrans statiques avant de définir autorisations, sélection organisation/site et états financiers. Construire des espaces distincts et des capacités de bout en bout, après réparation du socle d’identité/cache.

### P0 — identité, cache et autorisations de vues avant activation

1. `professional` est défini à 690 et rempli à 715 ; `logout()` 874–889 vide `data`, pas `professional`, selected, filtres ni contexte. `refresh()` 731–749 remplace workspace et rôle sans vider le cache professionnel du compte précédent. Le chargement pro dépend seulement de mode/rôle (804–806), donc un changement compte manager→manager dans une même session peut conserver l’ancien contexte. Risque statique de restitution locale, pas une fuite réseau démontrée.
2. Hash accepté dès qu’il figure dans VIEW_NAMES (787–795), rendu `Sites()`/`Admin()` sans garde de rôle (2925–2930). Les menus filtrés à 914–934 ne sont pas une autorisation. Les API/RLS peuvent refuser le réseau mais ne protègent pas les données déjà en mémoire ni les actions démo.
3. Aucune occurrence `onAuthStateChange` dans le composant. Prévoir invalidation/réinitialisation lors connexion, déconnexion, expiration/changement utilisateur, et rétablissement du dossier autorisé seulement après chargement.
4. Les query parameters de retour paiement/connect/auth ne sont pas lus dans le composant ; la page reset, elle, lit bien code à 20–24. Ne pas généraliser « aucune lecture query dans toute l’application ».

Critère de fin : après manager A→logout→client B ou manager B, aucun ancien contrat/approbation/site/filtre ne subsiste ; hash interdit affiche état autorisé clair sans monter son composant ; expiration coupe l’accès et nettoie les caches. Reproduire d’abord en preview avec comptes séparés et conserver traces sans données personnelles.

### P1 — architecture et fidélité sans nouveau style générique

- `app/page.tsx` rend seulement CourantApp ; nav 914–934 : Overview, missions/demandes, messages, documents, puis sites pour manager et administration pour admin. Pas de routes artisan/entreprise/admin indépendantes.
- `Admin()` 2703–2715 n’affiche qu’ArtisanAdministration et WarrantyPanel : manque réel du Super Admin M43, pas simple problème de renommage.
- L’absence de routes indépendantes n’est pas en soi un défaut de sécurité ni une obligation de spécification. Une stratégie cohérente de navigation et autorisation est requise ; le futur plan peut retenir routes par acteur pour restaurer URLs, retours et contextes.
- CSS plain actuel ; package.json n’a pas Tailwind. Les archives `@tailwind` et `@apply` ne sont pas directement exécutables par ce montage. Choisir conversion des compositions en CSS actuel ou intégration Tailwind versionnée, sans ajouter une stack par défaut.

### P1 — artisan

- Requests() 1603–1611 propose toujours Nouvelle demande même artisan ; backend doit refuser selon règles actuelles. Supprimer l’action non autorisée ou définir un vrai rôle de prescripteur, sans la rendre fonctionnelle arbitrairement.
- QuoteEditor seulement `role === artisan && assigned` 1908–1916 : pas de révision UI lorsqu’un devis est quoted. Les boutons accept/start/complete 1989–2014 existent ; refus de mission absent.
- ProfileView 2480–2559 et ProfileForm : compte et Stripe Connect, pas candidature société/justificatifs valides/planning/secteurs/performance.

Critère de fin : candidature personnelle+société+pièces+zones/disponibilités sauvegardée ; suspension visible ; mission acceptée une seule fois, refus individuel et coordonnées selon règle ; devis créé/révisé, rapport signé/preuves selon périmètre, paiement et versement distingués ; navigation mobile propre aux missions/devis/messages/profil avec états vides/erreurs.

### P1 — entreprise cliente et Super Admin

- Sites() reste une série de cartes et pilotage ; bouton Demande 2360–2368 appelle newRequest() sans site ; formulaire RequestForm 3084–3103 sait choisir site sans préremplir adresse.
- `ProfessionalOperations` 4239+, sélection site locale qui choisit sites[0] par défaut ; rapport live 4327 envoie `/api/reports?format=csv` sans sélection site. `save_contract` 4579–4583 utilise organizations[0], sans organisation active choisie.
- Aucun menu invitations/membres ni rôles par site, sélection organisation et fiches verticales détaillées. Les trois rubriques pilotage (approbations/contrats/audits) existent bien ; ne pas les qualifier entièrement absentes.
- Super Admin : approbation/suspension et garantie présents ; exploitation globale artisans/interventions/devis-factures/clients/avis/messages/paramètres et dispatch manquent.

Critères entreprise : organisation/site actif explicite, invitations et révocations, permissions distinctes selon site, demande liée au bon site et contacts, fiche verticale, approbation et payeur délégué cohérents, rapports filtrés/précisés.
Critères Super Admin : chaque menu M43 avec recherche/pagination/états et action tracée ; réaffectation contrôlée ; finance globale issue du ledger serveur ; aucune confusion avec owner d’organisation cliente.
L’entreprise prestataire employant plusieurs techniciens reste un modèle séparé à arbitrer ; ne pas l’inventer à partir du B2BDashboard fourni.

### P1/P2 — client, devis et preuves financières

- Documents 2133–2164 boucle toutes les versions mais bouton n’envoie que intervention_id ; currentQuote 903–913 sélectionne une autre version possible. Créer une sélection immutable du devis par ID/version, PDF et références commerciales ; ne pas afficher un récapitulatif TXT comme facture.
- Avis et garantie sous paid 1917+ existent ; retour Stripe et vrai état webhook n’ont pas de parcours dédié. Une URL success ne vaut jamais paiement.
- Fichiers 3944+ : limite 4 MiB à 3968, types autorisés 3971+, dépôt désactivé démo 4051+ ; pas de dates/types métier/expiration/revue de pièces.
- MessageCenter 3512–3519 étiquette tous les tiers Artisan côté non-artisan, même un autre manager/admin autorisé ; afficher identité/rôle minimal autorisé selon participant réel.
- Notification-button 2843–2850 ne prouve pas un centre de notifications ; badge lié au nombre total des messages.
- CSV frontend 1126 et 4316 garde locale au début strict de chaîne ; ne pas extrapoler les tests serveur csvCell à cette copie (espaces/onglets initiaux à couvrir).

Critère de fin client : demande avec photos/lieu/créneau selon règle ; devis exact/version et refus ; coordonnées autorisées ; galerie/historique/rdv ; checkout test, retour annulé/réussi et reprise, aucun doublon ; facture et garantie réelles selon conditions retenues.

### Accessibilité : points confirmés, preuve bornée

- Présents : lang fr, skiplink (layout), reduced-motion global réel 3291–3300. Les archives ne possèdent pas cette protection ; ne pas affirmer que l’application actuelle ne réduit jamais les animations.
- Menu mobile : CSS 2527 translate hors écran, garde DOM 2729+ sans inert/hidden ; boutons ouverture 2826+ sans expanded/controls. Pas de piège focus/Escape/restauration visible. Cible menu 32×44 à CSS2559.
- Tabs liste 1620–1630 et opérations 4370+ ont classe active mais pas état accessible sélectionné ; nav 2762+ sans aria-current. Corriger selon le widget choisi, pas ajouter role=tab sans comportements clavier associés.
- Field 500–519 enveloppe label+contrôle+hint ; ce n’est pas une absence générale de label. Séparer les indications dans aria-describedby et associer erreurs aux champs.
- Reset main 75 n’a pas id main alors que skiplink global le cible.
- Pas de nouvelle mesure contraste/zoom/reflow/lecteur écran ni prétendue certification AA.

## Variantes source : réutilisation explicite

Archive animations/HomePage.jsx 5,21,36/41/46 : page-enter, slide-up et fade-in différés ; styles.css 43–62 sans fill backwards/both crée une possibilité de contenu visible puis disparition au départ ; à vérifier visuellement. styles.css55–56 pulseSoft infinite et animations.css3–4 bounce infinite contredisent la règle de boucles décoratives permanentes de DESIGN.md. Les classes d’animations.css ne sont pas branchées aux composants livrés. Les autres risques (old fadeIn collision, globals alternatif incomplet, content globs) restent exacts.

Conserver les sources originales ; choisir une seule variante et reprendre seulement composition métier+tokens validés. Aucune identité Élec Pro/SyndicPro, promesse 24/7, montant ou donnée fictive ne devient validée par l’archive.

## Patterns disponibles et limites de la liste Allowed APIs

Liste **interne observée**, pas validation de documentation fournisseur actuelle :
- `api<T>(path, body?, method?)`, composant 659–676 : gestion JSON/error/no-store réutilisable.
- `run(task)` 859–871 : busy/error/notice ; compléter invalidation et annulation/compte cible avant reprise.
- `RequestForm` 2966+, `QuoteEditor` 3275+, `MessageCenter`3439+, `DocumentManager`3944+ : comportement concret existant à conserver/améliorer, pas recopier les squelettes statiques à leur place.
- `ConfirmAction`5021+ : confirmation intégrée existante ; éviter de réintroduire browser confirm ou action sans garde.
- `createClient().auth.signUp/signInWithPassword/resetPasswordForEmail/signOut` (2651+,874+) ; reset page `exchangeCodeForSession`, `getUser`, `updateUser` (23,27,63) sont APIs réellement appelées. Vérifier docs officielles à l’implémentation, sans paramètres inventés.

## Dépendances et ordre recommandé

0. Fixer rôle/organisation/preuves et référence maîtresse par écran ; décisions bloquantes classées (payer/revocation/TVA/conditions).
1. Réparer session/cache/permissions et retours ; provisionner ensuite environnement test dédié et RLS prouvée.
2. Navigation par acteur + composants accessibles + quelques captures représentatives confrontées aux PDF ; pas écran final basé seulement sur les trois couleurs.
3. Cycle opérationnel client-artisan complet et Super Admin minimum d’exploitation ; candidatures/dispatch avant service réel.
4. Entreprise cliente complète, puis approbations/finance avancées verticales selon dépendances réelles ; distinguer provider teams.
5. Stripe test complet et ledger, documents commerciaux, remboursement/litige selon périmètre ; ne pas attendre la toute fin pour définir payeur/montants.
6. Vérification preview par rôle, permissions négatives, reprise panne, mobile/accessibilité et traçabilité source/preuve/critère ; chaque lot sans preuve live reste non validé.

Confiance élevée sur les extraits ci-dessus et absence de changement applicatif ; moyenne sur l’exhaustivité nouvelle (relecture ciblée, pas 5274 lignes toutes relues cette fois). Aucun incident d’exposition démontré et aucun contrôle externe frais. Les références PDF de ce rapport sont reprises du catalogue existant, pas de nouvelle comparaison pixel par pixel.
