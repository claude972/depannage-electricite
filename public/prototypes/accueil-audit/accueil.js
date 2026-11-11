'use strict';

// Fourchettes TTC de démonstration du barème initial de la recette.
const ranges = {
  outage: '150 à 250 €',
  socket: '80 à 180 €',
  panel: '150 à 350 €',
  lighting: '80 à 200 €',
  diagnostic: '120 à 280 €',
};
const titles = {
  urgent: 'Une panne urgente ?',
  artisan: 'Votre intervenant',
  paiement: 'Empreinte bancaire',
  operateur: 'Informations de l’exploitant',
  recours: 'Garantie, annulation et recours',
};
const form = document.getElementById('finder');
const commune = document.getElementById('commune');
const situation = document.getElementById('situation');
const dialog = document.getElementById('dialog');
const heading = document.getElementById('dialog-title');
const body = document.getElementById('dialog-body');

function show(title, content) {
  heading.textContent = title;
  body.replaceChildren(content);
  dialog.showModal();
}

document.getElementById('close').addEventListener('click', () => dialog.close());

document.addEventListener('click', event => {
  const panel = event.target.closest('[data-panel]');
  if (panel && Object.hasOwn(titles, panel.dataset.panel)) {
    const key = panel.dataset.panel;
    show(titles[key], document.getElementById('panel-' + key).content.cloneNode(true));
    return;
  }
  const service = event.target.closest('[data-service]');
  if (service && Object.hasOwn(ranges, service.dataset.service)) {
    situation.value = service.dataset.service;
    form.scrollIntoView({ block: 'center' });
    (commune.value.trim() ? form.querySelector('button[type="submit"]') : commune).focus({ preventScroll: true });
  }
  if (event.target.closest('[data-finder]')) {
    dialog.close();
    commune.scrollIntoView({ block: 'center' });
    commune.focus({ preventScroll: true });
  }
});

commune.addEventListener('input', () => commune.setCustomValidity(''));
form.addEventListener('submit', event => {
  event.preventDefault();
  const city = commune.value.trim();
  if (!city) {
    commune.setCustomValidity('Indiquez votre commune.');
    commune.reportValidity();
    return;
  }
  const price = ranges[situation.value];
  if (!price) return;
  const content = document.createDocumentFragment();
  const place = document.createElement('p');
  place.textContent = city;
  const amount = document.createElement('p');
  amount.className = 'dialog-price';
  amount.textContent = price + ' TTC';
  const note = document.createElement('p');
  note.textContent = 'Fourchette de démonstration. Le devis et le créneau sont confirmés après vérification.';
  content.append(place, amount, note);
  show(situation.selectedOptions[0].textContent, content);
});

if (document.documentElement.dataset.view === 'app') {
  const share = new URLSearchParams(location.search).get('_vercel_share');
  for (const link of document.querySelectorAll('[data-app-link]')) {
    const url = new URL(link.href);
    if (share) url.searchParams.set('_vercel_share', share);
    link.href = url.href;
  }
  for (const tab of document.querySelectorAll('.app-tabs a[href^="#"]')) {
    tab.addEventListener('click', () => {
      document.querySelector('.app-tabs [aria-current]')?.removeAttribute('aria-current');
      tab.setAttribute('aria-current', 'page');
    });
  }
}
