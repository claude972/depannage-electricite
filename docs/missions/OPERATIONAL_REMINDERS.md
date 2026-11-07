# SYS-04 / ART-03 / ENT-14 — Rappels personnels d’échéance

Astra propriétaire backend unique ; branche codex/operational-reminders depuis 155996d. AGENTS/DESIGN et skills fastsplit/Supabase appliqués. Aucun cloud, SMS/email ni facture à échéance inventée.

Plan : heure explicitement choisie avant la date enregistrée du justificatif ou de conformité, rappel personnel versionné et annulable, reprise par commande stable. Réévaluer identité/rôle/périmètre/date/version/archivage avant notification interne. Traitement borné et dédupliqué ; définition de cron dédiée inactive tant que recette non faite, sans modification GPS ni rendez-vous.

Vérification : vrais handlers, SQL avec refus et invalidations, worker simulé, limites/préférences/déduplication, TypeScript. Contrat UI puis push pour assemblage.
