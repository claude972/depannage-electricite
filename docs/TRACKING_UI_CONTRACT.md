# Contrat UI — WEB-TRACKING-UI-006 (avant code)

- Agent : Claude (worker design), branche `claude/web-tracking-ui`, base `origin/integration/web-pwa`
  **6c67644af48b899857256d2211a843cd67efc608** (contient 0f57d96). Pilote/revue : Codex ; ROOT donne le feu avant code.
- Contrat API de référence : `origin/codex/gps-eta` **804a807**, `docs/TRACKING_CONTRACT.md` (revue ROOT en cours) ; ce
  document s’y aligne et sera amendé si les signatures changent.
- Propriété exclusive : `components/features/tracking/**`, `tests/ui/tracking*.test.ts`, ce document. Lead : coques
  client/artisan/entreprise, `components/app/types.ts`/`session.ts`/capacités/menus, raccordement. Codex : migration 019,
  `app/api/interventions/[id]/tracking/**`, `lib/features/tracking/**`. **Aucun package ajouté** (pas de Leaflet ni autre),
  aucun fournisseur ni clé côté client, aucun `fetch` dans les feuilles.

## 1. Références (inventaire `docs/audit/INVENTAIRE_SOURCES.json`)

| Code | Source | Contenu retenu | Non repris |
| --- | --- | --- | --- |
| M7 | `TOUT_EN_UN_MAQUETTES_GRANDES.pdf` p7 | Suivi client : timeline Demande / Artisan assigné / En route / Sur place / Terminé, « Arrivée estimée … vers HH:MM », carte avec trajet, « Votre artisan est en route », lien itinéraire. | « Mise à jour en temps réel », 18 min, avis/note, photo. |
| M44 | `MAQUETTES_UNE_PAR_PAGE_VOLUME_3.pdf` p13 | Offre artisan : distance + durée en voiture. | Distance/durée avant acceptation (aucune position partagée à ce stade : non affiché). |
| M67 | `MAQUETTES_UNE_PAR_PAGE_VOLUME_4.pdf` p20 | Adresse client + bouton de navigation. | Durée d’exemple. |
| V8-C07 | `MAQUETTES_UNE_PAR_PAGE_VOLUME_8.pdf` p8 | Détail d’intervention : vignette carte de l’adresse, stepper de statut. | Carte de l’adresse sans destination confirmée. |

## 2. Types et props (exactement ceux de `lib/features/tracking/types.ts`)

Les feuilles importent **uniquement** `TrackingSnapshot`, `TrackingCommand`, `TrackingClient` (et les types de réponse
route/géocodage exportés au même endroit). Client injecté : `load()`, `command(input)`, `route()`, `geocode(query)`, chacun
`Promise<T | null>` ; **`null` = chaîne d’identité périmée** → aucun message de succès, aucune mise à jour d’état. Erreurs
HTTP rendues avec le message serveur ; 503 structurés traduits (§6).

Props normalisées (comme les autres lots) :

```ts
type TrackingLeafProps = {
  state: "unknown" | "available" | "missing" | "unavailable"; // capacité « tracking » fournie par le lead
  unavailableMessage: string;
  scope: { userId: string; role: "client" | "artisan" | "manager" | "admin"; organizationId?: string; siteId?: string;
           authority: { canWrite: boolean; reason?: string } };
  client: TrackingClient;
  interventionId: string;
  demo?: { snapshot: TrackingSnapshot; route?: TrackingRoute | null };
  onNavigate?: (view: string, param?: string) => void;
  geolocation?: Pick<Geolocation, "watchPosition" | "clearWatch">; // défaut navigator.geolocation ; injectable pour tests
  now?: () => number; // horloge injectable pour les âges
};
```

Le droit d’action vient d’abord du serveur : `snapshot.permissions.can_share` (artisan) et
`snapshot.permissions.can_confirm_destination` (client propriétaire, owner/manager `can_manage_site`, SuperAdmin) ;
`scope.authority.canWrite=false` masque aussi les contrôles et affiche la raison. Refus serveur affichés tels quels.
Remontage complet (`key = userId|organizationId|siteId|interventionId`) à chaque changement d’identité ou de dossier.

Feuilles livrées : `ArtisanTrackingPanel` (partage), `TrackingCard` (client / entreprise / admin en lecture, variante
`variant`), `DestinationPicker` (géocodage + confirmation), `TrackingMap` (§5). Le lead les place : artisan dans le dossier
de mission à côté du panneau « Déplacement » existant ; client/entreprise dans le détail d’intervention.

## 3. Artisan — partage de position (M44/M67)

États UI dérivés du snapshot + de l’état local du watch :

| État | Condition | Affichage / actions |
| --- | --- | --- |
| Non partagé | `shared=false`, `can_share` | Explication + bouton « Partager ma position » (44 px). |
| Consentement | après clic | Texte versionné `tracking-v1` : qui voit (participants autorisés du dossier), quoi (dernière position seulement, aucun historique), envoi des coordonnées origine/destination à IGN pour le calcul, arrêt possible à tout moment, effacement à l’arrêt/arrivée/fin. Boutons « Autoriser et démarrer » / « Annuler ». La permission du navigateur **ne vaut pas** consentement. |
| Démarrage | clic « Autoriser et démarrer » | `session_id = crypto.randomUUID()` ; `command({action:"start", expected_version: control_version, payload:{session_id, consent:true, consent_policy:"tracking-v1"}})` ; **puis seulement** `watchPosition` (enableHighAccuracy, maximumAge 0, timeout 20 s). |
| En partage | watch actif | Dernière position **envoyée** : précision ± N m, âge (« il y a N s »), heure d’échantillonnage, source « position déclarée par le navigateur » (jamais « GPS certifié ») ; boutons « Arrêter le partage » et « Je suis arrivé ». |
| Erreurs | — | Permission refusée (code 1) : arrêt du watch, explication pour réactiver dans les réglages, aucun envoi ; position indisponible (2) / délai (3) : message + « Réessayer » ; hors ligne : points non envoyés (aucune file différée), message ; 409 (session/version/ordre) : arrêt local, rechargement du snapshot ; 429 : attente `Retry-After` sans boucle. |
| Arrivé / arrêté | `arrived` ou `stop` | `clearWatch` immédiat, purge mémoire, snapshot relu. |

Envoi des points : au plus **1 / 5 s**, `seq` croissant local à la session, `sampled_at` = horodatage de l’échantillon ;
échantillons d’`accuracy > 250 m` ou de plus de 60 s non envoyés (affichés « trop imprécise » / « trop ancienne »).
`clearWatch` et invalidation de génération à : Arrêter, Arrivé, déconnexion, changement d’identité, changement de dossier,
démontage, `can_share` devenu faux, session refusée (409/404/403). Tout callback d’une génération antérieure est ignoré.
**Aucune reprise cachée** : au rechargement, si le serveur indique `shared=true`, le panneau affiche « Partage interrompu par
le rechargement » et un bouton explicite (nouveau démarrage, nouveau `session_id`) ; jamais de `watchPosition` automatique.
Mention permanente : « Sur le web, le partage s’arrête si la page est fermée, mise en arrière-plan ou en veille ; aucun suivi
continu n’est garanti. »

## 4. Client / entreprise — suivi (M7, V8-C07)

- Timeline réelle : statut du dossier + `travel_stage` (planned → en_route → on_site) ; « Suivi actif » seulement si
  `shared=true` et `position_state="fresh"`.
- `position_state` : `fresh` → position affichée avec âge et précision ; `stale` → « Position périmée (dernière il y a N min) »,
  marqueur grisé, **aucune ETA** ; `stopped` → « Partage arrêté par l’artisan » ; `no_position` → « Aucune position
  partagée ».
- Arrivée estimée : seulement à partir d’une réponse `route()` `state:"available"` : « Arrivée estimée vers HH:MM
  (calculée à HH:MM, durée N min, hors trafic temps réel) », source « IGN Géoplateforme / BD TOPO » + attribution, distance ;
  heure = `calculated_at + duration_s`. Pas d’appel `route()` sans position fraîche ni destination ; rafraîchissement
  manuel (« Recalculer ») ou au plus toutes les 30 s pendant que la carte est visible. Aucune ligne droite ni vitesse
  constante, aucune ETA si erreur.
- Destination (`can_confirm_destination`) : recherche explicite (2–200 caractères) → jusqu’à 5 candidats avec libellé, type et
  score affichés tels quels (« correspondance N %, type commune/rue/adresse ») ; **aucune sélection automatique** ; bouton
  « Confirmer cette destination » par candidat ; saisie manuelle non prévue en V1 (`source:"manual"` réservé) ; « Retirer la
  destination » (`{clear:true}`) avec confirmation (efface aussi le partage en cours). Destination confirmée et extrémité
  routée (`snapped_end`) affichées distinctement avec la distance de raccordement.
- Lien « Ouvrir dans mon application de navigation » (URL `geo:` / Google Maps standard avec la destination confirmée
  seulement) : action utilisateur, aucun envoi de position.

## 5. Carte (proposition à faire approuver par ROOT avant code)

Décision ROOT : tuiles raster **OpenStreetMap**, usage interactif modéré, conforme à la politique officielle
(<https://operations.osmfoundation.org/policies/tiles/>). Plan sans dépendance :

1. Composant maison `TrackingMap` : grille de tuiles standard 256 px `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
   (`<img>` positionnées en projection Web Mercator calculée localement, `referrerPolicy="strict-origin-when-cross-origin"`
   pour un Referer valide, `loading="lazy"`, `decoding="async"`), **seulement les tuiles visibles** du cadre (≈ 6–12 par vue,
   jamais de chargement en masse), zoom borné 11–17, cadrage initial sur la boîte englobante position/destination/route.
2. Interaction modérée : boutons zoom +/− et recentrer (44 px, clavier), glisser au pointeur ; pas de molette continue
   (évite les rafales), aucun préchargement de niveaux voisins.
3. Superposition SVG dans le même repère : géométrie `LineString` du serveur (trait 4 px bleu action, contour blanc),
   marqueur position (cercle + halo de précision `accuracy_m` à l’échelle), marqueur destination confirmée, marqueur
   extrémité routée si distinct.
4. Cache : **cache HTTP du navigateur uniquement** ; aucun préchargement, aucune mise en cache Service Worker/offline des
   tuiles (le lead/PWA doit exclure `tile.openstreetmap.org` du SW — demande de raccordement) ; aucune coordonnée privée dans
   une URL autre que les indices de tuiles nécessaires à l’affichage.
5. Attributions toujours visibles dans le cadre : « © OpenStreetMap contributors » lien vers
   <https://www.openstreetmap.org/copyright>, et pour le trajet « Itinéraire : IGN Géoplateforme / BD TOPO — Licence Ouverte
   2.0 » (texte `attribution` du serveur) ; aucune attribution IGN attribuée au fond OSM.
6. Échec de tuile ou hors ligne : fond neutre + mention « Fond de carte indisponible » ; le tracé SVG reste affiché comme
   schéma explicitement libellé, jamais présenté comme carte validée.
7. Accessibilité : la carte est `role="img"` avec une description textuelle (« Position de l’artisan à N m de la destination
   par la route, échantillonnée à HH:MM ») ; toutes les informations existent aussi en texte hors carte.

## 6. Messages d’erreur (aucune ETA chiffrée)

| Raison 503 | Message |
| --- | --- |
| `position_unavailable` | Aucune position récente : l’arrivée ne peut pas être estimée. |
| `destination_required` | Destination non confirmée : la personne habilitée doit la confirmer. |
| `provider_quota` | Service d’itinéraire saturé ; nouvel essai possible dans N s (`retry_after_s`). |
| `provider_timeout` / `provider_unavailable` | Service d’itinéraire momentanément indisponible. |
| `route_unavailable` | Aucun itinéraire routier trouvé jusqu’à la destination. |
| `invalid_provider_response` | Réponse du service d’itinéraire inutilisable. |
| `server_configuration` | Calcul d’itinéraire non configuré sur ce service. |

401/403/404/409/422/429 : message serveur, action de rechargement ou d’attente ; 409 recharge le snapshot.

## 7. Responsive, clavier, accessibilité

- 360 : carte 16:10 pleine largeur sous l’état et l’arrivée ; boutons pleine largeur. 760 : idem. 1280 : carte à gauche
  (≈ 60 %), panneau d’état/arrivée/actions à droite.
- Cibles ≥ 44 × 44, focus visible, ordre clavier logique, `aria-live="polite"` sur l’état et l’arrivée (au plus une annonce par
  changement d’état, pas à chaque point), statut jamais porté par la couleur seule, `prefers-reduced-motion` respecté (pas
  d’animation de marqueur).
- Style : CSS module du lot, primitives communes (`.unavailable`, `.tag`), DESIGN.md (une couleur d’accent, bordures 1 px).

## 8. Tests (`tests/ui/tracking*.test.ts`, logique pure dans `components/features/tracking/*.ts`)

Machine d’état du partage avec géolocalisation et horloge injectées : aucun `watchPosition` avant consentement + start
réussi ; `clearWatch` sur stop / arrivé / démontage / changement de dossier / perte de `can_share` / 409 ; callback d’ancienne
génération ignoré ; `null` du client → aucune transition ; pas de reprise au reload ; débit ≤ 1 point / 5 s et `seq`
croissant ; échantillons > 250 m ou > 60 s non envoyés ; refus de permission / timeout / hors ligne. Affichage : ETA absente
pour chaque raison 503, `stale` sans ETA, heure d’arrivée = `calculated_at + duration_s`, géocodage sans sélection
automatique, `canWrite=false` → contrôles absents. Projection Web Mercator et sélection des tuiles visibles (nombre borné).

## 9. Vérification et hors périmètre

Captures 360/1280 en démo (snapshot de démonstration explicite) et, après raccordement lead, recette ROOT avec géolocalisation
**simulée explicitement** ; aucune preuve GPS matériel revendiquée. Hors périmètre : suivi natif/arrière-plan, historique de
parcours, trafic temps réel, saisie manuelle de coordonnées, choix d’un autre fond de carte, tout package.

## Amendement ROOT avant code (lecture de a7a1fed)

Accord ROOT : carte OSM interactive sans dépendance (§5). Vérifié en lecture seule : `public/sw.js` n’intercepte pas les
autres origines (`url.origin !== self.location.origin` → passage réseau), donc les tuiles `tile.openstreetmap.org` ne sont
ni interceptées ni mises en cache par le Service Worker ; aucune modification nécessaire.

1. **Effacement de l’affichage.** Dès qu’un snapshot donne `position = null`, `position_state` `stale` / `stopped` /
   `no_position`, ou qu’un droit est perdu (404/403, `can_share`/lecture retirés, changement d’identité/dossier), les
   coordonnées, le halo, le marqueur position **et** la géométrie de route sont **retirés de la mémoire affichée** : aucun
   marqueur grisé, aucune ancienne position conservée côté client. Seuls restent l’heure connue (`sampled_at` quand le
   serveur la transmet, sinon « heure inconnue ») et la raison (« position périmée », « partage arrêté », « aucune position »,
   « accès retiré »). La destination confirmée reste affichée seulement si le snapshot la renvoie. Une route n’est affichée
   qu’en même temps qu’une position `fresh` dont les `session_id/control_version/point_seq/destination_version` correspondent à
   la réponse `route()` ; sinon elle est effacée. Remplace la mention « marqueur grisé » du §4.
2. **Arrière-plan / veille / fermeture.** Libellé : « Sur le web, le partage **peut être interrompu** si la page est fermée,
   mise en arrière-plan ou en veille ; aucune continuité n’est garantie. » Jamais d’affirmation d’un arrêt serveur garanti à la
   fermeture. À `visibilitychange` → `hidden` et à la déconnexion : `clearWatch` + incrément de génération immédiats ; un
   `stop` serveur est tenté **au mieux** (`command` non attendu, aucun message de succès, aucune confirmation affichée), ce qui
   est dit explicitement (« l’arrêt côté service est tenté ; s’il n’aboutit pas, la position cesse d’être affichée après 60 s »).
   Au retour visible : aucune reprise automatique ; l’état « Partage interrompu » propose un nouveau démarrage explicite.
3. **Destination manuelle.** Pour une adresse introuvable ou ambiguë, l’utilisateur habilité peut (a) choisir un point sur la
   carte, puis confirmer, ou (b) ouvrir un panneau secondaire « Saisir des coordonnées » (latitude [-90, 90], longitude
   [-180, 180], libellé 1–200 caractères, validés avant envoi). Dans les deux cas : `source:"manual"`, **rien n’est envoyé avant
   le clic « Confirmer cette destination »** ; le point choisi est un brouillon local affiché comme tel (« non confirmé »). En
   lecture seule (`can_confirm_destination=false` ou `canWrite=false`), le sélecteur n’est jamais éditable : clic carte sans
   effet, champs et boutons absents, raison affichée.

Inchangé : adaptation M7/M44/M67/V8-C07, réponse `null` (chaîne d’identité périmée) ⇒ aucune transition ni succès, aucune
nouvelle dépendance. Types : tant que `lib/features/tracking/types.ts` n’est pas poussé par Codex, un miroir local
`components/features/tracking/types.ts` marqué **TEMPORAIRE** est utilisé et remplacé par l’import Codex dès réception du SHA.

## Amendement lead — reprise après rechargement (backend 8366c05 refuse un start sur session active)

Remplace « nouveau démarrage, nouveau `session_id` » du §3 et du point 2 de l’amendement ROOT. Après rechargement, si le
snapshot indique `shared=true` avec un `session_id` et que le lecteur a `can_share`, le bouton explicite « Reprendre le
partage » : (1) envoie `stop` avec ce `session_id` et `expected_version = control_version` du snapshot ; (2) si l’arrêt
réussit, réaffiche l’écran de consentement ; `start` avec un **nouveau** `session_id` n’est envoyé qu’après confirmation ;
`watchPosition` ensuite seulement. Jamais de `start` isolé suivi d’un 409, aucune nouvelle tentative automatique, aucune
reprise cachée. Échec du `stop` (409/403/404…) : relecture du snapshot, affichage de l’état serveur et du message, aucun
`start`. Rien n’est envoyé avant le clic. Testé (`tests/ui/tracking-model.test.ts`).

## Revue croisée Codex 8366c05 (P3-3, P3-4)

- P3-3 : confirmer ou retirer une destination arrête la session de partage côté serveur. Avant confirmation, si un
  partage est actif : « Le partage de position en cours sera arrêté ; l’artisan devra le relancer. » Côté artisan, le
  point suivant reçoit 409 : watch coupé, message d’arrêt, et seul chemin de reprise = nouveau consentement + `start`.
- P3-4 : une route qui répond 409 (`tracking_changed`) déclenche une relecture du snapshot ; une nouvelle demande n’est
  faite qu’une fois par nouvel état (`session/control_version/last_seq/destination_version`), jamais pour le même, sans
  boucle ni minuterie de nouvelle tentative ; l’ancienne route n’est jamais affichée entre-temps.

## Revue ROOT de 0778532 (P2-1, P2-2, P2-3) et correctif 360

- **P2-1** : toute sortie (interruption, arrêt, démontage, refus, 409) invalide la génération, y compris un `start`/point
  en attente. Une réponse arrivée après coup n’ouvre jamais de watch. Si un `start` en attente réussit après interruption,
  **un** `stop` compensatoire au mieux est envoyé pour cette session et la `control_version` retournée, par le client capturé
  au démarrage ; réponse `null` (identité périmée) : rien. Aucune nouvelle tentative.
- **P2-2** : `RouteGate` — au plus une demande d’itinéraire par 30 s, jamais avant la fin d’un Retry-After (429, 503
  `provider_quota`), état bloqué après 409 (une relecture, puis une demande seulement pour un nouvel état). Les effets
  dépendent d’une clé de contexte stable (`session_id | control_version | last_seq | sampled_at | destination_version`,
  position fraîche + destination), jamais de l’identité du snapshot re-sondé. Une seule minuterie, armée sur le temps
  restant ; le bouton « Recalculer » passe par la même porte et indique l’attente.
- **P2-3** : le cadrage descend sous 11 si nécessaire jusqu’au plancher **8** (trajet à l’échelle de la Martinique sur
  288 px) ; le dézoom utilisateur atteint au moins le zoom de cadrage (`min(11, cadrage)`). Halo de précision inclus dans
  le cadrage. Au plancher sans tenir : mention « Trajet trop étendu pour la carte », informations textuelles complètes.
- **360** : marges de cadrage calculées sur les boîtes mesurées des surcouches (contrôles, mention de fond), recentrage
  identique ; destination (libellé + coordonnées), heure et précision de la position restent visibles en texte.
- Non couvert par test d’effet React (pas de moteur de rendu de test dans les dépendances, aucun ajout) : la logique des
  effets est extraite dans `ShareController` et `RouteGate`, testés de façon déterministe ; le câblage est vérifié par
  captures (harnais temporaire non commité).
