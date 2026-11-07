# ART-12 — ownership et plan backend

Branche codex/provider-teams, base cb90544. Astra seul auteur des nouvelles tables/RPC, lib/features/provider-teams/**, routes /api/provider-teams/** et /api/provider-team-invitations, tests et contrat. Aucun fichier d’attribution artisan atomique, devis, finance ou droits globaux modifié.

1. Équipe distincte de l’organisation cliente : dirigeant = artisan approuvé titulaire, rôles internes planificateur/technicien ; aucun changement de profiles.role. Invitations nominatives par email confirmé, sans envoi externe ; acceptation personnelle, retrait et changement de rôle.
2. Après attribution existante à cet artisan seulement, affectation interne d’un technicien actif, versionnée et rejouable ; liste/détail opérationnels bornés. Le technicien confirme sa prise en charge et termine sa tâche interne sans changer l’état commercial du dossier. Devis, paiement, signature et rapport officiel restent au titulaire.
3. Refus interéquipes, avant attribution, après retrait/réaffectation/suspension ; RLS et tables sans accès direct. Relecture des droits avant retry, commandes stables, historique privé unique, limites explicites.
4. Contrat UI communiqué avant raccordement ; vrais handlers, SQL isolé, régressions des droits historiques et TypeScript ; push pour revue groupée. Aucune migration cloud ni fournisseur.
