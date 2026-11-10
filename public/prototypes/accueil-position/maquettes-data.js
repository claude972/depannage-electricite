import { demoEstimates } from './demo-estimates.js';

export const roles = {
  public: { label: 'Public', icon: 'bolt', description: 'Découvrir le service et préparer une demande.' },
  client: { label: 'Client', icon: 'person', description: 'Demande, devis, suivi et règlement.' },
  artisan: { label: 'Artisan', icon: 'work', description: 'Offres, planning, devis et preuves de travaux.' },
  entreprise: { label: 'Entreprise', icon: 'grid', description: 'Sites, budgets, approbations et rapports.' },
  admin: { label: 'Administration', icon: 'shield', description: 'Supervision, support, finance et accès.' },
  parcours: { label: 'Parcours', icon: 'steps', description: 'Séquences client, terrain et entreprise.' },
};

const screen = (id, role, title, refs, intro, blocks, actions = []) => ({ id, role, title, refs, intro, blocks, actions });
const link = (label, target) => ({ label, target });
const external = (id, role, title, refs, intro, hash = '') => ({ id, role, title, refs, intro, href: `./index.html${hash}` });
const rows = (title, items) => ({ type: 'rows', title, items });
const stats = (items) => ({ type: 'stats', items });
const facts = (title, items) => ({ type: 'facts', title, items });
const steps = (title, items, active = 0) => ({ type: 'steps', title, items, active });
const form = (title, fields, submit, target) => ({ type: 'form', title, fields, submit, target });
const info = (title, text) => ({ type: 'info', title, text });
const faq = (items) => ({ type: 'faq', items });
const picture = (src, alt, caption) => ({ type: 'photo', src, alt, caption });
const map = (caption) => ({ type: 'map', caption });
const priority = (tone, label, title, detail, action, target) => ({ type: 'priority', tone, label, title, detail, action, target });
const comparison = (title, items) => ({ type: 'bars', title, items });

const photoTableau = '/home/hero-photo-1.jpg';
const photoPrise = '/home/section-outlet.jpg';
const quote = [ ['Déplacement', '40,00 €'], ['Main-d’œuvre', '100,00 €'], ['Matériel', '20,00 €'], ['Sous-total HT', '160,00 €'], ['TVA de l’exemple', '16,00 €'], ['Total TTC', '176,00 €'] ];
const fieldProblem = ['Type de problème', ['Coupure de courant', 'Prise ou interrupteur', 'Tableau électrique', 'Éclairage', 'Diagnostic']];
const fieldCity = ['Commune', ['Fort-de-France', 'Le Lamentin', 'Schœlcher', 'Le Robert']];
const fieldDescription = ['Décrivez le problème', 'textarea', 'Plusieurs prises du séjour ne répondent plus.'];
const jobSteps = [ ['Demande reçue', 'Le besoin et le lieu d’intervention ont été enregistrés.'], ['Artisan affecté', 'Le rendez-vous a été confirmé.'], ['En déplacement', 'Le partage de position a été activé pour la mission.'], ['Sur place', 'L’artisan établit le diagnostic et présente le devis.'], ['Travaux terminés', 'Le compte rendu et le règlement sont accessibles depuis le dossier.'] ];

export const screens = [
  external('accueil', 'public', 'Accueil', ['M11','M41','M51','M61'], 'Recherche, types de service, raccourcis et interventions en vedette.'),
  external('position', 'public', 'Position et lieux favoris', [], 'Sélection d’une commune ou d’un lieu sur la carte.', '#position'),
  screen('catalogue', 'public', 'Catalogue des interventions', [], 'Choisissez la situation qui correspond à votre besoin.', [
    picture(photoTableau, 'Artisan contrôlant une armoire électrique', 'Interventions électriques'),
    rows('Les dépannages', [['Coupure partielle', 'Une pièce ou un étage sans courant', '', 'prestation'], ['Prises sans courant', 'Une ou plusieurs prises concernées', '', 'prestation'], ['Tableau électrique', 'Disjoncteur qui déclenche', '', 'prestation'], ['Éclairage en panne', 'Circuit ou luminaire', '', 'prestation']]),
  ]),
  screen('prestation', 'public', 'Plusieurs prises sans courant', [], 'Préparez une demande de dépannage pour un circuit ou plusieurs prises.', [
    picture(photoPrise, 'Deux mécanismes de prise murale', 'Photo d’illustration'),
    facts('Ce que l’artisan examine', [['Circuit', 'Alimentation et protections'], ['Prises', 'Raccordements et état des mécanismes']]),
    faq([['Quand le prix est-il confirmé ?', 'L’artisan établit le devis après le diagnostic et avant les travaux.']]),
  ], [link('Décrire la panne', 'demande'), link('Voir les estimations', 'tarifs')]),
  screen('tarifs', 'public', 'Tarifs indicatifs', ['M38'], 'Exemples de fourchettes TTC pour comparer la présentation.', [
    facts('Exemples de dépannage', Object.entries(demoEstimates)),
    info('Devis avant travaux', 'Le prix final dépend du diagnostic, des pièces nécessaires et du devis accepté.'),
  ], [link('Décrire mon besoin', 'demande')]),
  screen('zones', 'public', 'Zones d’intervention', ['M59'], 'Aperçu de la recherche par commune en Martinique.', [
    map('Carte schématique des communes de la maquette'),
    form('Rechercher une commune', [fieldCity], 'Voir le lieu sur la maquette', 'position'),
  ]),
  screen('contact', 'public', 'Contact et assistance', ['M42'], 'Posez une question sur votre demande ou le déroulement d’une intervention.', [
    form('Préparer un message', [['Sujet', ['Ma demande', 'Mon devis', 'Mon règlement']], ['Message', 'textarea', 'Précisez votre question.']], 'Voir l’aperçu du message', 'messages'),
    info('Dossier en cours ?', 'Regroupez les échanges et les documents dans la conversation associée à la demande.'),
  ], [link('Lire les réponses courantes', 'faq')]),
  screen('faq', 'public', 'Questions fréquentes', ['M70'], 'Les réponses utiles avant une intervention.', [
    faq([['Estimation ou devis ?', 'L’estimation donne un ordre de grandeur. Le devis présente le montant et le détail des travaux soumis à votre accord.'], ['Comment suivre l’intervention ?', 'Retrouvez le rendez-vous, les étapes de suivi et les documents dans votre dossier.'], ['Comment régler ?', 'Le règlement se fait sur la plateforme. Les justificatifs sont accessibles dans le dossier.'], ['Que faire si j’ai une question après les travaux ?', 'Ouvrez l’assistance depuis l’intervention concernée et décrivez le problème.']]),
  ], [link('Contacter l’assistance', 'contact')]),
  screen('fonctionnement', 'public', 'Comment ça marche', ['M46'], 'Quatre étapes, de la demande à la clôture.', [
    steps('Votre intervention', [['Décrivez le besoin', 'Indiquez la panne et le lieu.'], ['Confirmez le rendez-vous', 'Consultez les informations disponibles dans le dossier.'], ['Lisez le devis', 'L’artisan détaille les travaux proposés avant votre accord.'], ['Retrouvez les justificatifs', 'Le compte rendu, la facture et le règlement sont rattachés à la demande.']], 4),
  ], [link('Commencer une demande', 'demande'), link('Voir le parcours complet', 'parcours-client')]),
  screen('garantie', 'public', 'Garantie et assistance', ['M45'], 'Retrouvez les justificatifs et les conditions propres à votre intervention.', [
    info('Après les travaux', 'Le dossier rassemble les documents utiles et précise les conditions applicables.'),
    steps('Signaler un problème', [['Choisir une intervention', 'Sélectionnez la demande dans votre historique.'], ['Décrire le problème', 'Ajoutez une description et les éléments utiles.'], ['Suivre le dossier', 'Consultez les réponses de l’assistance.']]),
  ], [link('Voir mon intervention', 'intervention')]),
  screen('recrutement', 'public', 'Rejoindre le réseau d’électriciens', ['M60'], 'Présentez votre activité, vos compétences et vos zones d’intervention.', [
    picture('/home/section-real-panel.jpg', 'Électricien travaillant dans un tableau', 'Le dossier professionnel'),
    rows('Préparer votre candidature', [['Votre activité', 'Entreprise, contact et compétences'], ['Vos justificatifs', 'Pièces à joindre selon votre situation'], ['Vos disponibilités', 'Communes, créneaux et capacité']]),
  ], [link('Commencer la candidature', 'candidature'), link('Connexion artisan', 'connexion-artisan')]),
  screen('abonnement', 'public', 'Services et offres', ['M33'], 'Écran d’information pour une future offre de suivi.', [
    rows('Contenu à présenter', [['Suivi des interventions', 'Historique, devis et documents associés'], ['Assistance', 'Accès depuis un dossier existant'], ['Conditions d’une offre', 'Tarif, durée et périmètre à préciser avant toute souscription']]),
  ], [link('Découvrir le service', 'fonctionnement')]),
  screen('a-propos', 'public', 'À propos du service', ['V8-C03'], 'Un parcours dédié aux demandes de dépannage électrique.', [
    picture(photoTableau, 'Artisan devant une armoire électrique', 'De la demande au compte rendu'),
    rows('Nos principes', [['Devis avant travaux', 'Voir le détail et donner son accord dans le dossier.'], ['Suivi lisible', 'Retrouver les étapes, messages et documents.'], ['Paiement sur la plateforme', 'Regrouper le règlement et ses justificatifs.']]),
  ], [link('Voir les services', 'catalogue')]),
  screen('mentions', 'public', 'Mentions légales', ['M63'], 'Présentation des informations sur l’éditeur et le service.', [
    faq([['Éditeur et hébergement', 'Les informations officielles de l’exploitant et de l’hébergeur seront affichées dans cet espace.'], ['Contact', 'Les demandes concernant l’utilisation de la plateforme passent par l’espace d’assistance.'], ['Propriété intellectuelle', 'La page finale identifiera les contenus et crédits associés.']]),
  ], [link('Consulter la confidentialité', 'confidentialite')]),
  screen('confidentialite', 'public', 'Confidentialité et données', ['V8-C05'], 'Les informations utiles au traitement d’une demande et vos choix.', [
    faq([['Coordonnées et accès', 'L’accès aux dossiers privés suppose une vérification de l’identité prévue par le parcours.'], ['Adresse et suivi', 'L’adresse précise est communiquée selon les droits associés à l’intervention. Le partage de position de l’artisan concerne la mission.'], ['Documents et échanges', 'Les photos, justificatifs et conversations sont rattachés au dossier.'], ['Exercer vos droits', 'Utilisez l’assistance pour adresser une demande sur vos données.']]),
  ], [link('Contacter l’assistance', 'contact')]),

  external('compte', 'client', 'Compte client', ['M18'], 'Profil, paiements, aide, messages et adresses enregistrées.', '#compte'),
  external('parametres-client', 'client', 'Gérer mon compte', [], 'Informations personnelles, sécurité et confidentialité.', '#parametres/apercu'),
  external('activite', 'client', 'Activité vide', [], 'État avant la première intervention.', '#activite'),
  screen('connexion-client', 'client', 'Retrouver une intervention', [], 'Accès par vérification du téléphone ou connexion avec un compte existant.', [
    form('Votre numéro', [['Téléphone de démonstration', 'tel', '+596 000 000 000']], 'Voir l’étape de vérification', 'verification'),
    info('Compte facultatif', 'L’accès au dossier dépend de la vérification du numéro associé.'),
  ], [link('Gérer un compte', 'parametres-client')]),
  screen('verification', 'client', 'Vérifier mon téléphone', [], 'Aperçu de la saisie du code de vérification.', [
    form('Code de démonstration', [['Code de six chiffres', 'code', '000000']], 'Ouvrir le dossier de démonstration', 'historique'),
    info('Vérification simulée', 'Les écrans sont reliés localement avec des valeurs fictives.'),
  ]),
  screen('demande', 'client', 'Créer une demande', ['M5','M15'], 'Indiquez ce qui ne fonctionne plus et ajoutez les détails utiles.', [
    steps('Votre demande', [['Le problème',''], ['Le lieu et le créneau',''], ['Le récapitulatif','']], 0),
    form('Décrivez la panne', [fieldProblem, fieldDescription, ['Ajouter une illustration de démonstration', 'photo']], 'Continuer vers le lieu', 'adresse-demande'),
  ]),
  screen('adresse-demande', 'client', 'Lieu et rendez-vous', [], 'Précisez où et quand intervenir.', [
    form('Adresse d’intervention', [fieldCity, ['Adresse de démonstration', 'text', 'Résidence Exemple'], ['Créneau souhaité', ['Dès que possible', 'Un autre jour', 'Matin', 'Après-midi']]], 'Voir le récapitulatif', 'recapitulatif'),
  ], [link('Ouvrir la sélection de position', 'position')]),
  screen('recapitulatif', 'client', 'Récapitulatif de la demande', [], 'Vérifiez les informations avant de confirmer.', [
    facts('Demande de démonstration', [['Problème', 'Prises sans courant'], ['Lieu', 'Fort-de-France'], ['Créneau', 'Matin'], ['Estimation d’exemple', demoEstimates['Prise ou interrupteur']]]),
    form('Règlement sur la plateforme', [['Moment du règlement', ['Empreinte bancaire', 'Après l’intervention']]], 'Simuler la confirmation', 'confirmation'),
  ], [link('Modifier le lieu', 'adresse-demande')]),
  screen('confirmation', 'client', 'Demande envoyée', ['M54'], 'Exemple de confirmation pour le dossier DÉMO-021.', [
    info('Votre demande a été enregistrée dans la maquette', 'Le suivi présente les prochaines étapes et le rendez-vous lorsqu’il est disponible.'),
    steps('Et ensuite ?', [['Demande reçue','Dossier DÉMO-021'], ['Attribution','Recherche d’un artisan disponible.'], ['Rendez-vous','Créneau à confirmer.']], 1),
  ], [link('Suivre la demande', 'suivi'), link('Voir l’état sans artisan', 'sans-artisan')]),
  screen('sans-artisan', 'client', 'Recherche d’un artisan', [], 'Le rendez-vous dépend d’une attribution confirmée.', [
    info('Aucun artisan affecté', 'Vous pouvez élargir le créneau souhaité ou vérifier l’adresse d’intervention.'),
  ], [link('Revoir le créneau', 'adresse-demande'), link('Revenir au suivi', 'suivi')]),
  screen('suivi', 'client', 'Suivi de l’intervention', ['M7'], 'DÉMO-021 · L’artisan est en déplacement.', [
    map('Itinéraire et position illustratifs · Arrivée d’exemple vers 14 h 30'),
    steps('Étapes', jobSteps, 2),
    rows('Votre artisan', [['Électricien de démonstration', 'Mission affectée', 'Contacter', 'messages']]),
  ], [link('Ouvrir le dossier', 'intervention')]),
  screen('intervention', 'client', 'Dossier d’intervention', ['V8-C07'], 'DÉMO-021 · Prises sans courant.', [
    facts('Rendez-vous', [['Commune', 'Fort-de-France'], ['Créneau', '14 h – 16 h'], ['Artisan', 'Électricien de démonstration']]),
    picture(photoPrise, 'Mécanismes de prises électriques', 'Illustration jointe au dossier'),
    rows('Pièces et actions', [['Devis D-021', 'Proposition de l’entreprise artisanale', 'À lire', 'devis-client'], ['Compte rendu', 'Constats et remise en service', '', 'documents-client'], ['Rendez-vous', 'Proposer un autre créneau', '', 'rendez-vous']]),
  ], [link('Voir le devis', 'devis-client'), link('Discuter avec l’artisan', 'messages')]),
  screen('rendez-vous', 'client', 'Modifier le rendez-vous', [], 'Proposez un créneau à confirmer par l’artisan.', [
    form('Nouveau créneau', [['Préférence', ['Matin', 'Après-midi']], ['Précision facultative', 'textarea?']], 'Simuler la proposition', 'intervention'),
  ]),
  screen('devis-client', 'client', 'Devis D-021', ['V8-C06'], 'Émis par l’entreprise artisanale de démonstration.', [
    facts('Détail du devis', quote),
    form('Votre décision', [['Choix', ['Accepter le devis', 'Refuser le devis']]], 'Voir l’état de la décision', 'decision-devis'),
  ], [link('Revenir à l’intervention', 'intervention')]),
  screen('decision-devis', 'client', 'Décision sur le devis', [], 'État de démonstration après validation de votre choix.', [
    info('Accord ou refus', 'Le dossier conserve la décision et la version du devis concernée.'),
    rows('Suite du dossier', [['Intervention', 'Suivre les travaux ou demander un nouveau devis', '', 'intervention'], ['Règlement', 'Aperçu après achèvement des travaux', '', 'paiement']]),
  ]),
  screen('paiement', 'client', 'Règlement de l’intervention', ['M12'], 'DÉMO-021 · Devis accepté et travaux terminés dans le scénario.', [
    facts('Montant de démonstration', quote),
    form('Règlement sur la plateforme', [['Moyen de démonstration', ['Carte bancaire']]], 'Voir le retour de paiement', 'retour-paiement'),
  ]),
  screen('retour-paiement', 'client', 'Suivre le règlement', [], 'Écran de retour après ouverture du paiement.', [
    info('Confirmation en attente', 'Le dossier affiche le résultat après réception du statut du règlement.'),
    rows('États à comparer', [['Règlement confirmé', 'Le justificatif apparaît dans le dossier', '', 'documents-client'], ['Règlement à reprendre', 'Revenir au choix du moyen de paiement', '', 'paiement']]),
  ]),
  screen('historique', 'client', 'Mes interventions', [], 'Retrouvez vos demandes ouvertes et terminées.', [
    rows('Interventions de démonstration', [['DÉMO-021 · Prises sans courant', 'Fort-de-France', 'En cours', 'intervention'], ['DÉMO-014 · Tableau électrique', 'Le Lamentin', 'Terminée', 'documents-client']]),
  ], [link('Créer une demande', 'demande')]),
  screen('documents-client', 'client', 'Documents du dossier', [], 'Les justificatifs de l’intervention, regroupés par type.', [
    rows('Documents de démonstration', [['Devis D-021', 'Version 1 · Émetteur artisan', '', 'devis-client'], ['Compte rendu d’intervention', 'Constats, travaux et remise au client', '', 'rapport-artisan'], ['Facture', 'Disponible après finalisation du dossier', '', 'retour-paiement']]),
  ], [link('Donner un avis', 'avis')]),
  screen('messages', 'client', 'Conversation d’intervention', ['M62'], 'DÉMO-021 · Échanges avec l’artisan affecté.', [
    { type: 'chat', items: [['Artisan', 'Bonjour, je vous propose le créneau de l’après-midi.'], ['Client', 'Merci, le créneau me convient.']] },
  ], [link('Revenir au dossier', 'intervention')]),
  screen('notifications', 'client', 'Notifications', ['M39'], 'Les changements importants de vos dossiers.', [
    rows('Aujourd’hui', [['Un devis est disponible', 'DÉMO-021', 'Nouveau', 'devis-client'], ['Créneau confirmé', 'Rendez-vous cet après-midi', '', 'suivi'], ['Compte rendu disponible', 'DÉMO-014', '', 'documents-client']]),
  ]),
  screen('avis', 'client', 'Votre avis', ['M47'], 'Aperçu de l’avis après une intervention terminée.', [
    form('Comment s’est passée l’intervention ?', [['Votre note', ['5 étoiles','4 étoiles','3 étoiles','2 étoiles','1 étoile']], ['Commentaire facultatif', 'textarea?']], 'Simuler l’enregistrement de l’avis', 'historique'),
  ]),

  screen('connexion-artisan', 'artisan', 'Connexion artisan', ['M49'], 'Accédez à l’espace professionnel de démonstration.', [
    form('Profil professionnel', [['Adresse e-mail d’exemple', 'email', 'artisan@example.test']], 'Ouvrir le tableau de bord démo', 'artisan'),
  ], [link('Préparer une candidature', 'candidature')]),
  screen('candidature', 'artisan', 'Candidature artisan', ['M65'], 'Le dossier professionnel en cinq étapes.', [
    steps('Votre dossier', [['Identité','Coordonnées professionnelles'], ['Entreprise','Statut et activité'], ['Justificatifs','Pièces à joindre'], ['Zones','Communes couvertes'], ['Disponibilités','Créneaux et capacité']], 0),
    form('Identité et activité', [['Nom professionnel', 'text', 'Entreprise Exemple'], ['Activité', ['Électricité générale','Dépannage électrique']], fieldCity], 'Continuer vers les justificatifs', 'documents-artisan'),
  ]),
  screen('candidature-envoyee', 'artisan', 'Candidature envoyée', ['M64'], 'Exemple de confirmation après dépôt du dossier.', [
    info('Dossier à examiner', 'L’espace professionnel affiche les pièces reçues et les éventuelles demandes de complément.'),
  ], [link('Voir mes justificatifs', 'documents-artisan'), link('Ouvrir l’espace artisan', 'artisan')]),
  screen('artisan', 'artisan', 'Tableau de bord artisan', ['M35'], 'Vos missions, vos rendez-vous et vos devis.', [
    { type: 'workboard', board: 'artisan' },
  ], [link('Consulter mon profil', 'profil-artisan')]),
  screen('offres', 'artisan', 'Offres de mission', [], 'Choisissez une offre à examiner.', [
    rows('Offres de démonstration', [['Tableau électrique', 'Secteur Le Lamentin', 'Disponible', 'offre-artisan'], ['Éclairage', 'Secteur Schœlcher', 'À examiner', 'offre-artisan']]),
  ]),
  screen('offre-artisan', 'artisan', 'Nouvelle offre de mission', ['M8','M44','M67'], 'Tableau électrique · Secteur Le Lamentin.', [
    facts('Détail de l’offre', [['Zone', 'Le Lamentin'], ['Créneau', 'Cet après-midi'], ['Panne', 'Disjoncteur qui déclenche'], ['Rémunération', 'Estimation à confirmer sur devis']]),
    picture('/home/section-real-panel.jpg', 'Tableau électrique ouvert', 'Illustration du type de panne'),
    info('Dossier complet après attribution', 'L’adresse précise et les coordonnées s’affichent dans le dossier de mission attribué.'),
  ], [link('Simuler l’acceptation', 'mission-artisan'), link('Motiver un refus', 'refus-artisan')]),
  screen('refus-artisan', 'artisan', 'Refuser une offre', [], 'Indiquez le motif dans la maquette.', [
    form('Votre réponse', [['Motif', ['Créneau indisponible','Hors zone','Compétence ou matériel']]], 'Simuler le refus', 'offres'),
  ]),
  screen('mission-artisan', 'artisan', 'Mission attribuée', [], 'DÉMO-021 · Dossier de mission et prochaines actions.', [
    priority('neutral', 'Mission confirmée', 'Déplacement vers Fort-de-France', 'Créneau de démonstration de 14 h à 16 h.', 'Ouvrir le déplacement', 'partage-artisan'),
    facts('Sur place', [['Lieu', 'Fort-de-France · Adresse fictive'], ['Créneau', '14 h – 16 h'], ['Consigne', 'Vérifier le circuit des prises du séjour']]),
    rows('Actions de la mission', [['Déplacement', 'Consulter le partage de position', '', 'partage-artisan'], ['Devis', 'Établir la proposition avant travaux', '', 'devis-artisan'], ['Compte rendu', 'Préparer les preuves et la remise', '', 'rapport-artisan']]),
  ], [link('Créer le devis', 'devis-artisan'), link('Voir le planning', 'planning-artisan')]),
  screen('partage-artisan', 'artisan', 'Partager ma position', [], 'Aperçu du partage limité au déplacement sur la mission.', [
    map('Position simulée · DÉMO-021'),
    info('Partage de position', 'La position alimente le suivi du client pendant le trajet de l’intervention.'),
  ], [link('Voir le suivi côté client', 'suivi'), link('Revenir à la mission', 'mission-artisan')]),
  screen('planning-artisan', 'artisan', 'Planning et disponibilités', [], 'Préparez vos créneaux et votre capacité de prise en charge.', [
    rows('Aujourd’hui', [['14 h · DÉMO-021', 'Fort-de-France', 'Confirmé', 'mission-artisan'], ['16 h · Créneau libre', 'Secteur Le Lamentin', '', 'offres']]),
    form('Préférence de démonstration', [['Disponibilité', ['Disponible','Sur rendez-vous','Indisponible']], ['Capacité', ['3 missions','4 missions']]], 'Voir le tableau de bord', 'artisan'),
  ]),
  screen('devis-artisan', 'artisan', 'Créer un devis', ['M34'], 'Préparez la proposition et son détail avant les travaux.', [
    form('Lignes du devis', [['Déplacement HT', 'number', '40'], ['Main-d’œuvre HT', 'number', '100'], ['Matériel HT', 'number', '20']], 'Voir le devis de démonstration', 'devis-client'),
    info('Aperçu du calcul', 'Les montants visibles dans le devis suivant correspondent à l’exemple de la maquette.'),
  ]),
  screen('rapport-artisan', 'artisan', 'Compte rendu et remise', [], 'Regroupez les preuves de l’intervention et la remise au client.', [
    form('Rapport de démonstration', [['Constats et travaux', 'textarea', 'Vérification des prises et remise en service.'], ['Illustrations avant et après', 'photo'], ['Remise au client', ['Signature sur place','Accusé de remise','Signature et accusé']]], 'Voir les documents du dossier', 'documents-client'),
  ]),
  screen('documents-artisan', 'artisan', 'Justificatifs professionnels', ['M14'], 'Consultez l’état des pièces du dossier de démonstration.', [
    rows('Pièces', [['Assurance RC professionnelle', 'Attestation reçue', 'Validée'], ['Assurance décennale', 'Renouvellement à examiner', 'À renouveler'], ['Diplôme ou qualification', 'Justificatif demandé', 'Manquant']]),
    form('Préparer un justificatif', [['Type de pièce', ['RC professionnelle','Décennale','Qualification']]], 'Simuler le dépôt du dossier', 'candidature-envoyee'),
  ]),
  screen('profil-artisan', 'artisan', 'Profil professionnel', ['M36'], 'Activité, qualification et gestion du dossier.', [
    facts('Entreprise de démonstration', [['Spécialité', 'Électricité générale'], ['Zone', 'Fort-de-France et Le Lamentin'], ['Dossier', 'À compléter']]),
    rows('Gérer votre espace', [['Justificatifs', 'Assurance et qualification', '', 'documents-artisan'], ['Planning', 'Zones et disponibilités', '', 'planning-artisan'], ['Activité et règlements', 'Consulter les missions clôturées', '', 'reglements-artisan']]),
  ]),
  screen('reglements-artisan', 'artisan', 'Activité et règlements artisan', [], 'Distinguer les travaux facturés, les frais et le net à verser.', [
    stats([['Missions terminées','3'],['Règlements à suivre','1'],['Versements simulés','2']]),
    facts('Exemple DÉMO-021', [['Montant client', '176,00 € TTC'], ['Frais de plateforme', 'Selon les conditions du dossier'], ['Net artisan', 'Affiché après rapprochement']]),
  ], [link('Retour au profil', 'profil-artisan')]),

  screen('entreprise', 'entreprise', 'Portefeuille entreprise', ['M66'], 'Suivez les décisions, les budgets et les interventions de vos sites.', [
    { type: 'workboard', board: 'entreprise' },
  ], [link('Gérer l’organisation', 'ent-membres')]),
  screen('ent-interventions', 'entreprise', 'Interventions multisites', ['M4'], 'Retrouvez les dossiers par site, priorité et étape.', [
    rows('Dossiers de démonstration', [['DÉMO-021 · Prises sans courant', 'Résidence Exemple · Fort-de-France', 'Devis à valider', 'ent-approbation'], ['DÉMO-035 · Éclairage cuisine', 'Restaurant Exemple · Le Lamentin', 'Prioritaire', 'site-restauration'], ['DÉMO-052 · Éclairage étage', 'Immeuble de bureaux · Schœlcher', 'Planifiée', 'site-bureaux']]),
  ], [link('Créer une demande', 'ent-demande'), link('Voir les rapports', 'ent-rapports')]),
  screen('syndic', 'entreprise', 'Tableau de bord syndic', ['M13'], 'Immeubles, interventions, budgets et documents.', [
    priority('action', 'Décision sur un devis', 'Prises en parties communes', 'Devis D-021 · Résidence Exemple · 176,00 € TTC.', 'Examiner le devis', 'ent-approbation'),
    stats([['Immeubles','2'],['Demandes en cours','3'],['Devis à valider','1']]),
    rows('Portefeuille', [['Résidence Exemple', 'Fort-de-France · 24 lots d’exemple', 'À suivre', 'site-syndic'], ['Devis D-021', 'Réparation des prises en parties communes', 'À valider', 'ent-approbation'], ['Budget de l’exercice', 'Engagé, réalisé et restant', '', 'ent-budget']]),
  ], [link('Ouvrir la résidence', 'site-syndic'), link('Créer une demande', 'ent-demande')]),
  screen('site-syndic', 'entreprise', 'Résidence Exemple', ['M16'], 'Fiche de site syndic · Parties communes et suivi des travaux.', [
    facts('Immeuble', [['Commune','Fort-de-France'], ['Lots','24 · Exemple'], ['Contact sur site','Gestionnaire de la résidence']]),
    rows('Activité de la résidence', [['DÉMO-021 · Prises sans courant','Parties communes', 'À valider', 'ent-approbation'], ['Budget de l’exercice','Consulter la répartition par poste', '', 'ent-budget'], ['Rapports et documents','Compte rendu et suivi annuel', '', 'ent-rapports']]),
  ], [link('Déclarer un problème', 'ent-demande')]),
  screen('restauration', 'entreprise', 'Tableau de bord restauration', ['M56'], 'Suivez les équipements et l’impact des pannes sur le service.', [
    priority('urgent', 'Ticket prioritaire', 'Circuit de la cuisine à contrôler', 'DÉMO-035 · Restaurant Exemple · Impact sur le service.', 'Ouvrir la fiche du restaurant', 'site-restauration'),
    stats([['Restaurants','2'],['Tickets ouverts','2'],['Équipements à suivre','1']]),
    rows('Exploitation', [['Restaurant Exemple','Cuisine, froid et éclairage', 'Actif', 'site-restauration'], ['Circuit cuisine','Ticket DÉMO-035', 'Prioritaire', 'site-restauration'], ['Contrats et SLA','Priorités et conditions par site', '', 'ent-contrats']]),
  ], [link('Ouvrir le restaurant', 'site-restauration')]),
  screen('site-restauration', 'entreprise', 'Restaurant Exemple', ['M50'], 'Fiche de site · Cuisine, froid et éclairage.', [
    rows('Équipements électriques', [['Circuit cuisine','Contrôle à planifier', 'Prioritaire'], ['Alimentation du froid','Dernier contrôle illustratif', 'Surveillé'], ['Éclairage salle','En service', 'Disponible']]),
    facts('Site et contrat', [['Commune','Le Lamentin'], ['Accès','Prévenir le responsable du site'], ['SLA','Voir le contrat applicable']]),
  ], [link('Déclarer un ticket', 'ent-demande'), link('Voir les contrats', 'ent-contrats')]),
  screen('bureaux', 'entreprise', 'Tableau de bord bureaux', ['V5-C05'], 'Portefeuille de bâtiments, maintenance et consommation.', [
    priority('neutral', 'Prochaine maintenance', 'Contrôle des protections', 'Immeuble de bureaux · Vérification à planifier par zone.', 'Voir la maintenance', 'ent-maintenance'),
    stats([['Bâtiments','2'],['Consommation exemple','18,4 MWh'],['Maintenances planifiées','3']]),
    comparison('Consommation par bâtiment · Exemple', [['Immeuble de bureaux','11,2 MWh', 61], ['Annexe de bureaux','7,2 MWh', 39]]),
    rows('Suivi des bâtiments', [['Immeuble de bureaux','Zones, interventions et budget', '', 'site-bureaux'], ['Prochain entretien','Contrôle des protections', 'Planifié', 'ent-maintenance']]),
  ], [link('Ouvrir la fiche bâtiment', 'site-bureaux')]),
  screen('site-bureaux', 'entreprise', 'Immeuble de bureaux', ['V5-C01'], 'Fiche bâtiment · Énergie, zones, entretien et interventions.', [
    facts('Bâtiment', [['Commune','Schœlcher'], ['Étages','3 · Exemple'], ['Énergie du mois','11,2 MWh · Exemple']]),
    rows('Zones et documents', [['RDC · Accueil','Éclairage et circulations', 'Actif'], ['Étage 1 · Bureaux','Dossier DÉMO-052', 'Planifié', 'ent-interventions'], ['Tableau général','Entretien et historique', '', 'ent-maintenance']]),
  ], [link('Voir la maintenance', 'ent-maintenance'), link('Voir le budget', 'ent-budget')]),
  screen('ent-maintenance', 'entreprise', 'Maintenance et énergie', [], 'Planifiez les contrôles et examinez les relevés d’exemple.', [
    comparison('Consommation mensuelle · Exemple', [['Septembre','10,1 MWh', 72], ['Octobre','11,2 MWh', 80], ['Novembre','12,6 MWh', 90]]),
    rows('Calendrier', [['Contrôle des protections','Immeuble de bureaux', 'Planifié', 'site-bureaux'], ['Vérification de l’éclairage','Annexe de bureaux', 'À programmer']]),
  ]),
  screen('erp', 'entreprise', 'Tableau de bord ERP', ['M37'], 'Suivi des audits électriques et des réserves par établissement.', [
    priority('action', 'Réserve à suivre', 'Repérage du circuit à compléter', 'R-07 · Établissement Exemple · Preuve de levée à examiner.', 'Consulter la réserve', 'ent-reserves'),
    stats([['Établissements','2'],['Audits planifiés','1'],['Réserves ouvertes','2']]),
    rows('Établissements', [['Établissement Exemple','Audit électrique en suivi', 'Réserve ouverte', 'site-erp'], ['Réserves et preuves','Consulter la levée de réserve', '', 'ent-reserves'], ['Signalement sécurité','Préparer une demande prioritaire', '', 'ent-demande']]),
  ], [link('Ouvrir la fiche ERP', 'site-erp')]),
  screen('site-erp', 'entreprise', 'Établissement Exemple', ['M57'], 'Fiche ERP · Audits, alertes et documents.', [
    facts('Audit électrique', [['Site','Établissement Exemple'], ['Dernier état','Rapport à consulter'], ['Réserve de démonstration','Repérage d’un circuit à compléter']]),
    rows('Suivi sécurité', [['Réserve R-07','Vérification attendue', 'Ouverte', 'ent-reserves'], ['Documents','Compte rendu et export', '', 'ent-rapports']]),
  ], [link('Suivre la réserve', 'ent-reserves')]),
  screen('ent-reserves', 'entreprise', 'Audits et réserves', [], 'Vérifiez les preuves avant d’enregistrer une levée de réserve.', [
    rows('Dossier R-07', [['Constat électrique','Repérage du circuit à compléter', 'Ouverte'], ['Justificatif de levée','Ajout possible selon le dossier', 'Facultatif']]),
    form('Examen de la réserve', [['Décision', ['Maintenir la réserve','Simuler la levée']], ['Observation facultative','textarea?']], 'Revenir à la fiche du site', 'site-erp'),
  ]),
  screen('ent-demande', 'entreprise', 'Nouvelle demande multisite', ['M55'], 'Décrivez le besoin, le site et son impact sur l’activité.', [
    form('Dossier de démonstration', [['Site', ['Résidence Exemple','Restaurant Exemple','Immeuble de bureaux','Établissement Exemple']], fieldProblem, fieldDescription, ['Priorité', ['Critique','Élevée','Moyenne','Faible']]], 'Simuler la création de la demande', 'ent-interventions'),
    info('Budget du site', 'Les règles d’approbation applicables sont affichées dans le dossier du site.'),
  ]),
  screen('ent-approbation', 'entreprise', 'Approbation du devis D-021', ['V5-C08'], 'Résidence Exemple · Travaux électriques en parties communes.', [
    facts('Devis soumis', [['Émetteur','Entreprise artisanale de démonstration'], ['Version','1']]),
    form('Décision de démonstration', [['Décision', ['Approuver','Refuser','Demander un complément']], ['Commentaire facultatif','textarea?']], 'Simuler l’enregistrement', 'ent-interventions'),
    steps('Historique', [['Devis reçu','Dossier DÉMO-021'], ['Approbation','Décision attendue']], 1),
  ], [link('Consulter le détail du devis', 'devis-client')]),
  screen('ent-budget', 'entreprise', 'Budgets et alertes', [], 'Les montants engagés et réalisés restent distincts.', [
    stats([['Budget d’exemple','12 000 €'],['Engagé','4 600 €'],['Disponible','7 400 €']]),
    comparison('Montants engagés par poste', [['Interventions','2 900 €', 63], ['Maintenance','1 100 €', 24], ['Audits','600 €', 13]]),
  ], [link('Consulter les rapports', 'ent-rapports')]),
  screen('ent-contrats', 'entreprise', 'Contrats et SLA', [], 'Consultez le périmètre par site, les priorités et la grille applicable.', [
    rows('Contrats de démonstration', [['Maintenance électrique','Immeuble de bureaux', 'En cours'], ['Interventions prioritaires','Restaurant Exemple', 'En cours'], ['Audit électrique','Établissement Exemple', 'À renouveler']]),
    facts('Fiche de contrat', [['Grille','Conditions applicables par site'], ['SLA','Critères et délais définis au contrat'], ['Priorités','Selon l’impact sur l’activité']]),
  ], [link('Voir les interventions', 'ent-interventions')]),
  screen('ent-rapports', 'entreprise', 'Rapports, factures et exports', [], 'Consultez les synthèses et les pièces rattachées aux sites.', [
    rows('Rapports disponibles', [['Synthèse des interventions','Portefeuille de démonstration', '', 'ent-interventions'], ['Détail budgétaire','Engagements et postes', '', 'ent-budget'], ['Facture d’intervention','Dossier DÉMO-021', '', 'documents-client']]),
    form('Paramètres d’export', [['Période', ['Mois courant','Trimestre','Année']], ['Format', ['Tableau','CSV']]], 'Voir le périmètre du rapport', 'entreprise'),
  ]),
  screen('ent-membres', 'entreprise', 'Membres et droits', [], 'Le rôle et le périmètre des sites déterminent l’accès.', [
    rows('Membres de démonstration', [['Gestionnaire organisation','Tous les sites', 'Gestion'], ['Approbateur syndic','Résidence Exemple', 'Approbation'], ['Responsable restauration','Restaurant Exemple', 'Lecture']]),
    form('Aperçu d’une invitation', [['Espace', ['Résidence Exemple','Restaurant Exemple']], ['Rôle', ['Lecture','Approbation','Gestion']]], 'Voir le portefeuille', 'entreprise'),
  ]),

  screen('admin', 'admin', 'Tableau de bord plateforme', ['M43'], 'Supervision des demandes, candidatures et incidents.', [
    { type: 'workboard', board: 'admin' },
  ], []),
  screen('admin-artisans', 'admin', 'Artisans et candidatures', [], 'Identifiez le statut du dossier et les justificatifs à examiner.', [
    rows('Dossiers de démonstration', [['C-012 · Entreprise Exemple','Électricité générale', 'À examiner', 'admin-candidature'], ['C-008 · Atelier Exemple','Justificatif manquant', 'Complément demandé', 'admin-candidature']]),
  ], [link('Voir le dossier C-012', 'admin-candidature')]),
  screen('admin-candidature', 'admin', 'Examen d’une candidature', [], 'C-012 · Vue de contrôle des pièces professionnelles.', [
    facts('Dossier', [['Entreprise','Entreprise Exemple'], ['Activité','Dépannage électrique'], ['Pièces','Assurance et qualification']]),
    form('Décision de démonstration', [['Décision', ['Valider','Demander un complément','Refuser']], ['Motif','textarea','Précisez le motif de la décision.']], 'Simuler la décision', 'admin-artisans'),
  ]),
  screen('admin-interventions', 'admin', 'Interventions et affectation', [], 'Consultez les dossiers à attribuer, en cours et escaladés.', [
    rows('Interventions de démonstration', [['DÉMO-021 · Prises sans courant','Fort-de-France', 'Attribuée', 'intervention'], ['DÉMO-034 · Éclairage','Le Lamentin', 'À affecter', 'admin-dispatch'], ['DÉMO-052 · Tableau','Schœlcher', 'À suivre', 'admin-support']]),
  ], [link('Examiner une affectation', 'admin-dispatch')]),
  screen('admin-dispatch', 'admin', 'Affecter une intervention', [], 'DÉMO-034 · Choisir un artisan de démonstration.', [
    form('Affectation', [['Professionnel', ['Entreprise Exemple','Atelier Exemple']], ['Motif','textarea','Précisez les raisons de l’affectation.']], 'Simuler l’affectation', 'admin-interventions'),
  ]),
  screen('admin-clients', 'admin', 'Clients et organisations', [], 'Annuaire de démonstration pour retrouver les dossiers.', [
    rows('Annuaire', [['Camille Martin','Client de démonstration', '', 'historique'], ['Organisation Démo','Entreprise multisite', '', 'entreprise']]),
  ]),
  screen('admin-finance', 'admin', 'Devis, factures et finance', [], 'Suivi des montants, justificatifs et incidents de paiement.', [
    stats([['Règlements à contrôler','1'],['Remboursements en examen','1'],['Factures disponibles','2']]),
    rows('Opérations de démonstration', [['DÉMO-021 · 176,00 € TTC','Montant du devis exemple', 'À confirmer', 'retour-paiement'], ['DÉMO-014 · Facture','Pièces du dossier', '', 'documents-client'], ['R-003 · Remboursement','Examen du motif et du montant', 'À traiter', 'admin-remboursement']]),
  ], [link('Voir les versements artisan', 'reglements-artisan')]),
  screen('admin-remboursement', 'admin', 'Remboursement et litige', [], 'Aperçu d’une décision opérateur avec motif.', [
    form('Décision de démonstration', [['Action', ['Remboursement partiel','Remboursement total','Examiner le litige']], ['Motif','textarea','Décrivez le motif et la pièce associée.']], 'Voir la file finance', 'admin-finance'),
  ]),
  screen('admin-avis', 'admin', 'Avis et modération', [], 'Examinez le retour et l’intervention associée.', [
    rows('Avis de démonstration', [['A-004 · Intervention clôturée','Retour client en cours d’examen', 'À examiner', 'avis']]),
    form('Décision de démonstration', [['Décision', ['Publier','Masquer','Demander une précision']]], 'Voir le tableau de bord', 'admin'),
  ]),
  screen('admin-support', 'admin', 'Support et escalades', [], 'Consultez les tickets et leur dossier associé.', [
    priority('urgent', 'Escalade prioritaire', 'Justificatif de règlement', 'S-019 · Dossier DÉMO-014 transmis à la finance.', 'Ouvrir la file finance', 'admin-finance'),
    rows('File de démonstration', [['S-014 · Suivi de rendez-vous','DÉMO-021', 'Ouvert', 'intervention'], ['S-019 · Justificatif de règlement','DÉMO-014', 'Escaladé', 'admin-finance']]),
    form('Aperçu de l’escalade', [['Destinataire', ['Support','Finance','Supervision']], ['Note','textarea','Précisez le motif.']], 'Voir la file des interventions', 'admin-interventions'),
  ]),
  screen('admin-droits', 'admin', 'Accès opérateur et journal', [], 'Associez les droits au rôle et consultez la trace des actions.', [
    rows('Périmètres de démonstration', [['Support','Interventions et tickets attribués', 'Lecture / suivi'], ['Finance','Règlements et remboursements', 'Examen'], ['Administration','Paramètres et accès opérateur', 'Gestion']]),
    rows('Journal de démonstration', [['S-019 · Escalade','Support vers finance', 'Enregistrée'], ['C-012 · Examen des pièces','Dossier artisan', 'Enregistré']]),
  ], [link('Voir les paramètres plateforme', 'admin-parametres')]),
  screen('admin-parametres', 'admin', 'Paramètres de la plateforme', [], 'Aperçu des réglages éditoriaux et des référentiels de service.', [
    rows('Référentiels', [['Estimations publiques','Consulter les fourchettes', '', 'tarifs'], ['Zones','Consulter l’écran de couverture', '', 'zones'], ['Conditions de garantie','Consulter les informations de suivi', '', 'garantie'], ['Confidentialité','Consulter les informations publiques', '', 'confidentialite']]),
  ]),

  screen('parcours-client', 'parcours', 'Parcours du client', ['M3','M9','M40','M48','M53'], 'Planche de parcours, de la découverte au suivi après travaux.', [
    rows('Ouvrir les étapes', [['01 · Rechercher une prestation','Catalogue public', '', 'catalogue'], ['02 · Décrire le problème','Formulaire et illustration', '', 'demande'], ['03 · Préciser le lieu','Adresse et créneau', '', 'adresse-demande'], ['04 · Suivre le rendez-vous','Attribution et déplacement', '', 'suivi'], ['05 · Donner son accord','Devis émis par l’artisan', '', 'devis-client'], ['06 · Régler et retrouver les pièces','Paiement sur la plateforme', '', 'paiement'], ['07 · Évaluer ou demander de l’aide','Avis et assistance', '', 'avis']]),
  ], [link('Commencer le parcours', 'demande')]),
  screen('parcours-artisan', 'parcours', 'Parcours artisan et client', ['M1','M58','M68'], 'Planche de coordination des étapes de terrain.', [
    rows('Côté artisan', [['01 · Recevoir l’offre','Examiner le secteur et le créneau', '', 'offre-artisan'], ['02 · Se rendre sur place','Rendez-vous et partage', '', 'partage-artisan'], ['03 · Préparer le devis','Proposition avant travaux', '', 'devis-artisan'], ['04 · Documenter les travaux','Photos et remise', '', 'rapport-artisan'], ['05 · Vérifier le règlement','Rapprochement et versement', '', 'reglements-artisan']]),
  ], [link('Voir le tableau de bord', 'artisan')]),
  screen('parcours-b2b', 'parcours', 'Parcours multisite et back-office', ['M6','M52','M69'], 'Planche de coordination entreprise, artisan et administration.', [
    rows('D’une demande au rapport', [['01 · Déclarer par site','Catégorie et priorité', '', 'ent-demande'], ['02 · Affecter la mission','Coordination plateforme', '', 'admin-dispatch'], ['03 · Valider le devis','Décision et trace', '', 'ent-approbation'], ['04 · Vérifier les travaux','Compte rendu et preuves', '', 'rapport-artisan'], ['05 · Consolider les pièces','Budgets, factures et rapports', '', 'ent-rapports'], ['06 · Traiter une escalade','Support et finance', '', 'admin-support']]),
  ]),
  screen('reperes', 'parcours', 'Repères de comparaison', ['M2','M10','M17'], 'Planche de référence pour lire les variantes de parcours.', [
    rows('Points à examiner', [['Découverte','L’utilisateur trouve une prestation et comprend l’estimation.', '', 'catalogue'], ['Accord sur les travaux','Le montant est expliqué dans le devis avant validation.', '', 'devis-client'], ['Après l’intervention','Les justificatifs et l’aide sont faciles à retrouver.', '', 'documents-client']]),
  ]),
];
