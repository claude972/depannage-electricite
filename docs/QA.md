# Vérification indépendante

Revue du code, du PostgreSQL isolé et des réponses HTTP terminée — 30 octobre 2026. Parcours principal, responsive et formulaires professionnels vérifiés dans le navigateur en mode démonstration. Ce rapport distingue le code livré, les comportements vérifiés et les services externes non configurés. Une API implémentée ne vaut pas une validation de production.

## Contrôles réalisés

- `npm test` : 11 tests métier réussis. `npm run typecheck` également réussi au contrôle indépendant. Ils couvrent les centimes, l'arrondi de TVA, les limites du devis, les rôles, l'ordre des transitions et les données minimales de confirmation de paiement.
- Docker indisponible : le daemon local ne répond pas. Aucun test Supabase local sous Docker n'est déclaré exécuté.
- Création Supabase distante refusée par le fournisseur pour facturation en attente ; aucun projet existant n'a été utilisé.
- PostgreSQL isolé exécuté avec `@electric-sql/pglite@0.5.13`, installé uniquement dans un dossier temporaire. `tests/sql-review.mjs` lit la migration effective du dépôt. Seuls `auth.users`, `auth.uid()` et les tables Storage sont simulés explicitement ; `CREATE EXTENSION pgcrypto` est omis dans ce harnais, car PostgreSQL fournit déjà `gen_random_uuid`.
- Ce contrôle isolé prouve la syntaxe de la migration et les comportements SQL testés, sans prouver l'intégration réelle Supabase Auth/Storage, les permissions du fournisseur ou la charge concurrente.

Commande reproductible du contrôle isolé, depuis le dépôt :

```sh
qa_dir="$(mktemp -d)"
npm install --prefix "$qa_dir" --save-exact @electric-sql/pglite@0.5.13 --no-audit --no-fund
PGLITE_MODULE="$qa_dir/node_modules/@electric-sql/pglite/dist/index.js" node tests/sql-review.mjs
```

Aucune dépendance PGlite n'est ajoutée à l'application ou à sa CI. Le harnais utilise une base en mémoire neuve et ne contacte aucun projet Supabase. Un échec d'installation ou de test doit arrêter cette séquence ; ne pas interpréter l'absence de sortie comme un succès.

Résultats SQL observés : migration complète appliquée ; inscription publique incapable de créer un administrateur ; dossier inaccessible au client ou artisan tiers ; modification directe du rôle et auto-approbation refusées ; offres sans adresse ni description privée ; seconde acceptation d'une mission refusée ; montant du devis calculé par la base ; acceptation du devis réservée au demandeur/gestionnaire autorisé ; démarrage avant acceptation refusé ; confirmation de paiement réservée au serveur ; montant erroné refusé sans marquer l'événement traité ; replay sans double effet ; site inaccessible et demande inter-organisation refusée ; paramètres de paiement nuls tous refusés ; membre viewer autorisé en lecture mais interdit en écriture de messages.

L'acceptation a été testée séquentiellement sur une mission déjà prise. Le verrou `FOR UPDATE` a été revu ; aucun test de concurrence sur plusieurs connexions distantes n'a été exécuté.

## Matrice de périmètre

| Version / capacité | État du code au moment de la revue | Validation restante |
| --- | --- | --- |
| MVP : formulaire, estimation, suivi client | Interface et API/RPC présentes ; démo locale distincte | Parcours navigateur et vraie persistance Supabase |
| MVP : attribution, devis, intervention artisan | Interface/API/RPC présentes ; règles métier et SQL testées isolément | Deux comptes artisans et concurrence réelle |
| MVP : paiement Stripe/Connect | Routes Checkout, onboarding et webhook présentes ; signature et transaction revues | Clés test, webhook réel, compte Connect et scénario bancaire test |
| MVP : comptes et rôles | Auth Supabase, profils, approbation artisan, RLS présentes | Base dédiée, email confirmé et matrice réelle de comptes |
| Documents et photos privés | API de dépôt/lien signé, bucket privé et interface de dépôt présents | Vraie configuration Storage et test utilisateur connecté |
| Notation | API d'avis liée à intervention payée et formulaire présents | Test de bout en bout connecté |
| V2 : portail professionnel, sites, budgets | Création de sites et affichage par type présents | Vérification navigateur et vraie isolation distante |
| V2 : chat | API/RPC, interface et contrat auteur alignés | Validation navigateur et transport distant |
| V2 : suivi temps réel et notifications multicanaux | Publication PostgreSQL et abonnement Supabase pour les interventions/devis/messages présents ; notifications externes non implémentées | Validation du transport distant, email/SMS/push dédiés |
| V2 : garantie un an automatisée | Demandes et résolution de garantie implémentées ; activation commerciale désactivée par défaut | Conditions métier, activation explicite et tests distants ; aucune acceptation automatique d’une réclamation |
| V3 : approbations configurables, contrats, reporting consolidé | API/RPC et interfaces présentes ; seuil et rôle de décision vérifiés sous PostgreSQL isolé | Agrégations SQL vérifiées isolément ; vérification distante multi-organisations |
| V3 : diagnostic photo IA | Non implémenté ; aucun diagnostic simulé présenté comme réel | Fournisseur, protocole d'évaluation et intégration |
| V3 : conformité ERP | Registre de suivi audit/maintenance/sécurité/équipements avec échéances et statuts ; aucune certification automatique | Évaluation métier et règles applicables validées |

Cette matrice reflète les sources intégrées ; les vérifications en preview sont à consigner séparément. Aucun élément non implémenté n'est déclaré terminé.

## Revue et corrections en cours

Écarts communiqués aux agents responsables : contrat message `author_id` ; méthode PATCH du profil ; quantités entières et taux de TVA autorisés ; fourchette diagnostic identique entre interface et serveur ; parcours de récupération de compte non offert sans écran de nouveau mot de passe ; affichage des offres artisan anonymisées ; comparaison SQL de paramètres de paiement nullables.

La conclusion de mise en ligne et les vérifications responsive appartiennent au rapport final de preview. Les paiements réels, l'authentification distante et les fonctions V3 ne doivent pas être présentés comme validés sur la seule base du build.

## Premier essai de déploiement

La première compilation Vercel a échoué avec des imports `lib/supabase/*` introuvables. La règle non ancrée `supabase/` dans `.vercelignore` excluait également les utilitaires applicatifs de même nom. Cet échec de packaging a été identifié ; ne pas annoncer l'URL de ce déploiement comme une preview utilisable. La règle a été retirée ; `lib/supabase` et les migrations sont conservés. Une seconde tentative, lancée par erreur malgré un typecheck échoué pendant une intégration incomplète, a été interrompue côté CLI ; elle ne constitue pas un résultat validé. La relance suivante doit partir d’un instantané figé après contrôles réussis.

## Extension professionnelle vérifiée

Le harnais SQL charge désormais les deux migrations dans l'ordre. Treize groupes de contrôles réussissent : aux tests initiaux s'ajoutent la configuration des approbations réservée au propriétaire, la création automatique d'une approbation au dépassement du seuil, le refus d'accepter le devis tant que la décision requise n'est pas approuvée, le refus d'approuver par un gestionnaire lorsque le propriétaire est requis, l'isolation des contrats et fiches de suivi, le refus d'écriture du viewer et l'impossibilité de modifier directement le journal d'audit.

Corrections confirmées par lecture après intégration : message `author_id`, profil PATCH, quantités entières, liste des taux de TVA, fourchette diagnostic partagée, récupération de mot de passe avec écran dédié, offres anonymisées correctement affichées, sélection du devis actif récent, conservation du brouillon après échec d'envoi et conservation du brouillon de demande avant connexion.

Le reporting a été testé sur un site contenant une intervention payée, une intervention avec devis accepté non payé et une demande ne possédant qu'une estimation : respectivement 24 000 centimes payés, 24 000 centimes engagés et aucun montant issu de l'estimation. Le client hors organisation ne reçoit aucune ligne.

Le dépôt de garantie est interdit dans la base tant que le réglage commercial serveur est désactivé ; un compte authentifié ne peut pas activer ce réglage. Après activation dans le harnais isolé : demande d'un autre client refusée, intervention terminée depuis plus d'un an refusée, demande du propriétaire dans l'année autorisée, deuxième dossier ouvert refusé, résolution par artisan refusée et traitement par administrateur autorisé. Ces contrôles ne constituent pas une validation juridique des conditions de garantie.

## Limites fonctionnelles explicites

- Le matching implémenté est une liste d'offres anonymisées avec acceptation transactionnelle par artisan approuvé. La géolocalisation, le calcul de distance et le classement intelligent ne sont pas implémentés.
- Le suivi temps réel porte sur les données de demandes/devis/messages, pas sur la position GPS d'un artisan.
- Les sites possèdent un type et un budget ; les contrats et registres permettent le suivi d'échéances. Cela ne constitue pas un moteur de conformité ERP, une grille tarifaire contractuelle calculée automatiquement, un rapport spécifique d'assemblée générale ou un suivi de consommation énergétique.
- Les notifications email/SMS/push, les alertes SLA externes et l'archivage automatique ne sont pas implémentés. Un indicateur de messages dans l'interface ne les remplace pas.
- Les abonnements client/artisan et les services premium ne possèdent pas encore de parcours de souscription. La commission est une configuration serveur ; aucun taux commercial n'a été choisi sans décision du propriétaire.
- Le diagnostic photo IA n'est pas implémenté faute de fournisseur/configuration et d'évaluation ; aucune sortie fictive n'est produite.
- La base Supabase dédiée et les clés Stripe restent indisponibles. L'inscription, les emails, les documents privés, les abonnements temps réel et les transactions Checkout/Connect ne sont pas validés en intégration distante.
- Les conditions juridiques, les coordonnées, la zone de service, les taxes et l'identité commerciale finale restent à renseigner avant exploitation commerciale. Le nom Courant est provisoire.

## Conclusion de revue

Les règles métier et les frontières SQL exercées dans le harnais passent leurs contrôles. Les écarts de contrat identifiés ont été corrigés par les agents responsables ; aucune validation de production n'est donnée. La démonstration a également passé le build cloud et les contrôles de preview documentés ci-dessous. L'ouverture à de vrais clients et l'encaissement réel restent bloqués par les accès et validations externes mentionnés ci-dessus.

## Attribution des déploiements Vercel

Les premiers déploiements n'ont pas démarré : l'API Vercel retournait `BLOCKED` / `TEAM_ACCESS_REQUIRED`, car l'auteur des commits initiaux utilisait une adresse locale sans attribution reconnue. L'ancienne CLI affichait cet état comme `UNKNOWN`. L'identité GitHub connectée a été vérifiée (`claude972`, identifiant 65830944) ; les nouveaux commits utilisent son adresse noreply canonique dans la configuration Git locale du dépôt. Aucun historique n'est réécrit et aucun droit d'accès Vercel n'est modifié. Les déploiements automatiques suivants ont ensuite été contrôlés disponibles, comme indiqué ci-dessous.

## Déploiement final et vérifications HTTP

L'attribution Git corrigée a permis au déploiement automatique du commit `999b355` de compiler et de passer à l'état Vercel `READY` (`dpl_ByTFFtkzzFDHxtekEaVWzssj9oyc`). La compilation cloud a terminé en 15 secondes, avec 18 routes générées ou disponibles. La résolution des imports `lib/supabase/*` confirme que la correction du filtre de déploiement est effective.

Domaine canonique retourné par le fournisseur et vérifié : https://depannage-electricite-seven.vercel.app . Les URL techniques de preview et d'équipe restent protégées par le SSO Vercel ; aucune protection n'a été désactivée.

| Requête publique | Résultat observé |
| --- | --- |
| `GET /` | 200 ; titre « Courant — Dépannage électrique » |
| `GET /api/workspace` | 503 ; comptes en cours de configuration, démonstration disponible |
| `GET /api/professional` | 503 ; indisponibilité explicite de la connexion aux comptes |
| `GET /api/reports` | 503 ; indisponibilité explicite de la connexion aux comptes |
| `POST /api/payments/checkout` | 503 ; indisponibilité explicite, aucun faux paiement réussi |
| `POST /api/payments/webhook` | 503 ; Stripe non configuré et aucun débit annoncé |
| `GET /AGENTS.md` | 404 ; instructions de travail non exposées comme fichier statique |

Ces réponses prouvent la disponibilité de l'interface et le comportement contrôlé des API sans configuration. Elles ne valident pas les transactions, les comptes ou le stockage distants. Les contrôles interactifs consignés ci-dessous complètent ces réponses HTTP ; ils restent distincts de toute validation bancaire ou Supabase distante.

## Vérification navigateur de la démonstration

Contrôles exécutés par l'agent principal via CUA sur le domaine canonique, au commit `999b355` :

- Parcours complet : création d'une demande, bascule vers l'artisan, acceptation de mission, création du devis à 150 € HT / 180 € TTC, bascule client, acceptation du devis, démarrage et fin de l'intervention côté artisan, simulation explicite du règlement puis dépôt d'un avis. Toutes les étapes ont abouti dans la démonstration ; aucun paiement bancaire ni contact avec un artisan réel.
- Vue mobile 360 × 800 : contenu lisible, largeur de défilement mesurée à 360 px, absence de débordement horizontal et fonctionnement du menu de navigation.
- Vue desktop 1440 px : création d'un contrat de démonstration réussie. Le champ date a été rempli via son sélecteur natif puis confirmé avec Entrée ; la tentative de remplissage direct par locator n'avait pas fonctionné.
- Les références des trois dossiers fictifs étaient insuffisamment distinctes ; correction livrée dans `706d380`.
- Les boîtes `window.prompt` ne produisaient pas d'interaction utilisable dans le navigateur intégré. Elles ont été remplacées, avec les confirmations natives, par des formulaires et confirmations intégrés à l'interface dans `1db2a0d`, afin de rendre ces actions visibles et révisables.

Le déploiement automatique de `1db2a0d` a été contrôlé à l'état `READY` (`dpl_J7KnBWGqUSyTjrv5j5ZwBo2YRmDp`, cible production). Le contrôle CI GitHub correspondant, `41151552077`, est terminé avec succès : installation propre `npm ci` puis `npm run check` (types, 11 tests et build). La vérification ciblée des nouveaux formulaires d'approbation, de budget et de garantie a réussi dans le navigateur, comme détaillé ci-dessous.

Les réponses HTTP du domaine canonique ont été revérifiées après `1db2a0d` : accueil 200, workspace/checkout 503, webhook 503 et AGENTS.md 404, sans changement des limites externes.

## Contrôles ciblés après remplacement des dialogues

Contrôles exécutés par l'agent principal via CUA sur la version `1db2a0d` du domaine canonique :

- Approbation professionnelle : saisie d'une note dans le formulaire intégré, validation et état « Approuvé » visible.
- Budget du site : modification de 5 000 € à 5 500 €, valeur enregistrée et affichée dans la démonstration.
- Garantie : création d'une réclamation fictive sur une intervention réglée, puis traitement depuis l'espace administrateur de démonstration ; passage à « Résolue » après saisie d'une réponse d'au moins dix caractères, réponse affichée dans le dossier. Aucun rôle administrateur réel n'est attribué et aucune garantie commerciale réelle n'est activée.
- Persistance de démonstration : après rechargement du navigateur puis retour par l'entrée de démonstration, la demande et le contrat créés précédemment sont retrouvés. Les références distinctes des dossiers fictifs sont visibles.
- Le sélecteur de date natif, validé avec Entrée, fonctionne pour créer le contrat. Pour le sélecteur d'approbation, l'automatisation devait cibler le rôle `combobox` plutôt qu'un label exact encapsulant l'option ; ce dernier écart de ciblage ne constitue pas un défaut applicatif.

Ces résultats valident les parcours de démonstration examinés. Ils ne remplacent pas les tests de vrais comptes, de stockage ou de paiement distant, toujours bloqués par Supabase et les clés Stripe manquantes. Les capacités non livrées restent listées dans la matrice et les limites fonctionnelles ci-dessus.
