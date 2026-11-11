'use strict';

const icons = {
  home: '<path d="M3 10l9-7 9 7v10h-6v-6H9v6H3z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  activity: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM9 8h6m-6 4h6m-6 4h3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2"/>',
  pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="2.7"/>',
  bolt: '<path d="M13 2 5 14h6l-1 8 8-12h-6z" fill="currentColor" stroke="none"/>',
  plug: '<path d="M9 3v6m6-6v6M6 9h12v2a6 6 0 0 1-12 0zM12 17v4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  calendar: '<rect x="4" y="6" width="16" height="15" rx="2"/><path d="M8 3v5m8-5v5M4 11h16"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 2.8c-1 .4-1 1.2-1 2.2m0 3h.01"/>',
  message: '<path d="M4 5h16v12H9l-5 4z"/><path d="M8 9h8m-8 4h6"/>',
  shield: '<path d="m12 3 8 3v5c0 5-3 8-8 10-5-2-8-5-8-10V6z"/><path d="m8 12 3 3 5-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
};

const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const esc = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const norm = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr').trim();

const audit = new URLSearchParams(location.search).get('maquette') === 'audit';
const auditRanges = {
  outage: '150 à 250 €', socket: '80 à 180 €', panel: '150 à 350 €',
  light: '80 à 200 €', check: '120 à 280 €',
};
const auditPrice = id => audit && Object.hasOwn(auditRanges, id)
  ? `<small class="audit-price">${auditRanges[id]} · exemple indicatif TTC</small>` : '';

const services = {
  outage: { title: 'Coupure de courant partielle', summary: 'Une pièce ou une partie du logement reste sans courant.', category: 'Coupure de courant', photo: 'hero-photo-1.jpg' },
  socket: { title: 'Prise qui ne fonctionne plus', summary: 'Une ou plusieurs prises n’alimentent plus les appareils.', category: 'Prise ou interrupteur', photo: 'section-outlet.jpg' },
  panel: { title: 'Disjoncteur qui saute', summary: 'Le courant se coupe lorsqu’un circuit ou un appareil démarre.', category: 'Tableau électrique', photo: 'hero-photo-2.jpg' },
  light: { title: 'Éclairage en panne', summary: 'Un luminaire ou une zone reste sans éclairage.', category: 'Éclairage', photo: 'section-socket.jpg' },
  add: { title: 'Ajouter une prise', summary: 'Préparez la pose d’un nouveau point électrique.', category: 'Installation', photo: 'section-outlet.jpg' },
  fit: { title: 'Installer un luminaire', summary: 'Décrivez le luminaire et son emplacement.', category: 'Installation', photo: 'section-socket.jpg' },
  check: { title: 'Origine de la panne inconnue', summary: 'Vous constatez une anomalie sans avoir identifié son origine.', category: 'Diagnostic', photo: 'section-real-panel.jpg' },
};
const modes = [
  { label: 'Dépannage', title: 'Dépannages courants', icon: 'bolt', items: ['outage', 'socket', 'panel', 'light'] },
  { label: 'Installation', title: 'Installations courantes', icon: 'plug', items: ['add', 'fit'] },
  { label: 'Diagnostic', title: 'Situations à vérifier', icon: 'search', items: ['check', 'panel'] },
];
const shortcuts = [
  ['outage', 'Coupure', '#fcf0e4'], ['socket', 'Prises', '#f0f1f6'],
  ['panel', 'Tableau', '#e8eefc'], ['light', 'Éclairage', '#fbf2dc'],
];
const stages = [
  ['Décrivez la panne', 'Indiquez ce qui ne fonctionne plus.'],
  ['Précisez le lieu', 'Indiquez l’adresse et le créneau souhaité.'],
  ['Examinez le devis', 'L’électricien présente son devis avant les travaux.'],
];

const screen = document.getElementById('screen');
const tabs = [...document.querySelectorAll('[data-tab]')];
const dialog = document.getElementById('details');
const dialogTitle = document.getElementById('dialog-title');
const dialogBody = document.getElementById('dialog-body');
const state = { mode: 0, query: '', city: '', name: 'Camille Exemple', connected: true };
const demoAccount = { email: 'camille@example.test', password: 'Demonstration2026!' };
const views = { accueil: home, services: catalogue, activite: activity, compte: account, connexion: login, 'mot-de-passe-oublie': recover };

const arrow = `<span data-icon="next">${icon('next')}</span>`;
const link = (label, action) => `<button type="button" class="link-button" data-action="${action}">${label}${arrow}</button>`;
const primary = (label, action) => `<button type="button" class="primary" data-action="${action}">${label}</button>`;

function serviceList(ids) {
  return `<div class="card-list">${ids.map(id => {
    const item = services[id];
    return `<button type="button" class="service" data-action="service" data-value="${id}">
      <img src="/home/${item.photo}" alt="" loading="lazy">
      <div><small>${item.category}</small><strong>${item.title}</strong>${auditPrice(id)}</div>${arrow}
    </button>`;
  }).join('')}</div>`;
}

function home() {
  return `<div class="stack">
    <section class="entry" aria-label="Chercher une intervention">
      <button type="button" class="address" data-action="address">
        <span data-icon="pin">${icon('pin')}</span><span><small>Lieu d’intervention</small>${esc(state.city || 'Choisir mon adresse')}</span>${arrow}
      </button>
      <div class="modes" aria-label="Type de service">
        ${modes.map((mode, index) => `<button type="button" class="mode" data-action="mode" data-value="${index}" aria-pressed="${state.mode === index}">${icon(mode.icon)}${mode.label}</button>`).join('')}
      </div>
      <div class="search">
        ${icon('search')}<input type="search" id="query" aria-label="Rechercher un problème électrique" placeholder="Quel est le problème ?" value="${esc(state.query)}">
        <button type="button" class="later" data-action="schedule">${icon('calendar')}Plus tard</button>
      </div>
      ${audit ? `<button class="audit-urgent" type="button" data-action="audit-urgent">${icon('bolt')}Aide urgente</button>` : ''}
    </section>
    <section>
      <h2>Pour vous</h2>
      <div class="shortcuts">${shortcuts.map(([id, label, color]) => `<button class="shortcut" type="button" data-action="service" data-value="${id}">
        <span style="background:${color}"><svg viewBox="0 0 80 80" aria-hidden="true"><use href="/home/intervention-shortcuts.svg#art-${id}"></use></svg></span>${label}
      </button>`).join('')}</div>
    </section>
    <section id="situations"></section>
    <section class="steps">
      <h2>De la demande au devis</h2>
      ${stages.map(([title, copy], index) => `<div class="step"><span class="number">${index + 1}</span><div><h3>${title}</h3><p>${copy}</p></div></div>`).join('')}
    </section>
    <section class="banner">
      <h2>Votre panne est urgente ?</h2>
      <p>Décrivez la panne et indiquez votre commune. Le créneau dépend des disponibilités.</p>
      ${audit ? '<p class="muted">Le délai est confirmé dans votre dossier une fois le rendez-vous fixé.</p>' : ''}
      ${primary('Décrire ma panne urgente', 'urgent')}
    </section>
    <section>
      <h2>Nos engagements</h2>
      <div class="rows">
        ${row('activity', 'Le détail du prix', 'Un devis détaille les travaux et leur coût.', 'prices')}
        ${row('shield', 'Votre accord avant les travaux', 'Vous examinez le devis avant de décider.', 'agreement')}
        ${row('help', 'Une aide après l’intervention', 'Assistance et justificatifs depuis votre dossier.', 'help')}
        ${audit ? row('shield', 'Informations sur DomDépannage', 'Exploitant et zone d’intervention', 'audit-operator') : ''}
      </div>
    </section>
    <section><h2>Les interventions électriques les plus courantes</h2>${serviceList(modes[0].items)}${link('Voir toutes les interventions', 'services')}</section>
    <section>
      <h2>Questions fréquentes</h2>
      <div class="rows">
        ${row('activity', 'Quel sera le prix du dépannage ?', '', 'prices')}
        ${row('help', 'Que se passe-t-il après ma demande ?', '', 'next-steps')}
        ${row('shield', 'Comment se passe le règlement ?', '', 'payment')}
        ${audit ? row('user', 'Qui intervient chez vous ?', '', 'audit-electrician') : ''}
        ${audit ? row('help', 'Garantie, annulation et recours', '', 'audit-recourse') : ''}
      </div>
    </section>
    <section class="banner"><h2>Vous êtes électricien ?</h2><p>Rejoignez notre réseau pour recevoir des propositions de mission.</p>${primary('Découvrir la candidature', 'recruit')}</section>
    <section><h2>Le blog du dépannage</h2><p class="muted">Des conseils pour préparer votre intervention.</p>${link('Lire un devis d’électricité', 'advice')}</section>
  </div>`;
}

function updateSituations() {
  const region = document.getElementById('situations');
  const mode = modes[state.mode];
  const query = norm(state.query);
  const items = mode.items.filter(id => norm(services[id].title + ' ' + services[id].summary).includes(query));
  region.innerHTML = `<div class="split">
    <h2>${mode.title}</h2>
    ${items.length > 1 ? `<div class="rail-tools">
      <button type="button" class="icon-button" data-action="rail" data-value="-1" aria-label="Cartes précédentes">${icon('back')}</button>
      <button type="button" class="icon-button" data-action="rail" data-value="1" aria-label="Cartes suivantes">${icon('next')}</button>
    </div>` : ''}
  </div>${items.length ? `<div class="rail" id="rail">${items.map(id => {
    const item = services[id];
    return `<button type="button" class="situation" data-action="service" data-value="${id}">
      <img src="/home/${item.photo}" alt="">
      <div><span><strong>${item.title}</strong><small>${item.summary}</small>${auditPrice(id)}</span>${icon('next')}</div>
    </button>`;
  }).join('')}</div>` : `<div class="empty"><p>Aucune situation ne correspond à votre recherche.</p>${link('Effacer la recherche', 'reset')}</div>`}`;
}

function catalogue() {
  return `<section><h1>Services</h1><p class="muted">Choisissez la situation la plus proche de votre besoin.</p>${serviceList(Object.keys(services))}</section>`;
}
function activity() {
  return `<div class="account"><h1>Activité</h1><div class="empty"><h2>Aucune intervention en cours</h2>
    <p class="muted">Tes interventions et leurs devis s’afficheront ici.</p></div>${link('Trouver une intervention', 'services')}</div>`;
}
function row(glyph, title, summary, action) {
  return `<button type="button" class="row" data-action="${action}">${icon(glyph)}
    <span><strong>${title}</strong>${summary ? `<small>${summary}</small>` : ''}</span>${arrow}</button>`;
}
function account() {
  if (!state.connected) return `<div class="account"><h1>Votre espace</h1><p class="muted">Retrouvez votre profil et le suivi de vos interventions.</p>
    ${primary('Se connecter', 'login')}${link('Voir le compte de démonstration', 'sign-in')}${link('Retrouver une intervention', 'activity')}</div>`;
  const initials = state.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  return `<div class="account">
    <div class="identity"><div><h1>${esc(state.name)}</h1><p>Compte particulier</p></div><span class="avatar" aria-hidden="true">${esc(initials)}</span></div>
    <div class="tiles">
      <button type="button" class="tile" data-action="help">${icon('help')}Aide</button>
      <button type="button" class="tile" data-action="messages">${icon('message')}Messages</button>
      <button type="button" class="tile" data-action="security">${icon('shield')}Sécurité</button>
      <button type="button" class="tile" data-action="privacy">${icon('lock')}Mes données</button>
    </div>
    <section class="rows" aria-label="Paramètres du compte">
      ${row('user', 'Informations personnelles', 'Nom et coordonnées', 'profile')}
      ${row('pin', 'Adresses enregistrées', 'Adresse d’intervention', 'address')}
      ${row('activity', 'Mes interventions', 'Historique et devis', 'activity')}
    </section>
    <button class="signout" type="button" data-action="sign-out">Se déconnecter</button>
  </div>`;
}

function login() {
  return `<section class="auth">
    <div class="auth-intro"><h1>Connectez-vous</h1><p>Retrouvez vos interventions, vos devis et vos échanges.</p></div>
    <form class="form auth-form" id="login-form" novalidate>
      <label for="login-email">Adresse e-mail</label>
      <input id="login-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="vous@exemple.fr" required>
      <label for="login-password">Mot de passe</label>
      <div class="password-field"><input id="login-password" name="password" type="password" autocomplete="current-password" required>
        <button type="button" class="password-toggle" data-action="toggle-password" aria-controls="login-password" aria-pressed="false">Afficher</button></div>
      <a class="auth-recovery" href="#mot-de-passe-oublie">Mot de passe oublié ?</a>
      <p id="login-error" class="form-error" role="alert" hidden></p>
      <button class="primary" type="submit">Se connecter</button>
    </form>
    <div class="auth-guest"><h2>Une intervention à demander ?</h2><p>Vous pouvez commencer votre demande depuis l’accueil.</p><a href="#accueil">Continuer sans compte${arrow}</a></div>
    <div class="auth-demo"><p>Maquette test. La connexion et la récupération du compte sont simulées.</p>
      <button type="button" data-action="fill-demo">Remplir les identifiants de démonstration</button></div>
  </section>`;
}

function recover() {
  return `<section class="auth">
    <div class="auth-intro"><h1>Mot de passe oublié ?</h1><p>Indiquez l’adresse e-mail associée à votre compte.</p></div>
    <form class="form auth-form" id="recovery-form" novalidate>
      <label for="recovery-email">Adresse e-mail</label>
      <input id="recovery-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="vous@exemple.fr" required>
      <p id="recovery-error" class="form-error" role="alert" hidden></p>
      <button class="primary" type="submit">Envoyer le lien de récupération</button>
      <p id="recovery-result" class="auth-demo" role="status" hidden></p>
    </form>
    <a class="auth-recovery" href="#connexion">Revenir à la connexion</a>
    <p class="auth-demo">Maquette test. La récupération du compte est simulée.</p>
  </section>`;
}

const details = {
  help: ['Aide et contact', 'Pour une intervention en cours, ouvre son dossier depuis Activité.'],
  messages: ['Messages', 'Les échanges s’affichent après l’attribution d’une intervention.'],
  security: ['Sécurité', 'Tu peux vérifier tes moyens de connexion et protéger l’accès à ton compte.'],
  privacy: ['Confidentialité et données', 'Retrouve les informations liées à ton compte et les options de gestion de tes données.'],
  prices: ['Le détail du prix', 'La fourchette est indicative. Le prix figure sur le devis que tu acceptes.'],
  agreement: ['Ton accord avant les travaux', 'Les travaux commencent après ton accord. Tout supplément fait l’objet d’un nouveau devis.'],
  'next-steps': ['Après ta demande', 'L’équipe recherche un électricien selon ta commune, ton besoin et les disponibilités.'],
  payment: ['Règlement', 'Le règlement s’effectue sur la plateforme sur la base du devis accepté.'],
  recruit: ['Candidature électricien', 'Le parcours de candidature permet de renseigner ton secteur, tes compétences et tes disponibilités.'],
  advice: ['Lire un devis d’électricité', 'Vérifie les lignes de main-d’œuvre, de matériel et de déplacement, puis le total à régler.'],
  'audit-operator': ['Informations sur DomDépannage', 'La raison sociale, le SIRET, le contact et la liste des communes couvertes restent à publier dans cet aperçu.'],
  'audit-electrician': ['Qui intervient chez vous ?', 'Après l’affectation, retrouvez l’électricien et le créneau dans votre dossier. Vous pourrez lire le devis avant de vous engager.'],
  'audit-recourse': ['Garantie, annulation et recours', 'Consultez les conditions de votre dossier et contactez l’assistance si la panne revient. Les conditions et les coordonnées de médiation restent à publier dans cette maquette.'],
};

function render(focus = false) {
  const selected = location.hash.slice(1).split('?')[0];
  const key = Object.hasOwn(views, selected) ? selected : 'accueil';
  screen.innerHTML = views[key]();
  screen.scrollTop = 0;
  const activeTab = key === 'connexion' || key === 'mot-de-passe-oublie' ? 'compte' : key;
  for (const tab of tabs) {
    if (tab.dataset.tab === activeTab) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  if (key === 'accueil') updateSituations();
  if (focus) screen.focus({ preventScroll: true });
}

function open(title, body) {
  dialogTitle.textContent = title;
  dialogBody.innerHTML = body;
  dialog.showModal();
}

function showService(id) {
  const item = services[id];
  open(item.title, `<p>${item.summary}</p>${auditPrice(id)}${audit && auditRanges[id] ? '<p class="muted">Fourchette de démonstration. Le montant final figure sur le devis que vous acceptez.</p>' : ''}${primary('Préparer ma demande', 'request')}`);
}

function navigate(hash) {
  if (dialog.open) dialog.close();
  if (location.hash === '#' + hash) render(true);
  else location.hash = hash;
}

document.querySelectorAll('.tabs [data-icon], .dialog-bar [data-icon]').forEach(el => {
  el.innerHTML = icon(el.dataset.icon);
});
window.addEventListener('hashchange', () => render(true));
screen.addEventListener('input', event => {
  if (event.target.id !== 'query') return;
  state.query = event.target.value;
  updateSituations();
});
screen.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.id === 'query') document.getElementById('situations').scrollIntoView();
});
document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const { action, value } = control.dataset;
  if (action === 'close') dialog.close();
  else if (action === 'mode') {
    state.mode = Number(value);
    state.query = '';
    document.getElementById('query').value = '';
    screen.querySelectorAll('[data-action="mode"]').forEach(button => button.setAttribute('aria-pressed', button === control));
    updateSituations();
  } else if (action === 'rail') {
    const rail = document.getElementById('rail');
    rail.scrollBy({ left: Number(value) * rail.clientWidth * .8, behavior: 'smooth' });
  } else if (action === 'reset') {
    state.query = '';
    const field = document.getElementById('query');
    field.value = '';
    updateSituations();
    field.focus();
  } else if (action === 'service') showService(value);
  else if (action === 'services') navigate('services');
  else if (action === 'activity') navigate('activite');
  else if (action === 'login') navigate('connexion');
  else if (action === 'toggle-password') {
    const field = document.getElementById('login-password');
    const visible = field.type === 'password';
    field.type = visible ? 'text' : 'password';
    control.textContent = visible ? 'Masquer' : 'Afficher';
    control.setAttribute('aria-pressed', String(visible));
  } else if (action === 'fill-demo') {
    document.getElementById('login-email').value = demoAccount.email;
    document.getElementById('login-password').value = demoAccount.password;
    document.getElementById('login-error').hidden = true;
    document.querySelector('#login-form [type="submit"]').focus();
  }
  else if (action === 'sign-out' || action === 'sign-in') {
    state.connected = action === 'sign-in';
    render(true);
  } else if (action === 'address') {
    open('Lieu d’intervention', `<form class="form" id="edit-address">
      <label>Commune<input name="city" value="${esc(state.city)}" placeholder="Fort-de-France" required maxlength="80"></label>
      <button class="primary">Utiliser cette commune</button></form>`);
  } else if (action === 'profile') {
    open('Informations personnelles', `<form class="form" id="edit-profile">
      <label>Nom complet<input name="name" required maxlength="80" value="${esc(state.name)}"></label>
      <p class="muted">camille@example.test</p><button class="primary">Enregistrer</button></form>`);
  } else if (audit && action === 'payment') {
    open('Empreinte bancaire', '<div class="audit-card"><strong>Carte de démonstration</strong><p>•••• &nbsp; 4242</p></div><p><strong>Aucun débit immédiat lors de l’empreinte.</strong> Un montant peut être temporairement réservé. Le règlement se fait selon le devis accepté, par carte depuis votre espace, un lien sécurisé ou le QR code du dossier.</p>');
  } else if (audit && action === 'audit-urgent') {
    open('Aide urgente', `<p>Le numéro d’assistance reste à publier. Décrivez votre panne et renseignez votre commune pour demander un créneau.</p>${primary('Décrire ma panne urgente', 'urgent')}`);
  } else if (action === 'schedule' || action === 'urgent' || action === 'request') {
    if (dialog.open) dialog.close();
    open(action === 'schedule' ? 'Prévoir un dépannage' : 'Préparer ma demande',
      `<p>Choisis une intervention et précise le lieu pour commencer.</p>${primary('Voir les services', 'services')}`);
  } else if (Object.hasOwn(details, action)) {
    const [title, copy] = details[action];
    open(title, `<p>${copy}</p>`);
  }
});
screen.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  if (form.id !== 'login-form' && form.id !== 'recovery-form') return;
  if (form.getAttribute('aria-busy') === 'true') return;
  const email = form.elements.email;
  const error = form.querySelector('[role="alert"]');
  error.hidden = true;
  email.removeAttribute('aria-invalid');
  if (!email.validity.valid) {
    error.textContent = 'Saisissez une adresse e-mail valide.';
    error.hidden = false;
    email.setAttribute('aria-invalid', 'true');
    email.setAttribute('aria-describedby', error.id);
    email.focus();
    return;
  }
  if (form.id === 'recovery-form') {
    const result = document.getElementById('recovery-result');
    result.textContent = 'Récupération simulée. Vous pouvez revenir à la connexion pour poursuivre le test.';
    result.hidden = false;
    return;
  }
  const password = form.elements.password;
  password.removeAttribute('aria-invalid');
  if (!password.value) {
    error.textContent = 'Saisissez votre mot de passe.';
    error.hidden = false;
    password.setAttribute('aria-invalid', 'true');
    password.setAttribute('aria-describedby', error.id);
    password.focus();
    return;
  }
  if (email.value.trim().toLowerCase() !== demoAccount.email || password.value !== demoAccount.password) {
    error.textContent = 'Pour essayer la maquette, utilisez les identifiants de démonstration proposés ci-dessous.';
    error.hidden = false;
    return;
  }
  form.setAttribute('aria-busy', 'true');
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Connexion…';
  await new Promise(resolve => setTimeout(resolve, 350));
  if (!form.isConnected) return;
  password.value = '';
  state.connected = true;
  navigate('compte');
});
dialog.addEventListener('submit', event => {
  event.preventDefault();
  const values = new FormData(event.target);
  if (event.target.id === 'edit-address') state.city = String(values.get('city')).trim();
  if (event.target.id === 'edit-profile') state.name = String(values.get('name')).trim() || state.name;
  dialog.close();
  render(true);
});
render();
