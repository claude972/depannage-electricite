# Gateway83fd — deux tentatives réelles, pas de preuve de course

Source épinglée83fdad9, EdgeTESTv1d7abd8c inchangée. Première préparation20261031t1916bd2bd5 : vrai RPC sous authenticated owner, selected/0grants commités ; upload403, objet exact découvert puis absent/documents0. **FAIL/nonpreuve** car observation SQL0ligne, blocage finalisation non observé. Cleanup35PASS puis12scopes0/2Auth404/2Storage0 indépendant.

Deuxième préparation20261031t19197d39cc avec ordonnanceur ROOT démarrant la CLI lot après la phase de preuves distante : upload201, la finalisation a gagné avant acquisition du verrou (t_lock19:20:49.620, réponse20119:20:48.787). Révocation commitée ensuite mais **FAIL course perdue**, observation0ligne. Le document effectivement créé a été nettoyé,37cleanupPASS puis12scopes0/2Auth404/2Storage0 indépendant. Pas de pause augmentée au-delà3s, pas d'Edgehook ni fakePASS sur timing.

Les deux histoires et preuves privées /tmp/depannage-gateway-revoke-83fd-{live,live-2} sont conservées. Une fenêtre réellement observée reste à acquérir ; aucun compte de ces runs n'est maintenu. Expiry6466 séparée consommée/nettoyée :401 code générique OBSERVED et signature sousJWKSactuel vérifiée, pas PASSexpiration strict.
