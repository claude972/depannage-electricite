# Revue bornée expiry — aee66b0db5b8a9599c39c246c28aeef904fca126

Verdict code : acceptable pour intégrer la qualification OBSERVED/INCOMPLETE ; aucun P1/P2 identifié dans le changement685bd20 et les seuls compléments documentaires f6c35b6/aee66b0. Cela ne ferme pas le critère expiration spécifique et ne constitue aucun nouveau test cloud. Worktree propre, aucun fichier modifié.

Diff exact83fdad9..aee66b0 : quatre fichiers,96 ajouts/9 suppressions ; changements fonctionnels dans scripts/qa-gateway/lib.ts et tests uniquement. Pas d’Edge, migration, Auth/provider ni source app modifiée par cette livraison.

Preuves source :
- lib.ts803 : EXPIRED_PLATFORM_CODES reste vide ; ligne1052 enregistre UNAUTHORIZED_ASYMMETRIC_JWT dans une constante séparée d’observation uniquement. Aucun code générique épinglé comme expiration.
- lib.ts1056–1060 : absence de réponse ou HTTP5xx => incomplete ; tous les autres résultats passent par assertExpiredRefusal.
- lib.ts1062–1092 :2xx/422 ajoutent un motif de FAIL ; status autre que401 également ;401UNAUTHORIZED_NO_AUTH_HEADER/INVALID_JWT_FORMAT => FAIL ; autre UNAUTHORIZED_* avec enveloppe structurée et sans fuite => observed tant que la liste strictement liée reste vide. Enveloppe de fonction401 demeure le cas PASS préexistant, inchangé dans ce diff.
- lib.ts1249–1263 : exception de probe capturée ; incomplete donne cleanup:true uniquement après preuve de cohorte/UID déjà enregistrée, sans consommer le bail. Pas de suppression d’identité non validée ajoutée.
- computeVerdict815–831 : tout failed step/cleanup/leftover conserve prioritéFAIL ; outcomeobserved => observed, outcomeincomplete => incomplete ; aucun de ces états n’est transformé enPASS. Le runner rend1 pour incomplete et0 pour observed avec libellé explicite, pas promesse PASS.
- run.mjs165–166 applique toujours le redactor aux détails, y compris message de transport.

Preuve privée déjà acquise, lue uniquement via métadonnées/caviardage : result.json dans /tmp/depannage-gateway-expiry-6466-verify rapporte modeexpiry-verify/verdictobserved/outcomeobserved/codeUNAUTHORIZED_ASYMMETRIC_JWT ; début2026-10-31T19:06:31.436Z, fin19:06:39.057Z, marge atteinte depuis19:06:23.000Z. Huit cleanupok, zéroleftover. independent-postflight19:07:38.596Z : originalConsumedtrue,Auth404,quatreportéescount0/HTTP200,Storagecount0/HTTP200,cleanupProventrue. Ce rapport indépendant indique JWKS200/matchingKeyPresent/signatureVerified/claimsMatchLease/expiredByAtLeast60s tous vrais. Je n’ai pas relu le JWT/bail ni revérifié cryptographiquement sa signature ; aucun nouvel appel réseau n’a été effectué.

Vérifications exécutées : /tmp/depannage-web-pwa-local-qa/node_modules/.bin/tsx --test tests/qa-gateway-expiry.test.ts tests/qa-gateway-runner.test.ts =>23PASS/0SKIP ; vrai code de classification et cycle runner sous faux réseau/horloge, aucun Supabasecloud. node --check scripts/qa-gateway/run.mjs =>PASS. Aucun déploiement.

P3 documentaire restant : docs/CLAUDE_GATEWAY_REMAINING_QA_CONTRACT.md66 contient encore la formulation «401 plateforme UNAUTHORIZED_* (pass)», contredite par sa suite et §1.4bis. Remplacer cette seule description par OBSERVED pour code générique/non lié ; ne pas modifier les critères de code pour aligner cette vieille phrase. Ce P3 n’invalide pas la bonne qualification réelle §1.4bis.

Limites : OBSERVED montre le refus effectif d’un jeton réel expiré sous un code générique ; aucune attribution causale spécifique à l’expiration à partir de ce seul code. Bail consommé et nettoyé ; aucune nouvelle cohorte/verify autorisée ou nécessaire pour cette revue.
