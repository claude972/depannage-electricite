# Revue du harnais avancé 4be763a

Verdict borné : aucun blocant concret établi pour une exécution API contrôlée, après revue du pilote. Ne vaut ni résultat connecté, ni validation navigateur.

Source exacte : 4be763abcf02fac040846164536f6a5255205763, checkout propre /Users/claudebrafa/.codex/worktrees/depannage-codex-planning-qa. Lecture intégrale de scripts/qa-advanced/{core,run,scenarios}.mjs et tests/qa-advanced.test.ts. Références FK/permissions recoupées dans migrations 011 et 016 du checkout planning et 014 du checkout plateforme ; aucune migration modifiée.

Test exécuté : node --experimental-strip-types --test tests/qa-advanced.test.ts ; 13 tests PASS, zéro échec. Les tests utilisent faux clients/fichiers temporaires et un dry-run CLI sans réseau. Aucune exécution cloud effectuée.

Contrôles positifs établis :
- Préflight : fichier privé, projet/origine Supabase concordants, origine application explicitement autorisée, SHA complet concordant avec checkout servi, sortie hors Git. Ceci vérifie le checkout déclaré et pas à lui seul le contenu HTTP réellement servi.
- Cohorte : six utilisateurs client/manager/artisan ; aucun admin ou grant opérateur, paiement ou ledger. Donc aucune dépendance à la suppression du dernier admin introduite par 014.
- Service key uniquement dans les requêtes de semis/readback/cleanup serveur ; utilisateurs RPC avec publishable_key et leur propre bearer. Les arguments injectés dans page.evaluate ne contiennent ni service key ni objet credentials. Tokens/mots de passe enregistrés auprès du redacteur.
- Mutations admises suivies dans Gate, intention persistée avant requête, complétion après inscription des UUID. Finalisation idempotente ferme la porte, attend les mutations suivies ; délai dépassé = aucune suppression. Transport mutation inconnu, 5xx ou réponse mutation illisible = manifeste conservé et cleanup refusé. Le refus n’est pas transformé en faux nettoyage réussi.
- Races : Promise.all avec deux sessions du même UID, vérification des intervalles HTTP qui se chevauchent, exactement un succès et un conflit explicite, puis readback de la ligne gagnante. Ce sont de vrais appels HTTP concurrents prévus, pas une simulation SQL ; leur résultat reste à obtenir.
- RLS : autre artisan sans accès aux règles privées ; client sans planning artisan ; retrait de grant site retire ticket lié/notification/créneaux, conserve le ticket personnel et empêche le marquage de la notification liée.
- Cleanup : borné aux UUID suivis et UID cohorte ; notifications/préférences/règles/entrées 016 avant dépendances ; événements/messages support avant tickets ; découverte de créations indirectes avant suppression ; exact-count refusant la troncature ; chaque suppression relue ; Auth seulement si enfants supprimés. Aucun nettoyage de table financière immuable.

Limites : pas d’interruption réelle ni de réponse réseau perdue testée ici ; le signal attend le règlement du scénario courant et le prochain contrôle Gate avant finally. En cas de remoteUnknown, une réconciliation opérateur explicite est nécessaire, un simple --cleanup-manifest refuse toujours. Les notifications support sont semées par service_role avec actor_id null : la génération via réponse opérateur/trigger n’est pas prouvée. La revue API ne valide pas les sélecteurs, captures ou manipulations de formulaires du mode browser/all.
