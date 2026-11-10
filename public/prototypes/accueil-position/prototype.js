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
};
const modes = {
  repair: { title: 'Dépannages courants', cards: ['outage', 'socket', 'panel', 'light'] },
  install: { title: 'Installations courantes', cards: ['add', 'fitting'] },
  diagnose: { title: 'Situations à vérifier', cards: ['check', 'panel', 'outage'] },
};
const places = [
  { id: 'home', title: 'Domicile', area: 'Fort-de-France', context: 'Lieu enregistré · Démo', icon: 'home', favorite: true },
  { id: 'work', title: 'Travail', area: 'Le Lamentin', context: 'Lieu enregistré · Démo', icon: 'work' },
  { id: 'schoelcher', title: 'Centre de Schœlcher', area: 'Schœlcher', context: 'Lieu récent · Démo', icon: 'clock' },
  { id: 'robert', title: 'Bourg du Robert', area: 'Le Robert', context: 'Lieu favori · Démo', icon: 'star', favorite: true },
];
const demoPosition = { title: 'Position actuelle', area: 'Le Lamentin' };
const home = $('#home-screen');
const position = $('#position-screen');
const rail = $('#services-rail');
const problem = $('#problem-input');
const problemResults = $('#problem-results');
const place = $('#place-input');
const placeResults = $('#place-results');
const sheet = $('#sheet');
const sheetBody = $('#sheet-body');
let mode = 'repair';
let filter = '';
let selected = null;
let lastPositionTrigger = null;
let alertTimer;

const normalized = (value) => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replaceAll('œ', 'oe').trim();

function announce(message) {
  clearTimeout(alertTimer);
  $('#status').textContent = message;
  alertTimer = setTimeout(() => { $('#status').textContent = ''; }, 3600);
}

function updateScreen(focus = false) {
  const onPosition = location.hash === '#position';
  home.hidden = onPosition;
  position.hidden = !onPosition;
  if (!focus) return;
  window.scrollTo(0, 0);
  if (onPosition) $('#position-title').focus({ preventScroll: true });
  else if (lastPositionTrigger?.isConnected) lastPositionTrigger.focus({ preventScroll: true });
}

function openPosition(trigger) {
  lastPositionTrigger = home.contains(trigger) ? trigger : $('[data-position]');
  if (sheet.open) sheet.close();
  clearTimeout(alertTimer);
  $('#status').textContent = '';
  place.value = '';
  setFilter('');
  history.pushState({ position: true }, '', '#position');
  updateScreen(true);
}

function goHome() {
  if (position.hidden) {
    window.scrollTo(0, 0);
    return;
  }
  if (history.state?.position) history.back();
  else {
    history.replaceState(null, '', location.pathname + location.search);
    updateScreen(true);
  }
}

function showSheet(title, content) {
  $('#sheet-title').textContent = title;
  sheetBody.innerHTML = content;
  if (!sheet.open) sheet.showModal();
}

function renderCards() {
  const data = modes[mode];
  $('#services-title').textContent = data.title;
  rail.innerHTML = data.cards.map((id) => {
    const service = services[id];
    return `<button type="button" class="photo-card" data-service="${id}"><img src="${service.image}" alt="" width="320" height="178" decoding="async" style="object-position:${service.position}"><strong>${service.title}</strong><small>${service.detail}</small></button>`;
  }).join('');
  rail.scrollLeft = 0;
  requestAnimationFrame(updateArrows);
}

function updateArrows() {
  $('#cards-prev').disabled = rail.scrollLeft <= 1;
  $('#cards-next').disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1;
}

function renderProblemResults() {
  const query = normalized(problem.value);
  problemResults.hidden = !query;
  if (!query) return;
  const matches = Object.entries(services).filter(([, s]) => normalized(`${s.title} ${s.label} ${s.detail}`).includes(query));
  problemResults.innerHTML = matches.length
    ? matches.map(([id, s]) => `<button type="button" data-service="${id}">${s.title}${icon('next', 'small')}</button>`).join('')
    : '<p>Aucun résultat. Essayez « prise », « coupure » ou « tableau ».</p>';
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
  if (sheet.open) sheet.close();
  renderPlaces();
  goHome();
  announce(`${value.area} sélectionné pour cette maquette.`);
}

function openMap() {
  const mapPlaces = [places[0], places[1], places[3]];
  showSheet('Choisir sur la carte', `<p>Carte schématique de démonstration. Sélectionnez une commune.</p><div class="map"><svg viewBox="0 0 390 230" preserveAspectRatio="none" aria-hidden="true"><path d="M0 21C82 2 116 72 89 111c-18 26-61 47-89 40zM390 101c-48 15-49 49-73 52-40 5-55 42-40 77h113z" fill="#bddef2"/><path d="M-5 195C92 147 134 151 178 149s72-36 109-61 57-20 106-37M37 13c44 27 85 45 105 74s9 79 48 107l60 41M-8 102c101 30 126-23 184-33 69-12 125-14 213 37" fill="none" stroke="#fffdf4" stroke-width="10"/><path d="M37 13c44 27 85 45 105 74s9 79 48 107l60 41" fill="none" stroke="#e3c98b" stroke-width="2"/></svg>${mapPlaces.map((p, i) => `<button type="button" class="map-pin" data-pin="${p.id}" aria-pressed="${i === 0}">${p.area}</button>`).join('')}</div><button class="primary" type="button" id="confirm-map">Choisir Fort-de-France</button>`);
  let pin = mapPlaces[0];
  sheetBody.querySelectorAll('[data-pin]').forEach((button) => button.addEventListener('click', () => {
    pin = mapPlaces.find((p) => p.id === button.dataset.pin);
    sheetBody.querySelectorAll('[data-pin]').forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
    $('#confirm-map').textContent = `Choisir ${pin.area}`;
  }));
  $('#confirm-map').addEventListener('click', () => choosePlace(pin));
}

$('#shortcuts').innerHTML = ['outage', 'socket', 'panel', 'light'].map((id) => `<button type="button" data-service="${id}"><span class="shortcut-art"><svg aria-hidden="true"><use href="#art-${id}"/></svg></span>${services[id].label}</button>`).join('');
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('button');
  if (!trigger) return;
  const { mode: nextMode, service, place: placeId, filter: nextFilter, section } = trigger.dataset;
  if ('position' in trigger.dataset) openPosition(trigger);
  else if ('home' in trigger.dataset) goHome();
  else if (section) {
    const target = document.getElementById(section);
    target.scrollIntoView({ block: 'start' });
    target.querySelector('h2').focus({ preventScroll: true });
  } else if (nextMode) {
    mode = nextMode;
    document.querySelectorAll('[data-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button === trigger)));
    renderCards();
  } else if (service) {
    const item = services[service];
    showSheet(item.title, `<p>${item.detail} Pour tester la suite, choisissez un lieu d’intervention.</p><button type="button" class="primary" data-position>Choisir une position</button>`);
  } else if (nextFilter) setFilter(filter === nextFilter ? '' : nextFilter);
  else if (placeId) choosePlace(places.find((p) => p.id === placeId));
});

$('#schedule').addEventListener('click', () => {
  showSheet('Quand faut-il intervenir ?', '<p>Choisissez un moment indicatif pour la maquette.</p><div class="sheet-actions"><button type="button" class="option" data-time="Dès que possible">Dès que possible</button><button type="button" class="option" data-time="Plus tard">Prévoir un autre jour</button></div>');
  sheetBody.querySelectorAll('[data-time]').forEach((button) => button.addEventListener('click', () => {
    const schedule = $('#schedule');
    schedule.dataset.planned = String(button.dataset.time === 'Plus tard');
    sheet.close();
    announce(`${button.dataset.time} · Préférence de démonstration`);
  }));
});
$('#demo-position').addEventListener('click', () => choosePlace(demoPosition));
$('#open-map').addEventListener('click', openMap);
problem.addEventListener('input', renderProblemResults);
place.addEventListener('input', renderPlaces);
for (const id of ['#problem-search', '#place-search']) $(id).addEventListener('submit', (e) => e.preventDefault());
for (const [id, direction] of [['#cards-prev', -1], ['#cards-next', 1]]) $(id).addEventListener('click', () => rail.scrollBy({ left: direction * ((rail.firstElementChild?.offsetWidth ?? 0) + 14), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }));
rail.addEventListener('scroll', updateArrows, { passive: true });
window.addEventListener('resize', updateArrows);
window.addEventListener('popstate', () => updateScreen(true));
renderCards();
renderPlaces();
updateScreen();
