# A8 diagnostic — correctifs 1225f28

SHA exact : 1225f2899b521ff131016df0b21f62d8dd5540a4. Amendement ce4252e §8 appliqué. Export isolé /private/tmp/depannage-tracking-review-1225f28-g6ZgD3. Aucun cloud ni source auteur modifiée.

Verdict : P2 raison finie et P3 stop fermés. Aucun P1/P2 restant dans cette revue A8 ; feu diagnostic ROOT contrôlé T6 public selon l'ordre et la cohorte prévus. Le diagnostic ne constitue pas une résolution anticipée de T6 ou une preuve GPS physique.

48 tests existants PASS, zéro échec/skip. Vrais Chromium locaux : diagnostic sans requête/navigation supplémentaire, conservation identité/page, absence de fuite reason inconnue, T8 phrase entière+Resume et négatifs. Auth404 exact, provenance, durabilité, STOP/drain/réponse perdue et provider avant T19/pool révoqué restent verts.

Source : KNOWN_REASONS contient l'ensemble fini documenté ROUTE_REASONS + tracking_changed/application_quota ; inconnu => constante other. Une raison absente/invalide/trop grande ne transmet pas de texte arbitraire.

Après screenshot et après evaluate, captureDiagnostics relit stopping et marque truncated stopping ; aucune prochaine lecture DOM ou autre page après stop. Le JSON local borné de l'état partiellement capturé reste autorisé par le contrat. Les tests ont les deux cas signal pendant screenshot et pendant DOM, et préservent FAIL initial.

Probes indépendantes réexécutées sur les vrais exports : boundedReason(private_token_from_upstream) retourne other ; screenshot qui déclenche SIGINT puis rejette => zéro evaluate, zéro screenshot page suivante, résultat truncated stopping. Toutes les opérations de ces probes sont en mémoire/temporaire local, sans réseau.

T6/T9/T14/T16 et la logique de session/ordre/T8 n'ont pas été modifiés par ce correctif. Leurs assertions restent identiques au checkpoint A8 revu ; aucune reconnexion/navigation/correction de données n'est introduite par le diagnostic. Le dépôt Git de l'export sert uniquement à la fixture du test CLI.
