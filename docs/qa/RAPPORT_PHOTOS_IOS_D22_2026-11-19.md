# Compte rendu avec photos iOS — 19 novembre 2026

## Périmètre

Binaire D22, simulateur APFS iOS27.2, INT-D0FA86 exclusivement synthétique. Les états arrivée/démarrage ont été préparés par API artisan après la recette GPS ; cette étape n’est pas comptée comme un nouveau test des boutons natifs de départ/démarrage.

## Contrôles réussis

- Formulaire vide : erreur explicite demandant le compte rendu et le nom.
- Texte et nom renseignés mais photos absentes : deux photos distinctes requises.
- Sélection des deux images synthétiques de la photothèque (JPEG et PNG) ; deux dépôts réussis, boutons « Remplacer » affichés.
- Application arrêtée puis relancée : texte, nom et références des deux photos restaurés.
- Enregistrement du rapport dans l’interface, relu côté client par API avec les deux références distinctes.
- Lecture des octets des deux documents privés : image/jpeg et signature JPEG conformes ; compte tiers refusé 404 pour chacun. Aucun lien signé n’est copié dans ce document.

Journaux XCTest : `ios-report-before-open-d22-20261119`, `ios-report-photos-d22-20261119`, `ios-report-restore-save-d22-20261119` (copies expurgées). Preuve serveur : `ios-report-proof-d22-20261119.json`.

## À compléter

Clôture et réception/signature client sont désormais confirmées (voir complément ci-dessous). Le paiement reste à tester. Ce contrôle ne couvre pas la caméra physique, l’interruption pendant le sélecteur iOS ou une rupture réseau pendant le dépôt.

## Réception iOS : défaut détecté et correction

Le Host ajusté à son contenu rendait l’interrupteur visible mais insensible : appui sur le contrôle puis appui directement sur son bouton, valeur restant à 0 et aucune réception serveur. Le correctif conserve le Switch Expo UI et impose, sur iOS seulement, un Host de largeur disponible et hauteur 48 sans reprise des safe areas. Android conserve le Host ajusté au contenu.

TypeScript mobile et compilation iOS passent. XCTest `ios-receipt-layout-fix-20261119` vérifie la valeur 1, le bouton de signature activé puis la confirmation visible. Relecture serveur : révision c02f5891-ae85-41a0-bd44-ce1304a366f1, signature synthétique Client Recette à 15:30:44 UTC. Capture `ios-receipt-layout-result-20261119.png`, preuve `ios-report-receipt-after-fix-20261119.json`. Les deux essais avant correction restent conservés comme échecs.
