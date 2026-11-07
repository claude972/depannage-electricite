# Artisan mission radius

Leaf for `GET/POST /api/artisan/mission-radius` (contract given by ROOT, backend built in parallel;
strict UI-side schemas in `contract.ts`). Reference commune from the server's options + radius 1–200 km,
or both null. Approximation between commune centres; unknown postal codes matched by postal code only;
source + retrieval date shown. No geolocation, no client-side filtering. Mounted in Missions ›
Disponibles; a confirmed save bumps the AvailableMissionsPanel key (offers restart at page 1).
Command fenced under `courant-private-mission-radius:<uid>:<gen>`. Demo: note, zero calls.
