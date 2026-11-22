# Dossier de préparation commerciale — DomDépannage

19 novembre 2026, heure de Martinique ; **mis à jour le 21 novembre 2026 : commission, zone, garantie, règles de prix et identité de l’exploitant validées par le propriétaire et publiées** (voir `docs/DECISIONS.md`). Le reste demeure une version de travail. Créée à sa demande : les documents commerciaux n’existent pas encore. Leur rédaction ne vaut ni approbation des données ni activation des encaissements réels.

## Documents à travailler

1. [Identité et offre](01_IDENTITE_OFFRE.md) : exploitant, contacts, territoire et horaires.
2. [Prix, commissions et facturation](02_PRIX_COMMISSIONS.md) : grille à renseigner et décisions financières.
3. [Conditions de service](03_CONDITIONS_SERVICE.md) : parcours client/artisan et règles de réclamation, avec points à valider.
4. [Confidentialité](04_CONFIDENTIALITE.md) : projet de notice et registre des traitements à compléter.
5. [Exploitation et ouverture](05_EXPLOITATION_OUVERTURE.md) : responsabilités, preuves et conditions de mise en service.

Les champs `[À RENSEIGNER]` doivent être remplacés par des informations vérifiées. Les paragraphes **Proposition** sont modifiables ; ils ne deviennent des règles applicatives qu’après décision et vérification de l’implémentation. Les montants et identités synthétiques de recette ne sont jamais repris comme données commerciales. Aucun document de ce dossier n’est chargé automatiquement par l’application.

## Ordre conseillé de validation

Identifier l’exploitant et le prestataire qui contracte avec le client ; arrêter territoire/horaires et contacts ; définir prix, commission et fiscalité ; relire les conditions et la confidentialité ; configurer les publications depuis l’administration ; contrôler leur rendu et les versions historiques ; terminer les preuves d’exploitation et mobiles ; décider séparément de l’ouverture réelle.

## État observé au début de cette reprise

Sur l’alias de recette : profil opérateur et garantie `published: null`, couverture de 97200 `unknown`, barème `publication_available: false`. La fourchette technique de secours n’est pas un barème commercial validé. Stripe reste en TEST. Le rapprochement TEST est corrigé. Des tests CI historiques nécessitaient une adaptation à la relecture fournisseur ; leur correction est suivie dans la PR #9.
