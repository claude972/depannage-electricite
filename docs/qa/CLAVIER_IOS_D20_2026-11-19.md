# D20 — Bouton d’envoi accessible avec le clavier iOS

## Reproduction
Deux essais d’envoi de message sur le binaire D17 échouent avant tout POST : le bouton « Envoyer » reste masqué par le clavier. Le relevé XCTest montre le bouton à y=584, hauteur 48, alors que le clavier commence à y=546. La vue défilante utilise une hauteur qui ne tient pas compte de l’en-tête natif. Capture : `ios-chat-send-d17-observed-20261119.png`.

## Correction
Le composant partagé Screen transmet à KeyboardAvoidingView la hauteur d’en-tête fournie par Expo Router sur iOS. Les écrans sans contexte d’en-tête utilisent zéro. Aucun décalage fixe lié à un modèle d’iPhone n’est ajouté. Le comportement de clavier Android reste inchangé.

Le premier candidat utilisait le hook exigeant un en-tête et quittait au démarrage du conteneur de navigation sans en-tête. Il a été rejeté et remplacé par la lecture optionnelle du contexte public. Cet essai n’a pas été poussé ni distribué.

## Vérification
- TypeScript mobile et construction iOS : réussis.
- `ios-chat-send-d20-v2-20261119` : bouton accessible avec clavier, double appui, message affiché et champ vidé.
- Relecture serveur : un seul message, lecture artisan réussie, tiers refusé 404 (`ios-chat-send-d20-server-20261119.json`).
- `ios-headerless-login-d20-20261119` : déconnexion puis connexion sans en-tête réussies, bouton soumis avec clavier visible.
- Android D20 reconstruit et installé : démarrage, conversation, message entrant sans quitter l’écran et relecture au retour réussis (`android-chat-refresh-d20-after-20261119.json`). Les premiers contrôles du harnais cherchaient un titre ou un message hors de la zone visible ; le défilement a été ajouté, sans changement applicatif supplémentaire.
