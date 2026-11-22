# FIN-08 — cartes personnelles enregistrées

Base42845d3 ; migration CLI `20261107210543_saved_payment_methods.sql`.

## Contrat UI

Compte personnel authentifié : profil `client`, Auth non anonyme, adresse e-mail confirmée. Le profil `manager`, l’artisan, l’admin, un compte non confirmé ou un guest ne reçoivent pas ce droit. Aucun rapprochement par e-mail/téléphone ni par appartenance à une organisation.

- `GET /api/payments/methods` → `{methods:[{id,brand,last4,exp_month,exp_year}],has_more}`. Page20, suite facultative `?after=<dernier id>` ; le curseur doit encore appartenir au Customer. Aucun Customer ID, nom, adresse, fingerprint, token, donnée de facturation ou numéro complet ne sort.
- `POST /api/payments/methods` `{action:"setup",consent:true,command_id:"uuid"}` → `{url}`. Consentement explicite obligatoire. Conserver la commande avant l’appel et la réutiliser après503 ; une création encore incertaine interdit une autre commande de setup.
- Retour : `/?saved_methods=returned#profile`, annulation : `/?saved_methods=cancelled#profile`. Le paramètre est un simple signal de relecture **GET**, jamais une preuve de carte enregistrée. Pas besoin de session Stripe fournie par le navigateur.
- `POST` `{action:"remove",method_id:"pm_…",command_id:"uuid"}` → `{removed:true}`. Confirmation UI avant retrait : le détachement Stripe est irréversible. Réutiliser la même commande après réponse perdue.
- États401 connexion,403 autorisation,409 opération à vérifier/relecture (pas remplacement automatique de commande),422 validation,503 indisponibilité/reprise même commande. Réponses privées `no-store`, erreurs fournisseur non exposées.

La gestion des cartes se fait dans Mon profil. La sélection pour chaque règlement se fait dans Stripe Checkout après activation du raccordement ci-dessous.

## Preuves et garde-fous serveur

Customer lié durablement à `(user_id, live)` dans un schéma privé sous RLS sans grants directs API, y compris service role. Seules les RPC minimales sont accessibles : garde personnelle authentifiée ; contexte, commandes et preuves au service role. Chaque RPC revérifie le profil/Auth actuel. Pas de coordonnées personnelles recopiées dans la création Customer : marqueur opaque de liaison, recoupé avec la liaison SQL et le mode sur chaque réponse.

Commande persistée avant mutation Stripe, identifiants techniques aléatoires stables. Création Customer : même clé et mêmes paramètres ; création Checkout : même commande et mêmes paramètres. Une réponse perdue est rejouée dans une fenêtre conservatrice23h, vérifiée immédiatement avant appel. Après ce délai, aucune nouvelle création n’est tentée automatiquement. Un Customer connu n’est jamais remplacé après une erreur de lecture. La liaison comporte une unicité par compte/mode et par Customer/mode ; commandes sérialisées côté SQL.

Checkout exclusivement `mode=setup`, `customer` exact, cartes seulement ; aucun montant, ligne, PaymentIntent de paiement ou abonnement demandé. Réponse contrôlée : mode, Customer, livemode, session, marqueur de commande, absence de montant/paiement/abonnement et URL HTTPS `checkout.stripe.com`. Retours construits depuis l’origine configurée validée, HTTPS ou localhost HTTP ; jamais une URL fournie par le client. Live refusé sans `STRIPE_LIVE_PAYMENTS_ENABLED=true`, comme le garde projet existant.

GET relit Stripe avec le Customer précis et contrôle chaque méthode/mode avant de ne retourner que les champs masqués. Le retrait vérifie deux fois l’identité et l’appartenance, enregistre la preuve d’appartenance pour cette commande, revérifie l’accès puis détache avec une clé stable. Réponse de détachement vérifiée (méthode exacte, mode, Customer null). Après réponse perdue, une relecture `customer=null` n’est reconnue que si **cette commande** avait enregistré l’appartenance. Une carte étrangère ou déjà détachée sans cette preuve est refusée. La preuve `removed` durable rend le rejeu sans nouvel effet.

## Vérification et limites

Tests `tests/saved-payment-methods.test.ts` : vrais handlers avec dépendances injectées, nominal, absence de données sensibles, refus, clés stables/réponses perdues, mode/live, origines, pagination, révocation.

`tests/sql-saved-payment-methods-review.mjs` : migrations complètes PGlite, ACL, rôles/Auth, liaison/mode, commandes/rejeu, fenêtre, reprise ; exécute aussi les vrais handlers reliés aux RPC SQL avec Stripe seul injecté. Les stubs historiques pg_cron ne valent pas preuve d’un scheduler ; ce lot n’en ajoute aucun.

Les tests utilisent Stripe injecté et PostgreSQL isolé. La recette hébergée et la vérification sur Stripe restent à faire.

Sources officielles consultées : [Checkout setup](https://docs.stripe.com/payments/checkout/save-and-reuse), [idempotence](https://docs.stripe.com/api/idempotent_requests), [liste des méthodes](https://docs.stripe.com/api/payment_methods/list), [détachement](https://docs.stripe.com/api/payment_methods/detach). Stripe peut supprimer les clés API v1 après24h ; la fenêtre23h conserve une marge technique.

### Compatibilité URL Checkout — correction de revue

La [réponse officielle Checkout Session](https://docs.stripe.com/api/checkout/sessions/object) contient une URL `checkout.stripe.com` avec fragment `#fid…`. Ce fragment est conservé à l’identique, opaque ; aucune lecture ni réécriture. Origine HTTPS exacte, absence d’identifiants et port standard restent contrôlés. Le garde d’origine de retour configurée reste séparé et refuse toujours son propre fragment.

La même référence documente `amount_total` comme entier nullable ; aucune valeur0 spécifiquement documentée pour setup n’a été trouvée dans cette référence et le guide setup consulté. Le lot conserve donc `amount_total=null` pour setup, refuse les montants numériques et ne généralise pas l’exemple en mode payment. À confirmer contre la réponse réelle en recette Stripe autorisée ; aucun élargissement spéculatif.

## Règlement d’un devis avec une carte personnelle

`20261107211438_saved_customer_checkout_binding.sql` prépare le raccordement. Il est désactivé par défaut. Une fois le mode Stripe choisi, le premier règlement d’un devis personnel peut fixer le Customer vérifié du même compte et du même mode dans son registre privé. Stripe Checkout présente les cartes éligibles. Le client confirme chaque règlement sur Stripe.

Une commande existante garde ses paramètres initiaux. Avant l’envoi, le serveur revérifie le compte, le droit de régler et la liaison du Customer. Les parcours avec site, payeur délégué et réservation invitée gardent leur traitement existant. Les tests couvrent le cloisonnement, la reprise du même Checkout et la coexistence avec les anciennes versions de la route. [Documentation Stripe](https://docs.stripe.com/payments/existing-customers?platform=web&ui=stripe-hosted)
