# Recheck harnais métier f372c01

Source exacte `f372c01cccf64fa6efffc44583096d49337173a8`, worktree business propre à l'ouverture et au dernier contrôle ; diff depuis20dd33c. Aucun cloud/credential/install/build/édition source.

## Anciens P2 corrigés et reproductions rejouées

- BUSINESS-REVIEW-001 : finalizeCleanup centralise run/crash/signal/cleanupOnly, agrège intentsunknown/mismatch et collecte indirecte échouée en incomplete ; manifestes résolus sauvés avant suppression. Sauvegarde impossible => arrêt avant DELETE. Les chemins normaux et cleanupOnly utilisent cette fonction et retournent3 si incomplete. Reproduction précédente rejouée : getUser jette, createdvide => **okfalse** et raison d'incomplétude explicite. Des suppressions bornées aux IDs connus peuvent encore être tentées ; aucune affirmation de complétude si découverte inconnue.
- BUSINESS-REVIEW-002 : PDF literals décodés (échappements, octal, WinAnsi/CP1252), EOF désormais requis. Reproduction avec vrai PdfDocument portant AVENANT N°1 : **oktrue**. Tests ajoutés contre writer canonique et renderer complet d'avenant.
- Construction réellement utilisée explicitée dans result/summary : attributable exige sha_verified et build_id_verified ; absence de BUILD_ID ou marqueur n'est plus présentée comme preuve d'un SHA. Un code0 reste insuffisant pour une attribution si ces booléens sont false.

## Nouveau P1 BUSINESS-DISCOVERY-COHORT

`lib/cleanup.mjs:195–215` : la récupération par email ne vérifie jamais que intent.email appartient à manifest.run_id/label avant lecture puis revendication du compte. GET intent.id absent + un résultat findUsersByEmail suffit à pousser l'UID trouvé dans created.auth_users/profiles. La fonction Auth filtre précisément l'email, mais l'email lui-même peut être hors cohorte dans un manifeste altéré/corrompu. Le finalizer sauvegarde ensuite cette nouvelle autorité de suppression et exécute le cleanup privilégié.

Reproduction pure avec vraies fonctions resolveIntents/emptyManifest, sans réseau : manifest.run_id=0123456789ab, intent.id UUIDQA, intent.email=real-user@example.com ; getUser=>null ; findUsersByEmail=>[{id:00000000-0000-4000-8000-00000000beef,email:real-user@example.com}]. Résultat réel : **status=resolved**, UIDbeef ajouté à auth_users et profiles. Il s'agit d'un compte arbitraire hors cohorte admis au nettoyage, pas d'une hypothèse sur le comportement du serveur Auth.

Attendu : valider avant toute découverte que run_id est conforme, label est admissible et email égale strictement la construction canonique `qa-<manifest.run_id>-<slug(label)>@qa.invalid` ; vérifier aussi UUID et email exact renvoyés. Toute incohérence => INCOMPLETE/refus sans autorisation de supprimer l'ID découvert. Ajouter cas email hors domaine, mauvais run/label et résultats malformés ; ne pas supprimer par motif. Pour récupération à ID différent, seule l'identité exacte de la cohorte originale peut autoriser ce nouveau UID.

Le compte déjà explicitement présent dans un manifeste de confiance est un autre cas ; cette découverte ajoute une nouvelle autorisation à partir d'un simple email et doit donc établir son appartenance au run avant cette extension.

## Vérifications

**24 unités PASS**, couvrant les nouveaux finalizers réellement utilisés, sauvegarde avant suppression, cleanupOnly, erreur de collecte, Auth découverte paginée et bornée, vrai PDF writer/renderer. Reproductions indépendantes des deux anciens défauts : corrigées. Reproduction indépendante du nouveau P1 : confirmée (aucune suppression réelle).

Verdict : **pas de feu pour recette cloud avant garde de cohorte de découverte**. Aucune preuve HTTP/browser/métier réelle produite par cette revue ; les tests restent purs et le cleanupFK/stopdrain antérieur est inchangé.
