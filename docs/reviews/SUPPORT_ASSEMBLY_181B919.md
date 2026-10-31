# Revue assemblage A5

Source exacte `181b919ef0bb5b1a8b50e17c263909ce41f06ce7`, branche claude/web-shared-a5, checkout partagé propre à l’ouverture, HEAD inchangé ; en fin de revue Claude a commencé un WIP sur support-lists.ts/support-tickets.tsx. WIP préservé, non revu : findings revérifiés par git show 181b919. Commits UI d94c904, plateforme0d6d319 (intégré84ffb49), mocks d6d6b68 (intégré181b919) examinés. Backend6062f92 déjà revu séparément. Aucun cloud, credential, installation, build lourd ou édition source.

## Verdict : deux P2 UI à corriger avant clôture du lot

### A5-ASSEMBLY-001 — P2 : aucun contrôle de statut pour l'opérateur habilité

`components/role/platform-anchor.tsx:51–54` rend SupportCenter queue=all pour la file globale. Dans `components/role/support-tickets.tsx`, le seul appel à supportCommand (606–610) porte action reply. Aucun bouton, sélecteur ou handler set_status n'existe dans ce composant ; can_set_status est seulement consulté pour choisir le texte d'état fermé (801).

Un opérateur support_read+support_status peut lire les tickets mais ne peut pas en changer le statut depuis cette file. Un opérateur read+reply+status ne peut pas non plus rouvrir un ticket résolu pour répondre. Le sous-titre de la file annonce pourtant réponse et statut selon les habilitations, et018 expose le workflow.

Attendu : contrôles de transition fondés sur permissions.can_set_status du détail serveur, expected_version/CAS, états busy/erreur/conflit et relecture après succès/refus. Aucun contrôle par role=admin ou nouveaux droits client. Tester les trois cas readonly/reply/status sur le composant réellement rendu.

### A5-ASSEMBLY-002 — P2 : les permissions du détail restent périmées après actualisation des scopes

`SupportCenter` garde TicketDetail avec key=param (ligne82) ; effet de lecture détail551–566 dépend uniquement de id/reloadKey. Le rendu de file reste admis tant que capability support est vraie et ne fournit pas de clé d'autorité au composant (platform-anchor54).

Scénario : ticket ouvert avec read+reply ; admin retire support_reply ; relecture /me donne support=true, support_reply=false. Même compte, même ticket et même rôle : PlatformPage conserve la même instance et detail.permissions.can_reply reste true. Le formulaire ligne758 reste actif malgré le refus déjà connu dans les nouvelles capacités serveur. Le serveur refusera la mutation : aucun contournement serveur allégué, mais retrait de droit non répercuté dans l'UI. Une future action statut doit être protégée de la même manière.

Attendu : invalider/recharger les permissions du ticket à changement d'autorité (ou remonter une clé de scope comprenant identité et droits support) ; ne pas conserver des contrôles d'écriture sous l'autorité précédente. Test avec même utilisateur/read maintenu/reply retiré puis réponse ancienne retardée, sans republier l'ancienne autorité.

## Points conformes et limites

- File visible pour les quatre rôles uniquement sur le booléen support de /me ; roleadmin seul et scopeswrite seuls n'ouvrent rien. SupportCenter demande explicitement scope=all, masque création de ticket et conserve le retour détail→file. ID dossier présenté sans ouvrir un dossier non chargé ; aucune nouvelle permission dossier/finance.
- Créateur continue la vue personnelle. Auteur courant=Vous, user étranger de file=Demandeur, operator=Opérateur dans la file/Assistance côté demandeur, admin=Assistance. Aucun rôle admin inventé pour un opérateur.
- Identité : clearSessionState vide platformAccess, augmente sessionKey et remonte les espaces ; lectures contrôleur comparent seq et mutations passent par runner. Pas de fuite A→B identifiée dans le diff. Le défaut002 concerne une modification d'autorité du même utilisateur.
- Les sept scopes ont labels/descriptions/familles exhaustifs Record. L'avertissement write sans read est informatif, fondé sur les grants chargés et le dit explicitement. Démo : support/support_reply/support_status explicitement false, donc aucune file opérateur simulée présentée comme habilitation réelle.
- Tests historiques support compilent le vrai helper de décodage ; seuls les retours RPC sont simulés. RPC absent/malformé/incohérent =>503 privé ; write seul=>403 all ; mine et droits propres préservés. Ces tests ne rendent pas les contrôles React : ils ne détectent pas001/002.
- Une branche switch support-queue apparaît deux fois dans le diff EnterpriseSpace ; redondance sans conséquence fonctionnelle identifiée, non bloquante.

## Vérifications réellement exécutées

Tests ciblés : ui/support-lists, ui/anchors, ui/session, ui/features, support, support-operators, platform-operations/scope-labels et routes : **65 PASS, 0 échec**.

`./node_modules/.bin/tsc --noEmit --incremental false` : PASS, aucune sortie générée détectée ; les deux modifications source WIP finales appartiennent au travail concurrent, pas à cette revue. Cache existant uniquement.

Le chiffre annoncé394 et le buildTurbopack n'ont pas été reproduits ici : cette revue confirme ses65 tests ciblés et le typecheck seulement, pas un build ni un navigateur/HTTP réel. Aucune application distante de018, aucun acteur réel/grant ni concurrence live vérifiés.
