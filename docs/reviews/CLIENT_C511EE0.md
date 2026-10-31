# CLIENT-HISTORY-001 — recheck c511ee0

SHA exact c511ee0b5d9230bcf971a34f2517a3ff67d880e7, checkout documents propre. Diff exact depuis4a2ab70 et helpers/tests lus ; aucun WIP/code/test/cloud modifié.

Verdict : finding fermé dans ce périmètre. isSettled exige status=paid ET paid_at renseigné. detailHistory donne alors done à toutes les entrées ; currentStepIndex renvoie CLIENT_STEPS.length et le contrôleur lui passe le vrai i.paid_at. Sans timestamp, paid conserve une étape non confirmée ; completed avec timestamp ne suffit pas à confirmer le règlement.

Vérification exécutée : tests/ui/client-lists.test.ts,5 PASS/0 échec. Régression négative paid sans timestamp et completed avec timestamp couverte. Capture client-detail-1280-after.jpg mise à jour inspectée : dernier paiement Terminé, stepper tout coché, reçu confirmé cohérent. Capture360 remplacée par Claude mais non inspectée indépendamment lors de ce recheck.

Limites : aucun nouveau parcours connecté ni paiement exécuté ; le champ paid_at provient du serveur et la revue ne valide pas ici son émission Stripe. Aucun verdict global hors correction terminale.
