# Re-audit documentaire et intégrité des sources

## Sources consultées / méthode
- AGENTS.md et DESIGN.md lus intégralement.
- docs/audit/INVENTAIRE_SOURCES.json : neuf PDF, 93 entrées de maquettes ; chacun des neuf fichiers original comparé à son SHA-256 ; pagination recalculée avec pypdf ; les 93 empreintes d'images recalculées depuis les flux XObject `/Image` décodés `get_data()`.
- docs/audit/INVENTAIRE_ARCHIVES_CODE.json : chacune des cinq archives et chacun des 61 membres lu via tarfile/extractfile et comparé au SHA-256 du manifeste ; aucun membre exécuté.
- SPECIFICATION_COMPLETE_FINALE_PROJET.pdf p1 : texte intégral relu avec pypdf ; sections 1 à 7.
- docs/SPECIFICATIONS_A_COMPLETER.md intégral ; docs/PLAN_REPRISE.md intégral ; catalogue des maquettes et compléments V5/V8 consultés ; matrice de l'audit parcourue.
- Pas de nouvelle inspection visuelle de tous les PDF dans cette sous-revue : leurs fichiers sont strictement identiques aux sources de la précédente revue. Les constats de composition détaillée reposent sur les catalogues visuels précédents, pas sur un nouveau rendu prétendu.

## Résultat d'intégrité
- 9 PDF : SHA conformes pour tous ; 102 pages indépendamment recomptées ; 93 occurrences ; 63 flux d'images distincts ; 12 groupes de doublons. Les 93 hash d'image du manifeste sont corrects.
- Important : ces empreintes sont celles des flux image décodés du PDF, et non des fichiers PNG recompressés par l'API page.images de pypdf. Les PNG ont d'autres hash sans que la source soit altérée. Préciser cette méthode dans le manifeste pour rendre la preuve reproductible.
- 5 archives : SHA conformes ; 61 membres réguliers ; 17 chemins de fichiers ; 19 contenus distincts. Les quatre premières donnent 16 fichiers distincts ; la cinquième apporte animations.css et deux variantes HomePage/styles. Les sous-ensembles exacts ne concernent que 1/2/4 par rapport à 3. Aucun backend ou contrat API supplémentaire dans les archives.
- Aucune présence retrouvée des numéros initiaux 19–32. Ne pas transformer ce trou de numérotation en quatorze fonctionnalités obligatoirement manquantes.

## Corrections documentaires concrètes pour la réécriture
1. docs/audit/CATALOGUE_MAQUETTES.md:150 conserve une ancienne Q-PDF-27 affirmant « tableaux et fiches bureaux annoncés mais pas fournis explicitement ». C'est désormais faux au présent : V5-C01 et V5-C05 les fournissent. Le début du catalogue le corrige déjà, mais la duplication reste contradictoire. Remplacer cette cellule par un renvoi au registre canonique, ou la qualifier explicitement historique.
2. docs/audit/CATALOGUE_MAQUETTES.md:193 conserve une confiance sur « inventaire56numéros » et parle d'absence de revue code par parent ; vrai seulement pour la collecte initiale. Conserver comme historique encadré ou consolider. Les multiples compteurs 60/71/102 pages sont corrects historiquement mais augmentent le risque de lecture erronée ; un état courant au sommet puis annexes historiques séparées est préférable.
3. docs/PLAN_REPRISE.md:178 dit que la préparation « ajoute la copie du nouveau PDF source » ; périmètre ancien, n'intègre pas les cinq archives. Remplacer par un état actuel unique de toutes les sources.
4. docs/PLAN_REPRISE.md:152 repousse « matching géographique et distances » au même grand lot que abonnements/IA. La spécification finale §4 décrit matching intelligent + géolocalisation et §7 met matching implicite dans le parcours MVP. Distinguer **éligibilité minimale par territoire/compétence/disponibilité et attribution atomique** dès socle artisan-client, puis scoring et géolocalisation avancés plus tard. Une liste globale d'offres ne constitue pas une base métier prête à exploiter.
5. Même plan : les phases restent trop vastes (artisan « complet », entreprise tous types, SuperAdmin entier) ; introduire sous-lots vérifiables, dépendances et IDs des 76 capacités. Chaque capacité doit avoir une destination explicite, même lorsqu'elle est différée. Séparer refus d'offre / refus de devis / annulation / réaffectation ; aucun ne doit être implicitement couvert par un bouton « Refuser » générique.
6. Ne pas laisser les corrections de sécurité P0 dans une grande phase UI avant backend. Révocation/propriété d'organisation, fuite de cache et retour Auth/Stripe doivent être prérequis explicites aux parcours connectés, indépendants des choix commerciaux.
7. Spec §7 situe fiches détaillées complètes, contrats, reporting consolidé et conformité ERP en V3 ; ne pas annoncer les verticales B2B complètes comme MVP. Le propriétaire demande bien que tous les besoins soient notés : cela exige couverture et calendrier, pas suppression ni promotion automatique au premier lot.
8. Le registre Q-PDF-35 cite bien le diagnostic photo IA V3. Le refus du style IA est une règle de design, pas une interdiction de cette fonctionnalité. Rendre cette distinction visible dans le périmètre différé.

## Acteurs et scope, sources précises
- Client B2B et syndic : spécification §1–3 ; M4 Gp4, M66 V4p19, syndic M13/M16 Gp13/16, restauration M50/M56 V4p3/9, ERP M37 V3p6 et M57 V4p10, bureaux V5-C01/C05 p2/6. Espace propriétaire/gestionnaire/approbateur/lecteur/payeur à spécifier. Ce n'est pas la société d'artisans.
- Artisan individuel : §2 ; M34–36 V3p3–5, M14 Gp14, M44 V3p13 et M65/67 V4p18/20 ; candidature, disponibilité, missions, devis, preuves, paiements, performance.
- Société prestataire avec techniciens : M65 effectif/entreprise et blueprints M6 Gp6, M52 V4p5, M69 V4p22. Suggestion réelle, mais tableau et matrice des droits non complètement prescrits : Q-PDF-32 doit trancher son inclusion explicite et son lot. Ne pas la déclarer satisfaite par le rôle manager B2B.
- Exploitant/Super Admin : M43 V3p12 ; compte Admin Super Admin et menus Artisans, Interventions, Devis/Factures, Clients, Avis/Notes, Messages, Paramètres. Source explicite ; droits support/finance/superadmin restent à définir. Les deux seuls panneaux existants ne satisfont pas cet espace.
- Périmètre électrique : spec §1–3 ; exemples plomberie/peinture/facility management, hygiène/accessibilité/incendie et immobilier global des maquettes ne deviennent pas automatiquement des modules.

## Références et motifs réutilisables
- Source fonctionnelle à reprendre : SPECIFICATION_COMPLETE_FINALE_PROJET.pdf p1 §2 parcours par acteur, §3 verticales, §4 avancé, §7 ordonnancement.
- Table acteur/capacité : docs/AUDIT_COMPLET_SPECIFICATIONS.md:76–187, IDs PUB/CLI/ART/ENT/ADM/FIN/SYS. Les IDs sont la base de traçabilité ; le nombre76 n'est pas un pourcentage de complétude.
- Structures visuelles à sélectionner : catalogue lignes82(M43),105(M66), compléments V5-C01/C05/C08 et V8-C06/C07. Lire les pages visuelles originales avant implémentation.
- Archives : references/code-archives/3-CODES_ET_CSS_COMPLET.tar.gz membres ArtisanMission.jsx, ArtisanDashboard.jsx, B2BDashboard.jsx et SiteDetail.jsx = amorces de composition, pas implémentation fonctionnelle. Cinquième archive styles.css/HomePage.jsx/animations.css = variante à sélectionner, pas à concaténer.
- APIs autorisées documentaires : aucune nouvelle API de service fournie par les pièces. Ne pas inventer endpoints, SDK ou règles contractuelles à partir des schémas. Lire les routes existantes et documents officiels versionnés au lot technique (travail des autres revues).

## Confiance et limites
Élevée sur intégrité, pagination, occurrences/doublons et contradictions documentaires citées. Moyenne sur menus/champs visuels fins dans cette passe, car réutilisation des catalogues précédemment inspectés plutôt que nouveau rendu intégral. Aucun service distant, statut de facturation, variable Vercel ou paiement actuel vérifié ici. Aucune conclusion juridique/fiscale ; les 38 domaines de décisions + V5/V8 restent ouverts tant qu'une règle n'est pas documentée. Aucun fichier du dépôt modifié par cette sous-revue.
