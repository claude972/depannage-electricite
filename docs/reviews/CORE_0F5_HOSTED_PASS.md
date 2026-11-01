# Parcours principal connecté — app0f5

Preview publique : https://depannage-electricite-fp9k2xvhh-brafas-projects.vercel.app ; GitSource0f5bc00a86f16f4a532ba5b119333e02f409bac1 / Flightgz4HTuiGZbRpXK1PaTzOf, sans modification production/main/SQL/Edge.

Run privé ddca3f9e6a68 terminé exit0 :8/8 critères PASS. Trois comptes QA neufs, dont deux artisans approuvés synthétiques ; aucun administrateur créé. Les appels HTTP utilisent les cookies de sessions Auth vérifiées ; les lectures de contrôle sont limitées aux IDs de cette cohorte.

- Demande client créée par POST réel, estimation serveur exacte.
- Deux acceptations artisan HTTP se chevauchent ; un seul gagnant et attribution lue en base.
- Devisv1 puisv2 avec montants exacts et rejet de la version précédente.
- Ancien devis refusé409 ; acceptation de la seule version courante.
- Démarrage refusé au client et à l’artisan perdant ; autorisé à l’artisan attribué.
- Intervention terminée ; répétition refusée409 et horodatage/montant du devis accepté conservés.

Paiement non exercé (Stripe explicitement différé). Il s’agit de l’API connectée, pas d’une preuve de tous ces clics dans chaque interface.

Cleanup24étapes PASS, drain0/aucune intention ouverte,26lectures internes à zéro. Après arrêt du writer6094, ROOT a relu puis exécuté le postflight indépendant :53/53PASS (3Auth404 stricts,47scopes REST vides,3préfixes Storage vides). Aucun compte QA de ce run maintenu.

Tentative a1a44e264d28 conservée INCOMPLETE : le harnais utilisait demand(objectSession) alors que demand exige le booléen true. Les trois connexions avaient été interrompues avant toute création de dossier. La récupération ROOT a prouvé les seuls trois comptes QA, l’absence de tout objet métier, supprimé uniquement ces Auth, puis établi132contrôles et trois Auth404. Originaux et intention de grant inconnue restent préservés ; ancien verdict non requalifié.

Le harnaisV3 privé corrige explicitement !!session et couvre un véritable objet SDK dans les tests injectés (160 assertions). Diagnostics limités à codes/statuts autorisés et booléens, jamais de session, cookie, JWT ou mot de passe dans les preuves. Aucune réussite déduite du seul auto-test.
