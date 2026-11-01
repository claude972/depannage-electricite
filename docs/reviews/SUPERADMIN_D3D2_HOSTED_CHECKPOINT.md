# Super Admin — checkpoint fastsplit 1, 2 et 4

Ordre propriétaire : activer son compte, vérifier gestion, finances/factures. Source applicative intégrée et poussée `d3d2d6cf23eeffe992964c2ec848b73919a19747`. Preview READY `dpl_73Y2UDSF91SLmhLwEpawBJbkdcrP` : https://depannage-electricite-oihjfxt7l-brafas-projects.vercel.app . GitSource GitHub1440353116/refintegration/web-pwa vérifiée ; Flight `qiEbai-WFUQzHjhitiPSv`. Exception publique limitée à ce déploiement ; aucun changement production/main/env globale.

## Changements

API7cc6980 : statut artisan réel sous session admin/RLS, limite100/troncature réelle, erreurs privées no-store, dossier incomplet soumis requis422 explicite. UIa493963 : suspension et réactivation distinctes, pas d’approbation de brouillon, réponse illisible = erreur/reprise plutôt que fausse liste vide. Finance5751840 : ancien texte Stripe-seule-pièce retiré/lien Finance réel, aperçu HT+TVA=TTC entier strict sans substitution0, confirmation facture/avoir/taux avec cible figée et annulation sur édition, nouvel essai conservant request_id, libellés registre filtrés. Bd63772 corrige le test budget : statut paid sans paiement enregistré ne vaut pas règlement. Aucun SQL produit/migration ni opération fournisseur dans cette tranche.

## Vérification

ROOT :57 tests ciblés PASS/0skip et TypeScript strict non incrémental PASS. Contre-revue indépendante : API4groupes, UI6tests/repro faux-empty fermé, finance14tests/repros cohérence et valeurs héritées fermés ; vrais handlers finance exécutés avec hooks/API injectés (premier clic et annulation0mutation, cible modifiée invalide confirmation, nouvel essai même payload/request_id). SQL budget001–027 sous PGlite/AuthStorageCron simulés PASS, pas une preuve bancaire ni de concurrence cloud.

Preview réelle navigateur neuf :4cas artisan390/1440 x clair/sombre, réactiver/confirmation/suspendre/confirmation, brouillon sans Approuver,0cookies/erreursJS/débordement/appelsAPI inattendus.4cas Finance390/1280 x clair/sombre : Rapprochement/Ledger/Factures et avoirs,0erreurJS/réseauprivé/débordement. Démonstration explicite, aucune preuve opérateur connecté par ces8cas.5GET privés /admin/overview, /admin/artisans, /platform-operations/me, /finance/invoices et /finance/ledger :401 private,no-store. Preuves privées `superadmin-release-{artisan-public,finance-demo,anonymous}-proof.json`. CI applicative41343879691 en cours à la rédaction ; précédente7cc41343143784 SUCCESS deuxjobs.

## Activation et limites

Lecture distante ROOT : aucun profil admin, aucun réglage invoice_issuer/commission_bps. Email exact du compte propriétaire demandé ; aucun compte choisi/créé/promu. Bootstrap privé transactionnel préparé, verrou/countadmin0/UID+email unique confirmé/éligibilité/audit atomique ;19assertions PGlite PASS et relectureROOT, NON exécuté cloud. Aucune porte bootstrap publique ni droits assouplis. La recette connectée SuperAdmin/opérateur reste ouverte jusqu’à identification/activation du vrai propriétaire. Les données légales et taux restent à renseigner par le propriétaire, sans invention. Pas de facture réelle/avoir/grant immuable créé pour recette ; aucune cohorteQA committée ni donnée utilisateur modifiée. Stripe/SMS toujours différés ; aucune opération bancaire, publication store ou promesse application complète.
