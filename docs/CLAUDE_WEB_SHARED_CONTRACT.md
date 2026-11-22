# Contrat WEB-SHARED-001 — raccordements communs (propriétaire unique : lead CLI b4b555f0)

Base : 9b3dae03e1a413ffe89b34e0db7553ddc1b3ade9 (integration/web-pwa). Branche de préparation : `claude/web-shared`. Ce contrat est publié avant tout code de raccordement ; il fixe l’interface que les quatre lots avancés (ADV-DOCUMENTS-001, ADV-PLANNING-NOTIFICATIONS-001, ADV-B2B-OPERATIONS-001, ADV-PLATFORM-FINANCE-001) doivent respecter pour être branchés sans toucher aux fichiers globaux, et l’ordre dans lequel le lead les branche. Codex revoit et intègre ; `integration/web-pwa` et `main` ne sont jamais modifiées ici.

## 1. Fichiers possédés par ce lot

- `components/app/types.ts`, `components/app/session.ts`, `components/app/demo.ts`, `components/courant-app.tsx`, `components/app/session-types.ts`, `app/globals.css` (seulement si une primitive commune manque), `tests/ui/**` pour les tests de raccordement.
- Coques de rôle `components/role/*.tsx` et leurs CSS : possédées par l’agent design (`claude/web-pwa-design`) tant que le transfert n’est pas enregistré dans `docs/CLAUDE_STATUS.md`. Les points d’ancrage (onglet, menu, panneau) sont demandés à cet agent et branchés par lui, ou repris par le lead après transfert explicite. Aucune édition concurrente.
- `package.json` / `package-lock.json` : aucune dépendance prévue ; toute demande doit être justifiée dans le contrat du lot et validée par le pilote avant ajout.

## 2. Ce que livre un lot avancé (composants feuilles)

1. **Aucun import des fichiers globaux** : un composant feuille n’importe ni `components/courant-app`, ni `components/app/types`, ni `components/app/session`. Il déclare ses propres types dans `lib/features/<lot>/types.ts` et reçoit tout par props.
2. **Props minimales normalisées** (nommage à reprendre tel quel dans chaque contrat de lot) :
   - `state: "unknown" | "available" | "missing" | "unavailable"` — état du contrat serveur, calculé par le lead avec la règle existante (`contractStateFromError` : 404/405 → `missing`, 503/réseau → `unavailable`, autre échec → `unavailable`, succès → `available`). Le composant affiche lui-même l’état indisponible avec le libellé commun fourni en prop `unavailableMessage` ; il n’invente aucune donnée de remplacement.
   - `scope` — contexte serveur tel que connu du lead : `{ userId, role, organizationId?, siteId?, authority: { canWrite: boolean, reason?: string } }`. Le composant n’en déduit aucun droit ; il masque/désactive les contrôles d’écriture quand `authority.canWrite` est faux et affiche la raison. Tout refus serveur est rendu tel quel.
   - `client` — fonctions d’accès injectées par le lead (`load`, `command`) typées par le lot, construites sur `api()` existant ; le composant n’appelle jamais `fetch` directement. Les commandes retournent un résultat ou `null` quand la chaîne est périmée (règle `runForResult`) : un résultat `null` ne déclenche ni message de succès ni mise à jour.
   - `demo?: <données de démonstration du lot>` — fourni par le lead uniquement en mode démonstration explicite ; le lot expose ses graines dans `lib/features/<lot>/demo.ts`, jamais mélangées à des données réelles.
   - `onNavigate?(view, param?)` — navigation déléguée au lead (hash routing), jamais de `location.hash` direct dans la feuille.
3. **États obligatoires** : chargement, erreur (message serveur), vide, validation de formulaire, indisponible (`state ≠ available`), lecture seule (`authority.canWrite=false`). Copie utilisateur sans nom de fichier, route, RPC ou table (règle CL-UI-005) ; le bloqueur technique reste en attribut `data-blocker`.
4. **Style** : CSS module dans le dossier du lot, primitives communes de `app/globals.css` réutilisées (`.tag`, `.stat`, `.unavailable`, `.field-error`, `.forbidden`), règles `DESIGN.md` (Geist, une couleur d’accent, bordures 1 px, grille 8 px, cibles ≥ 44 px, pas de dégradés multi-accents). Aucune dépendance npm nouvelle.
5. **Tests** : logique pure dans `lib/features/<lot>/**` couverte par `tests/<lot>/*.test.ts` (node:test via tsx) ; un test par état indisponible/lecture seule/refus. Le lead ajoute les tests de raccordement dans `tests/ui`.

## 3. Clés et vues réservées (à utiliser exactement)

| Lot | Clé `Capabilities` | Route sonde (GET, utilisateur authentifié) | Vues (`View`) | Rôles |
| --- | --- | --- | --- | --- |
| ADV-DOCUMENTS-001 | `quoteDocuments` | `/api/quote-documents?quote_id=…` ou route de capacité déclarée au contrat | `quote-documents` (param : id de devis) | client, manager, artisan, admin selon RLS |
| ADV-PLANNING-NOTIFICATIONS-001 | `planning`, `notifications` | `/api/planning`, `/api/notifications` | `planning`, `notifications` | planning : artisan ; notifications : tous rôles connectés |
| ADV-B2B-OPERATIONS-001 | `siteOperations` | `/api/site-operations?site_id=…` | `site-operations` (param : id de site) | manager (lecture pour viewer/gestionnaire, écriture selon grant) |
| ADV-PLATFORM-FINANCE-001 | `platformOperations` | `/api/platform-operations/me` (droits de l’opérateur courant) | `platform-operators`, `platform-finance`, `platform-moderation` | admin et opérateurs explicitement habilités côté serveur |

Un lot qui a besoin d’une clé ou d’une vue supplémentaire la déclare dans son contrat ; le lead l’ajoute ici avant le raccordement. Les routes de hash restent `#vue/param` avec le même garde `canAccess` et le même paramètre `^[A-Za-z0-9_.-]{0,120}$`. Les liens de démonstration suivent `#demo/<rôle>-<vue>[.<id>]`.

## 4. Règles de menu et de droits

- Une entrée de menu n’apparaît que si (a) le rôle est autorisé par `ACCESS`, (b) la capacité est `available` ou `unknown` en cours de vérification, (c) pour l’entreprise, le contexte organisation/site est résolu. Capacité `missing`/`unavailable` : l’entrée reste visible uniquement si elle mène à l’écran d’indisponibilité honnête (jamais un menu sans action).
- La visibilité d’un menu ne confère aucun droit : tout acte passe par une route serveur qui revérifie identité, rôle, organisation, site, grant. L’UI reflète `enterpriseAuthority` (fail-closed) et `membershipRole` existants ; elle n’élargit jamais.
- Session, rôle et site restent la vérité serveur (`auth.getUser`, `validateContext`, invalidation sur 403/404). Un composant feuille reçoit un `scope` déjà validé et le réaffiche ; il ne le recalcule pas.
- Aucune simulation silencieuse : services différés (Stripe, fournisseurs d’envoi) rendus « indisponible : non configuré » ; démonstration explicite et isolée.

## 5. Ordre de raccordement (par lot, sans parallélisme sur les fichiers globaux)

1. Contrat du lot poussé (`docs/CLAUDE_ADV_<LOT>_CONTRACT.md`) → le lead vérifie la conformité à ce contrat (props, clés, vues, états) et consigne l’accord ou les écarts dans `docs/CLAUDE_STATUS.md`.
2. Checkpoint composants + API + migration du lot poussé, tests verts → revue Codex du SHA exact.
3. Le lead fusionne la branche revue dans `claude/web-shared`, ajoute la clé de capacité, la détection, les vues, les chargeurs/commandes bornés par la garde d’identité (`createRunner`/`runForResult`), la démo isolée et les ancrages (via l’agent design pour les coques).
4. Contrôles : `npx tsc --noEmit` ; `npx tsx --test tests/ui/*.test.ts` ; tests du lot ; tests de refus (hash direct d’un rôle non autorisé → écran « ne fait pas partie de votre espace » sans requête ; capacité `missing` → aucun appel de commande ; `canWrite=false` → contrôles absents et refus serveur rendu) ; `npm run check` complet avant chaque push de `claude/web-shared` ; captures 360/1280 selon la planche de référence ; scan console des vues démo.
5. Rapport SHA exact + sorties de contrôle + carte source → écran + « ce que Codex doit vérifier ». Codex intègre ensuite `claude/web-shared` et applique séquentiellement les migrations revues (014 → 017) ; l’UI ne présume jamais qu’une migration est appliquée : la détection de capacité fait foi.

## 6. Acceptation du lot WEB-SHARED-001

- Pas de menu sans action ; session/rôle/site serveur ; typecheck/check/tests de refus après chaque raccordement ; captures selon maquette ; aucun droit par simple visibilité.
- Toute dépendance SQL croisée entre lots est interdite (014–017 ne dépendent que de 001–013) ; si un besoin commun apparaît, il est publié ici et synchronisé avant code.
