# Reprise autonome — objectif31octobre2026 à08h Martinique

La dernière instruction du propriétaire diffère explicitement Vercel et Stripe. Continuer tout le reste ; pas de succès fournisseur inventé. Dès00h, TOUT le code applicatif et code de tests est produit par Claude (1–10 agents). Codex pilote, revoit, exécute les tests existants, intègre/applique les migrations revues et publie les rapports. Les agents QA Codex ne modifient plus de scripts après00h : demander ces changements à Claude.

## État et priorités immédiates

- Lead Claude unique b4b555f0, branche claude/web-pwa-ui ; ne pas le dupliquer. Reviewer distinct c38a6bc4 a fini ses revues jusqu’au012. Lire les SHA réels et CORRECTIONS, pas les statuts historiques.
- Base dédiée kcpyjzndybfdlnhvscbs ACTIVE, migrations001–012 appliquées. Tests réels Auth/RLS/Storage/concurrence, devis, annuaires, support et garde artisan publiés avec nettoyage. Aucune autre base modifiée.
- Intégration309ed9f contient012 et les premiers nouveaux écrans, branche UI plus récente9a321 puis checkpoints à découvrir. Dernière preview prête1be8f00 ; le reste se vérifie localement tant que Vercel est différé. Fallback /tmp/depannage-web-pwa-local-qa sur stockage interne, actuellementb8a277a : avancer uniquement une fois l’agent de test arrêté. Le port de test browser est localhost:3017 (Next dev reconstruit cette origine) ; fichier env privé ignoré.
- Fermer d’abord SUPPORT-REV001 P1 (résultat/effets tardifs entre comptes), CL-UI-008 (vrais callsites et fail-closed autorité site/organisation), puis SUPPORT-REV002 (création incertaine idempotente malgré remount). Ne pas se contenter d’un helper non raccordé.
- Valider le véritable éditeur de brouillon de devis (chargement/save/send/discard/version409), pas seulement les méthodes Session ; contrats010 et backend réels sont prêts. Contrôler photos avec perte de réponse, support privé complet, annuaires admin au-delà100, profil artisan et garde jusqu’au règlement, accès par site et captures fidèles M35/M43/M66.
- Web/PWA fonctionnel vérifié localement et sur backend réel hors deux services différés avant passage natif. Le cycle PWA réel à deux déploiements et la nouvelle preview restent différés, pas réputés réussis. Établir un checkpoint exact et ses limites.

## Puis iOS/Android réellement natifs

Lire expo-overview puis skills nécessaires. Plan actualisé : NATIVE_READINESS_PLAN.md ; prévol : NATIVE_BUILD_PREFLIGHT.md. EAS connecté claude972 (Owner), aucun projet/build à supposer créé. Vérifier avant init et créer un projet mobile dédié sans modifier un projet existant.

Choix technique proposé pour ne pas dépendre de la preview Vercel protégée : Supabase SDK authentifié/RPC et RLS pour les fonctions natives hors paiement, sans aucune clé service dans l’app. Upload privé nécessite un gateway Supabase Edge authentifié et validation partagée/magic/4MiB, autorisation finale de métadonnées et compensation ; pas de bucket public ni simple confiance MIME. Préserver Auth SSR web et proposer PKCE natif via redirections explicitement autorisées et templates conditionnels, jamais token de bypass Vercel embarqué. Relire sources officielles avant code.

Utiliser un checkout natif sur disque interne et dépendances internes, car /Volumes/Stockage est presque plein. Proposition apps/mobile autonome (Expo/React Native), exclu du compilateur Next sans restructurer le web ; tokens partagés seulement si sûrs. Séparer propriété mobile core/config/auth/data, routes client, routes artisan, gateway backend et scripts QA ; ne jamais faire modifier les mêmes fichiers partagés par deux agents. Respecter les1–10 agents Claude effectifs et les permissions normales.

SDK58 officiel : le cloud doit fournir Xcode>=26.4/AndroidcompileSdk37, la machine possède Xcode26.3/platform36. EAS cloud prioritaire ; comptes/quotas/signatures à vérifier. Simulateurs iOS26.3 et AVD Android36 présents pour exécuter un binaire compatible, pas une preuve de build. Aucun achat, acceptation de licence, publication stores ou débit réel implicite.

## Reprises et bilan

Les reprises de pilotage00–07 et bilan08 sont actives dans ce chat ; elles lisent MISSIONS/CORRECTIONS. Réutiliser les sessions, ne pas créer d’automations supplémentaires ni de doublons d’agents. Publier les contrats avant code, les preuves au SHA exact, les refus d’accès et limites. Ne pas déclarer les76 capacités terminées d’après les fichiers/tests ; l’échéance ne remplace pas les critères. Au bilan08 : code/livrables/liens prêts, tests réels, fonctions utilisables et reste explicite. Pas de production ni stores publics sans autorisation.
