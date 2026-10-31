# Vérification frontend — Claude, mission WEB-PWA-20261030

Rapport d’implémentation et de vérification de l’agent Claude (branche `claude/web-pwa-ui`). Les éléments « vérifiés » le sont localement (typecheck, tests, build, captures du serveur de développement en démonstration). **Aucune preview combinée en ligne n’a encore été vérifiée** : la revue croisée et la preview Vercel restent des conditions de clôture.

## Checkpoint 1 — identité/cache/gardes et coques de rôle

### Architecture livrée
| Fichier | Rôle |
| --- | --- |
| `components/courant-app.tsx` | Contrôleur de session : mode public/démo/live, identité, génération d’identité (`components/app/guard.ts`), gardes de vue, routage par hash, chargement avec protection contre les réponses tardives, toutes les mutations (contrat live ou contrepartie démo explicite). |
| `components/app/guard.ts` | Guard pur : chaque chaîne de mutation est liée à la génération d’identité qui l’a démarrée ; une déconnexion/connexion ou un changement de rôle démo invalide les effets différés (avis, navigation, données, drapeau occupé). |
| `components/app/session.ts` | Logique pure : accès par rôle, hash, paramètres de retour, sélection exacte de devis, missions/performance artisan, contexte organisation/site, rôle de membership. |
| `components/app/types.ts`, `session-types.ts` | Types de domaine et contrat `Session`/`PublicSession` entre le contrôleur et les espaces. |
| `components/app/ui.tsx`, `icons.tsx`, `format.ts`, `api.ts`, `demo.ts`, `forms.tsx` | Primitives partagées, icônes, formats, client HTTP honnête, données de démonstration isolées, formulaires existants extraits du monolithe. |
| `components/role/public-site.tsx` | Site public : accueil, demande (brouillon), compte, aide, tarifs (honnête), rejoindre, à propos, confidentialité, mentions, acceptation d’invitation, entrée démo. |
| `components/role/client-space.tsx` | Espace particulier (M61 mobile, V8-C07 détail, V8-C06 devis). |
| `components/role/artisan-space.tsx` | Espace artisan (M35 coque, M67 offre, M34 devis, M14 justificatifs, M65 candidature, M36 profil). |
| `components/role/enterprise-space.tsx` | Espace entreprise cliente (M66/M4 coque et tableau, V5-C08 approbation, V5-C01/M50 fiche site, membres/invitations contrat 006). |
| `components/role/admin-space.tsx` | Super Admin plateforme (M43 : menus, KPI serveur, validations, interventions, dispatch, clients, avis, messages, paramètres, garantie). |
| `tests/ui/*.test.ts` | Tests de la logique de session et du guard d’identité (voir ci-dessous). |

### P0 fermés dans le code (à confirmer en preview)
- **R-01 / SYS-02** : `clearSessionState()` vide workspace, données professionnelles, sélection, filtres de contexte, brouillon, capacités ; incrémente la séquence de requêtes et la génération d’identité ; remonte `sessionKey` pour remonter l’espace avec un état local vierge. `refresh()` ignore toute réponse dont la séquence ou l’identifiant utilisateur ne correspond plus. `onAuthStateChange` : SIGNED_OUT → public ; autre utilisateur → reset puis rechargement.
- **CL-UI-006** : `createRunner()` lie chaque mutation à sa génération ; une chaîne de A terminée après la connexion de B ne publie ni avis, ni erreur, ni navigation, ni données, et ne libère pas le drapeau occupé de B (tests `tests/ui/guard.test.ts`). Les connexions (`signIn`/`signUp`) adoptent explicitement la nouvelle identité via `ctx.rebind()`.
- **Gardes de vue** : `canAccess(view, role, mode)` ; un hash interdit rend `Forbidden` dans le chrome sans monter la vue ; le rôle live provient uniquement de `/api/workspace`. Le sélecteur de rôle démo n’a aucun effet en live (`setDemoRole` ignoré).
- **Caches démo** : lus uniquement dans les branches `mode === "demo"` ; `startDemo()` refuse de s’exécuter en live.
- **CL-003 / FIN-03** : `?payment=`, `?connect=`, `?auth=` sont nettoyés de l’URL et traités comme des indices : relecture de `GET /api/payments/status?quote_id=` (ou du workspace en repli) ; l’état « payé » n’est jamais déduit de l’URL.
- **API-QUOTE-001 / CLI-08** : la version affichée est choisie par `pickQuote(quotes, interventionId, quoteId)` ; l’acceptation envoie `quote_id` de la version affichée ; Documents ouvre la version exacte.
- **R-09** : `enterpriseContext()` n’adopte jamais `organizations[0]` implicitement quand plusieurs organisations existent ; tout le périmètre entreprise suit l’organisation/site actifs ; autorité par `membershipRole`, jamais par le rôle global.

### Contrôles exécutés
| Contrôle | Résultat |
| --- | --- |
| `npx tsc --noEmit` | voir CLAUDE_STATUS (checkpoint) |
| `npx tsx --test tests/ui/*.test.ts` | 15 tests, 0 échec (session 8, invitations 3, guard 4) |
| `npm run check` | voir CLAUDE_STATUS (checkpoint) |
| Captures dev server (démo, `#demo/<rôle>`) | `docs/verification/ui/*.png` |

### Correspondance captures / références
| Capture | Référence maîtresse | Points vérifiés |
| --- | --- | --- |
| `artisan-360.png`, `artisan-1280.png` | M35 (V3 p4) | salutation + cloche, bandeau navy « Tableau de bord / Vue d’ensemble », lignes « Missions d’aujourd’hui » (horaire = rendez-vous enregistré, sinon « à fixer »), panneau Performance (note, CA du mois, base de calcul), CTA bleu, 5 onglets bas |
| `artisan-missions-360.png` | M35/M67 | segments disponibles/en cours/terminées, offres anonymisées |
| `artisan-application-360.png` | M65 (V4 p18) | dossier en 5 sections, statut de candidature, pièces manquantes |
| `artisan-profile-360.png` | M36 (V3 p5) | identité société, documents N/3, grille performance, boutons |
| `client-360.png` | M61 (V4 p14) | CTA « J’ai besoin d’un électricien », actions rapides, interventions récentes, 4 onglets bas |
| `client-1280.png` | composition existante | stats, devis en attente, liste, aide |
| `manager-1280.png`, `manager-360.png` | M66 (V4 p19) / M4 | barre navy, navigation latérale, organisation/site actifs, filtres, tableau paginé, reflow en cartes à 360 px |
| `manager-approval-1280.png` | V5-C08 | liste d’approbations ; détail avec décision + historique |
| `manager-members-1280.png` | contrat 006 | membres par rôle de membership, invitations à partage manuel, journal |
| `admin-1280.png`, `admin-360.png` | M43 (V3 p12) | menus, 4 KPI (compteurs serveur, revenu plateforme non calculé), validations en attente, interventions en cours, menu off-canvas |
| `home-360.png`, `home-1280.png`, `pricing-360.png`, `join-360.png` | pages publiques | menu mobile, tarifs honnêtes, rejoindre sans promesse |

## Checkpoint 2 et corrections de revue (a5c4faa → b5ccc81)

- Membres (entreprise) : portée par site de chaque membre (contrat 009), éditeur réservé au propriétaire canonique, invitations avec portée, panneau « Votre accès » pour les autres membres ; aucune autorité dérivée du rôle global.
- Fiche candidature (Super Admin) : lecture du dossier et des pièces d’un artisan (`/api/artisan?user_id=`), SIRET masqué, statuts honnêtes.
- Installation : `PwaInstallControl` du lot PWA placé dans les quatre profils et l’aide publique ; silencieux quand l’installation n’est pas possible.
- Copies utilisateur : plus aucun chemin, nom de fonction serveur ou identifiant interne visible ; les bloqueurs restent en attribut de données pour la vérification.
- Retour paiement : `paymentReturnMessage` (serveur d’abord) ; `parseApiBody` (200 non JSON = résultat incertain).
- Contrôles : typecheck OK ; `tests/ui` 21/21 ; `next build` non relancé (volume plein, ENV-CL-001) ; captures des nouvelles vues reportées au retour d’espace disque.

### Écarts, limites et suites
- Aucune preview en ligne de ce frontend : le pilote déploie la branche d’intégration ; vérification mobile réelle, installation PWA, et retours Stripe restent à prouver en ligne.
- Les contrats 006 (organisations) et 007 (performance/rendez-vous) sont consommés derrière une détection d’indisponibilité ; tant qu’ils ne sont pas intégrés, l’UI affiche un état indisponible honnête.
- Composant `PwaInstallControl` : non encore importé (slots commentés dans les profils) ; intégration prévue au checkpoint suivant après accord pilote sur l’emplacement (Profil + Aide).
- Deep link démo `#demo/<rôle>[-<vue>]` ne porte pas d’identifiant de dossier (paramètre unique).
- `next dev`/`next build` (Next 16) réécrit `AGENTS.md` à la racine (fonction « agent rules ») : fichier restauré après chaque exécution ; correction demandée côté `next.config.ts` (Codex).
