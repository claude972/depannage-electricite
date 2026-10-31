# Relecture ciblée des correctifs — quatre lots

Lecture seule des diffs exacts ci-dessous et exécution des tests existants uniquement. Aucun code/test nouveau, mutation cloud, migration appliquée ou raccordement global accepté. Les changements d’autres missions ne sont pas couverts.

## Planning b26bc45 contre dac7505 — priorité avant application016

**Findings ciblés corrigés dans le périmètre source/SQL isolé.**

- `notifications.support_ticket_id` est maintenant renseigné par les deux triggers support. `notification_scope_visible(...,p_support_ticket)` utilise le prédicat courant011. RLS, API liste, résumé, read/unread/read_all et leur compteur utilisent ce lien : le sujet copié dans la notification n’échappe plus au retrait d’accès au ticket/dossier.
- Préférences : verrou advisory stable par utilisateur pris avant lecture de la version, puis CAS dans ON CONFLICT WHERE version attendue ; absence de ligne mise à jour entraîneP0001. Deux premières sauvegardes attenduesversion0 ne peuvent pas écraser silencieusement la première.
- Script existant `tests/sql-planning-review.mjs` exécuté : **PASS, exit0** sur migrations001–013+016 et stubs Auth/Storage. Cas de retrait de site/membre, réaffectation, lecture/compteurs/marquages support et première sauvegarde concurrentielle simulée passés.
- Suites existantes `tests/planning/*.test.ts` + `tests/notifications/*.test.ts` : **PASS, exit0**.
- Limite : la preuve prefs est séquentielle + inspection du verrou, pas une course réelle multi-session. Le script le déclare. Aucun apply distant autorisé par ce seul rapport ; le pilote contrôle le SHA complet et l’ordre d’intégration.

## Documents5960ad9 contre adb3152

**Continuation après le deuxième await : corrigée dans le périmètre testé.**

- `executeCommand` dans `lib/features/quote-documents/panel-model.ts` vérifie isCurrent après command puis après load. Un résultatnull ou une portée changée retournefalse ; aucun succès n’est dispatché. La lecture fraîche précède command_done.
- `QuoteDocumentsPanel.run` utilise réellement ce helper avec la clé montée capturée. Le callback appelant ne reçoit true que si commande et relecture sont courantes.
- Tests existants panel-model/panel : **16/16PASS**, dont changement pendant deuxième await, null de commande/relecture, erreur périmée, succès courant et rendu en lecture seule/démo.
- Limite : ce recontrôle ne remplace pas une recette React/Supabase après raccordement ; aucune validation globale de tous les callbacks ou téléchargements n’est revendiquée.

## B2B3c7aeff contre603ce12

**B2B-SLA001 et B2B-UI002 : corrigés dans le périmètre code/tests.**

- Snapshot017 renvoie toutes les pauses de chaque case et pauses_total. La donnée est transmise à evaluateSlaCase ; une discordance rend les pistes non mesurables avec pauses_incomplete. Les visites restent bornées20 mais visits_total et l’indication de troncation sont ajoutés.
- Le test SQL inclut55 pauses, dont une ouverte, toutes présentes au snapshot. Le calcul ne repose plus silencieusement sur les50 premières.
- `applyLoadResult` retire report sur refus/erreur. Null périmé conserve seulement un affichage gelé, signalé visiblement ; `resolveAuthority(...,stale)` ferme toutes les écritures. Le composant est réellement raccordé à ces décisions.
- Suites `tests/site-operations/*.test.ts` : **30/30PASS**. Script SQL site-operations : **12 groupesPASS**, exit0, stubs explicites.
- Limite : pas de recette montée403/retrait sur base réelle dans cette exécution ; pas de déclaration de toutes les fonctions B2B terminées.

## Finance782ce0d contre0b92a7a

**Readiness liée à la cible et TVA cumulée des avoirs : corrigées dans le périmètre testé.**

- ReadinessModel lie résultat à paiement+basis+scope et à la requête en attente. Changer la saisie invalide la préparation ; résultat d’une autre cible ignoré. Le bouton Émettre utilise la cible vérifiée stockée, et les champs sont désactivés pendant l’action.
- SQL014 calcule sous verrou paiement la TVA du nouvel avoir par différence du prorata cumulé et de la TVA déjà créditée. Le total des TVA ne dépasse pas celui de la facture ; la dernière fraction absorbe l’arrondi. Les plafonds de montant restent appliqués.
- Tests platform-operations : **19/19PASS**. SQL plateforme : **12 groupesPASS**, exit0, dont fractionnement33/33/34 et petits avoirs puis solde, cumulTVA17centimes exact.
- Limite : aucun remboursement/Stripe/PDF fournisseur réel exécuté. Les tests de machine de readiness n’établissent pas la conformité de tous les raccordements de la coque.

## Verdict global borné

Aucun nouveau finding bloquant identifié dans ces quatre diffs ciblés. Les findings nommés peuvent être marqués vérifiés pour leur niveau de preuve source/tests isolés ; ne pas fermer les critères de recette réelle non exécutés. Les contrats et interfaces complets restent soumis à leur revue séparée et au raccordement final.
