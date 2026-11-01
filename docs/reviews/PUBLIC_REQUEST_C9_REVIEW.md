# Public demande + auth — c9d9f12

SHA exact poussé confirmé : c9d9f1275f7c76176aec4b9d13b3a38b1e1d943f. Revue FASTSPLIT, export figé /private/tmp/depannage-public-request-review-c9d9f12-BgyWYV. Aucun cloud, credential ou code auteur modifié.

Verdict : aucun P2 concret trouvé ; feu borné intégration ROOT puis recette preview. Aucun nouveau plan ou gate documentaire.

23 tests public-request/public-home PASS, zéro échec/skip. SSR réel login/signup/reset, dispatch des callbacks, demande partagée avec mêmes props, notice de brouillon sans inscription automatique, autres vues/rôles non thémés, chrome/home et navigation vérifiés.

Probe complémentaire : vrais PublicSite/RequestForm/AuthView/ThemeProvider et CSS dans Chromium local360, callbacks de session injectés. Champ requis refuse la progression, fichier texte affiche l'erreur de type photo ; demande en3étapes jusqu'au brouillon puisauth. Bascule thème pendant étape2 conserve l'adresse et l'étape. Zéro débordement horizontal et zéro pageerror. Aucun appel réseau d'auth réel.

La première tentative de probe attendait à tort une alerte custom pour un champ vide : le contrôle natif required empêche la soumission avant cette alerte, conformément au formulaire existant. Probe corrigée pour observer la validité native, puis nominal/erreurphoto validés ; pas de défaut produit associé.

Source/diff : RequestForm/AuthForm/ui/session/globals inchangés ; habillage CSS sous requestSkin/authSkin/alerts ; PublicChrome stable sans key liée au thème. RetourAccueil via callback réel, sections de l'accueil sanshash, new/saveDraft et auth signIn/signUp/resetPassword conservés. Busy/erreurs/notice restent rendus par les composants existants ; les écrans rôles ne reçoivent pas le wrapper. Aucune promesse de prix garantie ou fonction nouvelle.

Limites : pas de buildNext/preview ni authentification distante dans cette revue. Les tests locaux ne remplacent pas la recette ROOT des2thèmes/tailles, contrastes et actions essentielles sur le SHA intégré. Seul le parcours public home/new/auth est concerné.
