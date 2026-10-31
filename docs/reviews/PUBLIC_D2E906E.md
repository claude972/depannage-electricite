# Revue publique — d2e906e

Source exacte : `d2e906ef09a41d39bee8ed27dadb8fd41344e1be`, branche `claude/web-design-public`, worktree `/Users/claudebrafa/.codex/worktrees/depannage-claude-planning`. Revue en lecture seule ; aucun appel cloud/Auth, installation, build ou changement applicatif.

## Verdict borné

Aucun P1 ni P2 applicatif identifié dans ce lot de présentation. Code acceptable dans le périmètre revu ; clôture de la preuve de fidélité de l’accueil desktop conditionnée à la correction PUBLIC-CAPTURE-001 ci-dessous. Cela ne valide ni la livraison globale ni les services différés.

## PUBLIC-CAPTURE-001 — P2, preuve visuelle invalide

`docs/visual-fidelity/public-home-1280-after.jpg` (9 331 octets) montre uniquement le spinner « Chargement… » sur fond vide. Le contrat annonce pourtant l’accueil capturé dans les résultats et la liste de captures (notamment ligne 498).

Action : refaire la capture 1280 après avoir attendu le titre et le CTA de l’accueil, puis vérifier le fichier réellement produit. La capture mobile 360 présente le contenu : cette observation ne suffit donc pas à conclure à une panne de l’application.

## Contrôles et résultats

- Tests existants exécutés : `./node_modules/.bin/tsx --test tests/ui/public-lists.test.ts tests/ui/session.test.ts` : **15 réussis, 0 échec**.
- Références réellement ouvertes : M11 (grand format p11), M46 (V3 p15), M38 (V3 p7), M60 (V4 p13), M49 (V4 p2), M63 (V4 p16), V8-C03 (V8 p4) et V8-C05 (V8 p6).
- Structure générale comparée aux captures livrées ; écarts volontaires photos, promesses commerciales, équipe et données légales explicités par le contrat.
- Diff applicatif limité à la coque publique, son module CSS et ses listes. RequestForm/AuthForm partagés et leurs callbacks de demande, connexion, inscription et réinitialisation préservés ; aucun changement API, backend ou permissions.
- Aucun nouveau prix contractuel, SLA, compteur, équipe, certification, coordonnées ou identité légale inventés identifié. Fourchettes issues des catégories existantes et présentées comme indicatives ; estimation, devis et paiement distingués.
- Actions reliées aux callbacks existants ; cibles minimales de 44 px prévues par les règles CSS inspectées. Pas de clipping évident dans les captures inspectées.

## Limites

Pas de nouvelle session navigateur : mesures de 44 px, débordement et console rapportées par Claude non reproduites indépendamment. Le garde-fou `publicStrings()` couvre les listes extraites, pas tous les textes JSX ; les textes JSX ont été revus manuellement. Aucune validation globale, cloud ou paiement déduite de ces tests. Worktree constaté propre au début et à la fin de cette revue.
