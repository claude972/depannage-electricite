# Revue app deep-link refresh — e37e2a9

SHA exact : e37e2a976f8aa268948a9e60eb0d60324e5cf132. Contrat docs/CLAUDE_DEEPLINK_REFRESH_CONTRACT.md A1–A4 lu. Export isolé /private/tmp/depannage-deeplink-review-e37e2a9-CW8Pr4. Revue lecture seule, aucun cloud, aucune source auteur modifiée. Skill vercel-react-best-practices lu pour le raccordement React.

## P2 — un HTTP200 workspace incomplet devient une preuve loaded d'absence

components/courant-app.tsx:229–259 (readWorkspace) ne valide que ws.profile. Un corps200 {profile:{id:identité_courante,role:'client'}} sans aucune collection passe, se fusionne dans EMPTY_WORKSPACE puis retourne loaded. Le nouveau hook traite ce loaded comme preuve et peut rendre introuvable alors que le serveur n'a fourni aucune liste valide des dossiers. Un corps200 {} est traité comme401 et déconnecte la session, bien qu'aucun401 n'ait été reçu. A1 exige failed pour invalid body, et seul loaded valide prouve absence.

Reproduction réelle sans réseau : extraction du corps exact readWorkspace du commit, retrait seulement des annotations TS/générique api, API et setters injectés. Premier corps ci-dessus => {kind:'loaded'}, setData avec interventions/organizations/sites vides venant de EMPTY_WORKSPACE ; second {} => {kind:'signed_out'}, clearSessionState appelé1fois. Aucun corps applicatif fictif n'a été codé à la place du contrôleur.

Correction : valider le schéma workspace minimal nécessaire (profil/id/role et toutes les collections utilisées), avant tout setData/setRole/setMode/validateContext. Un200 invalide => failed statut0/erreur de protocole, sans vider les données ni transformer ce200 en session expirée. VraiHTTP401 conserve le reset existant.

Tests requis du vrai raccordement contrôleur/API : réponses valides,200profil-seul,200{},null/mauvaises collections,503/transport/401 et arrivée tardive. Les nouveaux tests actuels injectent directement ReadResult au coordinateur : ils prouvent son algorithme, pas la classification ni l'application d'une réponse API dans readWorkspace. Ce manque explique le P2 observé. Extraire le vrai lecteur dans un module testable est possible sans changer API/SQL.

## P3 — libellé Actualiser toujours visible (A2)

components/role/client-space.tsx:377–387 affiche Connecté quand SUBSCRIBED ; Actualiser n'existe alors que dans title='Actualiser les données', pas dans le texte visible. Le bouton reste fonctionnel et le badge En direct est bien supprimé. A2 demande l'action Actualiser visible dans tous les états : conserver Connecté et ajouter un libellé visible de rafraîchissement. Ce point seul n'est pas un blocage sécurité.

## Contrôles et limites

- 18 nouveaux tests purs PASS : barrières par défaut post-write/realtime/manual/deeplink, batch même microtask, un seul vol + trailing coalescé, changements de contexte/identité, erreur503/transport/throw/signed_out/superseded, mémoire bornée32 et décision erreur≠absence.
- 47 tests UI existants ciblés PASS : guard, identity, session, revalidate, features. Total exécuté65, zéro échec/skip.
- Coordinator : aucune attente circulaire trouvée ; chaque cause active prend ++checkpoint, début différé capture checkpoint courant ; un événement pendantA attendB. Les appels refresh existants utilisent ce défaut via wrapper conservant Promise<void> ; pas de bypass direct readWorkspace ailleurs ajouté.
- Hook branché dans les trois détails avant leur état introuvable. Client utilise ses propres rows ; artisan sa liste de dossiers ; entreprise exactement c.orgInterventions déjà utilisée par DossierView (organisation active, accès détail historiquement indépendant du filtre site), sans nouvel élargissement de droits ni API directe.
- Mémoire par identité/role/org/site/vue/id, limit32, contexte différent efface les tentatives. Erreur503=>erreur explicite, tentative terminée ne relance pas automatiquement ; superseded devient erreur bornée, pas boucle.
- Tests du hook lui-même/de ses effets React non fournis ; ne pas présenter les tests de fonctions de décision comme une preuve d'intégration React. Pas de navigateur applicatif exécuté ici.
- Aucun API/SQL/dépendance/tracking-leaf/prototype changé dans le diff.
- LIVE-WORKSPACE-001 livraison Realtime reste OPEN selon contratA4. Le correctif de lien profond ne prouve pas livraison Realtime.

Verdict : pas feu intégration avant le P2 invalid-body corrigé et le raccordement testé. Revue bornée uniquement ; le run GPS public4c en cours ne doit pas changer d'app pendant son exécution.
