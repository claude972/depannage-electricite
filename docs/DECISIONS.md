# Décisions

30 octobre 2026 : voir DR-01 à DR-07 dans BLUEPRINT.md.
Base dédiée et Stripe confirmés explicitement par le propriétaire. Aucune base existante ne sera modifiée.

30 octobre 2026 — création de la base dédiée refusée par Supabase : factures en retard dans les organisations du compte, création de projet bloquée jusqu'à régularisation. Aucun projet existant modifié ; aucun mot de passe de base inutilisé conservé. Les variables Supabase resteront absentes et les API doivent répondre explicitement indisponibles tant que l'infrastructure n'est pas provisionnée.

Versions installées et vérifiées par npm : @supabase/ssr 0.12.7, @supabase/supabase-js 2.118.0, lucide-react 1.65.0, next 16.4.3, react 19.3.1, react-dom 19.3.1, stripe 23.1.0, zod 4.6.7, @types/node 26.6.6, @types/react 19.3.0, @types/react-dom 19.3.0, tsx 4.23.15, typescript 7.0.2. npm install : zéro vulnérabilité signalée au moment de l’installation.
Vercel : projet brafas-projects/depannage-electricite créé et relié au dépôt GitHub claude972/depannage-electricite. Aucun déploiement lancé à cette étape.

## Données commerciales validées par le propriétaire — 21 novembre 2026

- Commission de la plateforme : **10 %** (`PLATFORM_FEE_BPS=1000`, paramètre `commission_bps` = 1000 enregistré en administration). Cette décision explicite remplace l’orientation 15–25 % des documents sources et le taux synthétique de 17 % des recettes TEST.
- Zone : **Martinique entière**, codes postaux 972xx (97200 à 97299 publiés dans la couverture, version 1).
- Garantie : **portée par la plateforme** (satisfaction, ré-intervention, remboursement) ; conditions publiées (version 2) et demandes activées en administration.
- Prix : **barème horaire affiché + devis précis avant travaux ; majoration d’urgence +25 % ; grille dans le site** (la grille par type de panne déjà active, version 1, est la grille publiée).
- Exploitant : **TTBM SARL**, SIREN 929 507 762, SIRET 929 507 762 00011, RCS Fort-de-France, Cité Eucalyptus 97240 Le François, gérant Brafa Claude Thierry.

Mise en œuvre : `shared/commercial-facts.ts` porte ces valeurs pour les pages publiques web et l’aide mobile ; une valeur publiée depuis l’administration prévaut. Le profil opérateur est enregistré en **brouillon** : sa publication exige encore deux adresses e-mail (contact, données personnelles), l’hébergeur et le titulaire des droits, non fournis — aucune valeur n’a été inventée. Restent aussi à fournir : téléphone, numéro de TVA et taux de TVA sur commission, montant du barème horaire, frais de déplacement, délai de versement aux artisans, durée de garantie à afficher (le logiciel accepte une demande jusqu’à un an après la fin de l’intervention). La majoration d’urgence est affichée (page Tarifs, récapitulatif de demande) ; elle n’est pas appliquée automatiquement à la fourchette enregistrée, faute d’accès d’administration à la base pour modifier la fonction SQL.
