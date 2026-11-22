# D10 — actualisation des accès d’entreprise (observation O4)

## Constat

Sur le candidat Web o4n1lx6jm, le retrait d’un membre coupe immédiatement son accès au serveur, mais l’en-tête de sa page ouverte conserve son ancienne appartenance. Le propriétaire ne voit pas l’acceptation d’une invitation dans son journal sans rechargement.

Les abonnements Realtime existants couvrent interventions, devis et messages. Les tables de membres ne sont pas publiées ; ajouter un abonnement non publié compromettrait la connexion existante.

## Correction

Une session d’entreprise active relit le workspace et les données professionnelles toutes les 30 secondes après la fin de la lecture précédente, uniquement lorsque l’onglet est visible et le navigateur en ligne. Cette fréquence n’est pas une garantie instantanée : le délai réseau s’y ajoute. Les mécanismes existants au focus et au retour réseau restent disponibles.

Le coordinateur conserve l’isolation des comptes et des périmètres. Le timer cesse au démontage ; les lectures lentes ne se chevauchent pas et une panne n’arrête pas les prochaines tentatives. Aucun ajout de publication Realtime, aucun changement de permission ni d’écriture automatique.

## Vérification

16 tests réussis : ordonnanceur de revalidation et coordinateur workspace, dont cadence de 30 secondes, éligibilité recalculée, reprise après erreur, lecture lente et arrêt au démontage. TypeScript réussi. Preuve hors Git : `preuves/access-revalidation-20261119.log`.

À vérifier sur preview : propriétaire et lecteur ouverts simultanément, retrait effectif puis invitation acceptée ; l’appartenance et le journal doivent s’actualiser sans rechargement manuel, après une lecture réussie. Ne pas qualifier D10 de validé en ligne avant cette preuve.
