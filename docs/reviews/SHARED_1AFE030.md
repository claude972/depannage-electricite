# Revue SHARED-REV-006

Source exacte : `1afe030b7ca1aca78989d6cfa99ea89ba245dc79`, diff `d425a92..1afe030`, branche `claude/web-shared` (source inspectée dans le worktree partagé). Lecture seule ; aucun cloud, build, installation ou changement de code/tests. Worktree propre à l'ouverture et à la fermeture.

## Verdict

Deux P2 à corriger avant validation de SHARED-REV-006. Aucun contournement serveur ni fuite de contenu A vers B constaté dans ce diff ; le client bound conserve son refus des bundles périmés, mais le nouveau contrôleur ajoute des effets non protégés autour de ce client.

## SHARED006-RETRY-001 — P2 : une ancienne reprise efface les droits du compte suivant

`components/courant-app.tsx:2342–2343` : le client bound retourne null pour une réponse périmée, puis reprobeFeature appelle sans condition setPlatformAccess(access). Scénario : A lance une reprise /me, B est adopté et sa sonde établit ses droits, puis la réponse A arrive ; elle devient null dans bound mais efface les droits de B dans le contrôleur. Ce n'est pas une fuite de données, c'est une mutation de la nouvelle session par une ancienne chaîne.

`components/courant-app.tsx:2332–2333` : un callback conservé de A invoqué après adoption de B en mode live réinitialise aussi la capacité de B à unknown avant que le vieux bundle refuse la requête.

Attendu : liaison du callback à sa génération propriétaire, refus avant toute écriture si périmé, vérification après await ; null stale signifie aucun effet. Distinguer une erreur de la génération actuelle (qui peut retirer les droits) d'un retour stale. Uniquement vérifier la génération courante au démarrage ne couvre pas un callback déjà périmé : la génération doit être celle propriétaire du bundle/callback.

## SHARED006-RETRY-002 — P2 : aucune reprise plateforme après un 503 avec droits déjà chargés

`components/role/platform-anchor.tsx:32–48` : le nouveau bouton se trouve uniquement dans la branche !platformViewAllowed(access, view). Avec /me déjà réussi et droits valides, une requête finance/opérateurs/modération qui retourne 503 fait passer la capacité à unavailable tout en conservant access nonnull. La branche autorisée est donc conservée et rend le Gate du leaf.

`components/features/platform-operations/shared.tsx:69–71` : Gate rend alors Unavailable sans bouton de reprise. Le nouvel ajout ne couvre donc que l'indisponibilité initiale de /me, pas le scénario courant d'une panne après chargement des droits.

Attendu : état unavailable avec reprise dans la coque plateforme même quand access précédent autorise la vue ; conserver le refus de rendre les données pendant indisponibilité. Le retry relit /me et laisse la réponse serveur décider des droits.

## Tests et limites

Commande : `./node_modules/.bin/tsx --test tests/ui/features.test.ts tests/ui/identity.test.ts tests/ui/guard.test.ts` : **28 PASS, 0 échec**.

Les tests antérieurs couvrent meaningful les refus de bundles périmés avant requête et les retours tardifs des clients. Le seul test ajouté dans ce checkpoint vérifie retryableState, un helper qui n'est pas utilisé par FeatureUnavailable/reprobeFeature ; il ne teste pas les nouveaux effets du contrôleur ni le rendu de reprise plateforme.

Tests de correction attendus : (1) reprise A retardée puis adoption de B et réponse B, ensuite retour A null : droits/capacités B inchangés ; (2) vieux callback A invoqué sous B : aucun effet ni requête ; (3) droits plateforme valides puis 503 d'un leaf : bouton de reprise effectivement disponible et sonde /me réémise, succès ou refus respecté.

Notifications : le nouveau callback ne met à jour le compteur que si summary nonnull ; bound écarte le contenu périmé. Aucune nouvelle mutation de contenu de notification/article après identité identifiée dans ce diff. Le setCapabilities de début de reprise reste concerné par RETRY-001 pour tous les lots. Contrôles des hints site/devis restent côté serveur ; aucun nouveau droit accordé par la reprise.
