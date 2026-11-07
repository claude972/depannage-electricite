# Operational reminders (SYS-04 / ART-03 / ENT-14)

Personal deadline reminders for artisan credentials (`expires_on`) and site compliance records
(`due_on`), Astra eb138d6 (contract copied strictly in `contract.ts`; the commit also edits shared
notification files and migrations). Separate from `appointment-reminders`.
- `CredentialReminderPanel({ credentialId, context, demo })` — mounted on the artisan « Mes documents » cards.
- `ComplianceReminderPanel({ complianceId, context, demo })` — for the enterprise site compliance records.
State/eligibility/status exactly as returned (no history list in the contract); explicit Martinique
date + time; commands fenced under `courant-private-op-reminders:<uid>:<gen>:<kind>:<id>`. In-app only;
emission is never promised. Demo: honest note, zero calls.
