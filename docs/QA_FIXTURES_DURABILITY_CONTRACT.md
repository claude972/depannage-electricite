# QA-FIXTURES-DURABILITY — contrat : manifeste de fixtures durable et cohérent (avant correctif)

Statut : **contrat avant code** ; correctif après lecture de root. Autorisation propriétaire donnée par root. Propriété **exclusive** : `scripts/qa/lib/fixtures.mjs` et les tests du cœur (`scripts/qa/tests/fixtures*.test.mjs`). **Hors périmètre** : `scripts/qa/lib/lifecycle.mjs` (porte d'arrêt, drain, finalisation unique) et `scripts/qa/run.mjs` — inchangés ; `scripts/qa-tracking/**` et `scripts/qa-business/**` — inchangés (lus seulement pour la compatibilité).

## 1. Constat

`Fixtures` (`scripts/qa/lib/fixtures.mjs`) écrit le manifeste par `writeFile(path, JSON, {mode:0o600})` à chaque `track()` :
- **pas d'écriture initiale** : tant qu'aucun identifiant n'a été suivi, aucun `manifest.json` n'existe ; une mutation distante dont la réponse est perdue avant le premier `track()` laisse une donnée sans manifeste récupérable ;
- **écritures non sérialisées** : deux `track()` concurrents (créations en parallèle, `Promise.all`) lancent deux `writeFile` simultanés sur le même chemin — un lecteur (`--cleanup-manifest`, root, un crash) peut lire un fichier tronqué ou mélangé, et l'ordre d'arrivée peut écraser une version plus récente par une plus ancienne ;
- **non atomique** : `writeFile` tronque puis écrit ; un arrêt au milieu laisse un JSON invalide ; pas de `fsync`.

Les harnais qui en dépendent l'ont contourné localement : `scripts/qa-tracking/lib/durable.mjs` remplace `save` **sur son instance** (écriture atomique synchrone + écriture initiale immédiate) ; `scripts/qa-business/lib/fixtures.mjs` (`BusinessFixtures extends Fixtures`) appelle `this.save()` hérité pour ses intentions.

## 2. Exigences

1. **Écriture initiale avant la première mutation** : le manifeste vide (avec `run_id`, contexte, `created_at`) est sur disque **avant** tout appel d'écriture du client service. Mise en œuvre prévue : `creating(fn)` et `track()` attendent une promesse d'initialisation unique (`this.ready`), qui appelle `this.save()` — **la méthode de l'instance**, donc l'override du tracking s'il existe. Aucune écriture dans le constructeur synchrone (pas d'`await` possible), mais `await fixtures.init()` est exposé et idempotent pour les appelants qui veulent l'imposer tôt. Un échec de l'écriture initiale **refuse** la mutation (aucune création sans manifeste).
2. **File d'écriture sérialisée** : toutes les sauvegardes d'une instance passent par une file (`this.queue = this.queue.then(write)`) ; chaque écriture prend un **instantané** (`JSON.stringify`) du manifeste au moment de son tour, pas au moment de l'appel, de sorte que la dernière écriture reflète l'état le plus récent ; une erreur d'écriture est **propagée** à l'appelant de ce `save()` (jamais avalée) et ne bloque pas la file pour les suivants.
3. **Écriture atomique** : fichier temporaire dans le **même répertoire** (`.<nom>.<aléa>.tmp`, création exclusive `wx`, mode **0600**), écriture complète, `fsync` du fichier, `rename` sur le chemin final, `chmod 0600`, `fsync` du répertoire (ignoré sans échec là où non supporté) ; en cas d'échec avant `rename`, le temporaire est supprimé. Un lecteur voit toujours soit l'ancienne version complète, soit la nouvelle complète.
4. **Compatibilité stricte** :
   - `save` reste une **méthode de prototype**, remplaçable par instance : l'override `makeManifestDurable` du tracking (qui affecte `fixtures.save = …` puis écrit tout de suite) continue de fonctionner tel quel ; l'initialisation de la base appelle `this.save()` et utilise donc l'override ; aucune double écriture concurrente entre l'override synchrone et la file de base (la file n'est utilisée que par la méthode de base) ;
   - `BusinessFixtures` (héritage, `intend`/`resolveIntent` → `this.save()`) inchangé ; ses chemins « création perdue » et drain conservent leur sémantique : l'intention est sur disque **avant** la création Auth ;
   - signatures publiques inchangées (`track`, `save`, `creating`, `manifest`, `manifestPath`, `gate`) ; format du manifeste inchangé ; aucune modification de la porte d'arrêt, du drain ni de la finalisation (`lifecycle.mjs`).
5. **Pas de fuite** : contenu du manifeste inchangé (identifiants seulement, aucun secret) ; erreurs d'écriture sans contenu.

## 3. Tests prévus (hors réseau)

1. Base : le manifeste existe sur disque **avant** le premier appel au faux client service (vérifié depuis le faux client) ; `init()` idempotent (une seule écriture initiale).
2. Échec de l'écriture initiale ⇒ la création est refusée, aucun appel au client service.
3. Concurrence : 50 `track()` en parallèle ⇒ fichier final valide JSON contenant les 50 identifiants ; un lecteur qui lit en boucle pendant les écritures ne voit jamais de JSON invalide ni un ensemble d'identifiants régressif.
4. Atomicité : écriture interrompue (faux `rename` qui échoue) ⇒ ancien fichier intact, aucun temporaire résiduel ; mode 0600 du fichier final.
5. Erreur d'écriture propagée à l'appelant de `save()` ; la sauvegarde suivante réussit (file non bloquée).
6. **Override tracking** : vrai `makeManifestDurable` (importé de `scripts/qa-tracking/lib/durable.mjs` quand la branche est intégrée, sinon reproduction fidèle de son contrat dans le test) appliqué à une instance : écriture initiale de l'override, `track()` passe par l'override, aucune écriture de la file de base, fichier cohérent.
7. **Business** : `BusinessFixtures`-équivalent (sous-classe qui écrit une intention par `this.save()` avant la création) : intention sur disque avant l'appel Auth ; création perdue (réponse jamais reçue) ⇒ intention `pending` sur disque, identifiant pré-généré présent ; drain/porte d'arrêt : création refusée après `stop`, ids en vol écrits avant la fin du drain (tests existants de `fixtures.test.mjs` et `lifecycle.test.mjs` verts).
8. Non-régression : tous les tests `scripts/qa/tests/*.test.mjs` et le dry-run de `run.mjs` inchangés.

## 4. Non prouvé

Durabilité réelle sur le système de fichiers de la machine du pilote (sémantique `fsync`/`rename` du volume), crash du noyau ou coupure d'alimentation, systèmes de fichiers réseau. Les tests prouvent l'ordre des opérations et la cohérence observable, pas la persistance matérielle.
