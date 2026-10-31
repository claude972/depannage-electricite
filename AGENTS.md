# Instructions du projet

## Sources et état initial
- Lire ce fichier et `DESIGN.md` avant tout travail.
- Référence fonctionnelle : `SPECIFICATION_COMPLETE_FINALE_PROJET.pdf` (une page).
- Références de parcours et d'interface : `TOUT_EN_UN_MAQUETTES_GRANDES.pdf`, `MAQUETTES_UNE_PAR_PAGE_VOLUME_3.pdf` et `MAQUETTES_UNE_PAR_PAGE_VOLUME_4.pdf`.
- Référence complémentaire reçue pendant l’audit : `MAQUETTES_UNE_PAR_PAGE_VOLUME_5_MANQUANTES.pdf` ; identifier ses écrans V5-C01 à V5-C10, sans les confondre avec les numéros initiaux.
- Références complémentaires suivantes : `MAQUETTES_UNE_PAR_PAGE_VOLUME_6.pdf`, `MAQUETTES_UNE_PAR_PAGE_VOLUME_7.pdf`, `MAQUETTES_UNE_PAR_PAGE_VOLUME_8.pdf`, `MAQUETTES_UNE_PAR_PAGE_VOLUME_9_FINAL.pdf`. Qualifier les identifiants par volume ; le manifeste `docs/audit/INVENTAIRE_SOURCES.json` conserve les libellés imprimés et les doublons. Le mot FINAL du volume 9 ne constitue pas une nouvelle spécification fonctionnelle.
- La spécification finale prévaut pour le périmètre et les priorités. Les maquettes sont des bases à améliorer, pas des écrans à reproduire aveuglément.
- À l'initialisation, le dossier contient uniquement ces quatre PDF : aucune stack, application ou infrastructure existante. Ne pas présenter une proposition technique comme une décision validée.
- Les numéros 19 à 32 ne sont pas établis dans les documents fournis ; les volumes 5 à 9 emploient des numérotations locales complémentaires. Ne pas lui attribuer arbitrairement les numéros manquants.
- Audit de référence avant reprise : `docs/AUDIT_COMPLET_SPECIFICATIONS.md`, catalogue et annexes dans `docs/audit/`, décisions manquantes dans `docs/SPECIFICATIONS_A_COMPLETER.md`. Lire ces documents avec le plan de reprise ; distinguer les back-offices artisan, entreprise cliente, administration de plateforme et éventuelle entreprise prestataire.

## Produit et périmètre
Plateforme de dépannage électrique pour particuliers, artisans électriciens, syndics/copropriétés et organisations B2B (restauration, bureaux, ERP).

### MVP
- Client : demande, fourchette de prix, matching artisan, devis, intervention et paiement.
- Artisan : réception et acceptation de mission, création du devis, intervention et suivi du paiement.
- Préparer un modèle cohérent pour les rôles et les statuts sans implémenter les versions ultérieures par défaut.

### V2
Suivi temps réel, chat, portail B2B de base, garantie un an et tableaux de bord par type de client.

### V3
Approbations avancées, fiches de site complètes, contrats cadres, reporting consolidé, diagnostic photo IA et conformité ERP.

### Règles métier
- Distinguer estimation, devis accepté et montant effectivement payé ; ne pas transformer une fourchette en prix garanti.
- Prévoir une attribution de mission atomique pour empêcher les doubles acceptations.
- Vérifier côté serveur les permissions, transitions de statut, montants et confirmations de paiement.
- La commission de 15 à 25 %, les abonnements et les contrats cadres sont des orientations de monétisation : ne pas figer un taux ou un tarif sans décision explicite.
- Les verticales B2B couvrent respectivement équipements critiques/SLA, maintenance/budgets et audits/sécurité/conformité.

## Méthode de travail
- Rédiger un plan court avant tout travail non trivial ; indiquer périmètre, décisions et vérification attendue.
- Choisir et documenter la stack avant de créer l'application. Une fois définie, la respecter et conserver les conventions existantes.
- Utiliser les skills installés pertinents. Pour Expo, lire d'abord `expo-overview` si Expo est retenu.
- Après chaque fonctionnalité, vérifier parcours nominal, erreurs, états vides, chargement, permissions et adaptation aux tailles d'écran.
- Inclure validation des formulaires, messages explicites, protection contre les doubles soumissions et reprise après échec.
- Si Supabase est retenu : migrations versionnées, RLS sur les tables exposées, cloisonnement client/artisan/organisation et stockage privé des documents. Tester les refus d'accès entre comptes et organisations. Ne jamais exposer une clé de service dans le client.
- Ne pas inventer des coordonnées, certifications, avis, délais, obligations légales ou statistiques réels. Identifier clairement les données de démonstration.
- Conserver les PDF sources sans modification.

## GitHub et vérification en ligne
- Mettre le projet sur GitHub dès le démarrage ; créer le dépôt avant l'implémentation applicative.
- Commiter et pousser régulièrement par changements cohérents. Ne jamais commiter de secrets.
- Préférer les previews Vercel pour le web et EAS Update/EAS Build cloud pour le mobile.
- Après une fonctionnalité importante, pousser et fournir le lien de preview vérifié.
- Ne pas remplacer une vérification en ligne possible par une supposition fondée sur des tests locaux. Les contrôles statiques et tests ciblés restent complémentaires.
- Si l'accès GitHub ou au service de preview manque, signaler précisément le blocage ; ne pas annoncer un push ou un déploiement non réalisé.

## Skills partagés
- Créer et maintenir les skills réutilisables dans `~/.agents/skills` sauf instruction contraire.
- Lier les mêmes dossiers dans `~/.claude/skills` ; garder une seule copie canonique.
- Résoudre chemins et règles depuis le workspace actif ; ne pas coder en dur le chemin de ce projet dans un skill réutilisable.

## Stack retenue
Décision du 30 octobre 2026, prise dans le cadre de la réalisation autonome autorisée : application web responsive Next.js App Router / React, TypeScript strict, Supabase Postgres/Auth sous RLS, Stripe Checkout/Connect, hébergement Vercel. Versions épinglées dans package.json et package-lock.json.

## Archives de code complémentaires
Quatre archives sources sont conservées sans modification dans `references/code-archives/`. Lire `docs/audit/ARCHIVES_CODE.md` et son manifeste avant toute reprise. Elles contiennent 12 composants de base et des styles, aucun backend ni Super Admin. Ne pas exécuter ou intégrer leur code sur la seule base de leur réception pendant l’audit.
