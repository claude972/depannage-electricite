# Follow-up accueil — 09ae4e1

SHA exact : 09ae4e12a982e6fc6526fce68d18aa1a0f8df3e5. Tête distante claude/ui-public-home identique confirmée par ls-remote. Diff complet3ae..09ae : helper10lignes, contrat,36lignes de tests. Export figé /private/tmp/depannage-public-home-review-09ae4e1-NAf08T. Aucun cloud, source auteur ou déploiement modifié.

Verdict : aucun P1/P2 trouvé ; feu borné pour intégrer ce follow-up. Le comportement de navigation de3ae était déjà correct et reste équivalent ; il ne s'agit pas de la réparation d'un bug hash du produit livré.

scrollToSection devient exporté et injectable (doc/win), mais ses paramètres par défaut restent document/window et son appel dans PublicHome ne change pas : lookup de la section, scrollIntoView smooth ou auto si mouvement réduit, focus h2 preventScroll. Identifiant inexistant => retour sans effet. Aucun accès location/history ni callback session introduit. SSR reste sûr puisque les valeurs navigateur sont évaluées à l'appel du handler, pas au chargement du module/rendu.

13 tests public-home PASS, zéro échec/skip, sur export exact et dépendances existantes liées localement. Les2nouveaux tests exécutent le vrai helper avec window qui jette si location/history sont lus, et rendent le vrai PublicSite sous le bon ThemeProvider pour vérifier boutons internes sans href/action session. Les11tests antérieurs (callbacks, catégories, SSR, autres vues, brouillon, photos) restent verts.

Le contrat corrige la description initiale devenue obsolète des ancres : il décrit désormais les boutons déjà présents dans3ae. La preuve navigateur18/18 rapportée par l'auteur est consignée comme sa preuve ; je ne la présente pas comme rejouée ici. La recette ROOT de la livraison publique53d (8cas + vrai formulaire) reste une preuve de53d, pas d'un redéploiement09ae inexistant.

CSS, photos, état du formulaire, thème et autres rôles inchangés dans ce diff. Aucun besoin de rejouer la BDD pour ce follow-up ; contrôles d'intégration/CI usuels à conserver après assemblage.
