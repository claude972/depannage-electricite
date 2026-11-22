# Réservation sur place — revue bornée

Source figée : `2fcdc85dfa3d0f16d68382213f681044a2d06d27`. Relecture ROOT des handlers et de la migration022, puis exécution depuis une archive de ce commit, indépendante du checkout auteur qui poursuit le helper carte.

- 8 groupes HTTP passent : identité, client professionnel refusé, compatibilité compte email confirmé volontaire, corps strict et borné, contact privé, refus carte avant mutation, conflits/erreurs, sélecteur propriétaire unique, annulation et protection du Checkout existant contre un second paiement d'un dossier avec empreinte.
- 90 assertions PostgreSQL isolées passent : droits/RLS, nonce immuable, création sans paiement, rejeu sans nouveau dossier/audit/quota, cloisonnement, identité revalidée, annulation, autorisation fraîche requise et absence de mutation des fonctions historiques.
- Auth, Storage et pg_cron sont explicitement simulés dans ce test SQL. Aucune preuve de concurrence réseau réelle, de SMS ou de transaction Stripe n'en découle.

Aucun défaut P1/P2 trouvé dans ce lot borné. La migration n'est pas encore appliquée au service hébergé et les nouveaux écrans ne sont pas encore publiés. Le fournisseur SMS reste différé à la demande du propriétaire ; ce lot ne rend donc pas opérationnelle une réservation invitée par téléphone.
