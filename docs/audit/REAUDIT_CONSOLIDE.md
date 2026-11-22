# Réaudit consolidé — état avant reprise

Révision du 30 octobre 2026, référence applicative `46aac2a`, documentation précédente `2afdeec`. Audit statique et documentaire ; aucun code applicatif modifié, aucun code des archives exécuté. Cette synthèse remplace les conclusions dispersées comme point d’entrée courant ; les annexes conservent les preuves et l’historique.

## Conclusion

**L’application n’est pas terminée.** Le dépôt contient un véritable socle serveur avec permissions, commandes transactionnelles, calcul de devis, documents privés et routes Stripe. Il ne couvre pas les espaces métier complets et ne démontre pas un service réel connecté. Les trois back-offices demandés — artisan, entreprise cliente et Super Admin de plateforme — restent largement à réaliser. Les archives sont des exemples d’interface, pas le complément serveur manquant.

La reprise doit fermer les problèmes d’isolation et les règles d’acteurs avant les parcours connectés ; fournir un premier poste opérateur puis le cycle client/artisan ; vérifier Stripe en test ; terminer les back-offices et les verticales selon les priorités documentées. Le nouveau plan couvre tous les besoins recensés, sans les déclarer tous MVP et sans supprimer les fonctions avancées.

## Sources et méthode

| Ensemble | État recontrôlé | Limite de la preuve |
| --- | --- | --- |
| 9 PDF | SHA-256 conformes ; 102 pages ; 93 occurrences ; 63 images distinctes ; 12 groupes de doublons | Les 93 empreintes portent sur les flux image décodés ; les compositions visuelles proviennent du catalogue précédemment inspecté. Pas de nouvelle comparaison pixel par pixel des 102 pages. |
| 5 archives | SHA-256 des originaux et des 61 membres conformes ; 17 chemins ; 19 contenus distincts | 12 JSX par nom, sans nouvelle page dans la dernière archive ; lecture de données uniquement, aucun build/exécution. |
| Application | Diff vide depuis 46aac2a sur app, components, lib, supabase, tests, dépendances et CI | Relecture ciblée des zones de risque et capacités ; pas prétention à une deuxième lecture intégrale de chaque ligne ni à un audit de pénétration. |
| Preuves fraîches | `npm run typecheck` réussi ; `npm test` : 11 réussis, zéro échec | Tests de domaine exécutés localement ; aucun nouveau build, SQL cloud, navigateur, paiement ou test concurrent réel. |
| Fournisseurs | Aucun nouveau contrôle Supabase/Stripe/Vercel dans cette révision | Absence de variables et refus pour facturation sont des constats historiques, pas un état fournisseur actuel certifié. |

Le corpus PDF reste séparé du corpus code. Les numéros initiaux 19–32 ne sont pas identifiés ; ce fait ne prouve pas quatorze capacités absentes. Les archives 1/2/4 sont des sous-ensembles de la troisième ; la cinquième apporte HomePage/styles modifiés et animations.css nouveau. Le mot COMPLET ou FINAL ne change pas la hiérarchie des instructions.

Rapports de collecte : [backend](REAUDIT_BACKEND.md), [frontend](REAUDIT_FRONTEND.md), [sources](REAUDIT_SOURCES.md). Sources canoniques : [matrice des 76 capacités](../AUDIT_COMPLET_SPECIFICATIONS.md), [catalogue](CATALOGUE_MAQUETTES.md), [archives](ARCHIVES_CODE.md), [décisions](../SPECIFICATIONS_A_COMPLETER.md). Une capacité n’est pas une page ni une mesure de pourcentage terminé.

## Résultat par acteur

| Acteur | Présent dans le dépôt | Écart restant déterminant |
| --- | --- | --- |
| Public | Accueil, FAQ, entrée compte/démo | Pages tarifs, territoire, contact traité, candidature, identité réelle, À propos et confidentialité fidèles et complets |
| Client | Demande, devis accepté, états élémentaires, messages, dépôt générique, avis/garantie partiels | Photos dès la demande, créneaux, contacts, refus/version/PDF, galerie et preuve terrain, retours paiement et documents commerciaux |
| Artisan | Vue missions, prise atomique, éditeur de devis, début/fin, Connect codé | Navigation dédiée, société/candidature, pièces valides, zone/disponibilité, refus, révision, rapport, performance, net/transferts/versements |
| Entreprise cliente | Membres en base, sites simples, seuil d’approbation, contrats texte, registre et rapport financier | Organisation active, invitations/retrait, droits par site/payeur, fiches et tableaux verticaux, approbations détaillées, grilles, budgets et reporting complet |
| Super Admin plateforme | Approbation/suspension artisan et dossier de garantie | Tous les menus opérationnels M43 : dashboard, dispatch, clients, finance, avis, support, paramètres, rôles distincts et journal exploitable |
| Entreprise prestataire | Informations d’entreprise suggérées par les références, pas de modèle d’équipes livré | Inclusion à décider ; dirigeant/planificateur/techniciens distincts du B2B client. Ne pas déclarer ce besoin satisfait par manager. |

## Écarts prioritaires et preuves

| ID de révision | Priorité / avant quoi | Constat vérifié | Traitement dans le plan |
| --- | --- | --- | --- |
| R-01 | P0 avant données réelles | professional n’est pas vidé à logout ; chargement dépend de mode/rôle ; vues hash rendues sans garde et absence de suivi onAuthStateChange. frontend lignes 690–806,874–889,2925–2930 | Phase 1 : reset/invalidation, identité de requête et gardes ; reproduire changement de compte et réponse tardive. RLS reste nécessaire. Risque statique, pas incident cloud démontré. |
| R-02 | P0 avant équipes B2B | Les droits client_id persistent indépendamment d’une future révocation de membre ; approbateur et payeur n’ont pas la même portée. initial.sql:118–124 ; checkout:35–39 | Phases 0/1 puis 7 : propriété du dossier, payeur et départ des membres, tests négatifs. |
| R-03 | P0 avant opération financière réelle | Checkout/Connect/webhook présents, seuls deux succès Checkout traités ; aucun cycle remboursement/litige/payout complet | Phase 6 : événements et états financiers complets en test ; séparation payé/transféré/versé ; pas activation live. |
| R-04 | P0 avant usage intégré | Aucun nouveau service réel prouvé ici ; anciens tests SQL avec stubs ne prouvent pas Auth/Storage | Phase 2 : environnement dédié et comptes ; phase 11 : recette distante. Le projet existant reste préservé. |
| R-05 | P1 avant suspension opérationnelle | artisan_approved bloque accept_mission et Checkout, mais send_quote/start/complete restent possibles sur missions affectées. initial.sql:208–235 et approve_artisan:278–283 | Phase 0 puis 4/6/8 : préciser arrêt/nouvelles missions/réaffectation/solde ; conserver preuves et droits nécessaires selon décision. |
| R-06 | P1 avant workflow devis | decide_approval modifie l’approbation et sa trace, pas quote/intervention. professional.sql:114–125 | Phases 0/5/7 : distinguer rejet approbation, refus du devis, nouvelle version et annulation ; définir notifications et visibilité des motifs. |
| R-07 | P1 avant matching exploitable | available_missions trie par created_at croissant : plus anciennes d’abord, limite 100 ; pas disponibilité/zone/compétence | Phase 4 : éligibilité minimale et concurrence dès socle. Classement avancé et position ne sont pas une excuse pour livrer une liste globale comme matching terminé. |
| R-08 | P1 avant retours/parcours documentaires | Composant principal ignore retours Auth/Stripe/Connect ; ancien devis ouvre le devis courant du dossier | Phases 2/5/6 : contexte autorisé restauré, sélection quote_id/version, état paiement relu. La page reset-password lit déjà son code de retour. |
| R-09 | P1 avant KPI/export exhaustif | Fenêtres bornées, filtres hétérogènes et contexte organizations[0] ; garde CSV frontend distincte du serveur | Phases 5/7/8 : pagination et agrégats, organisation/site explicites ; vérifier formules avec espaces/onglets aussi sur exports frontend. |
| R-10 | P1/P2 avant reprise visuelle | Tailwind absent du projet ; archives CSS non directement compilables ; variantes fadeIn et boucles sans réduction du mouvement | Phase 3 : stratégie CSS unique, pas concaténation ; l’application possède déjà une règle reduced-motion, à préserver. |
| R-11 | P1 avant recette annoncée | CI exécute types/tests métier/build ; ne lance ni harness SQL ni intégrations distantes | Phase 11 et contrôles de chaque lot : ajouter vérifications SQL/intégration adaptées ; ne pas appeler les tests métier une validation Supabase. |
| R-12 | P1 accessibilité | Menu décalé hors écran conserve DOM sans inert/hidden ; états ouvert/actif et gestion focus insuffisants | Phase 3 puis 11 : clavier, focus/restauration, états accessibles. Les champs ont déjà des labels englobants ; compléter associations hints/erreurs, pas affirmer tous les labels absents. |

Les critères produit encore ouverts ne sont pas tous des failles. Les protections existantes sont à conserver : validation stricte, verrou d’attribution, montant serveur, signature webhook, journal transactionnel, contrôle MIME/signature binaire des fichiers, accès privé et compensation d’un upload raté.

## Décisions et autonomie

| À décider | Qui / portée | Peut continuer sans attendre |
| --- | --- | --- |
| Références maîtresses, composants, découpage et stratégie CSS | Choix techniques du développeur, documentés selon DESIGN.md | Audit, préparation et lots indépendants ; pas besoin d’autorisation pour chaque choix réversible lors d’une future exécution |
| Acteurs B2B/prestataire, suspension, propriété, payeur, refus et annulation | Règles produit à formaliser ; propositions explicitement marquées avant validation | Structures d’interface et tests de sécurité indépendants ; pas de droits permissifs par défaut |
| Prix, taxes, commission, pays juridique, facturier, garantie, exploitant/territoire | Données commerciales réelles du propriétaire, éventuellement validation compétente | Aucun tarif, texte légal ou engagement fictif pour contourner leur absence |
| Web ou application native, abonnements, IA et intégrations | Lots conditionnels distincts, traçables | Cycle web de base et contrôle des rôles ; pas de native ou fournisseur inventé |

Les 38 domaines Q-PDF, les 16 contradictions et les précisions V5/V8 restent le registre détaillé. Le plan n’attend pas toutes les réponses pour avancer, mais ne code pas les fonctions dépendantes d’une règle encore inconnue comme si elle était validée.

## Plan réécrit et preuve de couverture

Le [plan de reprise](../PLAN_REPRISE.md) décrit 12 phases 0–11, leurs prérequis, sources, résultats et garde-fous. Le [tableau de couverture](COUVERTURE_PLAN.csv) affecte **les 76 IDs, chacun exactement une fois comme ligne**, à une phase principale et aux phases complémentaires. Chaque ligne conserve l’écart concret à fermer et les preuves requises ; elle n’est pas une promesse de clôturer un grand module en une session.

Changements d’ordre : sécurité avant parcours réels ; poste opérateur initial avant cycle terrain ; matching minimal dans le socle artisan ; devis/rapports avant règlement ; Stripe test avec finance et reprises ; entreprise et Super Admin complets explicitement séparés ; verticales/automatisations et extensions suivies jusqu’à décision ou réalisation. Les preuves d’accès négatif et de fidélité sont exigées à chaque lot, pas seulement à la fin.

## Contrôles de cette révision

- Sources intactes, SHA et pagination vérifiés par collecte indépendante ; méthode d’empreintes d’image clarifiée dans le manifeste.
- Ancienne mention « références bureaux absentes » corrigée dans le catalogue ; ordre des offres corrigé dans annexe backend et matrice.
- Contrôle TypeScript réussi et 11 tests métier réussis. Les 13 groupes SQL cités antérieurement ne sont pas réexécutés ni promus en preuve cloud.
- Diff applicatif vide depuis la référence ; modifications limitées aux documents d’audit, plan, matrice de couverture et manifestes documentaires. Aucun service ni secret modifié.
- Relecture des documentations officielles Supabase SSR/RLS et Stripe webhooks/Checkout ; sources et patterns conservés dans le plan. Aucune API de refus, rendez-vous ou dispatch inventée comme déjà existante.
- Aucun nouveau rendu en ligne : les constats visuels demeurent ceux des sources/catalogues et de la lecture du code. Les comparaisons en preview restent une condition de livraison future.
