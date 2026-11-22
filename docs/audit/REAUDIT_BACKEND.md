# Réaudit backend ciblé, lecture seule

## Sources consultées et preuve d’état

Lus : DESIGN.md, AGENTS.md (contexte/règles), docs/audit/BACKEND.md intégralement ; app/api/payments/{checkout,webhook,connect}/route.ts ; app/api/{workspace,documents,professional,admin/artisans}/route.ts ; app/api/interventions/[id]/actions/route.ts ; lib/supabase/{server,validation}.ts ; deux migrations SQL (sections schéma, droits, fonctions, paiement, approbations et garantie) ; package.json et .github/workflows/check.yml. Inventaire complet des fichiers app/api, lib, supabase/tests, tests ; extraits de tests/sql-review.mjs vérifiés.

`git diff --stat 46aac2a -- app lib supabase tests package.json .github/workflows/check.yml` est vide : les éléments backend inspectés restent identiques au précédent audit. Aucun test exécuté, aucun compte distant interrogé, aucun état fournisseur actuel revendiqué. Le rapport ancien mentionne un contrôle fournisseur frais *à sa date* : ce n’est pas un contrôle frais de cette nouvelle revue.

## Constats corroborés, prioritaires et dépendances

| Priorité | Fait vérifié / source exacte | Dépendance / résultat attendu pour le plan |
| --- | --- | --- |
| P0 avant données réelles | serverClient retourne 503 si URL/clé absentes (lib/supabase/server.ts:13–20) ; authenticatedClient appelle auth.getUser (32–40). | Recontrôler en lecture seule les environnements, puis base dédiée/migrations et comptes de test quand implémentation autorisée. Ne pas confondre le backend codé avec un service actif. |
| P0 droits B2B | initial.sql:118–124 accorde toujours au client_id auteur lecture/écriture de dossier ; is_org_member ne remplace pas ce lien. | Définir propriété organisation, départ du salarié et rôles par site **avant** invitation/révocation. Tester retrait de membre et changement d’organisation. Aucun incident live démontré. |
| P0 payeur B2B | checkout:35–39 exige job.client_id===user.id ; accept_quote initial.sql:224 utilise owns_intervention qui accepte owner/manager. | Définir payeur délégataire, autorisation et journal ; pas simplement supprimer la condition Checkout. |
| P0 finance réelle | webhook:31–38 accepte uniquement deux événements Checkout payés ; aucun refund/dispute/payout. Le statut failed existe initial.sql:66 mais n’est pas alimenté ici. | Avant exploitation : modèle financier, cycle d’échec/remboursement/litige et rapprochement. paid n’est pas un virement bancaire artisan. |
| P1 terrain | profils_read initial.sql:153 et workspace:18–21 ne donnent que le profil courant hors admin. | Projection minimale des coordonnées après attribution, tests avant/après attribution et mauvais compte. Pas d’ouverture générale de profiles. |
| P1 métier | actions route:13–20 offre accept_mission/send_quote/accept_quote/start/complete/cancel seulement. initial.sql:35–48 ne stocke pas de rendez-vous. | Refus individuel artisan, refus client de devis, rendez-vous/modification, en-route/arrivée, rapport/preuve de fin nécessitent modèles et commandes métier ; UI seule insuffisante. |
| P1 listes | workspace:26/31/36/37/42/46–51 ; professional:65–85, admin artisans:27 limitent sans cursor. | Pagination, recherche et agrégats serveur avant de prétendre historiques/KPI exhaustifs. |
| P1 candidatures | initial.sql:7–14 seul booléen artisan_approved ; approve_artisan:278–283 bascule ce booléen. | Dossier structuré, catégories/validité des justificatifs, motifs et renouvellement. |
| P1 équipes/contrats | initial.sql:21–25 membres ; create_site:249–265 crée uniquement le premier propriétaire. professional.sql:15–28 contrats texte et fiches génériques. | Parcours org/membres et modèles verticaux avant portail avancé. Un texte contractuel ne calcule pas un tarif. |

## Nouvelles précisions à intégrer ou correction du précédent rapport

1. **Tri des offres : corriger BE-06.** Le rapport ancien dit « ordre récent », mais initial.sql:196 contient `order by i.created_at limit 100`, donc **les plus anciennes d’abord**. Pas de `desc`, pas de classement distance/pertinence. L’inventaire ne doit pas maintenir ce détail erroné.
2. **Suspension artisan et missions en cours : règle manquante explicite.** `accept_mission` vérifie artisan_approved (initial.sql:208), mais send_quote:212, start:231, complete:235 vérifient uniquement artisan_id et statut. approve_artisan:282 met seulement le booléen à jour ; can_access_intervention:120 conserve l’accès de l’artisan affecté. Checkout:52 bloque ensuite le paiement si artisan suspendu. Ainsi le code autorise encore les actes terrain sur missions existantes mais peut bloquer leur encaissement. Définir si suspension empêche nouvelles missions seulement, stoppe chantier, réassigne, maintient accès aux preuves et solde travaux déjà faits. C’est une incohérence métier potentielle à tester, **pas une vulnérabilité distante prouvée**.
3. **Le rejet d’approbation n’est pas le refus du devis client.** decide_approval (professional.sql:114–125) change approvals.status et écrit une trace ; il ne change ni quote.status ni intervention.status. L’artisan peut donc toujours voir son devis sent, sans workflow de retour explicite. Définir visibilité du motif et nouvelle version ; ne pas afficher « devis refusé » comme si une commande de refus quote existait.
4. **Fichiers : bonne base à conserver.** documents:13–21 et100–105 vérifie signatures de format ET MIME, pas seulement extension. RLS avant URL signée:38–49 ; écriture avant service-role:75–96 ; compensation d’upload si métadonnées échouent:126–128. Catégorisation métier, validité, scan éventuel/retenue et gestion d’orphelins restent des besoins à cadrer ; ne pas dire qu’aucun contrôle fichier n’existe.
5. **CI ne valide pas SQL/intégration.** check.yml:18–19 exécute npm ci puis npm run check ; package.json check=types+tests*.test.ts+build. tests/sql-review.mjs n’est pas dans cette commande et annonce explicitement des stubs auth/storage (ligne3 ; définition14–20 ; omission pgcrypto25–26). Les preuves 11 tests/13 groupes restent antérieures, aucune fraîche exécution ici.

## API réellement présentes / points de copie à conserver

Ces signatures sont constatées dans le dépôt et non promises comme API métier complètes. Lors d’implémentation vérifier aussi les documentations officielles des versions épinglées, notamment Stripe Accounts v2.

- `authenticatedClient(): Promise<{db,user}>` et `assertOrigin(request: Request)` : lib/supabase/server.ts:32–40,67–70. Copier le contrôle serveur déjà présent, pas un rôle envoyé par navigateur.
- `validated<T>(request: Request,schema:z.ZodType<T>):Promise<T>` : lib/supabase/validation.ts:11–26. Schémas stricts, limites corps et erreurs explicites.
- `POST(request:Request,context:{params:Promise<{id:string}>})` : actions route:27–55 ; RPC `intervention_action(p_id uuid,p_action text,p_lines jsonb default null,p_tax_rate numeric default20)` initial.sql:199. Transaction avec verrou de dossier ligne205, contrôle acteur et état, montants serveur. Étendre par commandes explicites, ne pas autoriser la mutation directe des tables.
- `professional_report(p_site_id uuid default null)` : professional.sql:198–209 ; agrégation SQL invoker/RLS, pas sommes sur fenêtres frontend tronquées.
- `stripe.checkout.sessions.create` : checkout:91–124 ; montant du devis immuable, référence et destination serveur, idempotence. `stripe.webhooks.constructEvent(body,signature,secret)` webhook:21–29 puis RPC service-only `confirm_stripe_payment(...)` lignes53–60 / initial.sql:295–318. Conserver signature corps brut, validation montant/devise/session et journal événement transactionnel.
- Upload contrôlé / URL signée : documents:13–21,38–49,75–128. Ne pas importer les pièces métier sans adapter le modèle et les permissions.

## Ordre de reprise recommandé à l’orchestrateur

A. Spécifier rôles/org/propriété/offboarding et suspension + politique devis/paiement/garantie ; tracer les décisions.
B. Vérifier environnement et sécurité des comptes de test ; migrations uniquement dédiées ; tester les refus d’accès et concurrence réelle.
C. Dossier artisan + commandes terrain + contacts ; documents/reporting/version devis ; client/devis et retours Auth/Stripe.
D. Stripe test, comptabilité d’événements et opérations finance ; aucune ouverture commerciale sans preuve.
E. Portail entreprise multi-utilisateur et SuperAdmin complets, avec granularité, traces et séparation des responsabilités ; les contrats/SLA/verticales avancés se fondent sur ces droits.
F. Acceptation en ligne par rôle : parcours nominal, erreurs, annulation, montant, accès interdit, reprises/idempotence et historique. Enrichir CI SQL et tests intégrés ; ne pas rebaptiser tests PGlite « Supabase validé ».

## Confiance et limites

Élevée sur les fichiers/conditions lus et le diff vide. Moyenne sur les scénarios de suspension/rejet comme défauts produit : comportement du code établi, intention métier à décider. Aucun état actuel Supabase/Stripe/Vercel ni rendu UI n’a été recontrôlé. Pas de recherche web dans cette collecte interne : pas de nouvelle API fournisseur recommandée comme valide ; le plan doit imposer relecture des docs officielles au début de chaque intégration.
