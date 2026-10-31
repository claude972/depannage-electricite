# Revue C05/C08 dc79506

SHA exact dc79506ce312749233f4d8a4aca4613faf06b36d, checkout documents propre. Diff d5c1f39..dc79506 (e83d359C05 puis C08), source/helpers/tests/CSS et contrat lus. Aucun build/cloud/credential/source/test modifié.

## P2 — échéances inconnues présentées comme zéro

components/role/enterprise-space.tsx:1153 calcule overviewFigures(scope,…) sans état de disponibilité ; la nouvelle tuile Échéances à30jours à1190 affiche toujours figures.deadlines30. scope.compliance vient de session.professional ; avant chargement et après premier échec /api/professional, cette collection est vide. loadProfessional conserve EMPTY_PROFESSIONAL et pose capabilities.professional unknown/missing/unavailable selon résultat ; OverviewView ne consulte jamais cet état. Une panne ou un contrat absent devient donc visuellement0 contrôle/maintenance plutôt qu’une donnée inconnue. Le sous-titre Données chargées renforce cette impression.

Correction : dériver le rendu de la tuile du même état de contrat que les alertes de sites ; afficher en lecture/inconnu/indisponible tant que professional n’est pas available, et0 seulement pour une collection chargée réellement vide. Si une ancienne collection est conservée après échec, qualifier explicitement son ancienneté/indisponibilité sans annoncer un chiffre actuel. Test négatif à demander Claude : professional unavailable avec compliance=[] ne doit pas produire une valeur métier0 ; available avec[] doit bien afficher0. Ce n’est pas une règle d’accès, mais une vérité de donnée nouvelle au checkpoint.

## Vérifications positives

- buildScope limite sites/interventions/devis/compliance au périmètre actif. overviewFigures compte les seuls dossiers ouverts marqués urgency=urgent et due_on non terminés entre aujourd’hui etJ+30 inclus ; aucune consommation/tendance/garantie construite. Bornes et exclusion échéance dépassée/complétée testées.
- siteBudgetBars associe les devis acceptés aux IDs d’intervention du site. ratio150 affiché150 et width100 ; budget nul =>ratio null/largeur0 et libellé pas de référence. Montants TTC sont indiqués comme calculés sur les dossiers chargés ; pas prix ou budget annuel inventé.
- C08 : QuoteDocumentsAnchor déplacé avec JSX/props identiques (quoteId, authority canWriteSite(decisionSiteId), reason, org/site) ; nouveau wrapper seulement. Commandes/règle owner/viewer/read-grant et décision pending restent inchangées. Aucune promotion en écriture par le déplacement.
- Contrôles locaux44, KPI cinquième visible sur mobile, noms/montants repliables et section documents pleine largeur. Pas de primitive commune/API modifiée.

## Preuves et limites

Tests : tests/ui/enterprise-lists.test.ts,17 PASS/0 échec. Le nouveau helper ne reçoit pas la disponibilité ; les tests actuels n’exercent donc pas le P2 ci-dessus.

Références véritables consultées : V5-C05 volume5/page6 et V5-C08 volume5/page9 (images p6.jpeg/p9.jpeg). Captures enterprise-overview360 et enterprise-approval1280 après consultées. L’ordre C08 détails/décision puis documents/historique est cohérent avec la référence ; pas de faux rôle d’acteur ou conformité ajouté. Les captures restantes fournies ne sont pas de nouvelles preuves indépendantes de ce reviewer.

Aucun montage React, mesure DOM44, test clavier, session viewer/read-grant réelle ou refus serveur exécuté. Ni captures de démo ni tests purs ne valent validation globale. C08 n’a pas de nouveau P1/P2 établi ; C05 reste ouvert au P2 de disponibilité. Intégration de travail possible, clôture globale non recommandée avant correction.
