# Contre-revue DETAIL_READ — 2058c2c

Source exacte :2058c2cdb2ac31261c41753cf7d66d821e50a261 (amendement637fffd), docs/DETAIL_READ_CONTRACT.md. Comparaison à2f9 et à la source58b. Docs seulement ; aucun code, appel cloud, credential ou mission de codage activée.

Verdict : conception nettement complétée, mais deux P2 à corriger avant GO implémentation et annexe de projections encore à figer. Ownership Codex des ajoutsworkspace reste une proposition à publier dans la mission dédiée, pas une attribution active induite par cette revue.

## Reprise des trois anciens P2

001 : absence du signal désormais traitée par ajout explicite limits + ownership backend et fallback utilisateur sanssignal, jamaisnotfound affirmé. Ce point de conception est corrigé, sous réserve de la définition mathématique ci-dessous.

002 : enveloppe nommée, statuts par dépendance, caps et headers désormais définis. La distinction erreur/invisible/absence est meilleure. Restent la complétude transitive paiements et les projections réelles intervention/quotes/messages encore placeholders auxlignes21/24/26/34.

003 : cache indépendant borné20LRU/TTL60s, purge identité/rôle/org/site/droits connus, revalidationouverture/focus/TTL sansdépendanceRealtime désormais explicites. L’essentiel du P2 est fermé. Clarifier encore stablekey vs générationrequête (ci-dessous), sans besoin de frameworknouveau.

## DETAIL-2058-001 — P2 : limited ne doit pas signifier « exactement le plafond »

Ligne9 définit limited vrai quand la lecture renvoie exactementlimit lignes, tout en citant limit+1 ou countexact comme preuve ; ligne33 applique la même règle aux souslistes. Ces formulations sont incompatibles. N=100 sur plafond100 ne prouve aucune lignecachée ; si la vraie lecturelimit+1 renvoie101, le critère textuel «exactement100» devientfaux.

Correction : limited=(nombrevisible sousRLS > L), via ligneL+1 réellement reçue ou totalexact>L ; exposer seulementlesLpremières. Tester N=0,L-1,L,L+1 pourchaqueliste. Préciser que limits.interventions mesure les interventionscomplètes lues sousRLS, pas la concaténation avec lesoffresartisan anonymisées dont le plafond est indépendant. Aucun compteur de lignes étrangères n’est exposé.

## DETAIL-2058-002 — P2 : absence de paiements non prouvée quand les devis parents sont tronqués

Lignes24–25/32 : devis≤20, puis paiements par quote_id dans cesdevislus. Avec21devis du dossier et unpaiement rattaché au devis accepté horsdes20retournés, la requête enfant renvoie0 et payments.limited=false selon son propreplafond ; le consommateur peut afficher«aucunpaiement» alors que sa lecture est incomplète. Même problème si quotes.status=error et aucunquote_id n’est disponible.

Correction : soit lire les paiements dans le scopecomplet du dossier sousRLS indépendammentdu cap des devisretournés, soit transmettre explicitement l’incomplétude parentale et interdire toute interprétation d’absence/complétude enfant. Définir aussi le traitement d’uneversion sélectionnée ou acceptéenonretournée. Si parenterror, un enfant nonrésolu devienterror/inconnu, jamaisokitems[]par défaut. Test21devis+paiementhors20 et erreurrequêtedevis obligatoire avantrecette.

## Gate de projection encore explicite

Ligne34 promet les colonnes exactes «figéesdanslefichiertypes…revuesavantcode». Cette condition n’est pas remplie dansleprésentdocument : intervention/quotes/messages restent des placeholders. Les définitions nommées/types/nullabilité/projections exactes doivent être livrées en annexe de contrat avant l’implémentation, pour que backend/hook/lead ne définissent pas troisinterfaces différentes. Pas de select* ou de validationworkspaceid/status suffisante pour un dossiercomplet.

## Statuts none/hidden/error et périmètres

Pas de nouvelle fuite intrinsèque dans cesstatuts pour un dossier déjà autorisé : son site_id est déjà une donnée lisible. hidden doit signifier uniquement«lectureRLSréussie sansligne», sans distinguerinexistant/interdit, sansID/nom récupéré autrement. none uniquement quand aucune relation ne s’applique. Si sitehidden ouerror, organisation doit propager respectivementhidden/error sans requête de découverte privilégiée ; si site_idNULL, organisationnone. Pas de fallbackservice ou d’énumération. Afficher une erreurlocale sur200partiel est cohérent tant que les états sont validés et jamais convertis enabsence. Horscaps100/50, site/org restent des dépendances liées au dossier autorisé, sans changement silencieux du contexteorganisation/siteactif.

## Clarification courte de cache

Lignes44/48 : la clé contient générationdedemande et une requête est permise«parclé». Séparer la clé stable de cache/contexte/id et le compteur monotone des vols : sinon deux causesmêmeid peuvent choisir deuxgénérations et échapper au singleflight annoncé. Dire explicitement qu’un ancienvol d’un autrecontexte n’est jamais rejoint, et comment une revalidation prend sa barrière. LRU20/TTL60s/purge restent adéquats ; ce reliquat de formulation n’est pas classé comme un nouveauP2 de fuite.

La correction du cas clientpropriétaire requested sansartisan est acquise (ligne15) ; l’exclusion concerne bien l’artisan seulement éligible à uneoffre. RLS009 et refus deservicekey/nouvellepolicy préservés.404/503/Retry-After2/no-store explicites, y compriscatch. Aucun test d’implémentation exécuté ni résultatRLSlive inventé.
