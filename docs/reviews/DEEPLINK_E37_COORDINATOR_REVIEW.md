# Revue délimitée coordination pure — e37e2a9

SHA exact `e37e2a976f8aa268948a9e60eb0d60324e5cf132`, checkout shared propre avant/après. ContratsA1–A4 relus. Périmètre : components/app/workspace-refresh.ts etdetail-resolution.ts, leurs tests ; pas de verdict sur hook/coques/readWorkspace ni applicationHTTP des résultats, revus par l’autre reviewer.

**Verdict : aucun P1/P2 identifié dans ce périmètre, intégrable sous réserve de l’autre revue. Un P3 de politiqueLRU ci-dessous.**

## Coordination

- Barrière par défaut pour chaque cause : need monotone, read.startedAt pris au départ effectif et contextecapturé. UnA commencé avantmutation/realtime/focus/manual/deeplink n’acquitte pas le nouveau waiter ; une seulelecturetraînante démarre ensuite avec checkpointactualisé.
- Démarrage microtask coalesce les causes avant départ ; flight empêche lectureconcurrente. Toute nouvellecause aprèsdépartB attendC plutôt que d’être satisfaite parB. La file de lectures reste unvol+untrain, pas une lecture parcause.
- Changement decontexte/génération : ancienswaiters superseded, nouveaucontexte attend sa proprelecture. Résultat superseded du mêmecontexte résout leswaiters éligibles au lieu de relancer à l’infini ; pas d’autrelecture sanscauseattendue.
- Exceptionssynchrones et rejetsPromise sont mappésfailedstatus0 ; failed503/0, signed_out etsuperseded sont distincts de loaded. Ce module consomme un ReadResult typé ; conversiondu vraiHTTP401/corpsinvalides et rejetd’applicationdonnéesanciens restent responsabilité de readWorkspace et de la revueUI, pas revendiqués ici.

## Mémoire et décisions

Present→show ; démoabsent→not_found sansréseau ; liveabsent sansattempt→refresh, pending→loading, failed→error. Seul attemptloaded autorise not_found. Les fonctions pures ne déclenchent aucune nouvellelecture quandfailed ; bouton/retry duhook horsscope.

Mémoire bornée32 par défaut, clés contexte/vue/id, reset complet au changement decontexte. **P3 : get() ne met pas à jour la récence**. Malgré l’étiquetteLRU, unID lu fréquemment reste le plusancien selon sa dernièreécriture et peut être évincé. Repro : hotset +31coldsets,10get(hot),set(new) ⇒ hotabsent,size32. Corriger get pour promouvoir ou qualifier la politique comme dernièreécriture ; effet attendu actuel = lecturescausales supplémentaires lorsdevisitesfréquentes, pas mélangecontexte ni fauxnot_found. Le test auteur fait get PUIS set surhot et ne couvre pas cette propriété.

## Vérifications exécutées

`tsx --test tests/ui/workspace-refresh.test.ts tests/ui/detail-resolution.test.ts` : **18PASS,0échec**. Source exact propre confirmée.

Script indépendant `/tmp/depannage-refresh-e37-adversarial.ts` sur snapshotgitarchive `/var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-refresh-e37-review-284u_za0` : **50bursts adversariaux PASS**. Pour chaqueburst : plusieurscausessync→A ; causesaprèsdépartA→B ; causeaprèsdépartB→C, Bfailed503 ou superseded ; assertoracle sur toutloaded checkpoint≥barrière et contexteexact ; maximumvol1 ; changementg1/org1/site1→g2/org2/site9 pendantA ne satisfait pas nouveauwaiter avecA. Pas de lectureadditionnelle sansnouvellecause. RejetPromise supplémentaire→failed0 puisrequêteexplicitesuivante récupère. ReproLRU ci-dessus confirme leP3.

Aucun cloud, API, navigateur, installation, build, credential, test/sourceapp modifié. Ce rapport ne prouve ni circuitpostmutation effectif, niRealtime, ni états coques ; cesgates restent à root/reviewerUI et à la recette réelle.
