export const workspaceNav = {
  artisan: { home: 'artisan', label: 'Espace artisan', links: [['Tableau','artisan','grid'],['Offres','offres','work'],['Planning','planning-artisan','calendar'],['Documents','documents-artisan','document'],['Règlements','reglements-artisan','receipt'],['Profil','profil-artisan','person']] },
  entreprise: { home: 'entreprise', label: 'Espace entreprise', links: [['Portefeuille','entreprise','grid'],['Dossiers','ent-interventions','pin'],['Devis','ent-approbation','document'],['Budgets','ent-budget','receipt'],['Rapports','ent-rapports','steps'],['Membres','ent-membres','person']] },
  admin: { home: 'admin', label: 'Administration plateforme', links: [['Tableau','admin','grid'],['Interventions','admin-interventions','bolt'],['Support','admin-support','shield'],['Artisans','admin-artisans','work'],['Finance','admin-finance','receipt'],['Accès','admin-droits','person']] },
};

const sites = [
  { id: 'syndic', type: 'Syndic', name: 'Résidence Exemple', place: 'Fort-de-France', status: 'Devis à valider', tone: 'action', target: 'site-syndic' },
  { id: 'restauration', type: 'Restauration', name: 'Restaurant Exemple', place: 'Le Lamentin', status: 'Ticket prioritaire', tone: 'urgent', target: 'site-restauration' },
  { id: 'bureaux', type: 'Bureaux', name: 'Immeuble de bureaux', place: 'Schœlcher', status: 'Maintenance prévue', tone: 'neutral', target: 'site-bureaux' },
  { id: 'erp', type: 'ERP', name: 'Établissement Exemple', place: 'Le Robert', status: 'Réserve ouverte', tone: 'action', target: 'site-erp' },
];

const queue = [
  { group: 'urgent', tone: 'urgent', status: 'Prioritaire', id: 'S-019', title: 'Justificatif de règlement', detail: 'Escalade vers finance · DÉMO-014', target: 'admin-support' },
  { group: 'review', tone: 'action', status: 'À affecter', id: 'DÉMO-034', title: 'Éclairage en panne', detail: 'Intervention · Le Lamentin', target: 'admin-dispatch' },
  { group: 'review', tone: 'action', status: 'À examiner', id: 'C-012', title: 'Candidature artisan', detail: 'Assurance et qualification', target: 'admin-candidature' },
  { group: 'active', tone: 'neutral', status: 'En cours', id: 'DÉMO-021', title: 'Prises sans courant', detail: 'Suivi de l’intervention · Fort-de-France', target: 'intervention' },
];

const status = (label, tone = 'neutral') => `<span class="work-status" data-tone="${tone}">${label}</span>`;

function artisan({ icon, targetFor }) {
  return `<div class="workboard" data-workboard="artisan">
    <div class="work-grid work-grid-artisan">
      <section class="work-mission" aria-labelledby="work-mission-title">
        <div class="work-mission-top"><span>${icon('calendar', true)} Prochaine mission</span>${status('Confirmée')}</div>
        <p class="work-time">14 h – 16 h</p>
        <h2 id="work-mission-title">Prises sans courant</h2>
        <p class="work-mission-place">${icon('pin', true)} Fort-de-France <span aria-hidden="true">·</span> DÉMO-021</p>
        <a class="work-mission-link" href="${targetFor('mission-artisan')}">Ouvrir la mission ${icon('next', true)}</a>
      </section>
      <section class="work-card work-agenda" aria-labelledby="work-agenda-title">
        <header class="work-heading"><h2 id="work-agenda-title">Agenda</h2><a href="${targetFor('planning-artisan')}">Voir le planning</a></header>
        <div class="work-segment" role="group" aria-label="Période de l’agenda">
          <button type="button" data-work-choice="today" aria-pressed="true" aria-controls="work-agenda-entries">Aujourd’hui</button>
          <button type="button" data-work-choice="next" aria-pressed="false" aria-controls="work-agenda-entries">À venir</button>
        </div>
        <ul class="work-agenda-list" id="work-agenda-entries" aria-live="polite">
          <li data-work-item="today"><a href="${targetFor('mission-artisan')}"><span class="work-slot">14 h</span><span><strong>Prises sans courant</strong><small>Fort-de-France</small></span>${icon('next', true)}</a></li>
          <li data-work-item="today"><a href="${targetFor('offres')}"><span class="work-slot">16 h</span><span><strong>Créneau libre</strong><small>Voir les offres disponibles</small></span>${icon('next', true)}</a></li>
          <li data-work-item="next" hidden><a href="${targetFor('planning-artisan')}"><span class="work-slot">Demain</span><span><strong>Créneaux à confirmer</strong><small>Voir vos disponibilités</small></span>${icon('next', true)}</a></li>
        </ul>
      </section>
    </div>
    <section class="work-section" aria-labelledby="work-art-actions">
      <h2 id="work-art-actions">À préparer</h2>
      <div class="work-shortcuts">
        <a href="${targetFor('offres')}"><span class="work-symbol">${icon('work')}</span><span><strong>Offres de mission</strong><small>Voir les offres à examiner</small></span>${icon('next', true)}</a>
        <a href="${targetFor('devis-artisan')}"><span class="work-symbol">${icon('receipt')}</span><span><strong>Préparer le devis</strong><small>Mission DÉMO-021</small></span>${icon('next', true)}</a>
        <a href="${targetFor('documents-artisan')}"><span class="work-symbol">${icon('document')}</span><span><strong>Justificatifs</strong><small>Voir les pièces à renouveler</small></span>${icon('next', true)}</a>
      </div>
    </section>
  </div>`;
}

const approvalStates = {
  Approuver: ['Approuvé', 'done'],
  Refuser: ['Refusé', 'neutral'],
  'Demander un complément': ['Complément demandé', 'action'],
};

export function approvalState(decision) {
  return approvalStates[decision] ?? ['À valider', 'action'];
}

function entreprise({ icon, targetFor, sample }) {
  const decision = sample.get('Décision entreprise');
  const [approvalLabel, approvalTone] = approvalState(decision);
  return `<div class="workboard" data-workboard="entreprise">
    <div class="work-context"><p>${icon('grid', true)} <strong>Organisation Démo</strong></p><div class="work-site-filter"><label for="work-site">Site</label><select id="work-site" aria-controls="work-decision-list work-site-list"><option value="all">Tous les sites</option>${sites.map((site) => `<option value="${site.id}">${site.name}</option>`).join('')}</select></div></div>
    <div class="work-grid work-grid-company">
      <section class="work-card work-approval" aria-labelledby="work-approval-title">
        <header class="work-heading"><h2 id="work-approval-title">Décisions sur les devis</h2>${status(approvalLabel, approvalTone)}</header>
        <div id="work-decision-list" aria-live="polite">
          <div data-approval-site="syndic"><p class="work-amount">176,00 € <span>TTC</span></p><h3>D-021 · Prises en parties communes</h3><p>Résidence Exemple · Fort-de-France</p><a class="primary" href="${targetFor('ent-approbation')}">${decision ? 'Consulter la décision' : 'Examiner le devis'} ${icon('next', true)}</a></div>
          <p class="work-empty" data-approval-empty hidden>Aucun devis à examiner pour ce site dans la maquette.</p>
        </div>
      </section>
      <section class="work-card work-budget" aria-labelledby="work-budget-title">
        <header class="work-heading"><h2 id="work-budget-title">Budget du portefeuille</h2></header>
        <p class="work-amount">4 600 € <span>engagés</span></p>
        <div class="work-meter" role="meter" aria-label="Budget engagé" aria-valuemin="0" aria-valuemax="12000" aria-valuenow="4600" aria-valuetext="4 600 euros engagés sur 12 000"><span></span></div>
        <div class="work-budget-caption"><span>12 000 € de budget</span><strong>7 400 € restants</strong></div>
        <a class="work-text-link" href="${targetFor('ent-budget')}">Voir le détail du budget ${icon('next', true)}</a>
      </section>
    </div>
    <section class="work-card work-sites" aria-labelledby="work-sites-title">
      <header class="work-heading"><h2 id="work-sites-title">Situation par site</h2><a href="${targetFor('ent-interventions')}">Toutes les interventions</a></header>
      <ul id="work-site-list" aria-live="polite">${sites.map((site) => `<li data-work-site="${site.id}"><a href="${targetFor(site.target)}"><span class="work-symbol">${icon('pin')}</span><span><strong>${site.name}</strong><small>${site.type} · ${site.place}</small></span>${site.id === 'syndic' && decision ? status(approvalLabel, approvalTone) : status(site.status, site.tone)}${icon('next', true)}</a></li>`).join('')}</ul>
    </section>
    <section class="work-section" aria-labelledby="work-vertical-title"><h2 id="work-vertical-title">Tableaux de bord par métier</h2><div class="work-verticals">${sites.map((site) => `<a href="${targetFor(site.id)}">${site.type}${icon('next', true)}</a>`).join('')}</div></section>
  </div>`;
}

function admin({ icon, targetFor }) {
  return `<div class="workboard" data-workboard="admin">
    <div class="work-grid work-grid-admin">
      <section class="work-card work-queue" aria-labelledby="work-queue-title">
        <header class="work-heading"><h2 id="work-queue-title">File opérateur</h2><span class="work-count" id="work-queue-count" role="status">${queue.length} dossiers</span></header>
        <div class="work-segment" role="group" aria-label="Filtrer la file opérateur">
          <button type="button" data-work-choice="all" aria-pressed="true" aria-controls="work-queue-list">Tous</button>
          <button type="button" data-work-choice="urgent" aria-pressed="false" aria-controls="work-queue-list">Prioritaires</button>
          <button type="button" data-work-choice="review" aria-pressed="false" aria-controls="work-queue-list">À traiter</button>
        </div>
        <ul id="work-queue-list">${queue.map((item) => `<li data-work-item="${item.group}"><a href="${targetFor(item.target)}"><span class="work-queue-dot" data-tone="${item.tone}" aria-hidden="true"></span><span><small class="work-case-id">${item.id}</small><strong>${item.title}</strong><small>${item.detail}</small></span>${status(item.status, item.tone)}${icon('next', true)}</a></li>`).join('')}</ul>
      </section>
      <section class="work-card work-controls" aria-labelledby="work-controls-title">
        <header class="work-heading"><h2 id="work-controls-title">Vues de contrôle</h2></header>
        <a href="${targetFor('admin-support')}"><span class="work-symbol">${icon('shield')}</span><span><strong>Support et escalades</strong><small>Ouvrir la file de support</small></span>${icon('next', true)}</a>
        <a href="${targetFor('admin-finance')}"><span class="work-symbol">${icon('receipt')}</span><span><strong>Finance</strong><small>Règlements et remboursements</small></span>${icon('next', true)}</a>
        <a href="${targetFor('admin-droits')}"><span class="work-symbol">${icon('person')}</span><span><strong>Accès et journal</strong><small>Droits opérateurs et traçabilité</small></span>${icon('next', true)}</a>
      </section>
    </div>
  </div>`;
}

const workboards = { artisan, entreprise, admin };

export function renderWorkboard(id, context) {
  return workboards[id](context);
}

export function renderPriority(block, { icon, targetFor, sample }) {
  const [label, tone] = block.target === 'ent-approbation' && sample.has('Décision entreprise')
    ? approvalState(sample.get('Décision entreprise'))
    : [block.label, block.tone];
  const action = block.target === 'ent-approbation' && sample.has('Décision entreprise') ? 'Consulter la décision' : block.action;
  return `<section class="work-priority" data-tone="${tone}"><div>${status(label, tone)}<h2>${block.title}</h2><p>${block.detail}</p></div><a class="primary" href="${targetFor(block.target)}">${action} ${icon('next', true)}</a></section>`;
}

export function bindWorkboard(root) {
  const board = root.querySelector('[data-workboard]');
  if (!board) return;
  const choices = Array.from(board.querySelectorAll('[data-work-choice]'));
  const items = Array.from(board.querySelectorAll('[data-work-item]'));
  choices.forEach((button) => button.addEventListener('click', () => {
    const choice = button.dataset.workChoice;
    choices.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
    let count = 0;
    for (const item of items) {
      item.hidden = choice !== 'all' && item.dataset.workItem !== choice;
      if (!item.hidden) count++;
    }
    const summary = board.querySelector('#work-queue-count');
    if (summary) summary.textContent = `${count} dossier${count > 1 ? 's' : ''}`;
  }));
  const siteSelect = board.querySelector('#work-site');
  siteSelect?.addEventListener('change', () => {
    const filter = siteSelect.value;
    for (const row of board.querySelectorAll('[data-work-site]')) row.hidden = filter !== 'all' && row.dataset.workSite !== filter;
    const approval = board.querySelector('[data-approval-site]');
    approval.hidden = filter !== 'all' && approval.dataset.approvalSite !== filter;
    board.querySelector('[data-approval-empty]').hidden = !approval.hidden;
    board.querySelector('.work-approval .work-heading .work-status').hidden = approval.hidden;
  });
}
