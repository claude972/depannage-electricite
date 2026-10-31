# Relecture du contrat fd29b7f

Sources : diff5634b79→fd29b7f, contrat partagé a29f732, droits existants001/007. Lecture seule, aucun code en cours ni service distant examiné. L’amendementA1 prévaut sur le corps historique.

## Corrections acceptées dans le contrat, implémentation non vérifiée

- `platform_reconcile(p_limit integer)` ne prend plus de taux : paramètre administrateur versionné en base et instantané dans le ledger. Le contournement RPC signalé est traité dans la conception.
- Estimation et commission retenue sont distinctes ; la facture de commission exige un montant retenu confirmé. L’écart entre taux Checkout et réglage courant est exposé.
- Props conformes au contrat partagé : state/unavailableMessage/scope obligatoires, client.load/command, résultats périmés null, démonstration isolée et aucun import global applicatif. Routage des opérateurs limités encore à vérifier après raccordement.
- Support limité explicitement non livré ; aucune promotion admin de remplacement autorisée.
- Verrou du paiement avant les entités financières et verrou advisory commun pour dernier admin, y compris trigger/cascade, sont documentés. Les courses réelles restent à tester.
- Clé idempotente et empreinte du contenu sont prévues. Les fonctions service doivent encore vérifier paiement, montant, devise et résultat fournisseur : le nom d’un événement ne prouve pas son succès.
- Les agrégats SECURITY DEFINER doivent exclure les avis masqués. Vérifier aussi la lecture du modérateur limité : la policy permissive existante est encore can_access_intervention, une policy restrictive seule ne lui crée pas un droit de lecture.

## Clarifications restantes

1. **TVA de commission :** préciser si le montant retenu comprend la TVA. Ne pas ajouter une taxe au montant retenu puis présenter ce nouveau total comme le montant effectivement prélevé. Définir la relation facture/ledger et l’arrondi.
2. **Destinataire de facture :** l’adresse d’intervention et le nom du demandeur ne constituent pas systématiquement les coordonnées de facturation. Utiliser une donnée autoritative ou signaler readiness incomplète. A1 ne corrige pas cette substitution initiale.
3. **Ancienne fonction renommée :** A1 renomme artisan_performance_before_review_moderation ;007 accordait EXECUTE à authenticated. Le renommage conserve les privilèges. Révoquer explicitement public/anon/authenticated et tester l’ancien appel direct, sinon l’ancien agrégat non modéré reste accessible.
4. **Indépendance014 :** conserver uniquement les dépendances001–013. Remplacer la fonction007 avec la même signature est compatible ; le renderer PDF reste une interface TypeScript tant que le lot documents ne l’a pas livré.

Verdict : l’essentiel des risques initiaux est traité dans le contrat. Les trois premières clarifications restent à transmettre avant acceptation du code. Aucun succès d’implémentation, concurrence, Stripe ou production revendiqué.
