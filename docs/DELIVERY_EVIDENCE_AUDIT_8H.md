# Audit de preuves — préparation du bilan08h

Relevé en lecture seule à02h05–02h15 AST,31octobre2026. Application examinée : integration `9b3dae03e1a413ffe89b34e0db7553ddc1b3ade9`. Coordination : `df1f9a3`, `docs/NIGHT_DELIVERY_8H.md`, MISSIONS/CORRECTIONS et rapports de preuve existants. Aucun code applicatif/test écrit, aucune mutation cloud ni exécution de recette créant des données pendant cet audit.

## Conclusion à porter au bilan

Un Web/PWA substantiel existe et plusieurs parcours réels sont vérifiés. **La totalité des76 capacités et les applications natives ne sont pas livrées.** Différer Vercel et Stripe autorise de poursuivre les autres lots ; cela ne transforme pas les fonctions absentes en simples tests manquants. Aucun pourcentage d’avancement fiable n’est déductible des fichiers ou tests.

Le plan et la matrice sont des inventaires historiques, pas des preuves actuelles : plusieurs textes décrivent encore comme absents les photos, brouillons de devis, support et annuaires qui ont été implémentés depuis. Inversement, un menu ou une carte “indisponible” n’établit pas une fonction livrée.

## Périmètre et ordre : distinguer MVP, livraison courante et versions futures

Source normative : AGENTS.md, sections MVP/V2/V3, et PLAN_REPRISE phases4–10. Le MVP explicite couvre demande/estimation/matching/devis/intervention/paiement et réception/acceptation/devis/actions/suivi artisan. Chat/tempsréel/portail B2B/garantie sont V2 ; approbations avancées/fiches détaillées/contrats/reporting/IA/conformité sont V3. Les back-offices et le natif ont aussi été demandés explicitement ; ils disposent de lots réels, mais cela ne rend pas chaque extension avancée obligatoire avant de commencer le natif.

**Aucun nouveau manque de code dans une fonction essentielle du MVP, hors intégration paiement expressément différée, n’est établi comme bloquant par ce relevé.** Les commandes principales existent. Le blocage immédiat est de terminer la preuve du périmètre codé, corriger les vrais défauts de sécurité/recette, et déclarer honnêtement le paiement non exercé. Les fonctionnalités absentes listées plus bas sont le reliquat du plan élargi, pas de nouveaux critères de gate avant le natif.

Priorités exécutables à03h50 :

1. **P0 fiabilité/vérification de livraison courante** : faire pousser/revoir QA003 (harnais, nettoyage sûr), QA001 (quote_id sélectionné obligatoire) et QA002 (site sélectionné lectureseule). Rejouer ces scénarios au checkpoint Web exact. Autorité/isolation restent des exigences transverses même pour le portail déjà codéV2.
2. **P1 validation du back-office demandé** : corriger le locator QA004, rejouer UI120. Il s’agit d’une preuve manquante, pas d’un serveur absent ni d’une preuve de défaut application.
3. **P1 prérequis média natif, non blocage Web** : terminer GW002/revue et livraison du harnais JWT/Storage puis déployer/valider le gateway. Le chemin photos Web actuel a déjà sa recette ; ne pas retenir sa livraison sur la seule indisponibilité du nouveau gateway.
4. **Ensuite natif**, conformément à la demande, lorsque le checkpoint Web fonctionnel du périmètre retenu est accepté hors services différés. Ne pas attendre cartes/SLA/IA/factures/grilles avancées, sauf nouvelle décision explicite de périmètre.
5. **BacklogV2/V3/conditionnel** : garder chaque fonction absente suivie par son ID/phase. PDF et validité calendaire/avenants appartiennent au parcours devis enrichi phase5 ; le MVP explicite exige un devis cohérent et son acceptation, pas la livraison implicite de tous ces enrichissements avant le natif. Les textes métier/légaux réels restent prérequis d’une ouverture commerciale, pas d’un scaffold/test interne.

## 1. Priorité avant le checkpoint Web : finir les preuves plutôt que réécrire les fonctions déjà présentes

Preuves acquises, selon les rapports publiés, sans refaire ici leurs recettes :

- Supabase dédié réellement actif ; migrations001–013 appliquées, dernier contrôle d’historique local=remote. Auth/RLS/Storage et concurrence bornée ont déjà des rapports cloud. CI exacte9b3dae0 verte.
- Sur source locale optimisée `62b1f7f` avec la base réelle : viewer refusebudget et masque contrôles, manager selected-write voit seulement son site, owner garde ses actions ; véritable éditeur de devis save/reload/conflit409/conservation saisie/send a passé la recette.
- Support réel2/2 : réponse de création A retenue puis loginB sans effet tardif ; création commitée/réponse perdue puis remount/reload avec mêmeclé et replay sans doublon. Nettoyage/readback réussis.
- Photos réelles2/2 : refus partiel avec renvoi de la seule pièce refusée ; résultat réellement incertain, candidat sans auto-confirmation, choix explicite sans nouvel upload. Nettoyage Storage/Auth/données relu.
- Rendu démo responsive6captures réussies lors de cette relance. Des previews plus anciennes ont d’autres preuves bornées ; elles ne prouvent pas automatiquement le dernier code.

Reste **non vérifié**, donc pas à classer “non implémenté” :

1. Manager selected avec un site lisible mais `can_write=false` en navigateur : QA002 manque dans l’ancien harnais. Les tests SQL de portées ne remplacent pas cette recette UI.
2. Navigation UI SuperAdmin au-delà100/120 dossiers : l’ancien essai échoue sur un locator de combobox, pas sur une panne application démontrée. API pagination>100 déjà vérifiée ; nouveau parcours UI encore nécessaire.
3. Sélection obligatoire du quote_id/version publiée dans la recette devis : assertion actuellement facultative QA001. Save/send est réellement passé, ce dernier critère ne l’est pas.
4. Régressions ciblées au code final exact après intégration des corrections, avec projet et source notés. La recette actuellement citée cible62b1f7f, pas toutes les modifications ultérieures.
5. Fiabilité du harnais QA003 (timeout route.fetch et finally) : la dernière relance nominale réussie ne ferme pas ce défaut du test runner. Les changements Claude non poussés ne doivent pas être exécutés comme livrés.
6. Gateway natif : code et migration013 présents, GW001 corrigé/revu ; GW002 validation de finalisation malformée encore ouvert à9b3dae0. Edge non déployée, recette JWT/Storage réelle due. Ce n’est ni une fonction native déjà distribuée ni une simple variable Stripe manquante.

## 2. Fonctions réellement absentes/incomplètes dans la source actuelle

### Client / devis / intervention (CLI07–10, CLI05)

- PDF du devis : **absent**, l’interface propose un récapitulatif texte et affiche explicitement PDF indisponible (`client-space`1729). Validité calendaire, mentions/émetteur complets, avenants et signature électronique ne sont pas fournis par le lot brouillon010. Le brouillon serveur/version409 lui-même est codé et déjà exercé.
- Carte, mesure GPS/distance/ETA : **absentes**, `client-space`1078 indique fournisseur non choisi ; artisan1259 indique distance non calculée. Les étapes en route/surplace sont codées mais ne sont pas une géolocalisation.
- Profil : nom/téléphone présents ; carnet multi-adresses/préférences et moyens enregistrés non réalisés dans ce lot.
- Avis simple présent ; modération/contestation/réponse non livrées. Compte rendu déclaratif/checks/nom existe ; ce nom ne constitue pas une signature certifiée ni une réception client complète.

### Artisan (ART04, ART09–12)

- Candidature/pièces/suspension, disponibilité/zone/compétences, offres/acceptation/refus, rendez-vous et actions terrain existent. Garde empêchant de modifier le dossier pendant mission active/solde en attente existe et a une preuve réelle : ne pas les remettre dans “à coder”.
- Planning récurrent/capacité d’équipe et expiration/relance automatisée des offres ne sont pas livrés par le simple champ disponibilité.
- Rapport terrain complet avec réception/mesures normalisées et preuve d’accord reste partiel. KPI ponctualité explicitement non calculé (`artisan-space`3057), ni net bancaire/payoutledger.
- Société prestataire avec dirigeant/planificateur/techniciens : modèle distinct **non implémenté**, décision métier requise, différent de l’entreprise cliente B2B.

### Entreprise cliente (ENT03–16)

- Organisations/membres/invitations/portées de sites, budgets simples, approbations et contrats/compliance enregistrés sont présents. Leurs scénarios encore incomplets relèvent de la recette, pas d’une absence globale de backend B2B.
- Hiérarchie bâtiments/étages/zones/plans, équipements identifiés/critiques, maintenance structurée, source énergétique, audits/réserves ERP et SLA/horloges/escalades **non implémentés comme systèmes métier complets**. Source le confirme : panneaux énergie sans source, AG non modélisées, SLA sans contrat/mesure (`enterprise-space`2701–2704).
- Budget par exercice/enveloppes/alertes notifiées et grilles tarifaires contractuelles calculables/versionnées : non fournis par les tables budget/contrats simples actuelles.
- Factures/avoirs/relances **absents côté serveur** (UI le dit explicitement2717–2718) ; payeur délégué non défini, paiement réservé au demandeur (`enterprise-space`662/1632). Intégrations comptabilité/ERP non implémentées.

### SuperAdmin plateforme (ADM05–10)

- Vraies listes paginées artisans/dossiers/clients/organisations, dossier artisan, dispatch avant devis accepté, KPI serveur et support privé sont codés. La boîte support n’est plus absente ; affectation à une équipe et escalade/SLA restent distincts et manquants.
- Factures/avoirs/remboursements/litiges/ledger commissions/rapprochement : absents du back-office (`admin-space`712–735), distinct du Checkout/Connect codé mais différé.
- Avis : liste en lecture ; pas de commandes de modération/contestation. Paramètres plateforme : lecture “À définir”, aucun éditeur serveur (`admin-space`845+).
- Admin reste rôle global ; séparation opérateur support/finance/gestiondroits non implémentée. Audit partiel ne vaut pas console complète avant/après de toutes les actions.
- Garantie : demande/décision existe, activation dépend des conditions validées ; mission corrective et circuit complet de preuves/SLA non livrés.

### Commun / exploitation / PWA

- Préférences/centre de notifications et envoi email/SMS/push métier, lu/nonlu et automatisation d’archivage/expiration ne sont pas livrés par le chat texte/Realtimesousensemble.
- Sauvegarde/restauration démontrée, supervision et politique rétention/effacement : **preuves manquantes** ; ne pas conclure que Supabase n’a aucun mécanisme sauvegarde par défaut, seulement qu’aucune restauration de cette application n’est prouvée.
- PWA : manifest/icônes/serviceworker/installcontrol et offlinepublic sont **codés** et ont un smoke ancien en ligne. Installation OS réelle et miseàjour multi-onglets sur deux déploiements **non vérifiées**. Ces deux points sont différés avec Vercel, pas des fonctionnalités arbitrairement déclarées absentes. Pas de promesse d’écriture métier offline.
- Natif iOS/Android : **non commencé** au checkpoint ; plans/prévol et missions conditionnelles existent. Aucun projet/application/binaire natif livré. Diagnostic photoIA et abonnements sont extensions conditionnelles, non développées et ne doivent pas être simulées.

## 3. Services différés et données métier

- Stripe Checkout/Connect/webhook/relecturestatut sont codés, tests unitaires/SQL bornés existent ; clés test/connectbénéficiaire/webhooks réels/scénario paiement fournisseur non vérifiés. Vercel nouvellepreview est différée. Ne pas annoncer un paiement simulé comme testStripe.
- Exploitant, territoire, barème, tauxcommercial, garanties et documents légaux réels restent des entrées métier à fournir/valider. Les inventer ne “termine” pas l’application. Le paiement différé ne suffit pas à expliquer tous les manques ci-dessus.

## 4. Vérifications réalisables sans nouveau code Claude pendant son indisponibilité

Codex peut **exécuter les scripts déjà écrits** et publier leurs limites, sans en modifier une ligne :

1. Sur source exacte9b3dae0 : `npm run typecheck`, `npm test`, `npm run test:ui` ; SQL isolés existants `sql-review`, `sql-performance-review`, `sql-site-access-review`, `sql-quote-draft-review`, `sql-support-review`, `sql-artisan-active-guard-review`, `sql-document-finalization-review`. Dépendances déjà présentes ; pas besoin de nouvel install ni de build volumineux. CI verte signifie déjà qu’il n’est pas utile de répéter sans raison ; réserver les relances à une nouvelle intégration ou à une question non résolue.
2. Harnais déjà poussé/épinglébfb2d4d `scripts/qa/run.mjs` : suites captures, viewer/scoped-write/owner, devis et photos peuvent se rejouer sur buildcompatible sourceexacte avec fixtures dédiées et cleanup. Support a déjà passé ses deux cas ; relecture au code final est utile si modifié, pas une boucle arbitraire.
3. Lire result.json/PASS/FAIL/ANOMALY et readbacks, pas seulement exit0. Ancien harnais timeout connu : ne pas lancer toutes suites sans surveillance/stratégiecleanup et ne jamais simultanément nettoyer une cohorte encore active.
4. Scripts préexistants `/tmp/depannage-web-pwa-qa/local-enterprise.mjs`, `quote-directory.mjs`, `active-guard-cloud.mjs` couvrent des questions déjà bornées ; avant réutilisation, vérifier le SHA/appbase/fixturemanifest et les permissions de sortie. L’audit présent ne les a pas exécutés ni autorisé de mutation cloud.
5. **Non faisable par simple exécution de l’ancien harnais** : selected-readonly manquant, assertionquoteversion facultative, locatoradmin120 cassé, finalisationgateway malformée et harnaiscloud non livré. Attendre les corrections poussées Claude, revue exacte puis exécution ; ne pas contourner la consigne minuit en réécrivant les scripts.
6. Recette Vercel/Stripe, deux-déploiements PWA et installations/applications natives ne sont pas rendues possibles par une suite locale verte ; garder différés/non réalisés explicitement.

Après reprise Claude03h50 : suivre l’ordre P0/P1 ci-dessus, accepter un checkpoint Web au périmètre honnête puis avancer les missions natives conditionnelles sans ajouter les enrichissementsV2/V3 au gate. À08h, livrer les liens/artefacts réellement disponibles et cette distinction codé/vérifié/absent, sans annoncer le plan complet terminé.
