import { roles, screens } from './maquettes-data.js';
import { sourceFiles, sourceRefs } from './maquettes-sources.js';
import { approvalState, bindWorkboard, renderPriority, renderWorkboard, workspaceNav } from './maquettes-pro.js';

const main = document.querySelector('#atlas-main');
const directory = new Map(screens.map((screen) => [screen.id, screen]));
const inRole = (id) => screens.filter(({ role }) => role === id);
const route = (id) => `#ecran/${id}`;
const targetFor = (id) => directory.get(id).href ?? route(id);
const icon = (id, small = false) => `<svg class="icon${small ? ' small' : ''}" aria-hidden="true"><use href="#a-${id}"/></svg>`;
const normalize = (text) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const escaped = (text) => String(text).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const selected = (on) => on ? ' aria-current="page"' : '';
const sample = new Map();
const workContext = { icon, targetFor, sample };
let currentScreen;
let noticeTimer;

function notify(message) {
  const status = document.querySelector('#atlas-status');
  clearTimeout(noticeTimer);
  status.textContent = message;
  noticeTimer = setTimeout(() => { status.textContent = ''; }, 3600);
}

function nav(active, screen) {
  const entries = Object.entries(roles).map(([id, role]) => `<a href="#role/${id}"${selected(active === id && !screen)}>${icon(role.icon)}${role.label}</a>`).join('');
  const gallery = `<a href="#maquettes"${selected(active === 'maquettes')}>${icon('grid')}Toutes les maquettes</a>`;
  const sources = `<a href="#sources"${selected(active === 'sources')}>${icon('document')}Références PDF</a>`;
  const sidebar = document.querySelector('#atlas-nav');
  const dock = document.querySelector('#atlas-dock');
  const workspace = screen && workspaceNav[screen.role];
  if (workspace) {
    const localLink = ([label, id, symbol]) => `<a href="${targetFor(id)}"${selected(screen.id === id)}>${icon(symbol)}${label}</a>`;
    const shortcuts = new Set(workspace.links.map(([, id]) => id));
    const extraLinks = inRole(screen.role).filter(({ id }) => !shortcuts.has(id));
    sidebar.innerHTML = `<div class="work-sidebar"><strong>${workspace.label}</strong>${workspace.links.map(localLink).join('')}</div><details class="work-sidebar-more"${extraLinks.some(({ id }) => screen.id === id) ? ' open' : ''}><summary>Autres écrans</summary>${extraLinks.map((item) => `<a href="${targetFor(item.id)}"${selected(item.id === screen.id)}>${item.title}</a>`).join('')}</details><div class="atlas-screen-nav"><strong>Bibliothèque de test</strong>${gallery}${entries}${sources}</div>`;
    dock.innerHTML = `${workspace.links.slice(0, 3).map(localLink).join('')}<a href="#role/${screen.role}">${icon('grid')}Maquettes</a>`;
    return;
  }
  sidebar.innerHTML = `${gallery}${entries}${sources}`;
  dock.innerHTML = `<a href="#maquettes"${selected(active !== 'sources' && active !== 'parcours')}>${icon('grid')}Maquettes</a><a href="#role/parcours"${selected(active === 'parcours')}>${icon('steps')}Parcours</a><a href="#sources"${selected(active === 'sources')}>${icon('document')}Sources</a><a href="./index.html">${icon('bolt')}Accueil</a>`;
}

function roleLinks(active = '') {
  return `<nav class="atlas-role-links" aria-label="Parcourir par espace"><a href="#maquettes"${selected(!active)}>Tous</a>${Object.entries(roles).map(([id, role]) => `<a href="#role/${id}"${selected(id === active)}>${role.label}</a>`).join('')}</nav>`;
}

function renderCards(list) {
  if (!list.length) return '<p class="atlas-empty" role="status">Aucune maquette trouvée. Essayez « devis », « syndic » ou une référence comme M43.</p>';
  return `<div class="atlas-cards">${list.map((item) => `<a class="atlas-card" href="${targetFor(item.id)}"><span class="atlas-card-icon">${icon(roles[item.role].icon)}</span><span><strong>${item.title}</strong><small>${item.intro}</small></span>${icon('next', true)}</a>`).join('')}</div>`;
}

function renderGallery(roleId) {
  const role = roles[roleId];
  const title = role ? `Maquettes · ${role.label}` : 'Toutes les maquettes';
  const workspace = workspaceNav[roleId];
  const featured = ['parcours-client', 'parcours-artisan', 'parcours-b2b'].map((id) => directory.get(id));
  const categoryCards = Object.entries(roles).map(([id, meta]) => `<a class="atlas-card atlas-role-card" href="#role/${id}"><span class="atlas-card-icon">${icon(meta.icon)}</span><span><strong>${meta.label}</strong><small>${meta.description}</small><span class="atlas-count">${inRole(id).length} écrans et planches</span></span>${icon('next', true)}</a>`).join('');
  main.innerHTML = `<div class="atlas-intro"><h1 tabindex="-1">${title}</h1><p>${role?.description ?? `${screens.length} écrans et planches à explorer par espace, de la demande au compte rendu.`}</p>${workspace ? `<a class="primary work-gallery-link" href="${targetFor(workspace.home)}">Ouvrir le tableau de bord ${icon('next', true)}</a>` : ''}</div>
    <label class="atlas-search search-pill"><span class="search-input">${icon('search')}<span class="visually-hidden">Rechercher une maquette</span><input id="atlas-search" type="search" placeholder="Rechercher une maquette" aria-controls="atlas-results"></span></label>
    ${roleLinks(roleId)}
    <div id="atlas-results">${role ? renderCards(inRole(roleId)) : `<section aria-labelledby="spaces-heading"><h2 id="spaces-heading">Choisir un espace</h2><div class="atlas-cards">${categoryCards}</div></section><section aria-labelledby="journeys-heading"><h2 id="journeys-heading">Tester un parcours</h2>${renderCards(featured)}</section><a class="atlas-inline" href="#sources">Consulter les ${sourceRefs.length} références PDF ${icon('next', true)}</a>`}</div>`;
  const search = document.querySelector('#atlas-search');
  const results = document.querySelector('#atlas-results');
  const initial = results.innerHTML;
  search.addEventListener('input', () => {
    const query = normalize(search.value.trim());
    if (!query) { results.innerHTML = initial; return; }
    const matches = (role ? inRole(roleId) : screens).filter((item) => {
      const refs = sourceRefs.filter(([, , , id]) => id === item.id).map(([id]) => id);
      return normalize([item.title, item.intro, roles[item.role].label, ...refs].join(' ')).includes(query);
    });
    results.innerHTML = renderCards(matches);
  });
  nav(roleId || 'maquettes');
}

function section(title, content, className = '') {
  return `<section class="atlas-block ${className}">${title ? `<h2>${title}</h2>` : ''}${content}</section>`;
}

function renderField([label, type, placeholder = ''], index) {
  const id = `atlas-field-${index}`;
  if (type === 'photo') return `<div class="atlas-field"><span>${label}</span><button class="atlas-photo-add" type="button" data-photo>${icon('camera')}Ajouter la photo d’exemple</button><img class="atlas-added-photo" src="/home/section-outlet.jpg" width="128" height="92" alt="Mécanismes de prises de démonstration" hidden></div>`;
  if (Array.isArray(type)) {
    const demoFields = { demande: { 'Type de problème': 'panne' }, 'adresse-demande': { Commune: 'lieu', 'Créneau souhaité': 'creneau' } };
    const key = demoFields[currentScreen?.id]?.[label];
    const initial = key ? new URLSearchParams(location.search).get(key) : null;
    return `<div class="atlas-field"><label for="${id}">${label}</label><select id="${id}" name="${escaped(label)}" required>${type.map((option) => `<option${option === initial ? ' selected' : ''}>${escaped(option)}</option>`).join('')}</select></div>`;
  }
  const optional = type.endsWith('?');
  const required = optional ? '' : ' required';
  const attributes = `id="${id}" name="${escaped(label)}" placeholder="${escaped(placeholder)}"${required}`;
  const control = type.startsWith('textarea') ? `<textarea ${attributes} rows="3" maxlength="500"></textarea>` : `<input type="${type === 'code' ? 'text' : type}" ${attributes}${type === 'code' ? ' inputmode="numeric" pattern="[0-9]{6}" maxlength="6"' : ''}${type === 'number' ? ' min="0" step="0.01"' : ''}>`;
  return `<div class="atlas-field"><label for="${id}">${label}</label>${control}</div>`;
}

const estimates = {
  'Coupure de courant': '150–250 € TTC',
  'Prise ou interrupteur': '90–190 € TTC',
  'Tableau électrique': '150–350 € TTC',
  'Éclairage': '80–200 € TTC',
  'Diagnostic': 'À préciser sur devis',
};

function currentFacts(screen, items) {
  if (screen.id !== 'recapitulatif') return items;
  return items.map(([key, value]) => [key, key === 'Estimation d’exemple' ? estimates[sample.get('Problème')] ?? value : sample.get(key) ?? value]);
}

function screenBlocks(screen) {
  if (screen.role === 'entreprise' && sample.has('Décision entreprise')) {
    const [label] = approvalState(sample.get('Décision entreprise'));
    return screen.blocks.map((block) => block.type === 'rows' ? { ...block, items: block.items.map((item) => item[3] === 'ent-approbation' ? [item[0], item[1], label, item[3]] : item) } : block);
  }
  if (screen.id !== 'decision-devis' || sample.get('Décision devis') !== 'Refuser le devis') return screen.blocks;
  return screen.blocks.map((block) => block.type === 'rows' ? { ...block, items: block.items.filter((item) => item[3] !== 'paiement') } : block);
}

function renderBlock(block, screen) {
  switch (block.type) {
    case 'workboard': return renderWorkboard(block.board, workContext);
    case 'priority': return renderPriority(block, workContext);
    case 'rows':
      return section(block.title, `<ul class="atlas-rows">${block.items.map(([title, subtitle, state, id]) => {
        const text = `<span><strong>${title}</strong>${subtitle ? `<small>${subtitle}</small>` : ''}</span>${state ? `<span class="atlas-badge">${state}</span>` : ''}${id ? icon('next', true) : ''}`;
        return `<li>${id ? `<a href="${targetFor(id)}">${text}</a>` : `<div>${text}</div>`}</li>`;
      }).join('')}</ul>`);
    case 'facts':
      return section(block.title, `<dl class="atlas-facts">${currentFacts(screen, block.items).map(([name, value]) => `<div><dt>${name}</dt><dd>${escaped(value)}</dd></div>`).join('')}</dl>`);
    case 'stats':
      return `<dl class="atlas-stats" aria-label="Indicateurs de démonstration">${block.items.map(([title, value]) => `<div><dt>${title}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
    case 'form':
      return section(block.title, `<form class="atlas-form" data-next="${block.target}" autocomplete="off">${block.fields.map(renderField).join('')}<div class="atlas-form-actions"><button class="primary" type="submit">${block.submit}</button>${block.fields.some(([, type, placeholder]) => !Array.isArray(type) && placeholder) ? '<button class="atlas-secondary" type="button" data-example>Remplir avec un exemple</button>' : ''}</div></form>`);
    case 'photo':
      return `<figure class="atlas-photo"><img src="${block.src}" alt="${block.alt}" width="720" height="360"><figcaption>${block.caption}</figcaption></figure>`;
    case 'info':
      return section(block.title, `<p>${block.text}</p>`, 'atlas-note');
    case 'faq':
      return section('', `<div class="atlas-faq">${block.items.map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}</div>`);
    case 'steps':
      return section(block.title, `<ol class="atlas-steps">${block.items.map(([title, text], index) => `<li${index === block.active ? ' aria-current="step"' : ''}><span class="atlas-step-dot">${index < block.active ? icon('check', true) : index + 1}</span><span><strong>${title}</strong>${text ? `<small>${text}</small>` : ''}</span></li>`).join('')}</ol>`);
    case 'bars':
      return section(block.title, `<ul class="atlas-bars">${block.items.map(([name, value, width]) => `<li><span>${name}</span><strong>${value}</strong><span class="atlas-bar" aria-hidden="true"><span style="width:${width}%"></span></span></li>`).join('')}</ul>`);
    case 'map':
      return `<figure class="atlas-map"><svg viewBox="0 0 620 235" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="620" height="235" fill="#e4eddc"/><path d="M0 0h119c70 32 68 75 27 103C82 148 122 205 0 216zM620 0h-88c-34 28-63 65-36 92 22 25 102 20 124 97z" fill="#c7e7f3"/><path d="M131-10c24 80 98 92 115 153s-37 51-2 108M-8 183c107-12 159-39 211-68 92-54 175-38 231-19 49 17 114 24 193-6m-284-103c-31 86 46 112 28 178-9 32-38 35-35 79" fill="none" stroke="#fff" stroke-width="14"/><path d="M187 130c47-24 81-43 117-45 35-2 51 4 75 8" fill="none" stroke="#2246e5" stroke-width="5" stroke-linecap="round" stroke-dasharray="5 9"/><circle cx="187" cy="130" r="9" fill="#2246e5" stroke="white" stroke-width="4"/><path d="M393 89c0 9-13 20-13 20s-13-11-13-20a13 13 0 0 1 26 0z" fill="#2246e5"/><circle cx="380" cy="89" r="4" fill="white"/></svg><figcaption>${block.caption}</figcaption></figure>`;
    case 'chat':
      return section('Conversation de démonstration', `<ul class="atlas-chat" id="chat-log" aria-live="polite">${block.items.map(([actor, text]) => `<li data-actor="${actor}"><strong>${actor}</strong><p>${text}</p></li>`).join('')}</ul><form class="atlas-chat-form"><label class="atlas-field"><span>Message d’exemple</span><input name="message" required maxlength="300" placeholder="Écrivez un message de test"></label><button type="submit" class="primary">Simuler l’envoi</button></form>`);
  }
  return '';
}

function renderScreen(screen) {
  const role = roles[screen.role];
  if (screen.href) { location.replace(screen.href); return; }
  const actions = screen.actions.map(({ label, target }, index) => `<a class="${index === 0 ? 'primary' : 'atlas-secondary'}" href="${targetFor(target)}">${label}${index === 0 ? icon('next', true) : ''}</a>`).join('');
  const demoDecision = screen.id === 'decision-devis' && sample.has('Décision devis') ? `<p class="atlas-selection" role="status">Choix dans cette simulation · ${escaped(sample.get('Décision devis'))}</p>` : '';
  const workspace = workspaceNav[screen.role];
  const [approvalLabel, approvalTone] = approvalState(sample.get('Décision entreprise'));
  const approvalSummary = screen.id === 'ent-approbation' ? `<section class="work-approval-summary" aria-label="Montant et état du devis"><div><p>Montant du devis</p><strong>176,00 € <small>TTC</small></strong></div><span class="work-status" data-tone="${approvalTone}">${approvalLabel}</span></section>` : '';
  main.innerHTML = `<article class="atlas-view${workspace ? ' atlas-workspace' : ''}">
    <a class="atlas-back" href="#role/${screen.role}">${icon('back', true)}Maquettes ${role.label.toLowerCase()}</a>
    <header class="atlas-view-head"><div class="atlas-view-mark">${icon(role.icon)}</div><div><h1 tabindex="-1">${screen.title}</h1><p>${screen.intro}</p></div></header>
    ${approvalSummary}${demoDecision}${screenBlocks(screen).map((block) => renderBlock(block, screen)).join('')}
    ${actions ? `<div class="atlas-view-actions">${actions}</div>` : ''}
    ${screen.refs.length ? `<p class="atlas-ref-foot"><a href="#sources">Références de cette planche</a> · ${screen.refs.join(', ')}</p>` : ''}
  </article>`;
  nav(screen.role, screen);
  bindWorkboard(main);
}

function renderSources() {
  const distinct = new Set(sourceRefs.map((ref) => ref[4])).size;
  main.innerHTML = `<div class="atlas-intro"><h1 tabindex="-1">Références PDF</h1><p>${sourceRefs.length} références et ${distinct} visuels distincts dans l’inventaire. Chaque ligne ouvre sa version adaptée ou la planche qui réunit ses variantes.</p></div>
    ${sourceFiles.map((file, index) => section(file.replace(/\.pdf$/i,'').replaceAll('_',' '), `<ul class="atlas-sources">${sourceRefs.filter((entry) => entry[1] === index).map(([id, , page, screenId, original]) => `<li><a href="${targetFor(screenId)}"><span><strong>${id}</strong><small>Page ${page}${id !== original ? ` · Même visuel que ${original}` : ''}</small></span><span>${directory.get(screenId).title}</span>${icon('next', true)}</a></li>`).join('')}</ul>`)).join('')}`;
  nav('sources');
}

function render(focus = true) {
  clearTimeout(noticeTimer);
  document.querySelector('#atlas-status').textContent = '';
  const [section, id] = location.hash.slice(1).split('/');
  currentScreen = section === 'ecran' ? directory.get(id) : null;
  document.body.classList.toggle('pro-view', Boolean(workspaceNav[currentScreen?.role]));
  if (currentScreen) renderScreen(currentScreen);
  else if (section === 'sources') renderSources();
  else if (section === 'role' && Object.hasOwn(roles, id)) renderGallery(id);
  else renderGallery();
  const heading = main.querySelector('h1');
  if (heading) document.title = `${heading.textContent} · Maquette dépannage électrique`;
  if (focus) {
    window.scrollTo(0, 0);
    document.querySelector('.atlas-shell').scrollTop = 0;
    heading?.focus({ preventScroll: true });
  }
}

main.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  const values = new FormData(form);
  if (form.classList.contains('atlas-chat-form')) {
    const text = String(values.get('message')).trim();
    if (!text) return;
    const item = document.createElement('li');
    item.dataset.actor = 'Client';
    const label = document.createElement('strong');
    label.textContent = 'Vous · Simulation';
    const message = document.createElement('p');
    message.textContent = text;
    item.append(label, message);
    document.querySelector('#chat-log').append(item);
    form.reset();
    return;
  }
  const keep = { demande: { 'Type de problème': 'Problème' }, 'adresse-demande': { Commune: 'Lieu', 'Créneau souhaité': 'Créneau' }, 'devis-client': { Choix: 'Décision devis' }, 'ent-approbation': { Décision: 'Décision entreprise' } }[currentScreen?.id];
  for (const [name, key] of Object.entries(keep ?? {})) sample.set(key, values.get(name));
  if (form.dataset.next) location.href = targetFor(form.dataset.next);
});

main.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-example')) {
    for (const field of button.form.querySelectorAll('[placeholder]')) if (field.placeholder) field.value = field.placeholder;
    notify('Exemple ajouté');
  }
  if (button.hasAttribute('data-photo')) {
    const image = button.nextElementSibling;
    image.hidden = !image.hidden;
    button.innerHTML = `${icon('camera')}${image.hidden ? 'Ajouter la photo d’exemple' : 'Retirer la photo d’exemple'}`;
  }
});

document.querySelector('.atlas-skip').addEventListener('click', (event) => { event.preventDefault(); main.focus(); });
window.addEventListener('hashchange', () => render());
render(false);
