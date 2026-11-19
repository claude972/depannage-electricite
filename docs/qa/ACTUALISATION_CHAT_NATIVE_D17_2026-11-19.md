# D17 — Réception des messages dans la conversation native

## Défaut reproduit
Sur Android, le client laisse la conversation INT-44B1D4 ouverte. Un message synthétique de l’artisan est enregistré au serveur, mais reste absent de l’écran pendant 25 secondes. Il apparaît après passage en arrière-plan puis retour. Preuve : `android-chat-refresh-d17-before-20261119.json`.

## Correction
La conversation récente relit son contenu cinq secondes après la fin de la lecture précédente, uniquement quand elle est active au premier plan. Les pages anciennes ne sont pas actualisées périodiquement. Le brouillon et les messages restent visibles pendant la lecture. Un échec de lecture efface les données avec un message d’erreur ; le changement de compte, le démontage et la désactivation annulent la requête et son prochain rappel. Le rafraîchissement manuel est également disponible.

Il s’agit d’une relecture périodique, pas d’une connexion temps réel par WebSocket. Le délai dépend du réseau. Aucun envoi de notification externe n’est activé.

## Vérification
- TypeScript mobile et racine : réussis.
- Six tests réussis, dont un montage React réel dans Chromium : lecture lente sans chevauchement, conservation pendant relecture, refus 403 effaçant les données, réponse tardive du compte A ignorée après passage à B, arrêt des rappels et annulation au démontage. Cinq tests du client réseau et des sessions complètent cette preuve. `native-chat-d17-tests-20261119.log`.
- Android reconstruit et installé : message reçu sans quitter l’écran (`android-chat-refresh-d17-after-20261119.json`).
- Second message reçu pendant la saisie : brouillon conservé et jamais envoyé (`android-chat-draft-d17-20261119.json`).
- iOS reconstruit et installé sur le simulateur APFS : XCTest `ios-chat-d17-20261119` réussi. Le message artisan est envoyé seulement après le signal de préparation de l’écran ; il apparaît sans quitter la conversation et le brouillon reste intact.

Les messages sont explicitement synthétiques. Le dossier payé conserve son statut et ses données financières.

## Complément d’envoi

La réception D17 reste validée. Le test d’envoi iOS a révélé le masquage du bouton par le clavier, corrigé séparément dans D20. Après D20, double appui sur Envoyer, champ vidé, message unique relu par client et artisan, tiers 404. Voir `CLAVIER_IOS_D20_2026-11-19.md`.
