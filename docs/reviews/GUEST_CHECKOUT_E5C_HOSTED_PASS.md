# Parcours réservation — livraison bornée du 1 novembre 2026

Application poussée et déployée : `e5c82681deb3f9956ca0dc48ece150437d03dc16`.
Preview publique : https://depannage-electricite-gy7wyxhjk-brafas-projects.vercel.app
Déploiement READY : `dpl_3Swvh9sFnDa8HdbcwVRtk8AJGYS7`, GitSource GitHub lié à `integration/web-pwa`, Flight `JVgF3INtZ2M3jJeHRwkxi`. CI `41332926660` : deux jobs SUCCESS. Exception publique limitée à ce déploiement ; aucun changement main/production/configuration SMS ou Stripe.

## Intégré
Urgence → coordonnées → adresse → paiement → récapitulatif. Email facultatif ; mobile normalisé, erreurs explicites, boutons sous le formulaire et barre fixe. Réservation sur place atomique et idempotente, contact privé distinct de la description. Empreinte manuelle codée : redirection Stripe contrôlée, preuve serveur avant confirmation, annulation et reprise propriétaire même sans brouillon. Création facultative d’un accès email sur le même UID ; suivi téléphonique et historique privé paginé codés, réponses tardives d’une ancienne identité ignorées.

## Vérifié
- ROOT : suite assemblée `09e4e11`, 1 074 tests PASS, zéro skip ; après le dernier correctif de validation, 49 tests ciblés PASS et TypeScript strict PASS. La CI de la source finale ci-dessus est verte, builds inclus.
- SQL022 : 110 assertions PostgreSQL isolées PASS ; SQL023 : 33 PASS. Auth/Storage/cron explicitement simulés, sans preuve fournisseur ni concurrence réelle déduite de ces tests. Migrations022–023 appliquées par ROOT, RLS et ACL relues sur le projet dédié ; aucune modification001–021.
- Preview finale : huit cas 360/390/1280/1804 × clair/sombre PASS, cinq étapes sans email, validation, retour conservant les valeurs, deux actions de continuation, paiement sur place proposé, carte/SMS non configurés honnêtement, zéro mutation et erreur JS. Quatre API privées anonymes : 401 JSON private/no-store.
- Vraie recette sur cette preview, run `3419e9df5929` : **21/21 PASS**, deux clients email QA volontairement connectés et un dossier créé par l’UI. Deux POST simultanés puis réponse perdue et reload/rejeu : même UUID, un dossier, un audit et chaque quota consommé une fois. Contact privé exact, aucune donnée personnelle dans la description ; paiement sur place, `paid_at` nul ; refus client tiers et UUID absent uniformes.
- Nettoyage terminé : drain0, sept intentions réglées, aucun effet inconnu. ROOT postflight indépendant après fin du writer : **47/47 PASS**, deux Auth404 exacts, 43 lectures REST à zéro dont les ledgers021/022, deux préfixes Storage vides. Aucune cohorte de ce run conservée.

## Limites explicites
SMS et Stripe seront fournis à la fin à la demande du propriétaire. Les branches téléphone/empreinte/upgrade sont testées avec APIs simulées ; aucune livraison SMS, réception email, autorisation ou capture Stripe réelle n’est affirmée. Le test connecté utilise l’alternative compte email existant, il ne prouve pas une identification téléphonique réelle. Le règlement sur place reste à effectuer ; aucun encaissement n’est inventé. La qualification fournisseur reste à effectuer lors de l’activation. Le règlement financier final d’une empreinte (capture et transfert) n’est pas livré par ce checkpoint ; son implémentation suit dans une mission séparée, sans attendre les clés. Ce rapport ne clôt pas toutes les capacités de l’application, le support opérateur ou les stores natifs.

Historique conservé : huit FAIL de la preview `09e4e11` ont révélé que l’email restait obligatoire ; le code a été corrigé par `380614e`, puis les huit cas ont été rejoués sur la source finale avec email vide. Les défauts de confidentialité de l’historique et de contexte pendant la vérification carte ont été reproduits et corrigés avant cette livraison.

Preuves privées hors Git : `guest-e5c-five-step-public-proof.json`, `guest-e5c-anon-api-proof.json`, `booking-connected-v4-onsite-3419e9df5929/{report,cleanup,intents,manifest,independent-postflight-v4-onsite}.json` dans le dossier QA privé du propriétaire. Aucun credential, OTP ou token n’est inclus dans ce rapport.
