# Revue plan public demande/auth — d623521

SHA exact : d623521f85c128977a5de8a9417f7dd2b0a62ae7. Documentation seule. Lecture du plan et des sources de référence forms.tsx, PublicSite et PublicHome au même commit. Aucun code, PDF, cloud ou credential modifié.

Verdict : plan acceptable dans son périmètre ; aucun P1/P2 bloquant identifié avant code. ROOT peut réserver les fichiers et autoriser les phases séparées. Le plan ne vaut pas acceptation d'une future implémentation.

Points confirmés : RequestForm est réellement partagé public/client/entreprise ; ses3étapes contiennent problème+description+photos, puis adresse/CP/ville/urgence, puis récapitulatif/estimation. Conserver cet ordre évite une refonte fonctionnelle implicite. L'estimation est déjà qualifiée d'exemple de préparation, pas de prix garanti. AuthView distribue les soumissions vers signIn/signUp/resetPassword selon authMode ; préserver ce dispatch et la notice pendingDraft est approprié.

Garde-fous à porter au contrat court de chaque phase :

- **Propriété.** Worker réservé aux fichiers public-chrome/public-home/public-site/CSS/tests déclarés ; forms/ui/session/globals/layout demeurent lecture seule. className n'est pas nécessaire au wrapper ; si retenu, petit diff séparé par le lead, défaut neutre, tous les consommateurs inchangés.
- **Extraction PublicChrome.** Définir des callbacks explicites pour home / login / new / navigation. Surhome, boutons scroll+focus sans hash ; surnew/auth, Accueil et marque appellent vraiment go(home). HomeTargetView actuel n'admet pas home : ne pas contourner ce type par un cast ni reprendre le window.scrollTo de la marque d'accueil pour le retour depuis un formulaire. Aucun routeur générique nouveau.
- **Base de P1.** Repartir de l'intégration courante, avec le follow-up09ae si intégré entre-temps ; ne pas réintroduire une version d'avant extraction du helper. L'accueil3ae/53d était déjà sans collision hash. Captures P1 avant/après et tests de callbacks doivent garder cette équivalence, sans preuve de bug rétrospective.
- **Portée du CSS.** Tous les sélecteurs historiques sous requestSkin/authSkin ; aucun aliasglobal ni sélecteur nu qui change RequestForm dans les rôles. ThemeSurface stable, pas de key liée au thème et pas de doublechrome/main. Alertes de session visibles et annoncées hors du header collant, focus/disabled/erreurs et photos retrait inchangés.
- **Focus partagé optionnel.** Les3titres h2 d'étape existent. Si le lead ajoute leur focus, viser le changement réussi d'étape et les retours, sans vol de focus lors d'un simple changement de thème. Préférer un opt-in neutre pour le public si le comportement des espaces rôles doit rester horslot ; ne pas faire ce changement dans le workerCSS.
- **Tests réalistes.** Les classes conditionnelles (erreur/photo/récapitulatif) ne sont pas toutes présentes au SSR initial : leurs gardes doivent utiliser les états réels en navigateur ou un rendu adapté, sans ajouter de prop métier uniquement pour satisfaire le test. Tester le vrai RequestForm pour validations, fichiers6max/type/taille/retrait, saisie conservée à la bascule, brouillon sansphotos et retourauth/new. Les captures seules ne prouvent pas le dispatch des callbacks.
- **Authentification.** Login/signup/reset et choixartisan demeurent explicites ; aucun signup automatique à l'arrivée surauth, aucunPOST avant soumission autorisée. Les erreurs simulées servent au contrôle visuel sans appeler ni modifier un compte réel par le worker.
- **Recette bornée.**2thèmes×4largeurs, contraste des champs/erreurs/sélections, clavier/cibles44px et SSR ; P1 d'abord sans rethémer formulaires, puisP2, puisP3. Preview et recette ROOT au SHA intégré. Aucun changement aux espaces rôles, paiement ou photosbackend annoncé.

Aucune modification fonctionnelle demandée, aucune réouverture de l'auditPDF. Les réservations de propriété et contrôles de phase relèvent de la coordination déjà prévue, pas d'une nouvelle question au propriétaire.
