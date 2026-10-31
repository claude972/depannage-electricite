# Livraison autonome Web/PWA puis iOS/Android

## Autorisation et ordre
Le propriétaire a autorisé la réalisation autonome selon le plan, avec split Claude/Codex, commits/push et previews. L’ancien statut préparation uniquement de l’audit n’est plus la consigne active. La version Web responsive/PWA est prioritaire ; les applications iOS et Android sont demandées ensuite, après vérification du Web/PWA. Pas de production ni encaissement réel implicitement autorisés.

Le 31 octobre 2026 à 00:00 America/Martinique, tout le codage passe à Claude, avec 1 à 10 agents selon besoin. Codex pilote, revoit, exécute les tests, intègre et publie les preuves. Un relais unique est programmé dans ce chat ; les missions/corrections distantes restent la référence de reprise.

## Checkpoints vérifiés dans leur périmètre
- Backend 0a01406 : candidature, disponibilités/éligibilité, opérations terrain et accès organisationnels ; 19 groupes PostgreSQL isolés et revue indépendante.
- Paiements et devis 4ae3bd1 : tentatives Checkout, événements d’échec/expiration sans downgrade paid, consentement sur identifiant exact ; 22 groupes SQL isolés et 3 tests de classification, revue indépendante.
- PWA 6aaa1b3 intégrée dans b0fa1df : manifeste/icônes, installation, mise à jour volontaire, cache exclusivement de la notice publique, corrections PWA001/PWA002 ; 14 tests ciblés et 13 contrôles navigateur sur preview, sans erreur de page. L’interface de cette preview est encore l’ancienne ; aucune fidélité de la nouvelle UI Claude n’est prétendue.
- CI et preuves distantes sont attachées à la draft PR 1 et consignées dans les rapports. Les identifiants de contrôle d’accès preview restent hors Git ; aucune protection Vercel désactivée.

## Toujours ouverts
- Nouvelle interface dédiée client/artisan/entreprise/Super Admin, comparaison aux maquettes et intégration des nouveaux contrats par Claude.
- Revue croisée Claude des révisions Codex, corrections de ses éventuels findings, validation combinée.
- Supabase refuse encore la création de la base dédiée pour factures en retard ; aucune base existante touchée. Auth/Storage/RLS réels et Stripe non configurés/non testés en ligne.
- Installation réelle sur appareil et mise à jour multi-onglets sur deux déploiements ; ne pas confondre CDP installability avec une installation OS.
- Fonctions avancées, documents commerciaux, délégations financières et règles produit/commerciales toujours suivis dans les 76 capacités ; les checkpoints ne terminent pas l’ensemble du plan.

## Suite native
Après le checkpoint Web/PWA, Claude prépare les lots iOS/Android avec backend partagé, navigation et écrans natifs conformes aux références client/artisan. Choix technique proposé : Expo/React Native et tests/builds EAS ; relire expo-overview puis skills dédiés et versions effectives avant scaffold. Prévoir authentification native, liens de retour Auth/Stripe, permissions médias/localisation, stockage des jetons, erreurs réseau et tests sur iOS/Android. Les back-offices desktop restent Web sauf besoin explicitement défini ; une PWA ne sera pas renommée application native. Aucune publication publique App Store/Google Play dans l’autorisation actuelle de prévisualisation.

Coordination : https://github.com/claude972/depannage-electricite/tree/missions/web-pwa ; draft PR : https://github.com/claude972/depannage-electricite/pull/1.
