# Revue Tracking A10 — cf61dee

SHA exact : cf61dee4f41cc2ca305ea39d550c857e062ae30e. Contratca34cde/A10 lu. Export isolé /private/tmp/depannage-tracking-review-cf61dee-J38QYA. Aucun cloud, credential, fixture distante ou changement source auteur.

Verdict : feu borné pour recette contrôlée ROOT A10 (T9,T14), aucun P1/P2 actionnable trouvé dans ce diff. Les résultats historiques ne sont pas requalifiés.

57 tests Tracking existants PASS, zéro échec/skip. Comprennent les5 nouveaux tests A10, avec vraie reproduction Chromium locale du panneau partage hérité/non partagé ; les tests Auth404, provenance/vrai HTML4c, A8 diagnostic/T8, A9 ordre seed et STOP/drain restent verts. Le dépôt Git temporaire de l'export sert uniquement à la fixture du testCLI.

Source vérifiée : ensureUnsharedMain cible précisément ctx.jobs.main.id et reçoit la page artisanA-ui14 existante. Lecture de shared/control_version/session_id via ctx.api ; si déjà non partagé, aucun stop envoyé. Si partagé, command stop porte version et session courantes, passe par l'API du harnais gardée/intention durable ;200 requis, puis nouvelle lecture shared=false avant uiStart MAIN. Refus stop ou readback encore partagé => BLOCKED ; forme inconnue ou résultat de mutation inconnu => UNKNOWN/BLOCKED, jamais PASS. Le protocole d'intentions/reconciliation existant n'est pas modifié.

L'ancien catch après timeout et second essai sont supprimés. Un seul uiStart MAIN reste, précédé d'ensureUnsharedMain. Assertions conservées au diff : stop répété409, point tardif409, bouton Partager ma position exact sans repli Reprendre, consentement et point, clic Je suis arrivé/arrived200, travel_stage on_site, sharedfalse et positionnull. Les corps T6/T9/T16 restent inchangés ; seul hashT14 est légitimement re-épinglé pour cette précondition.

Les tests d'ordre utilisent le vrai helper sur API injectée ; le navigateur local utilise une reproduction minimale du markup, pas l'application4c réelle. Il prouve l'ordre utile et l'état du bouton dans cette reproduction ; la recette ROOT distante reste nécessaire pour le raccordement réel. Aucune preuve GPS physique extrapolée. LIVE-WORKSPACE/troncature restent hors correctif A10.
