# CL-BE-001 — dossier professionnel et travail actif

Base fface1af11d62b19522cc5266b6f2b6b536209c0 ; branche codex/web-pwa-backend. **Plan et contrat publiés avant code ;012 non encore implémentée à cette révision.**

## Plan court

1. Migration012 additive : protéger save_artisan_profile sans modifier001–011, et sérialiser accept_mission/réaffectation avec cette édition.
2. Conserver toutes les vérifications d’approbation, suspension, zone/disponibilité, état, montant, devis exact et portée organisationnelle existantes ; anciens points d’entrée privés, aucun contournement RPC.
3. Tests SQL : refus sans modification, libération après annulation/règlement, suspension prioritaire, disponibilité/contact séparés, attributions après retrait d’approbation refusées, permissions/helpers et ordre de verrous ; régressions existantes. Revue du SHA puis course réseau QA après application autorisée seulement.

## Contrats publics inchangés

`POST /api/artisan` action save_profile conserve ses champs/signature. Nouveau **409** si l’artisan possède au moins une intervention assigned, quoted, accepted, in_progress ou completed : le dossier et artisan_approved restent exactement inchangés. Message utilisateur attendu : terminer les missions et leur règlement, ou obtenir leur annulation/réaffectation selon les commandes permises, avant de modifier le dossier professionnel. Ne pas faire disparaître le formulaire ni prétendre avoir sauvegardé après ce conflit.

Suspension existante reste prioritaire :403 et aucun retour à draft/submitted. Les comptes non-artisan ne gagnent aucun droit. Une fois toutes les missions sorties de ces cinq états, une modification autorisée garde le comportement actuel : dossier draft, disponibilité désactivée et approbation retirée, puis nouveau dépôt/examen. Seuls paid/cancelled libèrent les obligations pour ce contrôle ; completed encore non réglé reste bloquant.

Disponibilité immédiate (`set_availability`) et coordonnées de contact (`PATCH /api/profile`) restent séparées ; aucune interdiction générale d’éditer les contacts ou de devenir indisponible pendant une mission. Cela ne suspend pas automatiquement un chantier. L’opérateur peut toujours suspendre explicitement ; aucune exception d’approbation pour les actes terrain n’est ajoutée.

## Sérialisation

La garde d’édition verrouille profiles puis artisan_profiles (via la garde suspension existante), puis **lit** les missions actives sans les verrouiller. Elle ne prend jamais un verrou intervention après le profil.

L’acceptation de mission et la réaffectation admin prennent les verrous organisation → intervention → profil cible → dossier artisan cible avant d’appliquer les règles existantes. L’administrateur est validé **avant** tout verrou sur un autre profil. Ainsi, soit l’édition précède et retire l’approbation, auquel cas l’attribution échoue ; soit l’attribution précède et la garde observe la nouvelle mission active, auquel cas l’édition échoue. Le test PostgreSQL isolé vérifie les scénarios séquentiels et la structure ; seule une recette multi-session réelle peut démontrer les interleavings ciblées.

Les helpers renommés ne sont plus exécutables par public/anon/authenticated. Signatures RPC et réponses HTTP existantes restent compatibles. Cette correction n’ajoute aucun paramètre frontend ni compteur/client de confiance.

## Limites conservées

Le pilote a renforcé la décision après le contrat initial47e7b13 : completed non réglé bloque également l’édition, car retirer l’approbation bloquerait encore Checkout. Cette version mise à jour prévaut **avant toute implémentation012**. Aucun droit financier ou terrain n’est relâché. Les comptes déjà non approuvés issus de l’ancien comportement avec des missions impayées nécessitent un examen opérateur ; aucune réapprobation automatique ni annulation de dette n’est ajoutée.

Pas de modification directe de la base distante, nouvelle route, effet de notification, règle de TVA ou commande d’administration supplémentaire. Disponibilité des routes/previews et tests intégrés restent indépendants de l’application de cette migration.
