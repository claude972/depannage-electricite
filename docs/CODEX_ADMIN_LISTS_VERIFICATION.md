# WEB-PWA-ADMIN-LISTS-001 — vérification Codex

Branche : codex/web-pwa-backend. Base applicative : f132f6a. Contrat publié et pushé avant implémentation dans d910eec ; présence distante vérifiée par API GitHub. Mission et corrections distantes lues ; seule affectation liste admin revendiquée. Aucun frontend, paiement, ancien schéma ou migration modifié.

## Implémentation

- Nouvelle route GET /api/admin/interventions sous session vérifiée et contrôle du profil admin avant lecture des interventions/devis. Lectures via client utilisateur/RLS existants, jamais service-role ; aucune migration nécessaire.
- Filtres status/catégorie/urgence/site/artisan, bornes de création inclusives et recherche littérale bornée ; noms inconnus, doublons, limites invalides, wildcard/syntaxe PostgREST injectée et dates incohérentes refusés422.
- Pagination créée/ID décroissants, départage des dates identiques et microsecondes préservées dans le curseur. Curseur versionné strict, lié aux filtres normalisés mais pas à la taille de page ; ce n’est pas une permission secrète.
- Un seul arbre logique combine recherche et curseur avec AND explicite, sans écraser la recherche. Toutes les conditions précèdent les bornages côté serveur.
- COUNT exact avant curseur pour le total filtré ; COUNT restant et lecture d’une ligne supplémentaire pour déterminer has_more, sans faux « fin » si le fournisseur impose un cap inférieur au limit demandé. Aucun total à partir de la page chargée.
- Projection de liste sans adresse, description ou coordonnées ; détail ?id=UUID pour retrouver un dossier ancien et ses50 derniers devis exacts, troncature signalée. Contacts/rapport/RDV via l’API operations existante.
- Toutes réponses, y compris erreurs, privées/no-store. Le dashboard/workspace100 n’est pas changé et ne devient pas exhaustif par ce lot.

## Vérifications fraîches

- `node_modules/.bin/tsx --test tests/admin-interventions.test.ts` : **8 tests passent**.
- `npm run typecheck` : passe.
- `npm test` : **38 tests passent**, zéro échec.
- `git diff --check` : propre.

Les huit tests exécutent le code réel de la route transpilé uniquement en mémoire avec esbuild déjà fourni par tsx ; seules la session et les fonctions d’erreur sont remplacées pour isoler le contrôle HTTP. Le SDK Supabase/PostgREST réellement installé construit les requêtes vers un fournisseur HTTP synthétique déterministe : **237 dossiers**, groupes à dates égales et dates séparées d’une microseconde, filtres combinés, pagination jusqu’au dernier dossier sans doublon/omission, UUID exact, accents/apostrophes, comptages avant curseur, changement de taille, filtre changé, curseur malveillant, cap fournisseur inférieur et COUNT manquant. Le mode détail conserve les identifiants des50 devis sur53 et signale la limite. Les rôles non-admin sont refusés avant toute lecture dossiers/devis.

Ce fournisseur est un modèle HTTP limité à la syntaxe utilisée, pas PostgREST distant ni une implémentation de RLS. Le succès de ces tests ne prouve donc pas Auth/RLS cloud ou le rendu UI. Les protections existantes du schéma ne sont pas modifiées.

## Contrôles restant au pilote / Claude

- Revue du SHA exact puis intégration frontend : filtres changés → curseur réinitialisé ; conserver les filtres normalisés ; charger le dossier via le mode détail au lieu de chercher uniquement dans workspace100. Afficher le total filtré serveur et les limites d’historique honnêtement.
- Vérification Auth/PostgREST réelle sur la base dédiée : admin seul, rôles négatifs, pagination >100 et syntaxe logique recherche+curseur, respect de la RLS ; comptes/données QA temporaires seulement.
- CI et preview combinées, dont tests UI, responsive/clavier et ouverture d’un ancien dossier. **npm run check complet et nouveau build non revendiqués** dans ce checkout : il contient le script test:ui mais pas encore les fichiers frontend du lot Claude, et le volume est presque plein. Les contrôles TypeScript/tests ciblés ci-dessus sont distincts de cette future vérification en ligne.
- Pas de snapshot multi-requêtes : COUNT et page peuvent différer si les dossiers sont modifiés en parallèle ; les nouveaux dossiers nécessitent une actualisation. Aucun export exhaustif, index de recherche spécialisé ou benchmark de charge cloud livré.

Documentation primaire consultée : Supabase select/count et order, types du PostgrestFilterBuilder installé (or utilise la syntaxe PostgREST brute). Les valeurs q n’acceptent aucun délimiteur logique ni wildcard ; timestamps/UUID du curseur sont validés puis le timestamp est cité en conservant sa précision.
