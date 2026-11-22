# ENT-12 — Circuit d’approbations avancées

Astra seul auteur backend. Branche codex/advanced-approvals depuis 4c9d7a1. Skills fastsplit/Supabase et règles AGENTS/DESIGN appliqués ; aucun cloud/UI.

Plan : politique explicite par site, étapes ordonnées avec rôle exact ou membre désigné ; dossier de décision attaché au devis exact et à ses conditions ; complément/réponse, historique immuable, versions et commandes stables. Brancher le garde sur l’acceptation réelle existante, sans auto-accepter le devis. Absence de politique avancée active : approbation simple inchangée. Les avenants, réception de travaux et facture ne sont pas annoncés couverts par ce lot.

Vérification : vrais handlers et SQL nominal/refus/retrait/changement de devis/politique/rejeu ; accord final via intervention_action existant ; TypeScript. Contrat UI puis push pour revue groupée.

## Résultat

Contrat : `docs/ADVANCED_APPROVALS_BACKEND.md`, schémas UI partagés. Circuit réellement branché au garde d’acceptation existant, sans mutation de devis ni mouvement financier. Deux routes politiques/dossiers, historique et commandes stables. Les avenants, réception/facture restent hors de ce delta.

Preuves locales : 47 contrôles SQL sur 55 migrations PASS ; 8 tests de handlers PASS ; SQL global 29 blocs PASS ; TypeScript PASS. Auth/Storage/cron simulés ; interleavings séquentiels, pas de concurrence multi-connexion ni de recette hébergée.
