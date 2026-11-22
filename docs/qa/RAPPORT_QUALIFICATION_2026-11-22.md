# Rapport de qualification des 76 capacités — 21 et 22 novembre 2026

Candidat : `main` au commit `bda85303`, déployé sur la recette `https://domdepannage-recette-20261112.vercel.app` (base Supabase de recette, Stripe en mode TEST). Comptes et dossiers synthétiques uniquement ; aucun paiement réel, aucun envoi externe.

Matrice mise à jour : [MATRICE_PARCOURS_2026-11-19.csv](MATRICE_PARCOURS_2026-11-19.csv). Preuves détaillées par capacité (texte) : [preuves-2026-11-22/](preuves-2026-11-22/). Les captures d’écran (environ 1 250 fichiers, 305 Mo) restent hors dépôt, sur le poste de recette, dans `~/dev/domdep-qa/shots/`.

## Résultat

**L’objectif de plus de 90 % de PASS n’est pas atteint.** Sur les 228 cellules (76 capacités × 3 plateformes) : 118 PASS, soit 52 %. En écartant les 53 cellules sans objet en natif, 118 sur 175, soit 67 %. Aucune cellule n’est en échec ouvert.

| Plateforme | PASS | Partiel | Bloqué | Désactivé | Non testé | Sans objet en natif |
|---|---|---|---|---|---|---|
| Web | 56 | 17 | 1 | 2 | 0 | — |
| Android | 32 | 15 | 1 | 0 | 0 | 28 |
| iOS | 30 | 18 | 0 | 0 | 3 | 25 |

État de départ (19 novembre) : 7 PASS, 51 partiels, 128 à qualifier.

Vocabulaire de la matrice : `PASS` = joué de bout en bout dans l’interface et état serveur relu ; `PARTIEL` = une partie prouvée, reliquat nommé ; `BLOQUÉ` = dépend d’un fournisseur externe absent ; `DÉSACTIVÉ` = fonction fermée par configuration, état indisponible vérifié ; `N/A_NATIF` = l’application mobile n’a pas d’écran pour cette capacité (renvoi vers le web ou rôle absent) ; `NON_TESTÉ` = non exercé à l’écran.

## Méthode et limites

- **Web** : Playwright (Chromium), parcours joués dans l’interface à 1280 px et 390 px, états relus en base, refus inter-comptes vérifiés. Premier passage sur un serveur local ; à partir de 23 h 45 le serveur local s’est arrêté et tous les re-tests ont été faits sur la recette déployée.
- **Android** : émulateur Pixel 6, API 34, application ouverte dans **Expo Go**, pilotée au toucher (adb, Maestro en contrôle).
- **iOS** : simulateur DomDep-iOS27 (iOS 27.2), application ouverte dans **Expo Go**, pilotée au toucher (Maestro, simctl).
- **Limite native** : Expo Go n’est pas un binaire de distribution. Le retour automatique dans l’application après paiement (lien `depannageelectrique://`), les notifications système et le comportement d’un binaire signé ne sont pas couverts. Aucun appareil physique.
- **Pas d’accès d’administration à la base** : aucune migration SQL n’a pu être écrite ni appliquée. Les corrections qui l’exigent sont listées plus bas.
- Une seconde session a travaillé en parallèle sur les paiements web ; ses résultats (`pay.json`) sont intégrés.

## Phase 1 — publication commerciale

Données validées par le propriétaire le 21 novembre 2026, publiées telles quelles :

| Donnée | Où | État |
|---|---|---|
| Zone : Martinique entière, 972xx | Couverture publiée (97200 à 97299, version 1) ; vérification par code postal sur web, Android, iOS | Publié |
| Garantie plateforme (satisfaction, ré-intervention, remboursement) | Conditions version 2 publiées, demandes activées ; parcours de garantie joué de bout en bout sur web | Publié |
| Commission 10 % | Paramètre d’administration (1 000 points de base) et `PLATFORM_FEE_BPS=1000` sur la recette ; six paiements TEST prélevés à exactement 10 % | Publié |
| Prix : barème horaire + devis précis avant travaux ; urgence +25 % ; grille dans le site | Page Tarifs, aide mobile, récapitulatifs de demande (web et mobile) | Publié (affichage) |
| Exploitant : TTBM SARL, SIREN, SIRET, RCS Fort-de-France, adresse, gérant | Mentions légales, À propos, aide mobile ; émetteur des factures | Publié via `shared/commercial-facts.ts` |

Restent « À renseigner par l’exploitant », faute de donnée fournie : adresse e-mail de contact, e-mail données personnelles, téléphone, hébergeur (nom, adresse, contact), titulaire des droits, numéro de TVA et taux de TVA sur commission, équipe, durées de conservation, montant du barème horaire, frais de déplacement. Conséquences : le profil opérateur reste en **brouillon** dans l’administration (la publication exige les deux e-mails et l’hébergeur) ; la facture de commission ne peut pas être émise.

La majoration d’urgence est **affichée** mais n’est pas appliquée à la fourchette enregistrée (fonction SQL).

## Paiements Stripe TEST

Sept paiements TEST réglés avec un artisan de recette déjà raccordé à Stripe Connect, tous à 1 000 points de base :

| Dossier | Montant | Commission | Plateforme |
|---|---|---|---|
| INT-CDD097 | 130,20 € | 13,02 € | Web |
| INT-0DB3BB | 122,90 € | 12,29 € | Web (avec avenant) |
| INT-0BD880 | 117,72 € | 11,77 € | Web (payeur délégué) |
| INT-980BDD | 111,04 € | 11,10 € | Web (empreinte bancaire) |
| INT-6C3682 | 162,75 € | 16,28 € | Web |
| INT-D8EA99 | 162,75 € | 16,28 € | Android |
| INT-A9155E | 108,50 € | 10,85 € | iOS |

Prouvé : montant débité égal au devis accepté ; passage à « payé » par webhook seulement ; une seule écriture de commission par paiement ; second paiement refusé (« Ce dossier est déjà réglé ») ; facture F2026-000001 et avoir A2026-000001 ; l’artisan voit montant, commission et net sur web, Android et iOS.

Non prouvé : versement bancaire à l’artisan ; remboursement (exige la double authentification, non activée sur le compte admin partagé) ; facture de commission (taux de TVA manquant) ; session de paiement réellement expirée (vérifiée par simulation de la réponse serveur).

## Corrections livrées (phase 5)

Douze commits de correction sur `main`, de `f36ce54e` à `bda85303`. Suite unitaire finale : 2 178 réussis, 298 ignorés, 0 échec ; typage web et mobile propre. Chaque lot web a été rejoué dans le navigateur ; les lots mobiles ont été rejoués sur Android, partiellement sur iOS.

- **Public** : majoration d’urgence dans le récapitulatif par prestation ; lien « Aller au contenu » ; textes périmés (garantie, exploitant, commission dans Paramètres).
- **Client et artisan** : avenants visibles côté client avec total cohérent ; rafraîchissement sans rechargement (rendez-vous, compte rendu, avenant, panneau devis) ; avis hors zone ; code postal à cinq chiffres ; reprise du partage de position ; brouillon de demande conservé ; liste d’offres rechargée à la bascule de disponibilité.
- **Entreprise** : création d’organisation par le premier site ; lien d’invitation accepté dans l’interface ; refus d’approbation sans commentaire rejeté par le serveur ; site archivé en lecture seule ; fiche site sans panneaux bloqués ; fiche équipement avec interventions liées ; alerte de dépassement de budget.
- **Administration** : ouverture des justificatifs d’une candidature ; écran Finance (erreur 404, commission estimée) ; garantie (panneau correctif).
- **Paiements** : commission et net pour l’artisan ; factures consultables par l’artisan ; messages de refus spécifiques ; retour de paiement après reconnexion ; PDF de facture (références, heure de Martinique) ; libération de l’empreinte à l’annulation (testée par simulation seulement).
- **Mobile** : interrupteurs Android ; faux retour de paiement ; identité artisan et client ; note de rendez-vous ; majoration d’urgence ; boutons Approuver / Refuser natifs ; clavier ; conversation ouverte sur le dernier message ; aperçu HT / TVA / TTC ; commission et net pour l’artisan.

## Reliquats par cause

### Données à fournir par le propriétaire
PUB-08, PUB-09 (rubriques encore vides), ADM-08 (profil non publiable), ADM-05 et FIN-05 (facture de commission : taux de TVA), SYS-06 (durées de conservation).

### Demandent une migration SQL (pas d’accès à la base dans cette session)
- Notification à la proposition et à la décision d’un avenant (CLI-07).
- Motif et refus définitif sur une décision de candidature artisan (ADM-02).
- Signal « aucun artisan disponible » dans une commune couverte (CLI-03).
- Majoration d’urgence appliquée à la fourchette enregistrée.
- Double commission écrite par le rapprochement manuel (corrigée à l’affichage seulement) ; écriture automatique du règlement sans rapprochement ; état de l’empreinte après capture ; commission des empreintes au grand livre.
- Suppression réelle d’une photo de dossier (CLI-02) ; confirmation d’un créneau (CLI-04) ; artisan informé d’un refus d’approbation.

### Fournisseur ou infrastructure externe
- PUB-07 (bloqué) : l’inscription exige un e-mail de confirmation ; la recette n’a ni boîte de test ni SMTP.
- FIN-04, FIN-06 : remboursement et versement Stripe non observables.
- ADM-09, FIN-04 : double authentification non activée sur le compte admin partagé.
- SYS-09 : sauvegarde, restauration, alertes.
- SYS-10, FIN-07 : désactivés par configuration.
- FIN-03 natif : retour par lien profond, à vérifier sur un binaire de développement ou de distribution.

### Fonctions non développées
ART-10 (ponctualité), ENT-06 (tableau de bord restauration, échéance par ticket), ENT-16 (factures et intégrations entreprise), SYS-09 (exécution de l’effacement), et côté natif : carte, création de site, adresses enregistrées, PDF de devis et de facture, avis, écritures d’administration.

### Défauts ouverts connus
- **iOS** : la barre « Terminer » du clavier n’apparaît pas ; la carte de l’étape d’adresse reste blanche sous Expo Go (cause non identifiée, non testé sur binaire autonome) ; une bande au-dessus de la barre d’onglets intercepte des appuis ; la page de retour Stripe affiche un formulaire de connexion web ; « Nouvelle demande » rouvre sur la confirmation précédente ; refus d’approbation sans commentaire sans message.
- **Android** : dans Aide, le clavier masque « Vérifier » au premier appui ; icônes d’onglets rognées à 150 % de police ; après abandon du paiement, « Paiement en attente de confirmation ».
- **Web** : l’artisan ne voit pas dans l’offre les photos partagées par le client ; journal d’audit des paramètres plafonné à 100 événements ; le filtre « Site » du tableau de bord liste encore le site archivé.

## Décisions attendues du propriétaire

1. **Double authentification** : aujourd’hui exigée seulement pour les droits d’opérateur, les super-admins et les remboursements. Factures, avoirs, rapprochement, taux de commission, publication de la zone et de la garantie, approbation d’un artisan n’y sont pas soumis.
2. **Commission des empreintes bancaires au grand livre** : code écrit mais désactivé (`GUEST_SETTLEMENT_LEDGER_COMMISSION_ENABLED`), car il réutilise une fonction prévue pour les événements Stripe.
3. **Rappel public** : formulaire activé sur la recette pour le test ; à confirmer avant ouverture.
4. **Durée de garantie** : le texte publié n’en mentionne pas, alors que le logiciel accepte une demande jusqu’à un an après l’intervention.
5. **Pays Stripe Connect** : la page d’inscription s’ouvre avec des mentions autrichiennes ; à vérifier dans Stripe.

## Effets de bord sur la base de recette

- Quatre écritures de commission estimée ajoutées par un clic sur « Rapprocher les règlements » (non supprimables).
- Une empreinte bancaire TEST de 180,00 € restée en attente de capture sur un dossier annulé (INT-88FF28).
- Un devis de test refusé par une sonde ; un avis de test masqué par erreur puis rétabli ; une entrée du journal d’audit non attribuée.
- Plusieurs dizaines de comptes et dossiers synthétiques (`qa-…@qa.invalid`, préfixes `pub`, `core`, `adm`, `ent`, `fin`, `and`, `ios`, `retest…`) laissés en place.

## Configuration modifiée

- Recette Vercel : `PLATFORM_FEE_BPS=1000`, `WARRANTY_REQUESTS_ENABLED=true`, `PUBLIC_CALLBACK_INTAKE_ENABLED=true` ; alias de recette pointé sur `bda85303`.
- Base de recette : couverture, garantie, paramètre de commission, émetteur de facture, brouillon du profil opérateur.
- Aucune modification de la production ni de Stripe.
