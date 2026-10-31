# Livraison Web/PWA — rapport de livraison (périmètre déclaré, état au 31/10/2026 10:45 AST)

Document de livraison de l’agent Claude pour la phase 3 du plan actualisé (`docs/PLAN_LIVRAISON_ACTUALISE.md` sur missions/web-pwa). Il nomme exactement ce qui est codé, intégré, vérifié, différé ou absent. Aucune preuve locale n’est présentée comme une preview en ligne.

## Révisions

| Lot | Branche / SHA | État |
| --- | --- | --- |
| Interface Web (cinq espaces, session, guards) | claude/web-pwa-ui c7bd0eb (dernier code applicatif 04347d7) | codé ; intégré jusqu’à 9b3dae0 (CI verte) ; recette combinée en cours |
| Fidélité visuelle entreprise (M13/M4/M66) | claude/web-pwa-design e7aaef7 (Claude Desktop) | codé ; revue/acceptation due ; non intégré |
| Harnais de recette navigateur | claude/web-pwa-qa 07d7332 | codé, 42 tests unitaires ; exécution réelle due (pilote) |
| Gateway documents natif + harnais cloud | claude/web-pwa-backend 7fa4e95 | codé, 110 tests ; revue due ; Edge non déployée |
| Base dédiée | kcpyjzndybfdlnhvscbs, migrations 001–013 | appliquées et relues (pilote) |

## Démarrage local (pilote / recette)

```
npm ci
npm run check            # typecheck, tests, build
npm run build && npm start -- -p 3017   # production locale (webpack)
# ou : npm run dev -p 3017
```
Variables : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (serveur seul), `STRIPE_*` absentes = paiement explicitement indisponible. Sans variables Supabase : mode public + démonstration isolée (`#demo/<rôle>[-<vue>[.<id>]]`).

## Parcours utilisables (codés) et leur niveau de preuve

| Acteur | Parcours | Preuve disponible |
| --- | --- | --- |
| Public | accueil, aide, tarifs honnêtes, rejoindre, à propos, confidentialité, mentions, invitation d’organisation, compte (connexion, inscription, réinitialisation) | rendu sans erreur (scan 49 vues) ; Auth SSR réelle vérifiée par le pilote (12 contrôles) |
| Particulier | demande avec photos (envoi après création, file d’attente avec résultat incertain vérifiable), suivi, devis version exacte, acceptation/refus, rendez-vous, règlement (Stripe différé → indisponible explicite), avis, garantie, messages, documents, assistance | tests UI ; photos 2/2 et support 2/2 sur base réelle (pilote, 62b1f7f) |
| Artisan | tableau de bord M35, missions/offres anonymisées, acceptation atomique, refus, brouillon de devis (save/409/publication), rendez-vous, déplacement, compte rendu, justificatifs, candidature avec garde d’édition, performance, assistance | brouillon save/reload/409/send sur base réelle (pilote) ; tests UI |
| Entreprise cliente | organisation/site actifs, tableau d’interventions, fiche site, approbations V5-C08, contrats, rapports CSV, membres/invitations/accès par site, contrôles d’écriture masqués selon membership + portée, assistance | viewer/scoped-write/owner sur base réelle (pilote) ; gating complet 71f7fc9 à rejouer (QA-002) |
| Super Admin | KPI serveur, listes paginées serveur (dossiers, artisans, clients, organisations), fiche artisan et dossier, réaffectation, avis, assistance opérateur, paramètres (fonctions activées), garantie | pagination serveur 117/120 lignes (pilote) ; QA-004 à rejouer |

## Garanties transverses vérifiées par tests

Identité et chaînes périmées (guard, adoption de connexion, résultats jamais rendus à une autre identité), revalidation au premier plan sans perte de signal, contexte organisation invalidé sur 403, autorité d’écriture fail-closed, retours de paiement relus côté serveur, réponses 200 non JSON traitées comme incertaines, file de photos par dossier avec candidats vérifiés par l’utilisateur, clé d’idempotence d’assistance conservée jusqu’au succès. 43 tests `tests/ui`, 110 tests backend (branche gateway), `npm run check` vert.

## Différé ou non prouvé (explicite)

- Vercel : aucune nouvelle preview ; cycle PWA deux versions/deux onglets et installation sur appareil non prouvés (manifest, icônes, worker, notice hors ligne codés et testés unitairement).
- Stripe : Checkout/Connect/webhook en test non exécutés ; l’UI affiche l’indisponibilité et ne déduit jamais un paiement.
- Fonction Edge native non déployée ; harnais cloud jamais exécuté contre un projet réel.
- Fidélité visuelle : seul le lot entreprise est codé (non accepté) ; artisan/client/admin/public restent à comparer selon le plan phase 1.
- Périmètre avancé (PDF/avenants, GPS/ETA, notifications, planning artisan, équipements/SLA/ERP, factures/avoirs/commissions, rôles support/finance, paramètres administrables) : suivi dans PLAN_REPRISE et la matrice des 76 capacités ; non codé.
- Données d’exploitation (exploitant, territoire, tarifs, garanties, conditions) : à fournir par le propriétaire ; rien d’inventé.
