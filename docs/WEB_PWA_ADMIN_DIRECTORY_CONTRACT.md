# WEB-PWA-ADMIN-DIRECTORIES-001 — annuaires administrateur

Base d85da0657586f152ee9bba941d67345b4eead616, branche codex/admin-directories. Contrat prépublié avant code au7b1ea23. Route maintenant implémentée sur cette branche ; recette cloud et UI encore attendues.

## Plan court
1. Réutiliser Auth serveur/RLS et projections de admin_overview ; aucun service-role, migration ou droit nouveau.
2. Ajouter GET /api/admin/directory, trois annuaires avec pagination keyset stable et total filtré exact. Compléter uniquement les artisans de la page par leur société/statut, sans tronquer les profils sans dossier.
3. Tester route réelle via SDK Supabase et fournisseur HTTP déterministe (>100 par type, dates liées/microsecondes, filtres/curseurs, refus interrôles), puis remettre au pilote pour revue et recette en ligne.

## Autorisation
Session vérifiée et profiles.role=admin avant toute lecture annuaire. Aucun droit plateforme donné aux owner/manager/viewer B2B, clients ou artisans. Réponses et erreurs private, no-store ; aucun accès Auth ni email, adresse, SIRET, stripe_account_id ajouté.

## Liste
GET /api/admin/directory?kind=artisans|clients|organizations

Paramètres uniques, inconnus/doublons refusés422 :
- kind obligatoire, un des trois types ci-dessus.
- limit entier1..100, défaut25.
- cursor opaque renvoyé par cette même route, versionné et lié au type/filtres normalisés. Changer la limite est autorisé ; changer un filtre impose de repartir sans curseur.
- q optionnel, chaîne littérale normalisée NFKC de2..80 caractères : lettres/accents/chiffres/espaces/tirets/apostrophes. Recherche insensible à la casse dans full_name pour artisans/clients et name pour organisations ; pas dans la société artisan. UUID complet : référence exacte id. Vide équivaut à aucun filtre. Délimiteurs PostgREST, wildcards et ponctuation de contrôle refusés.
- approved=true|false seulement pour artisans (profiles.artisan_approved).
- role=client|manager seulement pour clients. Sans filtre, ces deux rôles sont inclus.
- owner_id=UUID seulement pour organisations.

Réponse : {kind,items,page:{limit,has_more,next_cursor,total},filters:{q,approved,role,owner_id}}.

Projections minimales :
- artisans : id,full_name,phone,artisan_approved,created_at,company_name,application_status. Les deux derniers sont null si aucun dossier artisan n’existe. Aucun profil sans dossier n’est exclu implicitement.
- clients : id,full_name,phone,role,created_at (client ou manager uniquement).
- organizations : id,name,owner_id,created_at.

Tri created_at DESC,id DESC. Curseur conserve timestamp exact PostgreSQL (microsecondes), UUID, kind et empreinte des filtres. Format/valeurs/empreinte invalides422. Il ne constitue pas un jeton de permission et peut être construit par un client admin : Auth/RLS est revérifié à chaque page. Pas de doublons/omissions sur jeu inchangé ; les insertions/modifications entre pages nécessitent actualisation pour une vue courante complète.

Total est un COUNT exact sur tous les filtres AVANT curseur, pas la taille de page. COUNT et page sont des lectures séparées, pas un snapshot transactionnel commun ; enrichissement artisan aussi séparé. Les plafonds fournisseur ne doivent pas créer une fausse fin de liste. Un COUNT absent ou page incohérente provoque503.

## Détail minimal hors fenêtre
GET /api/admin/directory?kind=...&id=UUID : seuls kind et id admis. Réponse {kind,item} avec même projection que la liste,404 si absent ou rôle incompatible. Le dossier complet d’artisan reste GET /api/artisan?user_id=UUID, existant ; les membres/sites d’organisation ne sont pas exposés par ce nouveau contrat. Aucune commande métier n’est ajoutée.

401 sans session ;403 hors admin ;404 détail absent ;422 filtres/curseur invalides ;503 fournisseur indisponible. Le frontend doit gérer chargement/erreur/vide et ne plus rechercher uniquement dans les100 entrées overview.

Référence primaire relue : https://supabase.com/docs/guides/database/joins-and-nesting ; l’implémentation choisit deux lectures bornées plutôt qu’une jointure susceptible d’exclure un dossier absent. Aucune preuve cloud ou preview à ce commit.
