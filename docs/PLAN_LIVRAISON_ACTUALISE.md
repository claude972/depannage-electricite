# Plan de livraison actualisé —31 octobre2026

## Primary goal
Livrer une application de dépannage électrique utilisable dans des espaces client, artisan, entreprise et SuperAdmin réellement fidèles aux maquettes fournies, avec un backend privé vérifié ; puis livrer de véritables applications iOS/Android. Toute fonction absente ou non vérifiée reste explicitement suivie, sans être présentée comme terminée.

Ce document actualise l’exécution de PLAN_REPRISE.md et ses76 capacités, sans supprimer son périmètre ni recommencer les fonctions déjà réalisées. Tout code et script de test est écrit par Claude ; Codex pilote, revoit, exécute et intègre. Le nouvel accès CLI par abonnement a été vérifié par un appel réel réussi. Le propriétaire maintient Vercel/Stripe différés et donne priorité à la fidélité réelle aux PDF.

## État de départ vérifié

| Élément | État au dernier contrôle |
| --- | --- |
| Intégration |9b3dae03e1a413ffe89b34e0db7553ddc1b3ade9, CI verte ; pas encore les nouvelles livraisons suivantes |
| Entreprise visuelle |e7aaef7bddb8559a8442ecd918c3f6d160b8520c, branche claude/web-pwa-design ; contratca7bda6 poussé avant code, tableaux M13/M4/M66 et captures livrés ; acceptation indépendante encore due |
| Recette Web |07d7332cc49c6f86074172f1b69d238e18010a20, branche claude/web-pwa-qa ; corrections annoncées QA001–004, revue et exécution réelle encore dues |
| Gateway média natif |071a963 intégré, GW001 revu ; GW002 et harnais cloud encore à terminer/revoir ; Edge non déployée |
| Base dédiée |kcpyjzndybfdlnhvscbs, migrations001–013 déjà appliquées et relues ; ne pas réappliquer013 par réflexe |
| Parcours déjà prouvés |Sur62b1f7f local+Supabase réel : viewer/scoped-write/owner, brouillon devis save/reload409/send, support2/2, photos2/2 ; Auth/RLS/Storage/concurrence et API pagination ont leurs preuves bornées précédentes |
| Natif |Aucun projet ni binaire créé ; missions conditionnelles publiées |
| Site seven.vercel.app |Ancien déploiement ; ne montre pas ces nouvelles corrections et ne vaut pas validation du style demandé |

## Ce qui manque réellement

1. **Fidélité visuelle globale** : premier lot entreprise codé, mais pas encore accepté/intégré ; autres tableaux de bord, fiches site, approbations, artisan, client, public et SuperAdmin à comparer/corriger selon leur référence maîtresse. Les tests fonctionnels ne donnent pas de passe esthétique.
2. **Fermeture de la recette Web** : sélection obligatoire du bon devis publié, manager avec site visible en lecture seule, navigation admin120, sécurité du harnais après erreur asynchrone et régressions sur le SHA combiné.
3. **Média natif sécurisé** : validation stricte de la réponse de finalisation, harnais fiable et tests réels JWT/Storage/révocation après revue du gateway.
4. **Preuves PWA réelles** : installation sur appareil et mise à jour entre deux versions/deux onglets non démontrées. Manifest, icônes, worker et notice offline sont déjà codés ; il ne s’agit pas d’un module inexistant.
5. **Applications natives** : fondation, écrans, Auth, builds et tests iOS/Android restent à réaliser.
6. **Périmètre avancé restant** : PDF/validité/avenants, GPS/ETA, notifications métier, planning/équipes artisan, B2B équipements/maintenance/SLA/ERP, factures/avoirs/remboursements/commissions, modération et rôles opérateur/finance, paramètres administrables. Leur détail/phase reste dans PLAN_REPRISE et DELIVERY_EVIDENCE_AUDIT_8H ; ne pas les réduire à de simples tests manquants.
7. **Services et données de mise en exploitation** : Stripe test/Connect/webhook réel, nouvelle preview, exploitant/territoire/tarifs/garanties/conditions, sauvegarde-restauration démontrée et supervision. Ne rien inventer pour combler ces entrées.

## Phase 0 — Découverte et état de référence (réalisée pour cette révision)

**How this serves the primary goal:** travailler à partir des vrais fichiers et preuves évite de refaire les fonctions existantes ou de déclarer prêtes des branches non intégrées.

- Sources lues : AGENTS.md, DESIGN.md, PLAN_REPRISE.md, audit8h, missions/corrections distantes, contrat visuelca7bda6, livraisone7aaef7, contrat/rapport QA07d7332, migrations010–013 et plans natifs. Deux collectes indépendantes ont fourni sources, signatures, exemples et limites ; Codex a synthétisé ce plan.
- Interfaces autorisées à réutiliser : `manage_quote_draft` (migration010 : load/save/discard/send, version et assignment_token), `create_support_ticket`/`mutate_support_ticket` (011 : idempotence/version), `finalize_document_upload` (013, JWT utilisateur), routes privées existantes et RLS. Ne pas créer un second modèle de statut/montant pour les nouvelles interfaces.
- Recette à reprendre depuis `07d7332:docs/CLAUDE_WEB_ACCEPTANCE_REPORT.md` §3 : `scripts/qa/run.mjs`, flags `--base-url --sha --project --credentials --app-dir --suite --out --timeout-ms --playwright-path --dry-run --cleanup-manifest`. `--app-dir` doit vérifier le SHA servi ; les sondes RPC directes utilisent la clé publique, jamais le service_role dans le navigateur.
- Exemples visuels : `e7aaef7:components/role/enterprise-space.tsx` ContextBar732, InterventionsTable924, SitesView1915 ; helpers purs `enterprise-lists.ts` et tests associés. Lire les images M13/M4/M66 réelles, pas seulement le catalogue.
- Preuve de sortie : chaque lot distingue codé/intégré/vérifié/différé/absent, acteur, référence, propriétaire et SHA. Les chemins et lignes ci-dessus sont ceux des SHA cités, pas garantis dans un futur commit.

## Phase 1 — Fidélité aux maquettes, acteur par acteur

**How this serves the primary goal:** l’utilisateur retrouve les interfaces qu’il a fournies, avec leur structure métier, au lieu d’un modèle de tableau de bord générique.

**Implémentation Claude.** Relire et corriger le lot entreprisee7aaef7 avant intégration : Sites selon M13, interventions M4 avec détails M66, shell documenté ; puis tableau de bord et fiche site par verticale (V5-C01/C05, M50), approbation V5-C08. Continuer par artisan M35/M34/M36/M14/M65, SuperAdmin M43, client M61/V8-C06/C07, public M11 et variantes cataloguées. Publier avant chaque tranche route→référence/page→écarts→corrections.

**Références.** DESIGN.md ; CATALOGUE_MAQUETTES.md et manifeste sources ; CLAUDE_VISUAL_FIDELITY_CONTRACT.md ; archives CSS seulement après ARCHIVES_CODE.md. Partir des compositions fournies, conserver les composants/services applicatifs existants ; ne pas générer une autre identité visuelle.

**Vérification.** Comparaisons référence/rendu à1280 et360 avec mêmes états/données, navigation clavier/focus/cibles44px, erreurs/vide/chargement, rôle lecture seule. Première correction précise : `e7aaef7:enterprise-space.tsx:2034` affiche encore Aucune pour des alertes issues de listes potentiellement partielles ; distinguer Non vérifié/Aucune parmi les données chargées. Vérifier budgets absents/dépassés, intitulés de date et limites de compteurs/export.

**Garde-fous.** Aucun chiffre, artisan, statut de site, conformité ou SLA inventé ; aucun menu vide ; pas de grandes cartes substituées arbitrairement aux tableaux. Les adaptations responsive/accessibilité sont expliquées, pas utilisées comme excuse à un autre dessin.

## Phase 2 — Revue croisée et recette fonctionnelle du Web

**How this serves the primary goal:** les nouveaux écrans restent utilisables et privés, y compris après échec réseau, changement de compte ou restriction de droits.

**Implémentation Claude.** Finaliser tout retour de revue QA07d7332 ; préserver les scénarios existants et leur idempotence. Intégrer les branches revues par lots cohérents, jamais le WIP. Le lead CLI reprend seulement QA/backend ; le worker Desktop possède le design, sans modification concurrente des mêmes fichiers.

**Références.** Contrats et rapport QA07d7332 ; `safeRoute`, `routeFetch`, `stopBrowser` et `lib/lifecycle.mjs` comme patterns à relire avant réutilisation. Contrats devis/support/documents et tests SQL/RLS existants.

**Vérification Codex.** Prouver QA001 devis publié exact parmi deux versions, QA002 site selected can_write=false en UI et refus serveur403/readback inchangé, QA004 ouverture d’un ancien dossier après pagination120. Tester QA003 : callback en erreur, redaction, arrêt/drain avant suppression, nettoyage même si rapport fatal échoue, récupération par manifeste. Puis parcours client/artisan/entreprise/admin au SHA intégré : chargement/vide/erreur, doubles soumissions, A→B, révocation, photos/support/brouillon, concurrence et montants. Nettoyer chaque cohorte et vérifier son absence.

**Garde-fous.** Pas de test cloud sur un script non revu, de données réelles supprimées ou de PASS déduit du seul exit0 ; les ANOMALY restent à expliquer. Les secrets et coordonnées de recette ne sont ni journalisés ni commités.

## Phase 3 — Livraison Web/PWA vérifiée au périmètre déclaré

**How this serves the primary goal:** fournir une version identifiable et ouvrable, avec une liste exacte des parcours utilisables et des limites.

**Implémentation/livraison.** Build du SHA combiné, version/tag de recette, documentation de démarrage et rapport de livraison. Si Vercel est disponible et la preview autorisée, publier seulement une preview vérifiée ; sinon fournir build/local et code exacts en les nommant correctement. Vérifier manifest, icônes, offline public, absence de cache privé et contrôles d’installation/mise à jour ; préparer installation appareil et cycle deux versions sans perdre la saisie d’un autre onglet.

**Références.** PWA_VERIFICATION.md, public/sw.js, tests PWA, procédures GitHub/preview et rapports existants ; current cachev3 ne prouve pas à lui seul la migration depuisv2.

**Vérification.** Typecheck/tests/build/CI au même SHA, parcours revus des quatre acteurs, comparaison visuelle acceptée dans le périmètre choisi, liste des exclusions explicites. Aucune preuve locale n’est renommée preview en ligne. Nouvelle preview/installation OS/cycle fournisseur différés restent non prouvés tant qu’ils ne sont pas exécutés.

**Garde-fous.** Le checkpoint autorisant le natif est fonctionnel ET visuel sur les fonctions retenues, hors Vercel/Stripe explicitement différés ; ne pas l’étendre arbitrairement à toutes les extensionsV2/V3, ni annoncer toute la spécification complète.

## Phase 4 — Backend média et fondation native, puis client/artisan

**How this serves the primary goal:** permettre une vraie application iOS/Android utilisant les mêmes règles et données, avec des documents toujours privés.

**Implémentation Claude.** Après checkpoint Web, ouvrir les missions natives déjà publiées. Lire expo-overview puis skills Expo/EAS pertinents et docs du SDK retenu avant scaffold. Fondation unique pour dépendances/config/session/navigation/thème ; puis client et artisan en parallèle selon contrat commun. Supabase SDK/RPC sous JWT/RLS, stockage sécurisé des sessions, AppState et refus des réponses tardives ; pas de WebView renommée application.

Le gateway peut être terminé en parallèle des phasesWeb : finir GW002, ses tests et son harnais puis pousser/revoir au SHA exact. Déploiement de test uniquement dans le projet dédié après revue ; tester JWT valide/invalide/expiré, tiers/viewer, fichier/taille/MIME, révocation/concurrence, réponses incertaines et compensation sûre.013 est déjà appliquée : pas de nouvelle application automatique.

**Références.** NATIVE_READINESS_PLAN.md, NATIVE_BUILD_PREFLIGHT.md, missions Foundation/Client/Artisan/EAS, contrat gateway ; vraie signature de `finalize_document_upload` dans013. Conserver le Web SSR, prévoir les liens Auth natifs sans exposer les sessions dans les URLs.

**Vérification.** Tests Auth froid/chaud/logout/A→B, accès intercomptes, devis exact et conflits, acceptation atomique, photos incertaines, offline honnête, aucune clé service/Stripe/bypass dans le bundle. Les privilèges serveur ne remplacent jamais les permissions utilisateur.

**Garde-fous.** Pas de secret de preview, pas d’invention d’API, pas de migration ou template Auth global non revu ; aucune fonction native n’est déclarée prête sur simple export.

## Phase 5 — Vrais livrables iOS/Android

**How this serves the primary goal:** l’utilisateur reçoit des applications construites et testées, pas seulement un projet source ou des agents lancés.

**Implémentation/livraison.** Vérifier compte/projet EAS/quota et produire Android APK interne et build iOS simulateur ; un IPA appareil/TestFlight nécessite les signatures et accès réellement disponibles. Installer les artefacts compatibles et exécuter les parcours sur chaque plateforme. Utiliser EAS cloud compatible plutôt que prétendre la toolchain locale suffisante.

**Références.** Skills eas-app-stores/eas-simulator/eas-update selon besoin après expo-overview, prévol natif et documentation versionnée des outils au moment du build.

**Vérification.** SHA, buildID, plateforme, lien de téléchargement et preuve de lancement/parcours ; captures conformes aux références mobiles, permissions, erreurs, authentification, documents privés. Distinguer simulateur iOS et application installable sur iPhone ; identifier précisément tout blocage de signature.

**Garde-fous.** Aucun achat, production ou store public sans autorisation ; aucune annonce sur seul démarrage d’un build. OTA seulement avec un binaire compatible déjà vérifié.

## Phase 6 — Compléments du périmètre global et mise en exploitation

**How this serves the primary goal:** compléter progressivement la spécification sans masquer ce qui dépasse la première version vérifiée.

**Lots Claude identifiés.** Devis PDF/validité/avenants et preuves terrain ; planning/capacité artisan et société prestataire si décidée ; back-office entreprise enrichi (équipements/maintenance/budgets par exercice/contrats), SuperAdmin complet (rôles support/finance, modération, paramètres, audit), factures/avoirs/remboursements/commissions/rapprochement, notifications métier, GPS/ETA, verticales syndic/restauration/bureaux/ERP/SLA, automatisations et extensions conditionnellesIA/abonnements. Chaque capacité garde son ID dans la matrice76 et la phaseMVP/V2/V3 de la spécification ; aucune n’est effacée pour réduire le travail.

**Dépendances explicites.** Stripe test et Vercel attendent selon consigne, sans bloquer les lots indépendants. Commission/tarif, exploitant, territoire, garanties, mentions et accès Apple/Google nécessitent des données réelles ; préparer les mécanismes et signaler seulement la dépendance qui les bloque.

**Références.** PLAN_REPRISE phases5–10, SPECIFICATIONS_A_COMPLETER.md, couverture76, audit de preuves et sources techniques officielles des intégrations retenues, à relire avant code.

**Vérification finale.** Matrice76 avec état/preuve/limite, tests métier/RLS/concurrence, scénario paiement test fournisseur quand accessible, sauvegarde/restauration et supervision, contrôle des conditions avant ouverture commerciale. Recette visuelle et fonctionnelle après chaque lot ; livraison indépendante identifiable et réversible.

**Garde-fous.** Ne pas appeler ces manques de simples tests si le code est absent ; ne pas simuler de paiement, GPS, conformité ou administration. Le périmètre global n’est déclaré complet qu’avec ses critères réellement démontrés.

## Responsables et point de reprise

- Claude Desktop16d349f9 : VISUAL-FIDELITY-001, design dans son seul worktree/branche ; codee7aaef7 à revoir, pas encore intégré.
- Claude CLIb4b555f0 : coordination de ses agents QA/backend dans leurs worktrees existants, pas de copie du design ; QAlivré07d7332, backendGW002 à livrer.
- Codex : synthèse, revues indépendantes, exécution des recettes, intégration, migrations/déploiements de test autorisés et rapports ; aucun code applicatif/test depuis minuit.
- Prochaine action concrète : revue exacte des deux nouvelles livraisons, correction Aucune partielle, intégration sans conflit puis recette réelle combinée. Pas de nouvelle échéance complète inventée.
