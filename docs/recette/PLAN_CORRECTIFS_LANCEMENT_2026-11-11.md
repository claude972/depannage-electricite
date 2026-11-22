# Plan des correctifs de lancement DomDépannage

## Objectif

Un client peut réserver sur le Web, la PWA, iPhone et Android, retrouver sa demande et suivre son règlement. L’électricien attribué dispose des informations nécessaires à l’intervention. L’équipe peut contrôler les droits, les paiements et la reprise après incident avant l’ouverture commerciale.

[Audit et preuves](AUDIT_LANCEMENT_2026-11-11.md)

## Phase 0 · Figer le candidat et la recette

Un candidat identifié permet de vérifier que les utilisateurs testent le même produit sur chaque support.

- Relever SHA Web/API, URL, identifiant masqué de base et version des migrations, builds EAS et profils. Comparer les capacités publiques des API avec le contrat natif. Tenir un registre de preuve par rôle, plateforme, version et date.
- Partir de `app/api/bookings/options/route.ts`, `apps/mobile/eas.json`, `.github/workflows/check.yml` et `docs/SETUP.md`. Utiliser un accès de preview limité à la recette et une base de test dédiée.
- **Sortie.** Les liens de recette sont utilisables depuis un réseau externe et le candidat est identifiable. Les comptes synthétiques client, électricien, organisation et opérateur sont prêts. Les variables Stripe/SMS sont attestées TEST avec valeurs masquées.

## Phase 1 · Réservation et compte sur les trois supports · L01, L02, L03, L12 et L15

Une première réservation doit aboutir après confirmation de l’e-mail, et l’adresse fournie doit servir à l’intervention.

- Reprendre le contrat d’inscription e-mail, mot de passe et téléphone de contact validé par `lib/features/auth/signup.ts`. Relier le brouillon natif à la confirmation et à la reprise de session. Garder la compatibilité du contrat SMS historique tant que ses binaires restent distribués. Décider de la reprise des anciens comptes après preuve de possession.
- Pointer les nouveaux builds sur le candidat commun et protéger la rétrocompatibilité du format. Reprendre les validations de `shared/booking-location.ts` et la garde de `20261111120000_booking_location.sql`. Projeter le point et le complément uniquement dans le détail autorisé après attribution. Indiquer explicitement si une vieille API ne peut pas conserver une saisie.
- Conserver description et photo facultatives, choix de créneau et envoi unique. Corriger la recherche textuelle avec un repli qualifié, sans perdre la saisie manuelle ni remplacer une correction récente par une réponse tardive.
- **Sortie.** Sur les trois supports, SMS désactivé, une nouvelle demande avec confirmation e-mail, ouverture du profil après session valide, téléphone valide, coordonnées et complément est créée une seule fois après un rejeu réseau. Variante sans photo ni description, puis variante avec photo privée. Offre avant attribution sans complément ni point précis. Client et électricien attribué voient le complément. Électricien réaffecté et tiers refusés.

## Phase 2 · Paiement et suivi financier TEST · L04, L05 et L13

La réservation propose un moyen de règlement que l’équipe sait finaliser et rapprocher.

- Aligner la capacité et la validation serveur de l’empreinte sur la capture réellement configurée dans `lib/features/guest/payment-options.ts` et `lib/features/guest/settlement-provider.ts`. Prévoir la reprise d’une empreinte devenue indisponible, avec état vérifié avant nouvelle action. Afficher explicitement le règlement différé et la disponibilité du paiement sur le natif.
- Construire l’inventaire des événements Stripe depuis `app/api/payments/webhook/route.ts`, `lib/payment-events.ts` et le contrat de réconciliation. Vérifier les destinations TEST plateforme et Connect, la signature, les alertes et la cohérence de l’en-tête Finance avec les capacités.
- **Sortie.** Une configuration partielle ne propose pas l’empreinte. Exécuter en Stripe TEST avec un compte Connect de test et carte de test. Vérifier autorisation, expiration, capture, paiement différé, webhook rejoué et désordonné, remboursement partiel et total, commission et transfert. Consigner montant accepté, montant encaissé, commission et net en centimes, avec identifiants masqués et preuve dashboard. Distinguer transfert Connect et versement bancaire. Recetter les notifications SMS uniquement sur les numéros vérifiés si ce service fait partie du pilote.

## Phase 3 · Opérations, droits et données · L06, L08, L09 et L10

Les équipes traitent les interventions et peuvent revenir en service après une erreur, avec des accès limités à chaque rôle.

- Raccorder la demande B2B au site et au rôle autorisés, ou diriger le client vers l’espace entreprise quand ce rattachement est requis. Vérifier invitation, retrait de membre, seuil d’approbation, payeur et cloisonnement entre organisations avec les règles de `202610310009_site_access.sql`.
- Attester la protection renforcée des actions finance, droits et administration, côté API et accès SQL autorisé. Compléter l’export des données de réservation et la procédure traçable de suppression, avec règles de conservation approuvées.
- Exercer `scripts/restore-drill/README.md` sur une base isolée. Couvrir données, comptes et fichiers, puis valider la compatibilité avec le déploiement précédent et les binaires encore distribués. Configurer et tester un destinataire d’alerte pour 5xx, webhook et échecs d’authentification, tâches et stockage.
- **Sortie.** Matrice de rôles et de révocations vérifiée. Restauration d’un dossier avec fichier privé et refus tiers. Temps de reprise et perte maximale mesurés. Alerte de test reçue et résolue.

## Phase 4 · Préparer l’ouverture et les boutiques · L07, L11 et L14

Les utilisateurs peuvent identifier l’exploitant et installer la version qui a réellement été recettée.

- Publier exploitant, contact, zones, barème, conditions, garantie et délais validés depuis les sources administrables du produit. Vérifier e-mail de confirmation et récupération sur le domaine distribué. Qualifier les deux avis npm et utiliser une correction compatible Expo lorsqu’elle est disponible.
- Ajouter une configuration de distribution distincte des profils internes après validation des identifiants et signatures. Préparer les fiches de confidentialité, la suppression de compte et les parcours de revue. Formaliser les relais Web pour entreprise et administration.
- **Sortie.** Installation physique native et PWA sur iPhone et Android. Recette clavier, photo, GPS, permission refusée, réseau coupé, retour de paiement et changement de compte. Publication boutique et passage live soumis à une décision séparée.

## Phase 5 · Vérification de sortie

Le feu vert repose sur des preuves rattachées à la version qui sera ouverte.

- Rejouer client, électricien, entreprise et administration à 390 et 1440 px, puis sur les builds installés. Inclure accès refusés entre comptes, candidature et approbation réelle de recette, devis et avenants, photos avant/après, signature, réserve et levée, règlement et suivi. Tester le nombre de missions autorisé avec la règle validée.
- Exécuter `npm run typecheck`, la suite `npm test`, les deux builds Web prescrits et les vérifications mobiles. Rejouer les parcours clavier et lecteur d’écran. Mesurer Lighthouse deux fois par taille en environnement isolé. Contrôler les migrations dans une base vierge et le retour arrière sur une copie de recette. Conserver les résultats des tests ignorés et leur motif.
- Établir un feu vert par périmètre. Pilote fermé avec comptes synthétiques, lancement commercial Web/PWA et distribution publique mobile ont chacun une recette et une validation explicites.

## Décisions nécessaires avant ouverture commerciale

- Périmètre initial et rôle des portails Web dans le parcours mobile. Zones desservies et éléments commerciaux qui seront affichés.
- Exploitant, contact de support, conditions de garantie, barème et commission, et reprise des anciens comptes téléphone.
- Responsable d’exploitation, objectifs de restauration, modalités de support, signatures et comptes de publication. Les clés live et la production restent dans la procédure séparée de mise en service.
