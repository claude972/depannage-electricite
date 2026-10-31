# Revue indépendante A5 support opérateurs

Source exacte **6062f92cef83f54c0af1f6713a050fa62a7baeb2**, base be17b24adbc0035d1ba82347c09f9045bac03d71, worktree `/Users/claudebrafa/.codex/worktrees/depannage-codex-support-operators`, propre et HEAD inchangé à la fin. Contrat et neuf fichiers du diff lus ; comparaison avec011/014/016. Aucune édition source, cloud, credential, installation ou build.

## Verdict borné

**Aucun P1/P2 identifié dans ce lot backend.** Acceptable pour assemblage/revue pilote dans le périmètre examiné. Cela n'est pas un feu d'application distante de018, ni une validation de concurrence réelle ou de l'interface encore à raccorder.

## Droits SQL et frontières

-018 lignes4–8 étend les contraintes à trois scopes et author_kindoperator sans modifier les valeurs historiques. La fonction de grant conserve les gardes014 (is_admin, note/rate limit, profil cible, refus cibleadmin, idempotence et audit) ; signature et ACL existantes conservées par remplacement. Pas de promotion de rôle ou attribution automatique.
-018 lignes27–42 : lectureglobale=support_read, reply=read+reply, statut=read+status ; write scope seul ne suffit pas. Les trois RLSsupport011 réutilisent can_access_support_ticket remplacé. La branche créateur conserve le prédicat011 exact : créateur personnel, ou créateur lié ayant encore accès au dossier. Aucun nouveau droit de lire le dossier lié, ses photos/devis/profils, finance/audit/modération ou notifications d'autrui.
-018 lignes47–62 : helperprivé SECURITY DEFINER/search_pathvide, EXECUTE retiré PUBLIC/anon/authenticated. Il refuse action inconnue et acquiert les grantsactifs nécessaires FOR SHARE, ordre scope/id, avant org→dossier→ticket. Retrait014 lignes120–123 prend la même ligne FOR UPDATE puis change status ; incompatible avec FOR SHARE. Après attente/retour, held_count=2 et scopes sont relus.018 lignes72–78 recontrôle encore l'autorité après les verrous ticket/site. L'ordre et le conflit des verrous soutiennent la sérialisation voulue ; pas de preuve expérimentale à deux sessions ici.
-018 lignes79–105 : créateur de repli sans droit global ne peut que reply ; tiers readonly refuse. CAS/plafondversion/transitions/validation/limite30 restent ceux de011. Opérateur reply sur résolu exige réouverture explicite ; créateur sans combinaison suit l'auto-réouverture011, y compris s'il possède seulement read+status. Message utilise l'auth.uid réel et admin/operator/user selon le chemin effectif.

## Notifications

-018 lignes111–119 : notify_support_reply accepte admin et operator, conserve destinatairecreator, support_ticket_id, acteur réel et clé de déduplication par message ; aucun contenu de message dans la notification.
-018 lignes122–136 : ancien trigger de statut sur ticket remplacé par l'événement autoritatif status_changed, acteur identique à auth.uid, combinaisonread+status. Une autoreopencréateur émet replied et ne devient pas une notification de commande opérateur. Clé ticket:status:version et filtreprivacy016 inchangés. Historique messages user/admin existant non réécrit.
- Le garde de notification liée s'appuie toujours sur can_access_support_ticket, tandis que les RLSnotifications gardent le destinataire ; donner support_read n'ouvre donc pas la boîte d'autrui. Le scénario isolé de perte de site vérifie ticket/notification liés masqués et ticketpersonnel conservé.

## HTTP et intégration

- Helperpermissions refuse RPCabsent, clés supplémentaires, typesmalformés et combinaisonsincohérentes par503. GETscopeall exige le droitDB ; défautalladmin/mineautres conservé. Detail reste RLS404, historique/compteurs bornés ; le helperne transforme pas une erreur en permissioncréateur.
- POST reste authentifié/assertOrigin/validationsbornées et dépend de mutate_support_ticket ; aucun droit dérivé du bouton ou du payload. Codes403/409 et cacheprivate,no-store testés, filtres/curseurscomptages restent protégés.
- describeAccess ajoute seulement les trois capabilities combinées ; un opérateursupport ne reçoit pas finance/opérateurs/audit/modération. L'union des scopes alimente le validateur existant de grants sans nouvelle route privilégiée.
- Dépendances d'assemblage explicites dans le contrat : author_kindoperator côté types/coques ; libellés des scopes et nouvelles clés capabilities dans UI/démos/fixtures. Un typecheckglobal avant ces raccordements n'est pas une preuve de livraison complète. Aucun build/UIlive effectué ici.

## Vérifications effectivement exécutées

1. Six unités `tests/support-operators.test.ts` via tsx du cache shared en lecture seule, NODE_PATHshared : **6 PASS, 0 échec**. Aucun node_modules dans le checkout ; pas d'installation ni de symlink ajouté. Première commande locale ./node_modules/.bin/tsx absente ; exécution reprise avec le cache existant.
2. `PGLITE_MODULE=/tmp/courant-pglite-review/node_modules/@electric-sql/pglite/dist/index.js node tests/sql-support-operators-review.mjs` : **PASS18migrations**, matricecomplète des scopes, RLS, mutations/CAS/ACL et vrais triggers ; Auth/Storage isolés ; **comptages de toutes les tables persistantes inchangés après rollback**. Assertion volontairement cassée provoque QA001 puis rollback sans fixtures : PASS.

Les tests routes utilisent le client Supabase avec fetchsimulé et vrais handlers transpilés ; ils ne sont pas des HTTPdistants. PGlite est une seule connexion : pas de preuve grant-revoke concurrent ni CAS à deux sessions. Le cheminadmin011/rétrogradation simultanée d'un SuperAdmin reste explicitement hors nouvelle garantie ; aucun claim supplémentaire fait par cette revue. Les séquences peuvent avancer malgré rollback, les comptages égaux ne signifient pas état global bitàbit inchangé.
