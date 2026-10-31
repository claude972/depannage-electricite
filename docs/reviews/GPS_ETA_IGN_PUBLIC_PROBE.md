# GPS/ETA : vérification du fournisseur public

Contrôle root du 2026-10-31T14:31:50-04:00 ; uniquement coordonnées/adresse de lieux publics fixes, aucune donnée utilisateur, compte, achat ou secret. Documentation et conditions dans GPS_ETA_PROVIDER_DISCOVERY.md.

- Capacités `https://data.geopf.fr/navigation/getcapabilities` : HTTP200 ; ressources bdtopo-pgr et bdtopo-valhalla présentes, bdtopo-osrm absente.
- Schéma `https://data.geopf.fr/navigation/openapi/swagger.json` : HTTP200 ; chemins itineraire/isochrone, serveur /navigation. Swaggerinit pointe encore vers /simple/1.0.0/openapi/swagger.json qui répond404 : ne pas utiliser cet ancien lien.
- Route réelle : GET /navigation/itineraire resource=bdtopo-valhalla, profile=car, optimization=fastest, start=-61.068,14.6035, end=-61.0032,14.5911, unités meter/second, geometryFormat=geojson, crs=EPSG:4326, getSteps=false, getBbox=true. Savane→zone aéroport Martinique, points de recette publics.
- HTTP200, resourceVersion=2026-10-29, durée=783.475 secondes, distance=10890.44 mètres ; géométrie LineString à 409 points.
- Réponse réelle geometry est un OBJET GeoJSON, malgré le schéma qui annonce string. start/end sont chaînes de points ajustés à la route ; conserver la destination confirmée distincte du point routier ajusté, ne pas prétendre arrivée à la porte. Ce trajet ne mesure ni trafic réel ni précision GPS d’un appareil.
- Géocodage public GET /geocodage/search?q=Place de la Savane Fort-de-France 97200&limit=3&index=address : HTTP200, FeatureCollection de deux résultats (place locale et rue différente). Le premier est une locality, score0.825 ; pas de confirmation implicite d’une adresse ambiguë. UI doit proposer et faire confirmer le point.
- Aucun adaptateur applicatif encore livré/testé à ce stade ; ces preuves établissent l’accès public et le format réel, pas les permissions/RLS/GPS de l’application. Pas de promesse arrière-plan PWA ou trafic live.

Empreintes des réponses privées de preuve :
- depannage-ign-capabilities.txt : `4f8701a7fec154d3a55974361cdf3a5af4c04e80038eeffc19e4fdfd0d83748a`
- depannage-ign-spec-navigation.json : `6f4d143b82a954ee4d12a0e5ca05638b52a20c93fbec6ae4866b10d35d2b75b6`
- depannage-ign-martinique-valhalla-response.json : `bdc751638eb2bf65fc8e68f74030bd496f1ae789dfadf57e5fa863edbc5c7b47`
- depannage-ign-geocoding-public-response.json : `a521e70b980134a4650d317525db0f60d8ba074dceddfdbba8213cc9a35a33f6`
