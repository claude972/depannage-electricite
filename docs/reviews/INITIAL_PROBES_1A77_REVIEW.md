# Revue APP première sonde — 1a77fe0

Source exacte : `1a77fe0399509bdcb2e41cb910ec4ec26c861fa2`, worktree shared propre et HEAD inchangé pendant les vérifications. Le checkout a depuis avancé ; cet avis porte uniquement sur ce SHA.

Verdict borné : aucun P1/P2 identifié ; accord pour intégration et recette de première ouverture par root.

La sonde démarre dans un effet React uniquement en mode live, lorsque la capacité est unknown et que la cible est admissible. Les dépendances primitives évitent une boucle causée par les objets de paramètres recréés. QuoteDocumentsAnchor transmet le devis ou dossier courant ; SiteSheet ne sonde que le site identifié dans les sites de l’organisation. Les sondes utilisent uniquement des GET via les clients liés à leur propriétaire de session. Les gardes existantes rejettent les callbacks et résultats périmés ; les vues de documents/sites conservent leurs remises à zéro de périmètre. Un 403 établit seulement la présence du contrat, sans créer de droit ; un 503 expose la reprise. Le mode démonstration ne lance pas la sonde réseau.

Vérifications : 80 tests ciblés PASS (features, anchors, identity, guard et documents) ; TypeScript `--noEmit --incremental false` PASS. Aucun cloud, compte, credential, installation ou build.

Limite : les nouveaux tests exercent le vrai helper de reprise mais ne montent pas l’effet React dans un navigateur. La présence effective du panneau dès la première ouverture doit donc être confirmée après reconstruction de l’application par root ; aucune recette distante n’est annoncée ici.
