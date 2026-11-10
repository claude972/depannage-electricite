# Rapport de livraison · Codex · 9 novembre 2026

Branche `release-candidate/codex-2026-11-09` sur le disque externe. Base Web et native `adba084341054168d819adb87ceb6b2bcbf8e4fe`. Ce rapport distingue l’avancement et la qualification de la version candidate.

## Avancement par bloc

| Bloc | État | Résultat |
| --- | --- | --- |
| 1 · Fiabilité mobile | Fait. Suite complète verte. | Brouillons par compte et dossier, photos chiffrées et reprise, session renouvelée sans perte de saisie, demande et reçu persistants. Code applicatif `afd7c7c98a4b35263bc72127585280ef9d1eacbf`. Tête de vérification `ef719e1`, qui modifie uniquement l’attente de rendu d’un test. La recette Android physique est reportée au bloc 6. |
| 2 · Client mobile | Partiellement fait | Accueil Mobile B, huit fiches et tarifs communs intégrés. Demande, historique et conversion du même compte vérifiés localement. La réception d’un SMS réel reste à prouver sur l’environnement de recette. |
| 3 · Artisan mobile | Non commencé | Le passage dépend de la qualification du bloc 2. |
| 4 · SMS et Stripe | Non commencé | Les essais de ce bloc nécessitent les environnements test et leurs preuves de livraison et de rapprochement. |
| 5 · Version à livrer | Non commencé | Contrat commun, publications et builds signés à traiter après la qualification des parcours. |
| 6 · Recette | Non commencé | Recette intégrée et essais sur téléphones physiques à effectuer sur le candidat figé. |

## Preuves acquises au bloc 1

- Codex a réalisé le stockage des brouillons et l’idempotence, puis Claude Fable 5.2 a fait la contre-revue du SHA `56b92a3`. Il a identifié le démontage des formulaires lors du renouvellement du jeton et livré le correctif de reprise du sélecteur Android dans un instantané isolé. Codex a intégré le correctif, renforcé la séparation des sélections encore en cours et ajouté les tests.
- Le test HTTP utilise la vraie route Next.js et les fonctions PostgreSQL isolées. Un tarif périmé donne 409, la limitation donne 429, puis la première demande réussit et sa réponse est coupée au relais. Après un 401 et trois réessais, la base contient une intervention et une clé. Un corps modifié sur la même clé est refusé.
- Dans Chromium, le hook mobile réel maintient le formulaire pendant la rotation du jeton du même compte. Le brouillon disparaît après un 403 et les données du premier compte restent absentes quand le deuxième compte prend la main.
- Sur iPhone 16e simulé, l’arrêt et le lancement produisent deux PID. Le stockage Expo retrouve le devis, le compte rendu et la demande. Un fichier photo synthétique est retrouvé, chiffré sur disque et déchiffré à l’identique. Les lectures sous un autre compte ou dossier restent vides. Ce test utilise un lanceur de recette et les modules de stockage de l’application.
- Les tests Android simulent le retour du sélecteur natif. Ils vérifient la reprise par le compte, le dossier et le côté attendus, et refusent le remplacement du marqueur d’une sélection encore en cours. Un APK de recette isolé a démarré sur Pixel API 36. La caméra native a capturé l’image. Des fenêtres « System UI isn’t responding » ont bloqué la confirmation avant le retour dans l’application. La restauration après destruction réelle de l’activité reste à prouver.
- Le premier passage complet comptait 2 242 réussites Web et 89 contrôles SQL réussis. Turbopack a d’abord refusé un lien vers les dépendances hors du dossier de travail. La compilation a réussi après copie locale des dépendances verrouillées. Sur `afd7c7c`, 2 245 des 2 246 tests sont passés. Le scénario 360 px d’une fiche entreprise a réussi seul. Son attente fixe de 300 ms a été remplacée par une attente bornée de la ligne rendue. Les huit tests de la fiche passent. Le rejeu intégral sur `ef719e1` passe avec 2 246 réussites, 0 échec et 0 ignoré. TypeScript Web et les builds Turbopack et Webpack sont verts. Sur le code applicatif exact `afd7c7c`, les 89 contrôles SQL, TypeScript mobile et les exports iOS et Android sont verts.

## Preview de recette

La preview Vercel est READY sur le code `afd7c7c`. Accueil, tarifs et options répondent 200 avec la session Vercel existante. Sans session applicative, l’espace connecté répond 401. La vérification SMS et l’empreinte Stripe sont désactivées. La base est distincte de celle de production.

[Preview protégée](https://depannage-electricite-i3a8r16oy-brafas-projects.vercel.app/)

## Bloc 2 · Écrans et API intégrés

- Claude Fable 5.2 a livré l’accueil, le catalogue et les fiches à partir de Mobile B en clair et sombre. Codex a intégré ces écrans en `a722e21`, restauré l’accès direct à la connexion, relié les conseils à l’aide existante et ajouté les tarifs dans le catalogue. L’adresse d’intervention est saisissable manuellement. La localisation propose une adresse à confirmer.
- Le catalogue API reprend les huit fiches Web en `a922e79`. La réservation et l’historique natifs utilisent la vérification et l’identité téléphone dans `f5a2f5b` et `3b4420a`. Le brouillon est enregistré avant la demande de code. La réservation conserve la référence tant que la confirmation manque. Le choix « Régler après l’intervention » utilise le flux plateforme existant. L’accès par e-mail est proposé après une demande et conserve l’identifiant Supabase.
- Sur `79bc04c`, TypeScript Web et les builds Turbopack et Webpack passent. La suite complète donne 2 247 réussites, 0 échec et 2 contrôles historiques ignorés faute de capture fournie à ce lancement. Les deux fichiers de tests concernés ont ensuite passé leurs 62 contrôles, dont les deux historiques, avec la capture privée réelle.
- Les exports Expo iOS et Android et le contrôle TypeScript mobile passent sur le code applicatif `a722e21`. Chromium a vérifié l’export Web Expo à 360 et 390 px dans les deux thèmes, avec réponses HTTP de recette. Les huit tarifs sont affichés. Le bouton reste dans la zone visible de la fiche, la catégorie est présélectionnée après le clic et le catalogue se recharge après une erreur 503. Les vérifications sur appareil restent ouvertes.
- La vraie route Next.js et PostgreSQL isolé en `79bc04c` confirment le même dossier après trois réessais, une ligne en base, le refus d’un numéro différent et un historique cloisonné. L’identité de test est synthétique. Aucun SMS ni débit n’a eu lieu.
- La preview Vercel protégée `dpl_6tU4qJTzsP6AFUFCTHD1cxDkdnQU` est READY au SHA Git `79bc04c71d56c14a209c3cada6397f7c38d9c59a`. Accueil, catalogue, tarifs et modalités répondent 200. L’espace et l’historique anonymes répondent 401. L’API indique que le SMS et l’empreinte de carte sont indisponibles. [Preview protégée du bloc 2](https://depannage-electricite-80labkhvt-brafas-projects.vercel.app/)

### Confirmation de l’adresse e-mail

Le test de régression échouait avec le type Supabase `email_change`. Le commit `a145972` ajoute ce type au lien de confirmation et fournit le modèle d’e-mail Supabase correspondant. La confirmation exige toujours une session valide. Les 24 tests ciblés Auth passent. La suite Web sur le même code termine avec 2 250 réussites, aucun échec et aucun test ignoré. TypeScript, Turbopack et Webpack passent. Le modèle versionné doit être configuré sur le projet Auth de recette pour valider le lien qu’il émet.

La [preview protégée du correctif](https://depannage-electricite-2or3678xu-brafas-projects.vercel.app/) sert le SHA exact `a145972c4ca27f78f745c7b96e9f7cf9af7b26fe`. Un lien invalide répond 307 vers `/?auth=expired`, sans cache et sans référent. Les options de réservation répondent 200, avec le SMS et l’empreinte de carte désactivés.

La recette locale a exécuté les 125 migrations de la branche sur PostgreSQL Supabase. Next.js a refusé un code erroné et accepté le code synthétique prévu par Supabase Auth local. Le parcours a créé une intervention réelle en base locale, refusé l’historique anonyme, puis capturé l’e-mail de changement dans Mailpit. La connexion par e-mail échouait avant confirmation. Après ouverture du lien, elle a retrouvé le même identifiant utilisateur, le même téléphone et le même dossier. La boîte et le code de recette étaient locaux. Aucun SMS externe, e-mail externe ou paiement n’a été émis.

## Décisions prises

- Les brouillons privés sont chiffrés par le stockage sécurisé du système. La photo en attente est stockée sous forme chiffrée et l’écriture est terminée avant de conserver sa référence. Une copie en clair temporaire sert au dépôt natif. L’alternative d’un brouillon général en cache a été écartée au profit d’une restauration par compte et dossier.
- Le renouvellement d’un jeton maintient uniquement la dernière lecture du même compte et de la même ressource pendant la nouvelle vérification. Un changement de compte ou un refus retire les données et les actions visibles.
- Une demande dont l’état est incertain conserve sa clé et son contenu. Un 409 explicite de changement de tarif permet au client de relire et de confirmer le nouveau tarif, ou de modifier la demande. Après un 201, l’application garde un reçu durable avant de naviguer. Une deuxième demande devient une action explicite.
- Sur Android, le résultat du sélecteur appartient au compte, au dossier et au côté du marqueur stocké avant ouverture. Une sélection récupérée se dépose manuellement. Si l’utilisateur ouvre un autre sélecteur après un redémarrage avant d’avoir récupéré l’ancienne sélection, la référence native orpheline est abandonnée pour garantir l’isolation.
- Si un brouillon de devis ou de compte rendu est illisible, l’artisan peut continuer dans un emplacement local distinct qui conserve l’enregistrement initial. Pour une demande d’état inconnu, l’application conserve la clé existante pour éviter la création d’un doublon.

## Fournisseurs, actions externes et dettes

La recette SMS du bloc 2 demande une configuration de test qui limite réellement les envois aux numéros vérifiés de `TEST_PHONE_NUMBERS`. La liste est absente des fichiers d’environnement du candidat consultés et des variables Vercel applicables à la branche. Le SMS est désactivé dans la preview. Le test local couvre la reconnexion et l’accès e-mail avec le même historique. Il reste à vérifier la réception du code par le fournisseur de test, puis le même parcours en ligne, avant le bloc 3.

Aucun appel Stripe ou SMS et aucun montant observé au bloc 1. Les montants attendus et le rapprochement au centime seront établis à partir du devis de recette et de la configuration sandbox lors du bloc 4.

La qualification matérielle doit inclure Android avec « Ne pas conserver les activités », retour de caméra, annulation, sélection avant/après et réessai hors ligne. Un appareil physique iPhone reste également nécessaire pour la recette finale. La disponibilité des profils de signature, des numéros autorisés +596 et +590 et des comptes fournisseurs de test devra être confirmée dans les blocs concernés.

Le stockage d’un brouillon illisible est conservé sur l’appareil. Une copie temporaire de photo issue du cache peut survivre à un arrêt forcé pendant le dépôt. Les cas de vidage par le système et de suspension au milieu d’une écriture ne sont pas couverts par la recette simulée de relance après écriture terminée.

## Liste de contrôle de bascule en live

Cette procédure reste hors exécution.

1. Obtenir l’autorisation de mise en production et figer le SHA à promouvoir. Vérifier la sauvegarde et la procédure de retour arrière.
2. Vérifier la configuration Stripe live et Connect, le webhook dédié et son secret de signature, les bons modes et comptes, les permissions et les alertes. Préserver l’idempotence et le rapprochement.
3. Configurer le fournisseur SMS hors sandbox, les numéros et routes approuvés, les limites et la surveillance des rejets.
4. Retirer les indicateurs test uniquement dans les environnements activés en live. Faire les contrôles autorisés et surveiller paiements, webhooks et notifications.
