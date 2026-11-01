# Reçu sur place — tranche025

Nouvelle migration025 uniquement, aucun fournisseur/banque appelé. Deux nouveaux champs `payments.method` et `payment_attempts.method` : `stripe` par défaut (historique conservé) ou `on_site_declared`. Référence déclarative `onsite:<intervention UUID>` stable, jamais un faux identifiant Stripe.

GET `/api/bookings/settlement/onsite?intervention_id=UUID` : client propriétaire confirmé ou artisan affecté, `{method:"on_site",status:"due_on_site",amount_cents:number|null,currency:"eur",can_declare:boolean,available:boolean,reason?:code}`. Seul l’artisan affecté approuvé (profil ET candidature) obtient `can_declare:true` après fin et devis accepté. Autres comptes404, client incapable de s’auto-déclarer payé.

POST même chemin strict `{intervention_id:UUID}` : déclaration explicite artisan, montant serveur = devis accepté + tous avenants acceptés, autres états exclus. Transaction unique reçu privé/clé métier/paiement/history/jobpaid/paydate/audit ; rejeu sans doublon. Réponse `{method:"on_site_declared",status:"declared_received",amount_cents,currency:"eur",can_declare:false,available:false}`. Libellé attendu « Déclaré reçu sur place » : preuve déclarative, pas bancaire. Aucune commission Stripe inventée. Toute tentative Stripe préexistante bloque la déclaration409, sans annulation financière aveugle.

Les lectures d’erreur sont503 (Retry-After2), jamais absence ni faux reçu ; corps/query stricts et bornés, private,no-store. Prix, méthode, artisan et référence jamais fournis par le navigateur. Receipt/quote/avenants/affectation figés après déclaration. ROOT possède les projections method dans status/workspace/types ; Claude les libellés et le CTA explicite. Le texte initial « due_on_site » doit céder au reçu `payments.method=on_site_declared` quand il existe.

QA future avec règlement déclaré/capturé : supprimer d’abord les reçus/ledgers et paiements/history exactement identifiés avant quotes/job dans le plan privé, puis vérifier leurs scopes à zéro. Ce n’est pas une autorisation de transaction réelle ou de nettoyage global. Les tests locaux Auth/Storage/cron sont simulés ; aucune banque, SMS ou cloud exécuté.
