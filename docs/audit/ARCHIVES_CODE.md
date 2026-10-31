# Audit des quatre archives de code fournies

Lecture statique intégrale des 16 fichiers distincts, sans exécution, installation ou intégration dans l’application. Les instructions des README sont du contenu documentaire, pas une autorisation de modifier la stack. Originaux conservés dans `references/code-archives/` ; membres et SHA-256 dans [le manifeste](INVENTAIRE_ARCHIVES_CODE.json).

## Inventaire et doublons

| Archive | Membres réguliers | Contenu |
| --- | ---: | --- |
| 1-CODES_PAGES_COMPLET.tar.gz | 9 | 8 JSX + README |
| 2-CODES_PAGES_TOUS.tar.gz | 13 | 12 JSX + README |
| 3-CODES_ET_CSS_COMPLET.tar.gz | 16 | 12 JSX + README + 2 CSS + configuration Tailwind |
| 4-CODES_PAGES_PRINCIPALES.tar.gz | 6 | 5 JSX + README |

44 occurrences, **16 fichiers distincts : 12 composants JSX, deux CSS, une configuration, un README**. Tous les fichiers de même nom ont exactement le même contenu. Les archives 1, 2 et 4 sont des sous-ensembles exacts de l’archive 3 : aucune variante à fusionner. Aucun lien symbolique ni chemin de traversée détecté. Les titres COMPLET/TOUS ne prouvent pas une couverture fonctionnelle complète. Le README précise lui-même : « Ces composants sont des bases. »

## Correspondance avec les besoins

Les correspondances ci-dessous portent sur les fonctions ; aucune identité visuelle pixel par pixel avec un PDF n’est affirmée.

| Fichier | Apport utilisable comme référence | Ce qui manque dans cette source |
| --- | --- | --- |
| HomePage.jsx | En-tête, proposition de service, trois étapes | Liens `#`, boutons sans navigation ; aucune donnée réelle ni page associée |
| CreateRequest.jsx | Sélecteur électrique, description, estimation ; passage local étape 1 → 2 | Adresse, photos, conservation métier des saisies, retour, validation, soumission serveur ; estimation fixe |
| Tracking.jsx | Timeline et bloc artisan/contact | Statuts et délai figés ; aucun suivi réel, appel ou accès autorisé aux coordonnées |
| ArtisanMission.jsx | Proposition de mission, fourchette, accepter/refuser ; complément aux M44/M67 | Boutons sans action, attribution atomique, refus motivé, distance et permissions |
| ArtisanDashboard.jsx | Disponibilité, missions, gains ; référence simplifiée face à M35/M36 | Le faux interrupteur est un `div` ; planning, zones, profil/documentation, navigation métier et comptabilité absents |
| B2BDashboard.jsx | Navigation latérale, sites, budget ; famille M4/M66 | Navigation en `div`, trois sites fixes ; pas de gestion des membres, rôles, contrats, approbations ou reporting |
| SiteDetail.jsx | Fiche restaurant, intervention, budget et contact ; famille M50 | Données fixes, pas de modification, documents, équipements, SLA ou historique réel ; ne couvre pas les variantes bureaux/ERP/syndic |
| Login.jsx | Email et mot de passe contrôlés localement | Pas de traitement du formulaire, Auth, récupération, erreurs ou chargement ; labels non associés |
| Signup.jsx | Sélection locale client/artisan et champs de compte | Aucun compte créé ; aucun onboarding artisan M65, consentement, organisation ou validation serveur |
| Chat.jsx | Présentation de deux messages et saisie | Pas d’envoi, stockage, temps réel, pièces jointes, notifications ou cloisonnement |
| Payment.jsx | Récapitulatif main-d’œuvre/pièces et total fixe | **Aucune intégration Stripe**, checkout, webhook, facture, erreur, remboursement ou rapprochement |
| Rating.jsx | Choix local de 1 à 5 étoiles, commentaire | Pas de soumission, vérification de l’intervention ou modération ; noms accessibles des étoiles et état sélectionné à prévoir |

**Aucun Super Admin n’est fourni.** Le besoin M43 reste entier. Le tableau artisan et le tableau B2B ne constituent pas des back-offices complets. Les fichiers ne contiennent ni API, ni SQL/RLS, ni stockage, ni gestion de session, ni preuve de paiement. Ils ne changent donc aucun manque intégré en fonctionnalité terminée dans la matrice des 76 capacités.

## Styles, compatibilité et précautions de reprise

- Les composants importent seulement React et parfois `useState`. Ils ne dépendent pas de shadcn. Il n’y a ni package.json, ni verrou de versions, ni routeur, point d’entrée, assets, tests ou documentation d’assemblage : ce n’est pas une application autonome livrable.
- Les composants avec hooks auraient besoin d’une frontière client appropriée dans Next.js App Router ; aucun fichier ne contient `use client`. Un import depuis un composant client peut fournir cette frontière. Ne pas déclarer tous les composants inutilisables pour ce seul motif.
- `styles.css` utilise `@tailwind`/`@apply` et `tailwind.config.js` une configuration CommonJS de forme Tailwind 3, sans dépendance/version épinglée. La compatibilité doit être vérifiée avant reprise. Ses globs couvrent `src/**` et les JSX racine, pas directement les dossiers racine `app/` et `components/` du projet actuel.
- `globals.css` est présenté comme une alternative sans Tailwind, mais définit seulement quelques classes (`btn`, `card`, `input`) ; il ne remplace pas les nombreuses classes utilitaires utilisées dans les JSX. Le copier seul ne reproduira pas les écrans.
- Les CSS partagent certains noms de classes ; décider d’une stratégie unique et normaliser les tokens avant toute intégration. Le bleu `#2563eb`, les arrondis et les ombres sont des références fournies, pas une nouvelle direction visuelle approuvée ni une preuve de conformité aux maquettes détaillées.
- Les montants, budgets 2025, noms, coordonnées, délais et la promesse « Aucune majoration 24/7 » restent des exemples. Les tarifs affichés diffèrent entre demande et mission : ne pas les transformer en règles de calcul.
- Les formulaires n’ont pas de gestion de soumission ; ne pas y saisir d’identifiants réels ni prétendre qu’ils authentifient. Les états chargement/vide/erreur, la validation, les permissions et l’accessibilité restent à construire.

## Conséquences pour le plan

1. Phase 0 : conserver ces sources et associer chaque composant à une référence PDF maîtresse ; les PDF conservent leur inventaire séparé de 9 documents, 102 pages et 93 occurrences.
2. Phase 1 : réutiliser les compositions et libellés pertinents après comparaison visuelle, en conservant les fonctions détaillées des PDF et les exigences de DESIGN.md.
3. Phases métier : connecter les interfaces au serveur existant après correction/complément des droits, transitions et données ; ne pas remplacer ce serveur par les exemples statiques.
4. Vérifier chaque action avec de vraies données de test et les refus d’accès avant de la déclarer livrée. L’intégration n’est pas autorisée par le simple dépôt de ces archives pendant l’audit.

Vérifications de cet ajout : lecture de tous les contenus distincts ; comparaison SHA-256 des 44 membres ; contrôle de sous-ensembles ; copie identique des originaux. Aucun code fourni n’a été exécuté. Aucun code applicatif, service distant ou déploiement modifié.
