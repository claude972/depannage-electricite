# Revue métier docs/B2B

Source exacte `20dd33ce7c1c1122a9d5ea83f0da7393f8fdee3f`, worktree depannage-claude-b2b constaté propre. Sources fixtures/auth/cleanup/orchestration/runner/build/PDF et assertions suites lues, confrontées aux migrations015/016/017 et au writerPDF. Aucun cloud/credential/install/build/édition source.

## Verdict : deux P2 confirmés à corriger avant recette réelle

### BUSINESS-REVIEW-001 — P2 : les lectures inconnues d'intents ne rendent pas le cleanup incomplet

`lib/cleanup.mjs:188–212` renvoie des résultats unknown/mismatch/absent pour les créations Auth à issue inconnue. `run.mjs:189` ignore le tableau retourné puis lance runCleanup ; la lecture indirecte qui échoue est également seulement loguée (184–186). `cleanupOnly` ignore de même le statut de résolution et ne réécrit pas les IDs résolus dans le manifeste avant suppression.

Scénario concret : Auth création timeout, intent durable pending ; lookup Auth timeout lors du nettoyage ; created vide. Reproduction locale avec les vraies fonctions, sans réseau : resolveIntents=>unknown, suivi runCleanup=>**ok:true,steps:0**. Le compte potentiellement créé n'a pas été établi absent et le résultat annonce pourtant complet. Selon la classification d'erreur de setup, le run peut finir ANOMALY/code0 ; cleanupOnly peut aussi retourner0. Le manifeste conserve l'intent mais le verdict masque le reliquat inconnu.

Attendu : unknown ou mismatch => INCOMPLETE/exit3, manifeste actionnable et sauvegardé avant toute suppression nouvellement autorisée. Une collecte indirecte inconnue doit empêcher une affirmation de nettoyage complet. Ne supprimer aucun UID par intuition/pattern et ne traiter un GET au seul pré-ID comme preuve d'absence si la possibilité d'un ID différent n'est pas exclue par le contrat Auth réellement vérifié.

Le chemin nominal suit bien l'ID renvoyé par Auth (fixtures48–52), même s'il diffère du pré-ID ; mais la récupération timeout n'interroge que intent.id. Le client Auth transmet id sans établir ici que le serveur garantit ce choix : c'est une précondition à prouver ou un mécanisme de découverte exacte à compléter, pas une affirmation que le vrai serveur ignore id.

### BUSINESS-REVIEW-002 — P2 : faux FAIL sur un vrai PDF d'avenant

`lib/pdf.mjs:inspectPdf` cherche les chaînes attendues directement dans les bytes latin1. `suites/docs.mjs:276` attend « AVENANT N° 1 AU DEVIS ... ». Or le writer canonique pdfStringLiteral (`lib/features/quote-documents/pdf-writer.ts:33–38`) encode les caractères hors ASCII en octal : ° devient \\260. Le titre réellement écrit ne contient donc pas le caractère ° brut.

Reproduction indépendante avec PdfDocument canonique (une page portant le titre exact), build réel, puis inspectPdf : headerPDF+EOF valides, expected heading dans missing et ok:false. Le test unitaire actuel compose des faux bytes, ne croise pas le vrai writer. Décoder les text literals PDF/extraire le texte, puis tester contre le writer canonique et préserver les contrôles de référence/montants/ETag/no-store.

## Autres observations bornées

- Aucun administrateur créé par le lot. Intents persistés avant l'appel Auth et mots de passe absents du manifeste ; l'ID effectivement reçu est suivi. Seeding service_role explicite pour validité passée/réaffectation et retrait de grant, données QA déclarées.
- Les suppressions utilisent seulement UUID/sites/organisations du manifeste ; plan étendu enfants015/016/017 avant parents, Storage avant documents, Auth dernier. L'ordre correspond aux colonnes/FK inspectées (notamment pauses.site_id présent). Unknown delete/readback stoppe bien les opérations suivantes ; ce garde ne reçoit simplement pas les unknown issus de la découverte d'intents/collecte.
- Stop gate/drain hérités entourent les créations ; navigateur fermé avant finalisation normale. Le modèle finally est testé avec fakes par orchestrate ; main non exporté n'est pas exercé en lifecycle complet dans ces tests. Ne pas en déduire une protection réseau réelle vérifiée.
- Build mismatch explicite donne FAIL, mais absence de BUILD_ID local ou de marqueur servi demeure seulement verified:false et les suites continuent. Root doit disposer d'un build identifiable et vérifier build_id_verified=true pour attribuer les résultats à un SHA précis ; le code0 seul ne le prouve pas.
- Les assertions métier ont une valeur réelle : documents via route privée/PDF téléchargé, snapshot/validité/montants, acceptation et avenant séparés des paiements, tiers/ancien artisan/refus ; B2B versions périmées409 sans mutation, cloisonnement organisations, lecteur sans POST, retrait de grant403 et données périmées absentes. Les limites de couverture sont listées (pas concurrence deux onglets, SLA complet/publication, refus/retrait avenant, pas finance/Stripe).
- inspectPdf calcule has_eof sans l'inclure dans ok : limite de validité structurelle, à renforcer sans prétendre qu'un header suffit à valider tout un PDF.

## Vérifications exécutées

`tsx --test tests/qa-business.test.ts` : **17 PASS, 0 échec**. Deux sondes pures indépendantes ci-dessus confirment les deux P2 sans cloud. Une première invocation de la sonde writer utilisait un mauvais nom de méthode (bytes au lieu de build), corrigée puis résultats confirmés ; aucun fichier source changé. Les tests existants ne couvrent ni l'agrégation des intents unknown dans le vrai finalizer, ni l'avenant rendu par le vrai writer.
