# Disponibilité artisan iOS — 19 novembre 2026

Le binaire 0c11a1a affichait un interrupteur débordant de sa carte, sans changement après toucher. XCTest échouait sur le passage de 1 à 0 ; la relecture serveur restait `available=true`.

Correction : conserver le composant natif Expo UI, donner à son Host iOS une largeur explicite de 100 %, une hauteur de 72 points pour le libellé long, et neutraliser l'ajout de zone sûre dans cette carte. Les propriétés Android restent inchangées.

Validation sur iPhone 18 Pro virtuel / iOS 27.2 :
- compilation Release réussie, après un premier délai dépassé de 5 secondes dans le scanner de modules Expo ; une reprise a suffi, sans changement de dépendance ;
- TypeScript mobile réussi ;
- même geste XCTest qu'avant : passage indisponible puis disponible réussi ;
- relecture API simultanée : true → false → true ; disponibilité initiale rétablie, capacité inchangée ;
- capture après correction conservée.

Preuves externes : `ios-availability-toggle-20261119.redacted.log` (échec avant correction), `ios-availability-toggle-fixed-20261119.redacted.log`, `ios-availability-server-20261119.json`, `ios-availability-fixed-20261119.png`.

Limites : pas de recette sur appareil physique, pas de nouvelle preuve Android ni de toutes les tailles de police système.
