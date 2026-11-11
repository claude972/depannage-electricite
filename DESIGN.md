# Direction de design

## Décisions courantes — palette B et encaissement plateforme

La version du 10 novembre 2026 sert de référence pour l’accueil et le blog Web/PWA. L’accueil reprend la recherche, les cartes bleues, le menu à droite, les engagements avant le catalogue et la navigation basse sur téléphone. Les bannières urgence et candidature utilisent le jaune `#F4D649` avec des actions bleu nuit. Les pages publiques partagent les surfaces claires, les marges, l’en-tête et le pied de page bleu nuit. Les résumés, cartes et messages d’état utilisent des contours réguliers. Les états et sélections sont identifiés par leur libellé, une surface ou un contour complet. Le focus clavier reste visible. Les tarifs viennent du catalogue publié et l’entrée par l’adresse utilise le formulaire de demande existant. [Fichier Figma](https://www.figma.com/design/yHq46klgSoXkIXvG3dQBB1/accueil-web-pwa-bannieres-jaunes)

L’application iPhone et Android reprend la composition mobile du Web pour l’accueil, le catalogue, la réservation publique, le suivi, le compte et le blog. Les écrans connectés utilisent la même palette et une navigation adaptée aux actions de chaque rôle. La candidature et les demandes d’installation s’ouvrent dans le portail configuré.

DomDépannage est le nom visible sur le site, la PWA et l’application mobile. Sur le Web et la PWA, le logo horizontal noir sert à l’en-tête, le logo horizontal bleu au pied de page et le carré noir à l’icône d’installation. Dans l’application iPhone et Android, le logo empilé noir et bleu sur fond blanc est utilisé à l’accueil, à l’ouverture et sur l’icône d’installation.

Les dernières décisions du propriétaire priment sur les sections historiques ci-dessous. Référence historique Figma : `hec6XdQ7IbOFVeFhq6KPDw`, pages MOBILE B. Palette B validée : cobalt `#2246E5`, accent orange `#FF6B35`, surfaces blanches en clair et anthracite en sombre, Plus Jakarta Sans. Préserver la structure métier et les états accessibles ; pas de simple remplacement global de couleurs aux usages contradictoires. Mobile puis déclinaisons web complètes.

Le devis et la facture de prestation sont émis au nom de l’entreprise de l’artisan, via son dossier professionnel. Accord sur une version avant travaux ; supplément soumis à un nouvel accord. Tous les paiements doivent être encaissés par la plateforme : espace client, lien sécurisé ou QR associé au dossier. Aucun règlement espèces, TPE personnel, virement personnel ou déclaration artisan « reçu » n’est accepté pour les nouvelles opérations. Les anciennes opérations restent dans l’historique, sans les renommer en confirmations bancaires. Le choix après intervention signifie paiement sur la plateforme après travaux, jamais encaissement direct. Les codes internes historiques `on_site` peuvent rester transitoirement compatibles s’ils sont strictement interprétés comme paiement plateforme différé et ne donnent aucun droit de déclarer un encaissement.

Stripe et l’envoi SMS sont les deux liaisons fournisseur explicitement différées. Leur absence ne bloque pas le développement et les tests injectés, mais aucun faux paiement/OTP réel ni contournement d’accès privé n’est permis. Le compte client est facultatif, la vérification de possession du téléphone reste requise pour son accès privé. Commission et conditions commerciales sans valeurs inventées. L’application entière est visée, tous rôles et modules compris ; les maquettes et tests locaux ne prouvent pas à eux seuls la livraison.

---

## Statut et références
Le 31 octobre 2026, le propriétaire a retenu la maquette Delivo adaptée comme nouvelle direction UI/UX : « Je pense qu’on tient une partie de nos maquettes ça sera la nouvelle direction UI/ux ». La référence visuelle retenue à cette date était le prototype `6bc0cab3a9eabcc52ac62802b5ddfb953a5cb78e`, `prototypes/delivo-test/web-network.html`, consultable sur https://depannage-electricite-mgyxn7dsb-brafas-projects.vercel.app/web-network.html. Voir `docs/DIRECTION_UI_UX_VALIDEE.md` pour les décisions et leur adoption progressive.

Cette décision remplace la proposition initiale bleu/blanc pour la direction graphique. Les PDF restent les références fonctionnelles et de structure propres à chaque rôle. Le prototype valide une direction et une partie des compositions ; il ne prouve ni la migration de l’application, ni la validation de tous ses écrans.

Les maquettes couvrent interfaces mobiles client/artisan, pages web publiques, portails professionnels et administration. Elles peuvent être améliorées tout en conservant leurs intentions métier. Plusieurs noms et logos y coexistent : le nom final, le logo, les coordonnées et la zone de couverture restent à décider. Ne pas adopter une marque concurrente visible dans les schémas de comparaison.

## Intention
Une interface de service claire, rassurante et opérationnelle : comprendre la prochaine action, son coût estimé et l'état de la demande. Donner la priorité à la lisibilité et à la transparence, particulièrement en situation urgente.

## Langage visuel
- Identité verte : vert forêt pour les actions, noir en mode sombre, blanc et gris pâle en mode clair ; famille Plus Jakarta Sans. Conserver les boutons, cartes, arrondis et espacements de la maquette retenue.
- Thème clair/sombre avec choix système initial et choix utilisateur mémorisé. Le jaune distingue le bloc « Conseils et formation » ; il ne constitue pas un état de validation ou d’alerte à lui seul.
- Accueil web : grand diaporama photographique manuel, bord à bord, premier écran complet sous la navigation, sans publicité. Les photos restent lisibles, avec texte contrasté, commandes clavier et réduction du mouvement.
- Interventions en cartes compactes avec photos pertinentes, services par onglets, conseils en grand article + vignettes et bannière verte pour rejoindre le réseau professionnel. La composition et les règles de ces blocs viennent du prototype retenu.
- Réserver les couleurs de statut aux besoins métier et les accompagner de libellés. Ne pas utiliser la seule couleur verte de marque pour signifier qu’une information a été vérifiée.
- Icônes simples et cohérentes, accompagnées de libellés lorsque leur sens n'est pas évident.
- Bordures discrètes, arrondis modérés, ombres légères ; hiérarchie par espacement et typographie.
- Photographies pertinentes d'interventions et d'artisans pour les pages publiques ; aucune fausse preuve de qualification.

### Tokens de la direction retenue
| Usage | Valeur |
| --- | --- |
| Action principale | `#18794E` |
| Accent sur fond sombre | `#5BD49A` |
| Fond sombre / surface / carte | `#000000` / `#141414` / `#1A1A1A` |
| Texte sombre principal / secondaire | `#FFFFFF` / `#B5B5B5` |
| Fond clair / surface / carte | `#FFFFFF` / `#F4F6F5` / `#FFFFFF` |
| Texte clair principal / secondaire | `#111111` / `#4B5563` |
| Accent sur fond clair | `#0F5C3A` |
| Conseils et formation | fond `#F4D649`, texte `#141414`, secondaire `#343434` |
| Bordure sombre / claire | `#2A2A2A` / `#D9DFDC` |
| Erreur | `#B42318` (adapter le contraste à la surface) |

Vérifier le contraste des combinaisons réellement utilisées avant livraison. Centraliser couleurs, espacements, typographie, rayons et états dans le thème de la stack retenue.

## Typographie et disposition
- Plus Jakarta Sans pour le web/PWA, conformément à la maquette retenue ; conserver une hiérarchie de titres et un texte courant lisibles. Toute adaptation native ultérieure suit les règles de sa plateforme.
- Texte courant web autour de 16 px ; ne pas réduire les textes pour faire entrer un tableau.
- Échelle d'espacement initiale : 4, 8, 12, 16, 24, 32, 48 et 64.
- Mobile : une colonne, action principale visible, progression explicite pour les demandes et devis.
- Desktop professionnel : navigation latérale, titre et filtres, indicateurs utiles puis liste opérationnelle.
- Adapter les tableaux sur petits écrans avec cartes ou défilement identifié ; ne pas comprimer toutes les colonnes.
- Ne pas afficher les cadres de téléphone, barres système simulées ou cadres de navigateur des maquettes dans le produit.

## Parcours client retenu — complément du 1 novembre 2026

- Après l’adresse : choix du paiement (empreinte bancaire sans débit immédiat ou règlement sur place), récapitulatif puis confirmation. Une création de compte email/mot de passe est facultative ; elle ne doit plus être la suite imposée du formulaire particulier.
- Le suivi permet de retrouver ses interventions à partir du téléphone et des coordonnées. Nom, prénom et téléphone ne sont pas des secrets : une vérification du numéro précède l’affichage privé. Le fournisseur SMS étant explicitement différé par le propriétaire, le suivi téléphone reste désactivé tant qu’il n’est pas configuré, avec un état honnête.
- Les clients déjà connectés par un email confirmé gardent leur accès ; aucun rattachement de dossiers entre comptes n’est fait sur la seule égalité d’un téléphone non vérifié. Artisans et organisations conservent leurs parcours d’authentification.
- Paiement sur place reste un règlement à effectuer, jamais un paiement confirmé. L’empreinte doit être autorisée par le fournisseur ; retour navigateur ou choix de radio ne prouvent ni autorisation ni débit. Débit limité au devis accepté, après intervention et contrôles fournisseur.
- MesDépanneurs sert de référence de structure ; ses garanties, moyens de règlement précis, CGU, coordonnées et délais ne deviennent pas nos engagements.

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

La structure des écrans, la navigation et la hiérarchie métier font partie des références à respecter ; reprendre seulement les couleurs ne suffit pas. Les espaces artisan, entreprise cliente et Super Admin ne doivent pas être une simple vue client renommée. Pour chaque écran, choisir et noter une référence maîtresse parmi les variantes avant reprise visuelle.

- Artisan : M14, M34–M36, M44, M65 et M67, dont navigation basse mobile, profil métier, justificatifs et mission.
- Entreprise/partenaire : M4/M66, fiches et tableaux propres au syndic, à la restauration, aux bureaux et aux ERP.
- Super-administration de plateforme : M43 avec ses menus et indicateurs transverses ; ne pas confondre avec l’owner d’une organisation cliente.
- Nouveau volume 5 : V5-C01 fiche bureaux, V5-C05 dashboard Bureaux360, V5-C08 détail d’approbation syndic. Les autres images complémentaires dupliquent des références déjà présentes.

Les chiffres, certifications, dates, identités et promesses des images restent des exemples. Le périmètre électrique de la spécification finale prévaut sur les lignes multi-métiers/facility management des maquettes. Les adaptations d’accessibilité et de responsive doivent être documentées ; aucun style IA générique n’est autorisé.


### Références complémentaires des volumes 6 à 9

Le volume 8 ajoute V8-C03 À propos, V8-C05 confidentialité, V8-C06 devis client et V8-C07 détail intervention. Les volumes 6/7/9 reprennent des vues déjà cataloguées ; ne pas les compter comme de nouvelles interfaces à créer plusieurs fois. La structure des pages est une référence, pas une autorisation de publier des équipes fictives, une histoire inventée, un texte YourCompany non adapté ou les promesses d’annulation/satisfaction d’exemple. Le périmètre électrique et la chronologie métier cohérente prévalent sur les exemples peinture/plomberie et l’ordre discutable d’une timeline.
