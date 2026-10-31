# Statut Claude — WEB-PWA-20261030

Fichier de coordination émis par l’agent Claude pour le pilote (Codex). Le pilote publie les mises à jour sur `missions/web-pwa` ; ce fichier reste la source des claims, statuts, questions et rapports de Claude.

## Acceptation et claim

- mission: WEB-PWA-20261030
- agent: claude
- session: b4b555f0 (`depannage-web-pwa-ui`, background, acceptEdits, sans bypass)
- branch: claude/web-pwa-ui, base 3c1ca2ce978f354556c0c691d4ac0d3088308b36
- worktree: /Volumes/Stockage/Projets/depannage-web-pwa-claude
- status: **accepted / in_progress** — seul l’assignment Claude est revendiqué ; les entrées Codex et pilote sont préservées telles quelles
- lectures effectuées: origin/missions/web-pwa MISSIONS.md + CORRECTIONS.md ; origin/codex/web-pwa-backend docs/WEB_PWA_CONTRACTS.md (08c10c5) ; AGENTS.md, DESIGN.md, CLAUDE.md, docs/PLAN_REPRISE.md, audit/REAUDIT_CONSOLIDE.md, REAUDIT_FRONTEND.md, CATALOGUE_MAQUETTES.md, ARCHIVES_CODE.md, COUVERTURE_PLAN.csv, DECISIONS.md ; components/courant-app.tsx (5275 lignes), app/globals.css, app/page.tsx, app/layout.tsx, lib/domain.ts, lib/supabase/*, toutes les routes app/api lues, migrations SQL ; images maîtresses extraites des PDF (M35 V3p4, M34, M36, M43 V3p12, M44, M14, M4, M7, M61, M65, M66 V4p19, M67, V5-C01/C05/C08, V8-C06/C07, M50, M56, M13)
- périmètre de fichiers: components/courant-app.tsx, nouveaux composants/styles de rôle, app/globals.css, app/page.tsx, public/design, tests/ui, docs/CLAUDE_STATUS.md, docs/CLAUDE_VERIFICATION.md. Aucun fichier Codex/partagé ne sera modifié sans demande ici.

## Prochain livrable (checkpoint 1)

**P0 identité / cache / gardes + coques de rôle fidèles**, commit vérifié et poussé sur claude/web-pwa-ui :

1. Réinitialisation complète à logout / changement d’identité / expiration : `data`, `professional`, `selected`, filtres, brouillon de réponse en vol (jeton de requête, réponse tardive A ignorée après connexion B), `onAuthStateChange` branché, caches de démonstration jamais lus en mode live.
2. Garde de rôle sur chaque vue rendue (hash direct `#sites`, `#admin`, `#missions`… renvoie un état « accès non autorisé » sans monter le composant) ; rôle live dérivé uniquement de `/api/workspace`, jamais du sélecteur démo.
3. Coques dédiées : artisan mobile (bandeau navy, missions du jour, performance, CTA bleu, 5 onglets bas Tableau de bord/Missions/Devis/Messages/Profil — M35), entreprise cliente (M4/M66 : navigation latérale, organisation/site actifs, tableau filtrable), Super Admin (M43 : menus Artisans/Interventions/Devis & Factures/Clients/Avis/Messages/Paramètres avec vues réellement disponibles ou état indisponible lié à son bloqueur), client/public conservés et nettoyés.
4. Lecture des retours `?payment=`, `?connect=`, `?auth=` par relecture serveur (jamais « payé » depuis l’URL).
5. Sélection historique de devis par `quote_id` exact dans Documents.
6. `npm run check` vert ; captures 360 px et desktop dans docs/CLAUDE_VERIFICATION.md.

Découpage interne prévu (sous-modules à propriété unique, pas d’édition concurrente du monolithe) : `components/role/*` par acteur (artisan, enterprise, admin, public/client), `components/ui/*` partagés, `app/globals.css` + feuilles de rôle. Le monolithe `courant-app.tsx` devient la coque session/état et délègue.

## Contrats backend et intégration

- Actions existantes conservées : accept_mission / send_quote / accept_quote / start / complete / cancel ; routes workspace, interventions, professional, reports, sites, profile, documents, reviews, warranty, admin/artisans, payments.
- Contrats 08c10c5 pris en compte comme **non disponibles sur preview** : `/api/artisan` (save_profile, submit_application, set_availability, link_credential), `/api/interventions/[id]/operations` (decline_offer, reject_quote, save_appointment, set_travel_stage, save_report, reassign), `/api/admin/overview`, champs additifs workspace (`organization_members`, `artisan_profile`, `participants`). L’UI les appellera uniquement derrière une détection explicite (404/503 → état « indisponible : contrat backend en cours » rattaché au bloqueur). Aucune simulation live.
- PwaInstallControl (components/pwa-registration.tsx) : import prévu dans Profil/Aide **après intégration** du fichier Codex ; non importé tant que le fichier n’existe pas sur ma branche.

## Questions au pilote (non bloquantes, réponses via MISSIONS/CORRECTIONS)

- Q-C1 : pour `GET /api/workspace` additif, la projection `participants` fournira-t-elle `full_name` + `phone` du tiers uniquement à partir de `assigned` ? L’UI affichera « coordonnées disponibles après attribution » sinon.
- Q-C2 : `GET /api/admin/overview.capabilities` — format proposé côté UI : `Record<string, {available:boolean, reason?:string}>` clé = menu M43 (`artisans`, `interventions`, `quotes_invoices`, `clients`, `reviews`, `messages`, `settings`). Confirmer ou fournir le vôtre ; l’UI s’adaptera.
- Q-C3 : règles commerciales (commission, TVA par défaut, territoire, exploitant) : aucune valeur inventée côté UI ; les écrans affichent « à définir par l’exploitant ». Les propositions restent dans ce fichier.

## Bloqueurs connus (hors Claude)

- Supabase dédié refusé (factures organisation en retard) : mode live indisponible sur preview ; tous les états live affichent le 503 serveur existant honnêtement, la démonstration reste explicite et isolée.
- Nouveaux contrats backend en implémentation : UI livrée avec états « indisponible » tant que la preview combinée ne les expose pas.

## Journal

- 2026-10-30 21:46 AST — lecture complète des sources de mission, claim écrit, npm ci effectué (exit 0), extraction des 20 images maîtresses. Début du checkpoint 1.
