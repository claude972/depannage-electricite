# PUB-06 / ADM-10 — conditions publiées et activation opérateur

Base `10ba87d`, branche `codex/warranty-activation`, claim `b5271c1`. Aucun contenu juridique, durée commerciale nouvelle ni activation réelle. Migration `20261107143142_warranty_policy_activation.sql` à la livraison du lot, enregistrée sur la base de test en `20261107144136_warranty_policy_activation.sql` sans données de conditions ou commande d’activation préchargées. Mission corrective liée indépendante hors de ce premier delta.

## Contrat opérateur

`GET /api/admin/warranty-policy` retourne `version` globale, `draft:{title,body}`, `published:{version,title,body,published_at}|null`, `operator_enabled`, `environment_enabled`, `enabled`. Les droits sont contrôlés par rôle administrateur courant ; privé et sans cache. Le dernier champ combine l’activation SQL et le garde d’environnement existant de l’API HTTP.

`POST` même route : `{command_id, expected_version, action}`. UUID créé avant soumission et conservé pour retry identique. Actions :

- `save` exige `title` (160 caractères maximum) et `body` (20 000 maximum), texte brut fourni par l’opérateur ; brouillon vide autorisé, jamais publiable. Aucun HTML à interpréter dans l’interface.
- `publish` publie un instantané du brouillon non vide et désactive le dépôt. Toute nouvelle publication nécessite une nouvelle activation.
- `enable` exige en plus `published_version` exactement égale à la version actuellement publiée. Active la porte existante `app_settings.warranty_requests_enabled`.
- `disable` désactive le dépôt sans retirer les conditions ; possible dès l’état initial.
- `withdraw` retire la publication courante et désactive le dépôt. Les anciennes publications restent accessibles par numéro pour l’historique.

Les champs étrangers sont refusés. Réponse `{version,action,replayed}` : reçu de commande, pas état courant. Recharger le GET après succès/retry. Une ancienne activation rejouée après désactivation ne réactive rien. Droits actuels, UUID, contenu, acteur et version sont vérifiés ; un seul événement/audit par mutation. Sérialisation par verrou transactionnel partagé avec le dépôt d’une demande. Une modification de brouillon seule ne change ni la publication courante ni son activation.

## Lecture publique et historique des demandes

`GET /api/public/warranty-terms` retourne `{published:...|null}`. `?version=N` retourne uniquement une version effectivement publiée, même retirée ensuite. Brouillons, actions d’activation, auteurs et UUID de commandes ne sont jamais publics. Aucune donnée = publication nulle ; ce n’est pas une page juridique fictive.

`warranty_requests_enabled()` exige désormais la porte app_settings ET une activation explicite correspondant à la publication courante. Une valeur app_settings vraie isolée ne suffit pas. Le garde `WARRANTY_REQUESTS_ENABLED` de l’API existante reste en place ; il n’est ni modifié ni lu depuis PostgreSQL. Le GET garantie refuse désormais une valeur RPC autre qu’un vrai booléen.

Les nouvelles demandes stockent `terms_version`, référence à la publication courante au dépôt, **pas une preuve d’acceptation ni la version applicable à la date des travaux**. Les anciens dossiers gardent `null` ; aucun rattachement rétroactif inventé. L’éligibilité préexistante (client propriétaire, dossier payé et terminé, contrôle historique `completed_at + interval '1 year'`) reste inchangée. Ce lot ne décide aucune durée et ne garantit pas l’accord juridique de conditions saisies avec ce prédicat : cet accord doit précéder l’activation opérateur. Le traitement des dossiers existants reste possible quand le dépôt est fermé.

## Vérification et limites de livraison

TypeScript strict et 6 tests des vrais handlers HTTP PASS : commande stricte, versions, origines et accès, projections publiques, garde env, traitement historique et booléen strict. SQL isolé : 41 contrôles PASS sur 47 migrations réelles, Auth/Storage/cron simulés, brouillon privé, activation sur publication, concurrence séquentielle par version, reçu rejoué sans réactivation, audit unique, droits retirés, lien historique, fermeture/réouverture, critères existants et refus inter-acteurs. Régression globale `tests/sql-review.mjs` PASS avec préparation de conditions QA publiée/activée par RPC ; assertions historiques conservées. Pas de preuve multi-connexion, pas de déploiement ou de recette cloud. Interface et revue du contenu opérateur restent à raccorder ; PUB-06/ADM-10 entiers ne sont pas déclarés livrés.
