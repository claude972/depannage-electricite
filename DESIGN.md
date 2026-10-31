# Direction de design

## Statut et références
Ce document fixe une direction initiale issue des PDF fournis et des règles de qualité du projet. Les valeurs de tokens ci-dessous sont des propositions de normalisation, pas des couleurs extraites exactement des maquettes.

Les maquettes couvrent interfaces mobiles client/artisan, pages web publiques, portails professionnels et administration. Elles peuvent être améliorées tout en conservant leurs intentions métier. Plusieurs noms et logos y coexistent : le nom final, le logo, les coordonnées et la zone de couverture restent à décider. Ne pas adopter une marque concurrente visible dans les schémas de comparaison.

## Intention
Une interface de service claire, rassurante et opérationnelle : comprendre la prochaine action, son coût estimé et l'état de la demande. Donner la priorité à la lisibilité et à la transparence, particulièrement en situation urgente.

## Langage visuel
- Base claire, surfaces blanches, fond gris très pâle, titres bleu nuit et action principale bleue.
- Vert réservé aux réussites, validations et disponibilités ; orange aux alertes et rouge aux erreurs ou urgences qui le justifient.
- Icônes simples et cohérentes, accompagnées de libellés lorsque leur sens n'est pas évident.
- Bordures discrètes, arrondis modérés, ombres légères ; hiérarchie par espacement et typographie.
- Photographies pertinentes d'interventions et d'artisans pour les pages publiques ; aucune fausse preuve de qualification.

### Tokens initiaux proposés
| Usage | Valeur |
| --- | --- |
| Action principale | `#1457D9` |
| Titres / navigation sombre | `#102A43` |
| Texte principal | `#172B4D` |
| Texte secondaire | `#526178` |
| Fond | `#F5F7FB` |
| Surface | `#FFFFFF` |
| Bordure | `#D8E0EB` |
| Succès | `#167344` |
| Alerte | `#925C00` |
| Erreur | `#B42318` |

Vérifier le contraste des combinaisons réellement utilisées avant livraison. Centraliser couleurs, espacements, typographie, rayons et états dans le thème de la stack retenue.

## Typographie et disposition
- Police sans empattement lisible ; retenir une famille commune avant implémentation et utiliser les conventions natives si une application mobile est choisie.
- Texte courant web autour de 16 px ; ne pas réduire les textes pour faire entrer un tableau.
- Échelle d'espacement initiale : 4, 8, 12, 16, 24, 32, 48 et 64.
- Mobile : une colonne, action principale visible, progression explicite pour les demandes et devis.
- Desktop professionnel : navigation latérale, titre et filtres, indicateurs utiles puis liste opérationnelle.
- Adapter les tableaux sur petits écrans avec cartes ou défilement identifié ; ne pas comprimer toutes les colonnes.
- Ne pas afficher les cadres de téléphone, barres système simulées ou cadres de navigateur des maquettes dans le produit.

## Parcours et composants
- Client : problème, adresse/zone, description et photos, estimation, confirmation et état de la demande. Distinguer informations obligatoires et facultatives.
- Artisan : mission avec problème, distance estimée et fourchette, acceptation/refus ; devis détaillant déplacement, main-d'œuvre, pièces, taxes et total.
- Paiement : récapitulatif explicite, états en attente/réussi/échoué et possibilité de reprise ; aucune confirmation avant validation serveur.
- Professionnels : organisation et site actifs visibles, filtres persistants lorsque pertinent, statuts textuels et accès aux documents selon les permissions.
- Réutiliser boutons, champs, badges, cartes, étapes, tableaux, alertes et confirmations ; éviter des variantes arbitraires entre rôles.
- Prévoir sur chaque vue de données : chargement, erreur avec action de reprise, absence de données avec prochaine action et succès.
- Formulaires : labels persistants, erreurs près du champ, conservation des valeurs après échec et confirmation des actions réussies.

## Accessibilité
- Viser WCAG 2.2 AA pour le web : contraste texte courant de 4,5:1, grands textes de 3:1, focus visible et navigation clavier complète.
- Cibles tactiles d'au moins 44 × 44 ; ne pas transmettre un statut uniquement par la couleur.
- Prévoir intitulés accessibles, ordre de lecture cohérent, zoom et réduction des animations.

## Interdictions du projet
Ces règles sont établies pour la suite du projet ; elles ne sont pas présentées comme des interdictions préexistantes dans les PDF.
- Pas de faux avis, compteurs, certifications, garanties détaillées ou délais présentés comme réels.
- Pas de prix d'exemple présenté comme tarif contractuel ; préciser estimation, taxes et frais selon les règles métier retenues.
- Pas de copie des marques concurrentes ni de mélange des identités présentes dans les maquettes.
- Pas de dégradés décoratifs envahissants, effets de verre, animations permanentes ou accumulation de cartes sans utilité fonctionnelle.
- Pas de texte illisible, contenu tronqué essentiel, boutons sans action ou navigation fictive dans une fonctionnalité livrée.
- Pas d'information personnelle ou de document accessible au mauvais rôle ou à la mauvaise organisation.

## Vérification après chaque fonctionnalité
Contrôler cohérence des composants, responsive, lisibilité, clavier/focus, validations, chargement/erreur/vide, transparence tarifaire et permissions. Comparer aux intentions des PDF et vérifier le résultat sur la preview en ligne adaptée à la plateforme.


## Fidélité aux références après audit

La structure des écrans, la navigation et la hiérarchie métier font partie des références à respecter ; reprendre seulement le bleu et le blanc ne suffit pas. Les espaces artisan, entreprise cliente et Super Admin ne doivent pas être une simple vue client renommée. Pour chaque écran, choisir et noter une référence maîtresse parmi les variantes avant reprise visuelle.

- Artisan : M14, M34–M36, M44, M65 et M67, dont navigation basse mobile, profil métier, justificatifs et mission.
- Entreprise/partenaire : M4/M66, fiches et tableaux propres au syndic, à la restauration, aux bureaux et aux ERP.
- Super-administration de plateforme : M43 avec ses menus et indicateurs transverses ; ne pas confondre avec l’owner d’une organisation cliente.
- Nouveau volume 5 : V5-C01 fiche bureaux, V5-C05 dashboard Bureaux360, V5-C08 détail d’approbation syndic. Les autres images complémentaires dupliquent des références déjà présentes.

Les chiffres, certifications, dates, identités et promesses des images restent des exemples. Le périmètre électrique de la spécification finale prévaut sur les lignes multi-métiers/facility management des maquettes. Les adaptations d’accessibilité et de responsive doivent être documentées ; aucun style IA générique n’est autorisé.
