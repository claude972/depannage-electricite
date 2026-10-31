# Attribution T6 réelle — état React sans dossier

Lecture seule : diagnostic JSON et PNG /tmp/depannage-tracking-1225-4c-t6-diagnostic/diagnostics/T6/client.*, result.json ; app exacte4c398e8393026598c5b629d3912cf80285acc2f5 dans /tmp/depannage-web-pwa-local-qa ; harnais integration5eb0f8540e253833f87fae1bc5007247770c6700. Aucun cloud, compte ou navigateur touché.

Cause immédiate confirmée : le composant de détail n'a pas le dossier dans son workspace React. URL correcte /#detail/4dd56c01-9e46-4990-bbff-83587e9380b5, identité client QA du run d79f5a9c4973 visible dans le PNG, titre Intervention introuvable, aucun blocker, aucune carte tracking. L'unique GET tracking enregistré est le randomUUID du préflight404, pas le dossier demandé. Donc l'échec précède le montage du suivi ; ce n'est pas un masquage de stale par une capability inconnue ou indisponible.

La source4c explique le rendu : mine() filtre sur profileId (client-space147–150) ; DetailView903 cherche l'id puis910–921 rend Empty s'il manque, avant l'ancre1301. Le hash detail est autorisé au client et correctement transmis à selectedId. Hash handler courant-app464–467 ne fait que setParam/setView, sans refresh.

Le harnais crée le compte et ouvre la session client110 avant toutes les données seed129–140 ; T6 réutilise le même handle. openHash browser139–141 fait page.goto même document/path avec hash différent, ce qui ne garantit pas une nouvelle initialisation React. Le lecteur API waitForWorkspace ne met pas à jour l'état React. Le prérequis « client a chargé le dossier seedé » n'a donc pas été garanti par le setup.

Contrat de correction QA recommandé avant code :
1. Après création du premier compte, ouvrir un contexte nommé préflight dédié, exécuter le404 UUID inconnu avec ce compte, puis fermer le contexte (pas logout global).
2. Seed complet avec les écritures/intents/stopgate existants ; seulement ensuite ouvrir le contexte client destiné aux scénarios, sous le même utilisateur de cohorte.
3. Vérifier que le workspace API de cette session contient le dossier attendu, et conserver les assertions UI T6 inchangées (carte + périmé + pas ETA). Une absence UI persistante reste FAIL.
4. Tests d'ordre sur vrai setup/pool : préflight avant autres fixtures, contexte préflight fermé, session scénario après seed ; stop/refus => aucune émission tardive ; aucun relogin diagnostic ni contournement de assertions.

Ne pas effacer l'observation produit : ce run démontre qu'une session déjà ouverte n'a pas incorporé un dossier créé extérieurement pendant le setup. L'app prévoit des callbacks Realtime refresh (courant-app502–511), ainsi qu'une revalidation focus/visibility ; le badge En direct du PNG prouve seulement le statut de canal affiché, pas la livraison des événements de la table. La cause profonde (publication/RLS, abonnement prêt, événement reçu, réponse workspace/état React) reste non isolée par ce diagnostic. Conserver une vérification distincte « nouveau dossier externe dans session ouverte » et ne pas annoncer ce comportement réparé par l'ordre QA.

Résultat historique reste setup PASS/T6 FAIL ; cleanup ok, intents ouverts0/nonprouvés0 selon result.json. Les readbacks indépendants ROOT annoncés ne sont pas requalifiés en preuve UI.
