# Instructions du projet

## Sources et état initial
- Lire ce fichier et `DESIGN.md` avant tout travail.
- Référence fonctionnelle : `SPECIFICATION_COMPLETE_FINALE_PROJET.pdf` (une page).
- Références de parcours et d'interface : `TOUT_EN_UN_MAQUETTES_GRANDES.pdf`, `MAQUETTES_UNE_PAR_PAGE_VOLUME_3.pdf` et `MAQUETTES_UNE_PAR_PAGE_VOLUME_4.pdf`.
- La spécification finale prévaut pour le périmètre et les priorités. Les maquettes sont des bases à améliorer, pas des écrans à reproduire aveuglément.
- À l'initialisation, le dossier contient uniquement ces quatre PDF : aucune stack, application ou infrastructure existante. Ne pas présenter une proposition technique comme une décision validée.
- Les maquettes 19 à 32 ne figurent pas dans les documents fournis ; ne pas inventer leur contenu.

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

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
