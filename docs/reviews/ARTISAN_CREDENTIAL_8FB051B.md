# ART-CREDENTIAL-001 — recheck 8fb051b

SHA exact 8fb051b9d187529f485be39dc96f93fbdc77de02, checkout design propre. Diff depuis c653bc4 lu par commit ; helper, tous appels et tests vérifiés. Aucun serveur/cloud/build/credential ni source/test modifié.

Verdict : ART-CREDENTIAL-001 fermé dans le périmètre UI. Feu pour merge8fb et M65 déjà revu ; aucun nouveau P1/P2 établi.

credentialState est désormais pur et ne reçoit plus application_status. Il choisit la dernière pièce du type demandé et ne retourne que Manquant, Transmis ou À renouveler suivant présence/expiration. Plus de clé valid, tag Validé ni vert par pièce. Tous usages Documents/Candidature/Profil passent les trois paramètres corrects ; les commandes de liaison et permissions ne changent pas. N/3 reste un compte de pièces transmises, y compris expirées, jamais un taux de validation. Le statut global de candidature apparaît séparément dans l’en-tête.

Tests exécutés : tests/ui/artisan-lists.test.ts,14 PASS/0 échec. Pièce nouvelle sans statut d’approbation => Transmis ; expirée => À renouveler/Expiré le ; dernière pièce du type gagne ; absente reste Manquant.

Capture artisan-documents-1280-credential.jpg consultée : candidature approuvée séparée, nouvelle pièce Transmis bleu, ancienne assurance À renouveler ambre avec date expirée, qualification Manquant rouge,2/3 pièces transmises. Données injectées dans la démo et explicitement signalées ; pas une preuve de téléchargement/liaison réelle. Capture360 fournie mais non réinspectée lors de ce recheck.

Aucun changement serveur requis pour cette correction de présentation ; le maintien d’application_status lors d’un nouveau link ne vaut plus validation individuelle. Pas de recette connectée, de conformité des pièces ou de mesure DOM indépendante annoncé.
