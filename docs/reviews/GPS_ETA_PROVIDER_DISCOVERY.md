# Découverte fournisseurs GPS / ETA Web–PWA

Revue documentaire du 31 octobre 2026. Sources officielles uniquement. Aucun compte créé, achat, installation, credential, appel avec coordonnées/adresse utilisateur, mutation cloud ou code applicatif. Seuls documentation et endpoint public de capacités ont été consultés. Aucun calcul Martinique exécuté : couverture documentée ≠ preuve de fonctionnement de l’intégration.

## Décision proposée

Retenir **IGN Géoplateforme** pour le géocodage et la durée routière, dans deux adaptateurs remplaçables côté serveur. C’est une option immédiatement développable sans présumer de secret existant : les opérations publiques documentées n’exigent aucun paramètre de clé. Confirmer les capacités et le schéma exact au raccordement ; ne pas annoncer le fournisseur testé avant une vraie requête de recette avec coordonnées publiques synthétiques. Carte, GPS navigateur, géocodage et route sont quatre fonctions distinctes.

### IGN : routage

`https://data.geopf.fr/navigation/itineraire` accepte GET ou POST JSON. Choix recommandé : `resource=bdtopo-osrm`, `profile=car`, `optimization=fastest`, `distanceUnit=meter`, `timeUnit=second`, `geometryFormat=geojson`, `crs=EPSG:4326`. `start` et `end` sont des chaînes longitude,latitude. Découverte : `https://data.geopf.fr/navigation/getcapabilities` ; [Swagger officiel](https://data.geopf.fr/navigation/openapi/).

La documentation actuelle annonce France entière, DROM inclus : Martinique couverte contractuellement par cette description. Limite **5 requêtes/seconde/IP**, donc agréger tous les utilisateurs derrière la sortie serveur. Le graphe vient de BD TOPO et expose `resourceVersion`. Ses vitesses et pénalités sont modélisées : **aucune preuve de trafic temps réel**. Libellé recommandé : « Durée routière estimée, hors trafic en temps réel » ; conserver date de calcul et fraîcheur GPS. [Documentation IGN itinéraire](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/calcul-itineraire/).

### IGN : géocodage

Endpoints : `https://data.geopf.fr/geocodage/search` et `/reverse`, GET unitaire ; [capacités](https://data.geopf.fr/geocodage/getcapabilities), [Swagger](https://data.geopf.fr/geocodage/openapi). Limite **50 requêtes/seconde/IP**. Sources BAN pour les adresses, BD TOPO pour les lieux et PCI pour les parcelles ; l’autocomplétion est prévue. Utiliser recherche d’adresse explicitement confirmée puis enregistrer le point retenu, plutôt que regéocoder chaque position GPS. La page décrit des données nationales mais ne détaille pas la complétude des adresses martiniquaises : contrôler un échantillon public et proposer confirmation/correction du point. [Documentation IGN géocodage](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/).

Les pages Swagger sont dynamiques et leurs schémas n’ont pas été rendus lisibles par l’outil web : **noms exacts des champs de réponse géocodage, structure d’erreur IGN et statuts HTTP restent à vérifier par l’auteur dans le schéma**, sans inventer une compatibilité BAN/OSRM brute. Les unités et options ci-dessus sont documentées. Aucune durée de timeout contractuelle trouvée.

### Coût, droits, attribution

Les CGU autorisent le cadre de développement commercial ou non et indiquent que les géodonnées/géoservices sont gratuits sauf licence spécifique. Certaines API privées peuvent nécessiter un compte/une authentification ; ce n’est pas une promesse générale de service sans clé pour toute la plateforme. La licence attachée à chaque donnée prime ; absence de mention spécifique : Licence Ouverte selon ces CGU. Ne pas confondre l’offre payante d’hébergement de jeux de données avec la consommation des géoservices publics. [CGU, notamment accès, licences et annexe 2](https://cartes.gouv.fr/cgu/?lang=fr).

La fiche du producteur IGN identifie BD TOPO sous **Licence Ouverte 2.0**. Cette licence permet l’exploitation commerciale et impose la paternité. Prévoir crédits séparés pour route IGN/BD TOPO, adresse BAN et fond de carte, avec version/date lorsque fournie ; ne pas attribuer toute la carte à IGN si elle vient d’OSM. [Fiche IGN BD TOPO](https://www.data.gouv.fr/datasets/bd-topo-r), [Licence Ouverte officielle](https://ia.numerique.gouv.fr/licence-ouverte-open-licence/).

## Comparaison OSRM et OSM

**OSRM logiciel ≠ service public garanti.** Son API standard `/route/v1/{profile}/{lon,lat;lon,lat}` renvoie JSON, codes `Ok`/erreur dont `NoRoute`, durée en secondes, distance en mètres et géométrie selon option. Le profil est déterminé par le graphe préparé ; ne pas supposer que son nom sélectionne dynamiquement un véhicule. [Documentation OSRM](https://project-osrm.org/docs/v5.24.0/api/).

Point important : la page officielle GitHub qualifie explicitement ses anciennes restrictions commerciales de règles de l’**ancien** serveur et renvoie à FOSSGIS pour le serveur actuel. Ne pas citer l’ancienne clause « pas derrière un paywall » comme règle actuelle établie. [Politique OSRM et renvoi actuel](https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy).

La page officielle de l’opérateur FOSSGIS annonce couverture voiture mondiale, **1 requête/s maximum**, pas de charge lourde/scraping, UA/Referer corrects, attribution et lien de correction OSM ; les requêtes sont journalisées. Le texte allemand complet a répondu Access Denied à l’outil : autorisation commerciale détaillée non vérifiée. Donc **ne pas en faire un fallback de production de l’application payante**. Une recette publique ponctuelle doit respecter ce cadre ; exploitation durable : instance OSRM dédiée ou fournisseur contractuel, décision d’infrastructure ultérieure. [Conditions résumées par l’opérateur](https://routing.openstreetmap.de/about.html), [conditions complètes inaccessibles pendant cette revue](https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/).

**Fond OSM raster** : `https://tile.openstreetmap.org/{z}/{x}/{y}.png` convient à une consultation interactive modérée, avec attribution visible « © OpenStreetMap contributors » liée aux droits, Referer navigateur valide, respect du cache HTTP (à défaut au moins sept jours). Ni préchargement massif, ni téléchargement hors-ligne, ni parcours automatique de carte pour remplir le cache. Pas de SLA ; blocage possible. Fond configurable et remplaçable ; les captures automatisées doivent éviter de charger massivement ce service. [Politique officielle tuiles](https://operations.osmfoundation.org/policies/tiles/).

**Nominatim public non retenu** : maximum agrégé 1 requête/s, requêtes déclenchées par l’utilisateur et modérées, attribution/identification/cache, aucune autocomplétion. Ce serveur ne convient pas à un géocodeur générique automatisé ; aucune donnée personnelle/confidentielle à soumettre. IGN documente au contraire un service destiné au géocodage et à l’autocomplétion. [Politique officielle Nominatim](https://operations.osmfoundation.org/policies/nominatim/).

## GPS navigateur et limite PWA

`navigator.geolocation.watchPosition(success, error, options)` exige contexte sécurisé HTTPS, permission utilisateur explicite et une Permissions-Policy compatible. Les options `enableHighAccuracy`, `maximumAge`, `timeout` se règlent explicitement ; garder l’identifiant pour `clearWatch`. Refus de permission, absence de position et timeout doivent produire des états explicites ; ne pas simuler un déplacement. [MDN watchPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition).

La spécification W3C actuelle (Candidate Recommendation Draft, donc état documentaire précisé) exige des documents actifs et visibles pour les mises à jour. L’API est exposée à Window : le service worker n’offre pas une acquisition GPS de remplacement. **Installer la PWA ne garantit aucun GPS continu écran verrouillé ou application en arrière-plan**. Afficher dernière position horodatée et suivi interrompu/périmé ; à la reprise attendre un nouveau point. La fréquence du watch dépend du navigateur, pas d’un intervalle garanti. [W3C Geolocation, §6.3/6.5 et exposition Window](https://www.w3.org/TR/geolocation/).

## Contrat d’adaptateur recommandé à Claude (choix de mise en œuvre, non quotas fournisseur)

- Configurer endpoints serveur et fond de carte par allowlist ; pas d’URL arbitraire fournie par un client. IGN primaire ; aucun fallback réseau silencieux vers un autre opérateur.
- Normaliser résultat : fournisseur, durée secondes, distance mètres, géométrie validée, calculé-à, version ressource si présente. GPS : latitude/longitude, précision et timestamp originaux. Vérifier valeurs finies, unités, géométrie et bornes ; pas d’heure d’arrivée issue d’une vitesse constante ou d’une distance à vol d’oiseau.
- Démarrer le partage par action explicite de l’artisan affecté ; arrêter watch et effets au retrait du consentement, fin de mission, logout/changement compte. Serveur contrôle affectation et lecture client de cette seule mission ; aucun canal public de positions.
- Dédupliquer et limiter à une requête route en vol par mission ; intervalle initial proposé 30 s et seuil de déplacement, avec garde de génération contre réponses anciennes. Budget partagé inférieur à 5/s par IP, incluant retries. En multi-instance, un compteur mémoire par instance ne suffit pas : régulation partagée ou plafond conservateur documenté.
- Timeout applicatif proposé 5–8 s avec abort ; retry borné/jitter sur panne temporaire, backoff sur quota (respect Retry-After s’il existe), aucun retry automatique sur erreur de saisie/no-route. Tant que le schéma n’est pas vérifié, ne pas prétendre qu’IGN utilise nécessairement un code particulier pour ces cas.
- États séparés : position indisponible, destination non confirmée, route absente, quota/panne/timeout, résultat périmé. Afficher ETA indisponible plutôt qu’un chiffre de repli fictif ; un ancien calcul peut rester visible seulement daté comme ancien.
- Pas de précises positions/routes privées dans cache PWA hors-ligne, logs ou URL publique. Réponses applicatives privées `no-store` ; cache court de déduplication serveur cloisonné si utile. Le cache HTTP des tuiles publiques reste distinct et respecte sa politique.

## Recette encore nécessaire avant déclaration « GPS/ETA livré »

Auteur : inspecter schémas officiels et capacités courantes ; tests d’adaptateur nominal + JSON invalide/unités/absence de route/timeout/quota/réponse ancienne ; un trajet public synthétique Martinique réellement routé ; confirmation destination ambiguë ; droits entre comptes et mission réaffectée ; vraie permission GPS appareil, refus/révocation et retour de veille. Fond visible avec attribution et sans préfetch hors-ligne. Ne pas transformer un test GPS simulé en preuve matérielle ni une durée routière en prévision de circulation. Aucun prérequis d’achat/secret identifié pour commencer IGN, mais l’accès effectif depuis le déploiement et la qualité locale restent à mesurer.
