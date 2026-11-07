# Taux de TVA explicites — backend

Représentation technique des taux0/2,1/5,5/8,5/10/20%. Aucun choix de régime fiscal automatique, aucune exonération ni obligation individuelle déduite. Source primaire : https://www.impots.gouv.fr/professionnel/questions/quels-sont-les-differents-taux-de-tva-applicables-dans-les-dom (BOI-TVA-GEO-20-10 lié).

Migration nouvelle20261107023839 : quatre contraintes monétaires élargies, quatre validateurs existants actualisés, valeur20 implicite supprimée de toute la chaîneintervention_action. Fonctionnalités et droits existants conservés. La migration vérifie les anciennes définitions attendues et échoue sur dérive. Aucun UPDATE historique. APIenvoyer devis sans taux explicite :422 ; brouillonNULL autorisé ; actions non fiscales sans taux conservées. Schéma canonique partagélib/tax-rates.ts ; seuls changements de types danscomponents/app/types.ts.

Vérifications :27testsHTTP/PDF/snapshot/ledgerPASS0skip. SQLréel isoléPGlite0.5.13 :37contrôlesPASS ; devis/avenants/document persisté2,1/8,5, arrondis centimes, absence/7refusés, actionsnonfiscales, brouillonNULL/taux, commissionNULL/taux. Lignehistorique20 + instantané/hashdocument inchangés ; tousOID/ACLfonctions identiques. Auth/Storage/cron simulés ; aucun fournisseur réel, cloud ni preuve de concurrence.

Typecheck autonome de cette branche :3erreurs de consommateursfrontend réservésClaude (courant-app777 ; amendment-form46 ; artisan-quote-draft225), unions resserréesTaxRate àcâbler. Aucune autre erreur observée. Ne pas annoncer tscglobalPASS avant intégration frontend et rejeuROOT. Pas de déploiement ni migrationcloud par ce worker.
