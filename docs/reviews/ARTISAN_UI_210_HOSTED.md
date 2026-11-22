# Parcours artisan connecté — source210

Application `210536d3b18ee822be5a7a061b22929741b7ef95`, READY `dpl_dvjoMKJEUvaQ4nUWUaWGTAbgULUG`, origin om1bmcd6i, Flight `WcMjL3w7zwfUBU6Gr28eF`. Les seuls changements produit depuis a4 sont la présentation de la page de réinitialisation. Les validations et appels Auth sont inchangés après revue du diff.

## Réinitialisation : couche visuelle vérifiée

Source593fa54 : ThemeSurface/Toggle/Jakarta et tokens verts, clair/sombre, chargement/erreur/succès et cibles44. Tests ciblés SSR/CSS et TypeScript PASS. ROOT navigateur public neuf : quatre cas360/1280 × clair/sombre PASS ; lien expiré affiche l’erreur et aucun champ de mot de passe, thème système puis choix inverse persistant au reload, retour accueil, zéro POST/erreur JS/débordement. Preuve privée auth-reset-210-public-proof-v2.json. La première sonde ROOT utilisait un locator alert ambigu après reload (annonceur Next) ; corrigée côté sonde seulement, première trace conservée. Aucune preuve de réception email ni de changement de mot de passe réel dans cette recette visuelle.

CI21041315378356 FAIL sur un test dépendant de git show99f92f2 absent du checkout shallow. Correctif76af6de intégré1529e8b, tests seuls : comparaison historique inutile supprimée, tests autonomes SSR/CSS conservés2/2PASS. Aucune modification app/SQL/preview pour ce correctif ; ne pas présenter l’ancienne CI comme verte.

## Première recette artisan : échec conservé

Run `1df60af61ef1`, driver privé initial SHA256 `ee21e156a59b57619910ebc42f4b55f8ab4428113d6a91b40434d101725b2e29`,67 contrôles injectés PASS. Attestation ROOT fraîche14:19:11.958UTC avant credentials, deux comptes QA client/artisan approuvé synthétiquement, un dossier créé par API client authentifiée. Acceptation mission et sauvegarde du brouillon par vrais clics UI passent, brouillon refusé au client403 ; publication émet200 et un devis est découvert. Le contrôle s’arrête ensuite sur SCOPED_READ_UNKNOWN (phasepublish), avant acceptation client/démarrage/fin : ces étapes ne sont pas prouvées par ce run.

Le harnais effectuait SELECT puis HEADcount séparés pendant mutation : ces lectures ne forment pas un instantané atomique. Ce défaut structurel est corrigé dans une version distincte du driver, sans requalifier ce run ni déduire une panne produit de cette seule mesure. Cleanup25 étapes/readbacks internes à zéro, drain0 ; writer57682 terminé exit1. ROOT postflight indépendant READONLY **47/47PASS**, deux Auth404 stricts/43scopesREST0/deuxStorage0, dont quotes/quote_terms et ledger021 inutilisé. Script SHA256 `6bf9d4bf757f90645e5f8908d7db0b2dba9bcd4198d53a90bf6ea480456f43da`. Aucune cohorte QA connue conservée après ce contrôle.

## Nouvelle recette artisan : PASS borné

Run `7b73e73ba151`, driverV2 gelé SHA256 `1127a612bf84a230b0468b8687de696611bc718c5c30de5e121cf620a743d09b`,115 contrôles injectés PASS. ROOT attestation API/HTML fraîche14:22:11.825UTC avant credentials, app et harnais source210 figés. Une seule réponse PostgREST avec count=exact/Content-Range prouve chaque lecture ; cap+1 et refus de troncature/malformation/droits étrangers, diagnostic fini. Aucun retry ajouté ni assertion métier assouplie.

**16/16 preuves PASS**, writer82776 terminé exit0. Deux comptes QA préconfirmés (client/artisan approuvé synthétiquement), un dossier préparé par API client authentifiée, puis six mutations métier par vrais clics UI : accepter mission disponible identifiée par commune QA unique ; enregistrer brouillon de deux lignes40+60€HT/TVA20 ; envoyer devis ; client consulte puis accepte le quote_id courant exact ; artisan confirme démarrage puis fin. Neuf transports exacts incluent deux connexions, setup201 et six mutations200. Brouillon privé403 côté client avant publication, un devis120€TTC dont lignes/montants serveur exacts, brouillon consommé, statutcompleted/horodatage accepté inchangé et six audits aux acteurs exacts. Zéro violation/erreur JS. Aucun déplacement ni prestation réels.

Cleanup25 étapes/readbacks internes zéro, drain0, neuf intentions réglées. Après FIN, ROOT postflight READONLY **47/47PASS** : deux Auth404 stricts/43scopesREST0/deuxStorage0, dont quotes/terms et ledger021 inutilisé. Script SHA256 `6b49013244daac63af3db6da241197c686c9d9f046fcb9f29fa4c5f570bc2b16`. Aucune cohorte QA connue maintenue. Preuves privées dans artisan-connected-ui-v2-7b73e73ba151. L’échec initial reste conservé.

Correctif CI tests-only intégré `1529e8b4a5dd42eb64607793ce993435a5ad2bb1` : CI41315745212 **deux jobs SUCCESS**, app/components/lib/public/SQL byte-identiques à210. Aucun nouveau déploiement nécessaire pour les tests seuls. Preview source210 reste publique, API tracking anonyme401 JSONprivate,no-store ; alias de branche relu200 avec le même Flight.

Bornes : cette recette desktop1280 couvre le parcours nominal, pas chaque erreur ni le GPS physique. Elle ne prouve pas une approbation par un vrai opérateur, la création du dossier par UI (prouvée séparément par bookinga4), la réception SMTP, l’écriture du compte rendu ou un paiement Stripe. Paiement/premierSuperAdmin toujours différés ; aucune production/main/Edge/stores changés.
