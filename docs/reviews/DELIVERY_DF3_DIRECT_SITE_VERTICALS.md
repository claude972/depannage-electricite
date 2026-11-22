# Énergie et copropriété sur les fiches de sites chargées directement

La preview sert `df31cdd4b80ed37ffda405508be9e6f4c6ab9fec` de `integration/web-pwa`. Vercel confirme `dpl_9qHSa3w8WL9EbU4nuyqY6o1C6Y4F` et le HTML public confirme le build `AtkQVhQST9eSaUK-Px9MU`. Les 33 tests ciblés et TypeScript strict passent. [Preview](https://depannage-electricite-khje8rgra-brafas-projects.vercel.app) · [CI](https://github.com/claude972/depannage-electricite/actions/runs/42444521956)

La recette Chromium `8ebacfd70fd2` a ouvert les fiches depuis les trois pages du portefeuille de 102 sites. Les deux sites cibles étaient absents des 100 sites chargés au démarrage pour le gestionnaire et le lecteur. L’API a préparé deux relevés et un brouillon d’assemblée. Le gestionnaire a ensuite créé depuis les écrans un relevé de 3,5 kWh à 4,90 € et un appel de fonds documentaire de 123,45 € lié à l’assemblée. L’API a confirmé les deux écritures et les écrans ont relu les enregistrements.

Le panneau de copropriété est disponible pour le syndic. Le lecteur consulte les données et reçoit un HTTP 403 s’il tente d’écrire. Le tiers reçoit un HTTP 404. La navigation entre les sites conserve le bon périmètre. L’appel de fonds testé est un brouillon documentaire.

Les 36 opérations de nettoyage, 90 lectures indépendantes et 20 contrôles supplémentaires sur les quatre tables de relevés, de copropriété et d’événements ont passé. Les contrôles supplémentaires couvrent les 102 identifiants du manifeste et ne trouvent aucun résidu. La recette s’est terminée le 7 novembre à 23 h 59, heure de Martinique.
