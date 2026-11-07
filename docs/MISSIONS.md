# Missions UI (Claude)

## SYS-07 — demandes d’effacement (UI)

Claim : `claude/data-requests-ui` (base 44c35f2). Contrat Astra c0df158 (`docs/DATA_ERASURE_REQUESTS_BACKEND.md`,
`lib/features/data-requests/contracts.ts`) recopié strictement dans la feuille `components/features/data-requests/`,
sans fusion ni cherry-pick. Client : liste privée « Mes demandes d’effacement » dans « Mes données » (opt-in,
espace client uniquement). Opérateur : composant indépendant sous la file d’assistance. Aucune exécution
d’effacement.
