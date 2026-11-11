import { demoEstimates } from './demo-estimates.js';

const $ = (selector) => document.querySelector(selector);
const icon = (name, size = '') => `<svg class="icon ${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const services = {
  outage: { title: 'Coupure de courant partielle', label: 'Coupure', detail: 'Une pièce ou une partie du logement reste sans courant.', image: '/home/hero-photo-1.jpg', position: '34% 44%' },
  socket: { title: 'Prise qui ne fonctionne plus', label: 'Prises', detail: 'Une ou plusieurs prises n’alimentent plus les appareils.', image: '/home/section-outlet.jpg', position: '50% 51%' },
  panel: { title: 'Disjoncteur qui saute', label: 'Tableau', detail: 'Le courant se coupe lorsqu’un circuit ou un appareil démarre.', image: '/home/hero-photo-2.jpg', position: '56% 43%' },
  light: { title: 'Éclairage en panne', label: 'Éclairage', detail: 'Un luminaire ou une zone reste sans éclairage.', image: '/home/section-socket.jpg', position: '38% 42%' },
  add: { title: 'Ajouter une prise', label: 'Prises', detail: 'Préparez la pose d’un nouveau point électrique.', image: '/home/section-outlet.jpg', position: '50% 53%' },
  fitting: { title: 'Installer un luminaire', label: 'Éclairage', detail: 'Décrivez le luminaire et son emplacement.', image: '/home/section-socket.jpg', position: '38% 43%' },
  check: { title: 'Faire vérifier le tableau', label: 'Tableau', detail: 'Décrivez le problème pour orienter la vérification.', image: '/home/section-real-panel.jpg', position: '52% 45%' },
  board: { title: 'Panne de tableau électrique', label: 'Tableau', detail: 'Un module ne répond plus ou le tableau n’alimente plus certains circuits.', image: '/home/section-real-panel.jpg', position: '52% 45%' },
  damaged: { title: 'Prise abîmée ou qui chauffe', label: 'Prises', detail: 'Le mécanisme est endommagé ou montre des signes de chauffe.', image: '/home/section-outlet.jpg', position: '50% 47%' },
  multiple: { title: 'Plusieurs prises sans courant', label: 'Prises', detail: 'Plusieurs prises d’une même zone restent sans courant.', image: '/home/section-outlet.jpg', position: '50% 56%' },
  unknown: { title: 'Origine de la panne inconnue', label: 'Diagnostic', detail: 'Vous constatez une anomalie sans avoir identifié son origine.', image: '/home/hero-photo-1.jpg', position: '42% 45%' },
  // Restaurant. Les photos sont celles de la maquette, en attendant des visuels de cuisine et de salle.
  coldroom: { title: 'Chambre froide ou frigo sans alimentation', label: 'Froid', detail: 'Un équipement de froid n’est plus alimenté ou fait disjoncter.', image: '/home/section-real-panel.jpg', position: '52% 45%', art: 'outage' },
  kitchen: { title: 'Équipement de cuisine qui fait disjoncter', label: 'Cuisine', detail: 'Le courant se coupe au démarrage d’un four, d’une friteuse ou d’un lave-vaisselle.', image: '/home/hero-photo-2.jpg', position: '56% 43%', art: 'panel' },
  hood: { title: 'Hotte ou extraction à l’arrêt', label: 'Extraction', detail: 'La hotte ne démarre plus ou s’arrête pendant le service.', image: '/home/hero-photo-1.jpg', position: '42% 45%', art: 'socket' },
  dining: { title: 'Éclairage de salle en panne', label: 'Éclairage', detail: 'Une zone de la salle ou de la terrasse reste sans éclairage.', image: '/home/section-socket.jpg', position: '38% 42%', art: 'light' },
  service: { title: 'Coupure pendant le service', label: 'Coupure', detail: 'Une partie de l’établissement reste sans courant.', image: '/home/hero-photo-1.jpg', position: '34% 44%', art: 'outage' },
  sign: { title: 'Enseigne lumineuse en panne', label: 'Enseigne', detail: 'L’enseigne ou l’éclairage extérieur ne s’allume plus.', image: '/home/section-socket.jpg', position: '38% 43%', art: 'light' },
  kitchenplug: { title: 'Raccorder un équipement de cuisine', label: 'Cuisine', detail: 'Préparez l’alimentation d’un nouvel appareil.', image: '/home/section-outlet.jpg', position: '50% 53%', art: 'socket' },
  diningplug: { title: 'Ajouter des prises en salle ou au bar', label: 'Prises', detail: 'Indiquez l’emplacement et les appareils à brancher.', image: '/home/section-outlet.jpg', position: '50% 51%', art: 'socket' },
  // Bureau
  desks: { title: 'Postes de travail sans courant', label: 'Postes', detail: 'Plusieurs postes ou une rangée de bureaux ne sont plus alimentés.', image: '/home/section-outlet.jpg', position: '50% 56%', art: 'socket' },
  rack: { title: 'Baie informatique ou onduleur sans alimentation', label: 'Informatique', detail: 'La baie, le serveur ou l’onduleur n’est plus alimenté.', image: '/home/section-real-panel.jpg', position: '52% 45%', art: 'outage' },
  officelight: { title: 'Éclairage des bureaux en panne', label: 'Éclairage', detail: 'Un plateau, un couloir ou une salle de réunion reste sans éclairage.', image: '/home/section-socket.jpg', position: '38% 42%', art: 'light' },
  aircon: { title: 'Climatisation qui fait disjoncter', label: 'Tableau', detail: 'Le courant se coupe au démarrage de la climatisation.', image: '/home/hero-photo-2.jpg', position: '56% 43%', art: 'panel' },
  emergency: { title: 'Éclairage de sécurité en défaut', label: 'Sécurité', detail: 'Un bloc de secours ne s’allume plus ou signale un défaut.', image: '/home/section-socket.jpg', position: '38% 43%', art: 'light' },
  deskplug: { title: 'Ajouter des prises pour des postes', label: 'Postes', detail: 'Indiquez le nombre de postes et leur emplacement.', image: '/home/section-outlet.jpg', position: '50% 53%', art: 'socket' },
};
const modeTitles = { repair: 'Dépannages courants', install: 'Installations courantes', diagnose: 'Situations à vérifier' };
// Un catalogue par type de site. `estimates` : les fourchettes d’exemple viennent du catalogue des particuliers,
// elles ne sont donc pas affichées pour un restaurant ou un bureau.
const catalogues = {
  home: {
    modes: { repair: ['outage', 'socket', 'panel', 'light'], install: ['add', 'fitting'], diagnose: ['unknown', 'check', 'panel'] },
    shortcuts: ['outage', 'socket', 'panel', 'light'],
    featured: ['board', 'socket', 'panel', 'outage', 'damaged', 'light', 'multiple', 'unknown'],
    extra: ['add', 'fitting', 'check'],
    estimates: true,
  },
  restaurant: {
    modes: { repair: ['coldroom', 'kitchen', 'hood', 'dining'], install: ['kitchenplug', 'diningplug'], diagnose: ['unknown', 'check', 'kitchen'] },
    shortcuts: ['coldroom', 'kitchen', 'hood', 'dining'],
    featured: ['coldroom', 'kitchen', 'hood', 'service', 'dining', 'sign', 'board', 'unknown'],
    extra: ['kitchenplug', 'diningplug', 'check'],
    estimates: false,
  },
  office: {
    modes: { repair: ['desks', 'rack', 'officelight', 'aircon'], install: ['deskplug', 'fitting'], diagnose: ['unknown', 'check', 'aircon'] },
    shortcuts: ['desks', 'rack', 'officelight', 'aircon'],
    featured: ['desks', 'rack', 'officelight', 'aircon', 'emergency', 'board', 'panel', 'unknown'],
    extra: ['deskplug', 'fitting', 'check'],
    estimates: false,
  },
};
const profiles = {
  particulier: { label: 'Particulier', catalogue: 'home' },
  restaurant: { label: 'Restaurant', catalogue: 'restaurant' },
  airbnb: { label: 'Airbnb', catalogue: 'home' },
  bureau: { label: 'Bureau', catalogue: 'office' },
  autre: { label: 'Autre', catalogue: 'home' },
};
// Catégorie du formulaire de demande pour chaque situation.
const demoCategories = {
  outage: 'Coupure de courant', socket: 'Prise ou interrupteur', panel: 'Tableau électrique', light: 'Éclairage',
  add: 'Prise ou interrupteur', fitting: 'Éclairage', check: 'Diagnostic',
  board: 'Tableau électrique', damaged: 'Prise ou interrupteur', multiple: 'Prise ou interrupteur', unknown: 'Diagnostic',
  coldroom: 'Coupure de courant', kitchen: 'Tableau électrique', hood: 'Diagnostic', dining: 'Éclairage',
  service: 'Coupure de courant', sign: 'Éclairage', kitchenplug: 'Prise ou interrupteur', diningplug: 'Prise ou interrupteur',
  desks: 'Prise ou interrupteur', rack: 'Coupure de courant', officelight: 'Éclairage', aircon: 'Tableau électrique',
  emergency: 'Éclairage', deskplug: 'Prise ou interrupteur',
};
const places = [
  { id: 'home', title: 'Domicile', area: 'Fort-de-France', context: 'Lieu enregistré · Démo', icon: 'home', favorite: true },
  { id: 'work', title: 'Travail', area: 'Le Lamentin', context: 'Lieu enregistré · Démo', icon: 'work' },
  { id: 'schoelcher', title: 'Centre de Schœlcher', area: 'Schœlcher', context: 'Lieu récent · Démo', icon: 'clock' },
  { id: 'robert', title: 'Bourg du Robert', area: 'Le Robert', context: 'Lieu favori · Démo', icon: 'star', favorite: true },
];
const demoPosition = { title: 'Position actuelle', area: 'Le Lamentin' };
const screens = {
  accueil: $('#home-screen'),
  position: $('#position-screen'),
  compte: $('#account-screen'),
  parametres: $('#settings-screen'),
  activite: $('#activity-screen'),
};
const dock = $('.dock');
const webHeader = $('#web-header');
const siteMenu = $('#site-menu');
const settingsTabs = Array.from(document.querySelectorAll('[data-settings-tab]'));
const returnFocus = new Map();
const rail = $('#services-rail');
const problem = $('#problem-input');
const problemResults = $('#problem-results');
const place = $('#place-input');
const placeResults = $('#place-results');
const sheet = $('#sheet');
const sheetBody = $('#sheet-body');
const profileSelects = Array.from(document.querySelectorAll('[data-profile-select]'));
const scheduleButton = $('#schedule');
let mode = 'repair';
let profile = 'particulier';
let slot = { key: 'today', label: 'Aujourd’hui', short: 'Aujourd’hui' };
let filter = '';
let selected = null;
let serviceToResume = null;
let alertTimer;

const normalized = (value) => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replaceAll('œ', 'oe').trim();

function announce(message) {
  clearTimeout(alertTimer);
  $('#status').textContent = message;
  alertTimer = setTimeout(() => { $('#status').textContent = ''; }, 3600);
}

function currentScreen() {
  const [screen] = location.hash.slice(1).split('/');
  return Object.hasOwn(screens, screen) ? screen : 'accueil';
}

function routeFor(screen, tab) {
  if (screen === 'accueil') return location.pathname + location.search;
  return screen === 'parametres' ? `#parametres/${tab}` : `#${screen}`;
}

function renderSettingsTab(tabId) {
  const tab = settingsTabs.find((button) => button.dataset.settingsTab === tabId) ?? settingsTabs[0];
  for (const button of settingsTabs) {
    const active = button === tab;
    button.tabIndex = active ? 0 : -1;
    button.setAttribute('aria-selected', String(active));
    document.getElementById(button.getAttribute('aria-controls')).hidden = !active;
  }
  return tab;
}

function selectSettingsTab(tabId) {
  history.replaceState(history.state, '', routeFor('parametres', tabId));
  renderSettingsTab(tabId).focus({ preventScroll: true });
}

function updateScreen(focus = false, restore = false) {
  const current = currentScreen();
  for (const [id, screen] of Object.entries(screens)) screen.hidden = id !== current;
  dock.hidden = current === 'position' || current === 'parametres';
  webHeader.hidden = dock.hidden;
  document.querySelectorAll('.dock [data-screen], .web-nav [data-screen]').forEach((button) => {
    if (button.dataset.screen === current) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (current === 'parametres') renderSettingsTab(location.hash.split('/')[1]);
  if (current === 'position') {
    const label = history.state?.from === 'compte' ? 'Retour au compte' : 'Retour à l’accueil';
    screens.position.querySelector('[data-return]').setAttribute('aria-label', label);
    renderMap($('#web-map'));
  }
  if (current === 'accueil') requestAnimationFrame(updateArrows);
  if (!focus) return;
  window.scrollTo(0, 0);
  const preferred = restore ? returnFocus.get(current) : null;
  const target = preferred?.isConnected && preferred.getClientRects().length ? preferred : screens[current].querySelector('h1');
  target.focus({ preventScroll: true });
  if (current === 'accueil' && serviceToResume) {
    const service = serviceToResume;
    serviceToResume = null;
    showService(service);
  }
}

function openScreen(screen, trigger, tab = 'apercu') {
  const current = currentScreen();
  if (screen === current) {
    if (screen === 'parametres') selectSettingsTab(tab);
    else window.scrollTo(0, 0);
    return;
  }
  if (sheet.open) sheet.close();
  const origin = trigger?.closest('dialog') ? document.activeElement : trigger;
  returnFocus.set(current, origin);
  clearTimeout(alertTimer);
  $('#status').textContent = '';
  history.pushState({ from: current, service: trigger?.dataset.serviceLocation }, '', routeFor(screen, tab));
  updateScreen(true);
}

function openPosition(trigger) {
  place.value = '';
  setFilter('');
  openScreen('position', trigger);
}

function goBack(fallback) {
  if (history.state?.from) history.back();
  else {
    history.replaceState(null, '', routeFor(fallback));
    updateScreen(true);
  }
}

const catalogue = () => catalogues[profiles[profile].catalogue];

// Situations proposées au profil courant, tous onglets confondus.
function profileServices() {
  const { modes, featured, extra } = catalogue();
  return [...new Set([...Object.values(modes).flat(), ...featured, ...extra])];
}

// Lien vers le formulaire de demande, avec ce qui a déjà été indiqué sur l’accueil.
function requestUrl(fields = {}) {
  const request = new URL('./maquettes.html', location.href);
  const values = { profil: profiles[profile].label, lieu: selected?.area, creneau: slot.label, ...fields };
  for (const [name, value] of Object.entries(values)) if (value) request.searchParams.set(name, value);
  request.hash = 'ecran/demande';
  return request.href;
}

function showSheet(title, content) {
  $('#sheet-title').textContent = title;
  sheetBody.innerHTML = content;
  if (!sheet.open) sheet.showModal();
}

function renderCards() {
  const cards = catalogue().modes[mode];
  $('#services-title').textContent = modeTitles[mode];
  $('#web-service-count').textContent = `${cards.length} situations`;
  rail.innerHTML = cards.map((id) => {
    const service = services[id];
    return `<button type="button" class="photo-card" data-service="${id}"><img src="${service.image}" alt="" width="320" height="178" decoding="async" style="object-position:${service.position}"><span class="photo-card-copy"><strong>${service.title}</strong><small>${service.detail}</small></span><span class="photo-card-arrow web-only">${icon('next', 'small')}</span></button>`;
  }).join('');
  rail.scrollLeft = 0;
  requestAnimationFrame(updateArrows);
}

function updateArrows() {
  $('#cards-prev').disabled = rail.scrollLeft <= 1;
  $('#cards-next').disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1;
}

function renderCatalogue(ids, showEstimate = false) {
  return ids.map((id) => {
    const service = services[id];
    const estimate = showEstimate ? `<small>${demoEstimates[demoCategories[id]]}</small>` : '';
    return `<button class="catalogue-item" type="button" data-service="${id}">
      <img src="${service.image}" alt="" width="144" height="144" loading="lazy" decoding="async" style="object-position:${service.position}">
      <span class="catalogue-item-copy"><span class="catalogue-category">${service.label}</span><strong>${service.title}</strong>${estimate}</span>
      ${icon('next', 'small')}
    </button>`;
  }).join('');
}

function renderProblemResults() {
  const query = normalized(problem.value);
  problemResults.hidden = !query;
  if (!query) return;
  const matches = matchingServices(query);
  problemResults.innerHTML = matches.length
    ? matches.map((id) => `<button type="button" data-service="${id}">${services[id].title}${icon('next', 'small')}</button>`).join('')
    : '<p role="status">Aucune situation type ne correspond. Validez pour décrire votre problème dans le formulaire.</p>';
}

function matchingServices(query) {
  return profileServices().filter((id) => {
    const service = services[id];
    return normalized(`${service.title} ${service.label} ${service.detail}`).includes(query);
  });
}

function renderProfile() {
  const { shortcuts, featured, extra, estimates } = catalogue();
  $('#shortcuts').innerHTML = shortcuts.map((id) => `<button type="button" data-service="${id}"><span class="shortcut-art"><svg aria-hidden="true"><use href="#art-${services[id].art ?? id}"/></svg></span>${services[id].label}</button>`).join('');
  document.querySelectorAll('#catalogue-cards .catalogue-item').forEach((item) => item.remove());
  $('#catalogue-cards').insertAdjacentHTML('afterbegin', renderCatalogue(featured, estimates));
  $('#catalogue-extra').innerHTML = renderCatalogue(extra);
  $('#catalogue-note').textContent = estimates
    ? 'Fourchettes TTC d’exemple. Le prix final figure sur le devis que vous acceptez.'
    : 'Le prix figure sur le devis que vous acceptez avant les travaux.';
  renderCards();
  renderProblemResults();
  syncUrgentLink();
}

function setProfile(value) {
  if (!Object.hasOwn(profiles, value)) return;
  profile = value;
  for (const select of profileSelects) select.value = value;
  renderProfile();
  announce(`Interventions affichées pour le profil ${profiles[value].label}.`);
}

function syncUrgentLink() {
  const urgentLink = $('#urgent-request');
  const request = new URL(urgentLink.href);
  request.searchParams.set('profil', profiles[profile].label);
  if (selected) request.searchParams.set('lieu', selected.area);
  urgentLink.href = request.href;
}

function setFilter(value) {
  filter = value;
  document.querySelectorAll('[data-filter]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
  renderPlaces();
}

function renderPlaces() {
  const query = normalized(place.value);
  $('#demo-position').hidden = Boolean(query || filter);
  const matches = places.filter((p) => (!filter || (filter === 'favorite' ? p.favorite : p.id === filter)) && normalized(`${p.title} ${p.area}`).includes(query));
  placeResults.innerHTML = matches.length ? matches.map((p) => `<button type="button" class="place-row" data-place="${p.id}"><span class="place-icon">${icon(p.icon)}</span><span><strong>${p.title}</strong><small>${p.area} · ${p.context}</small></span>${icon(selected?.id === p.id ? 'check' : 'next', 'small')}</button>`).join('') : '<p class="empty" role="status">Aucun lieu d’exemple ne correspond. Essayez une autre commune.</p>';
}

function choosePlace(value) {
  selected = value;
  $('#home-location').textContent = value.area;
  $('#web-location-label').textContent = value.area;
  $('#account-location').textContent = value.area;
  syncUrgentLink();
  if (sheet.open) sheet.close();
  renderPlaces();
  serviceToResume = history.state?.service ?? null;
  const resume = Boolean(serviceToResume);
  goBack('accueil');
  if (!resume) announce(`${value.area} sélectionné pour cette maquette.`);
}

const mapPlaces = [places[0], places[1], places[3]];

function renderMap(root) {
  let pin = mapPlaces.includes(selected) ? selected : mapPlaces[0];
  root.innerHTML = `<div class="map"><svg viewBox="0 0 390 230" preserveAspectRatio="none" aria-hidden="true"><path d="M0 21C82 2 116 72 89 111c-18 26-61 47-89 40zM390 101c-48 15-49 49-73 52-40 5-55 42-40 77h113z" fill="#bddef2"/><path d="M-5 195C92 147 134 151 178 149s72-36 109-61 57-20 106-37M37 13c44 27 85 45 105 74s9 79 48 107l60 41M-8 102c101 30 126-23 184-33 69-12 125-14 213 37" fill="none" stroke="#fffdf4" stroke-width="10"/><path d="M37 13c44 27 85 45 105 74s9 79 48 107l60 41" fill="none" stroke="#e3c98b" stroke-width="2"/></svg>${mapPlaces.map((value) => `<button type="button" class="map-pin" data-pin="${value.id}" aria-pressed="${value === pin}">${value.area}</button>`).join('')}</div><button class="primary" type="button" data-map-confirm>Choisir ${pin.area}</button>`;
  const buttons = Array.from(root.querySelectorAll('[data-pin]'));
  const confirm = root.querySelector('[data-map-confirm]');
  buttons.forEach((button) => button.addEventListener('click', () => {
    pin = mapPlaces.find((value) => value.id === button.dataset.pin);
    buttons.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
    confirm.textContent = `Choisir ${pin.area}`;
  }));
  confirm.addEventListener('click', () => choosePlace(pin));
}

function openMap() {
  showSheet('Choisir sur la carte', '<p>Carte de démonstration. Sélectionnez une commune.</p><div data-map-dialog></div>');
  renderMap(sheetBody.querySelector('[data-map-dialog]'));
}

function focusSection(section) {
  const target = document.getElementById(section);
  const block = section === 'services' && matchMedia('(min-width: 940px)').matches ? 'nearest' : 'start';
  target.scrollIntoView({ block });
  target.querySelector('h2').focus({ preventScroll: true });
}

function showService(service) {
  const item = services[service];
  const next = selected
    ? `<p><strong>Lieu d’intervention</strong> · ${selected.area}</p><p><strong>Jour souhaité</strong> · ${slot.label}</p><div class="service-sheet-actions"><a class="primary web-form-link" id="test-request-link">Voir le formulaire de test</a><button type="button" class="secondary" data-position data-service-location="${service}">Modifier l’adresse</button></div>`
    : `<button type="button" class="primary" data-position data-service-location="${service}">Choisir une commune</button>`;
  showSheet(item.title, `<p>${item.detail}</p>${next}`);
  if (selected) {
    const link = $('#test-request-link');
    link.href = requestUrl({ panne: demoCategories[service] });
    link.addEventListener('click', () => sheet.close());
  }
}

// --- Jour souhaité : aujourd’hui, demain, après-demain ou une date choisie dans le calendrier.
const dayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const monthFormat = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const quickDays = [['today', 'Aujourd’hui', 0], ['tomorrow', 'Demain', 1], ['after', 'Après-demain', 2]];
const moments = ['Matin', 'Après-midi'];
const calendarMonths = 3; // mois affichables, mois courant compris

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function setSlot(next) {
  slot = next;
  $('#schedule-label').textContent = next.short;
  scheduleButton.dataset.planned = String(next.key !== 'today');
  if (sheet.open) sheet.close();
  announce(`Jour souhaité : ${next.label}.`);
}

function renderCalendar(root, state) {
  const today = startOfToday();
  const first = new Date(today.getFullYear(), today.getMonth() + state.month, 1);
  const lead = (first.getDay() + 6) % 7; // lundi en première colonne
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: count }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), index + 1);
    const past = date < today;
    const pressed = state.date?.getTime() === date.getTime();
    return `<button type="button" class="calendar-day" data-day="${date.getTime()}" aria-label="${dayFormat.format(date)}" aria-pressed="${pressed}"${past ? ' disabled' : ''}>${index + 1}</button>`;
  }).join('');
  const chosen = state.date ? `${dayFormat.format(state.date)}${state.moment ? ` · ${state.moment}` : ''}` : 'Choisissez une date';
  root.innerHTML = `<div class="calendar-head"><button type="button" class="back" data-month="-1" aria-label="Mois précédent"${state.month === 0 ? ' disabled' : ''}>${icon('back')}</button><strong aria-live="polite">${monthFormat.format(first)}</strong><button type="button" class="back" data-month="1" aria-label="Mois suivant"${state.month >= calendarMonths - 1 ? ' disabled' : ''}>${icon('next')}</button></div>
    <div class="calendar-grid" role="group" aria-label="Jours de ${monthFormat.format(first)}">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day) => `<span aria-hidden="true">${day}</span>`).join('')}${'<span></span>'.repeat(lead)}${days}</div>
    <div class="slot-moments" role="group" aria-label="Moment de la journée">${moments.map((moment) => `<button type="button" class="option" data-moment="${moment}" aria-pressed="${state.moment === moment}">${moment}</button>`).join('')}</div>
    <p class="calendar-choice" role="status">${chosen}</p>
    <button type="button" class="primary" data-slot-confirm${state.date && state.moment ? '' : ' disabled'}>Valider ce créneau</button>`;
}

function openSchedule() {
  const today = startOfToday();
  const custom = slot.key === 'custom';
  const state = { month: 0, date: custom ? slot.date : null, moment: custom ? slot.moment : null };
  if (state.date) state.month = Math.max(0, (state.date.getFullYear() - today.getFullYear()) * 12 + state.date.getMonth() - today.getMonth());
  const quick = quickDays.map(([key, label, offset]) => `<button type="button" class="option slot-option" data-slot="${key}" aria-pressed="${slot.key === key}"><span>${label}</span><small>${dayFormat.format(addDays(today, offset))}</small></button>`).join('');
  showSheet('Quand faut-il intervenir ?', `<p>Indiquez le jour souhaité. Le rendez-vous est confirmé ensuite dans votre dossier.</p><div class="sheet-actions">${quick}<button type="button" class="option slot-option" data-slot="custom" aria-expanded="${custom}" aria-controls="slot-calendar"><span>Choisir un créneau</span>${icon('calendar', 'small')}</button></div><div class="slot-calendar" id="slot-calendar"${custom ? '' : ' hidden'}></div>`);
  const calendar = sheetBody.querySelector('#slot-calendar');
  renderCalendar(calendar, state);
  sheetBody.querySelectorAll('[data-slot]').forEach((button) => button.addEventListener('click', () => {
    const choice = quickDays.find(([key]) => key === button.dataset.slot);
    if (choice) {
      setSlot({ key: choice[0], label: choice[1], short: choice[1] });
      return;
    }
    calendar.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    sheetBody.querySelectorAll('[data-slot][aria-pressed]').forEach((quickButton) => quickButton.setAttribute('aria-pressed', 'false'));
    calendar.querySelector('.calendar-day:not([disabled])')?.focus();
  }));
  calendar.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.slotConfirm !== undefined) {
      const day = dayFormat.format(state.date);
      setSlot({ key: 'custom', date: state.date, moment: state.moment, label: `${day} · ${state.moment}`, short: `${shortDayFormat.format(state.date)} · ${state.moment}` });
      return;
    }
    let focus;
    if (button.dataset.month) {
      state.month += Number(button.dataset.month);
      focus = `[data-month="${button.dataset.month}"]:not([disabled]), [data-month]:not([disabled])`;
    } else if (button.dataset.day) {
      state.date = new Date(Number(button.dataset.day));
      focus = `[data-day="${button.dataset.day}"]`;
    } else if (button.dataset.moment) {
      state.moment = button.dataset.moment;
      focus = `[data-moment="${button.dataset.moment}"]`;
    }
    renderCalendar(calendar, state);
    calendar.querySelector(focus)?.focus();
  });
}

const accountNotes = {
  help: { title: 'Aide', text: 'Décrivez votre panne et précisez le lieu d’intervention. L’artisan vous présente un devis avant les travaux.' },
  payments: { title: 'Paiements et factures', text: 'Aucun règlement enregistré. Les factures et justificatifs apparaissent ici après un paiement sur la plateforme.' },
  messages: { title: 'Messages', text: 'Aucun message pour le moment. Retrouvez ici les échanges associés à vos interventions.' },
  verification: { title: 'Vérification de démonstration', text: 'Dans le parcours connecté, vous saisissez le code reçu par SMS pour confirmer votre numéro.' },
};

function openAccountAction(action) {
  if (action === 'profile') {
    showSheet('Choisir un espace', '<p>Changez le libellé du profil dans la maquette.</p><div class="sheet-actions"><button type="button" class="option" data-profile="Espace particulier">Particulier</button><button type="button" class="option" data-profile="Espace entreprise">Entreprise</button></div>');
    sheetBody.querySelectorAll('[data-profile]').forEach((button) => button.addEventListener('click', () => {
      $('#profile-space').textContent = button.dataset.profile;
      sheet.close();
    }));
    return;
  }
  const note = accountNotes[action];
  showSheet(note.title, `<p>${note.text}</p>`);
}

$('.settings-tabs').addEventListener('keydown', (event) => {
  const index = settingsTabs.indexOf(event.target);
  if (index < 0) return;
  const last = settingsTabs.length - 1;
  const next = { ArrowLeft: index === 0 ? last : index - 1, ArrowRight: index === last ? 0 : index + 1, Home: 0, End: last }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  selectSettingsTab(settingsTabs[next].dataset.settingsTab);
});

document.addEventListener('click', (event) => {
  if (siteMenu.open && !siteMenu.contains(event.target)) siteMenu.open = false;
  const trigger = event.target.closest('button');
  if (!trigger) return;
  if (siteMenu.open && siteMenu.contains(trigger)) {
    siteMenu.open = false;
    siteMenu.querySelector('summary').focus();
  }
  const { mode: nextMode, service, place: placeId, filter: nextFilter, section, screen, settings, settingsTab, accountAction } = trigger.dataset;
  if ('position' in trigger.dataset) openPosition(trigger);
  else if (trigger.dataset.return) goBack(trigger.dataset.return);
  else if (screen) openScreen(screen, trigger);
  else if (settings) openScreen('parametres', trigger, settings);
  else if (settingsTab) selectSettingsTab(settingsTab);
  else if (accountAction) openAccountAction(accountAction);
  else if (section) {
    openScreen('accueil', trigger);
    focusSection(section);
  } else if (nextMode) {
    mode = nextMode;
    document.querySelectorAll('[data-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button === trigger)));
    renderCards();
  } else if (service) {
    showService(service);
  } else if (nextFilter) setFilter(filter === nextFilter ? '' : nextFilter);
  else if (placeId) choosePlace(places.find((p) => p.id === placeId));
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !siteMenu.open) return;
  event.preventDefault();
  siteMenu.open = false;
  siteMenu.querySelector('summary').focus();
});

scheduleButton.addEventListener('click', openSchedule);
for (const select of profileSelects) select.addEventListener('change', () => setProfile(select.value));
$('#demo-position').addEventListener('click', () => choosePlace(demoPosition));
$('#open-map').addEventListener('click', openMap);
$('#catalogue-toggle').addEventListener('click', (event) => {
  const button = event.currentTarget;
  const extra = $('#catalogue-extra');
  const expanded = extra.hidden;
  extra.hidden = !expanded;
  button.setAttribute('aria-expanded', String(expanded));
  button.querySelector('span').textContent = expanded ? 'Réduire le catalogue' : 'Voir toutes les interventions';
});
$('#start-diagnostic').addEventListener('click', () => {
  $('.service-tabs [data-mode="diagnose"]').click();
  focusSection('services');
});
problem.addEventListener('input', renderProblemResults);
place.addEventListener('input', renderPlaces);
$('#place-search').addEventListener('submit', (event) => event.preventDefault());
$('#problem-search').addEventListener('submit', (event) => {
  event.preventDefault();
  // La recherche aboutit toujours au formulaire de demande : le texte saisi devient la description,
  // et le type de problème est prérempli lorsqu’une seule situation correspond.
  const description = problem.value.trim();
  const matches = description ? matchingServices(normalized(description)) : [];
  location.href = requestUrl({ description, panne: matches.length === 1 ? demoCategories[matches[0]] : '' });
});
for (const [id, direction] of [['#cards-prev', -1], ['#cards-next', 1]]) $(id).addEventListener('click', () => rail.scrollBy({ left: direction * ((rail.firstElementChild?.offsetWidth ?? 0) + 14), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }));
rail.addEventListener('scroll', updateArrows, { passive: true });
window.addEventListener('resize', updateArrows);
window.addEventListener('popstate', () => {
  siteMenu.open = false;
  if (sheet.open) sheet.close();
  updateScreen(true, true);
});
// Le navigateur peut restaurer un choix de profil au rechargement : repartir de sa valeur.
if (Object.hasOwn(profiles, profileSelects[0].value)) profile = profileSelects[0].value;
for (const select of profileSelects) select.value = profile;
renderProfile();
renderPlaces();
updateScreen();
