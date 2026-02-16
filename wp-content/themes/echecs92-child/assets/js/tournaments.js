/**
 * Native tournaments pages renderer (no iframe).
 */
(function () {
  const API_BASE = '/wp-json/cdje92/v1';
  const OPTIONS_ENDPOINT = `${API_BASE}/ffe-tournaments-options`;
  const LIST_ENDPOINT = `${API_BASE}/ffe-tournaments-list`;
  const DETAIL_ENDPOINT = `${API_BASE}/ffe-tournament-detail`;

  const page = document.querySelector('.tournaments-page');
  if (!page) {
    return;
  }

  const mode = (page.dataset.tournamentsMode || '').trim();

  const normalise = (value) =>
    (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const fetchJson = async (url) => {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  };

  const setText = (node, value) => {
    if (!node) {
      return;
    }
    node.textContent = (value || '').toString();
  };

  const buildDetailHref = (ref) => {
    const id = (ref || '').toString().trim();
    if (!id) {
      return '';
    }
    const from = `${window.location.pathname || ''}${window.location.search || ''}${window.location.hash || ''}`;
    return `/tournoi/${encodeURIComponent(id)}?from=${encodeURIComponent(from)}`;
  };

  const renderListCards = (host, items, options) => {
    if (!host) {
      return;
    }
    const opts = options || {};
    const activeMode = (opts.mode || '').toString().toLowerCase();
    host.innerHTML = '';
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'tournaments-empty';
      empty.textContent = 'Aucun tournoi trouve.';
      host.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'tournament-row';
      card.setAttribute('role', 'listitem');

      const heading = document.createElement('h2');
      heading.className = 'tournament-row__title';
      const detailHref = buildDetailHref(item.ref || '');
      const externalHref = (item.viewerUrl || item.detailUrl || '').toString().trim();
      const primaryHref = detailHref || externalHref;
      const titleLabel = item.name || `Tournoi ${item.ref || ''}` || 'Tournoi';
      if (primaryHref) {
        const link = document.createElement('a');
        link.href = primaryHref;
        link.textContent = titleLabel;
        if (!detailHref && /^https?:\/\//i.test(primaryHref)) {
          link.target = '_blank';
          link.rel = 'noopener';
        }
        heading.appendChild(link);
      } else {
        heading.textContent = titleLabel;
      }

      const meta = document.createElement('p');
      meta.className = 'tournament-row__meta';
      const metaBits = [];
      if (item.city) {
        metaBits.push(item.city);
      }
      if (item.department) {
        metaBits.push(`Dep. ${item.department}`);
      }
      if (item.dateLabel) {
        metaBits.push(item.dateLabel);
      }
      if (item.monthLabel) {
        metaBits.push(item.monthLabel);
      }
      meta.textContent = metaBits.join(' • ');

      const footer = document.createElement('p');
      footer.className = 'tournament-row__footer';
      const footerBits = [];
      if (item.ref) {
        footerBits.push(`Ref ${item.ref}`);
      }
      if (activeMode === 'parties' || item.itemType === 'parties') {
        footerBits.push('Base de parties');
      }
      if (item.homologation) {
        footerBits.push(`Homologation ${item.homologation}`);
      }
      if (item.isCancelled) {
        footerBits.push('Annule');
      }
      footer.textContent = footerBits.join(' • ');

      card.appendChild(heading);
      card.appendChild(meta);
      card.appendChild(footer);

      const links = [];
      if (item.viewerUrl) {
        links.push({ label: 'Voir les parties', url: item.viewerUrl });
      }
      if (item.pgnUrl) {
        links.push({ label: 'Telecharger PGN', url: item.pgnUrl });
      }
      if (links.length) {
        const linksRow = document.createElement('p');
        linksRow.className = 'tournament-row__links';
        links.forEach((entry) => {
          const a = document.createElement('a');
          a.href = entry.url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = entry.label;
          linksRow.appendChild(a);
        });
        card.appendChild(linksRow);
      }
      fragment.appendChild(card);
    });

    host.appendChild(fragment);
  };

  const initList92 = () => {
    const form = document.getElementById('tournaments-92-search-form');
    const input = document.getElementById('tournaments-92-search');
    const resetButton = document.getElementById('tournaments-92-reset');
    const status = document.getElementById('tournaments-92-status');
    const summary = document.getElementById('tournaments-92-summary');
    const results = document.getElementById('tournaments-92-results');

    if (!form || !input || !results) {
      return;
    }

    const state = {
      all: [],
      filtered: [],
      query: '',
    };

    const applyFilter = () => {
      const query = normalise(state.query);
      if (!query) {
        state.filtered = state.all.slice();
      } else {
        state.filtered = state.all.filter((item) => {
          const haystack = normalise(
            [item.name, item.city, item.department, item.dateLabel, item.monthLabel, item.ref].join(' ')
          );
          return haystack.includes(query);
        });
      }

      renderListCards(results, state.filtered, { mode: '92' });
      setText(summary, `${state.filtered.length} tournoi(s) affiche(s) sur ${state.all.length}.`);
      setText(status, '');
    };

    const load = async (refresh) => {
      setText(status, 'Chargement des tournois du 92...');
      const params = new URLSearchParams({ scope: '92', all: '1' });
      if (refresh) {
        params.set('refresh', '1');
      }

      try {
        const payload = await fetchJson(`${LIST_ENDPOINT}?${params.toString()}`);
        state.all = Array.isArray(payload.items) ? payload.items : [];
        applyFilter();
      } catch (error) {
        setText(status, 'Impossible de charger les tournois du 92.');
      }
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      state.query = input.value || '';
      applyFilter();
    });

    input.addEventListener('input', () => {
      state.query = input.value || '';
      applyFilter();
    });

    resetButton?.addEventListener('click', () => {
      input.value = '';
      state.query = '';
      applyFilter();
    });

    load(false);
  };

  const initListFrance = () => {
    const form = document.getElementById('tournaments-fr-form');
    const modeSelect = document.getElementById('tournaments-fr-mode');
    const fideSelect = document.getElementById('tournaments-fr-fide-level');
    const rapideSelect = document.getElementById('tournaments-fr-rapide-level');
    const cadenceSelect = document.getElementById('tournaments-fr-cadence');
    const monthSelect = document.getElementById('tournaments-fr-month');
    const yearSelect = document.getElementById('tournaments-fr-year');
    const partiesYearSelect = document.getElementById('tournaments-fr-parties-year');
    const refreshButton = document.getElementById('tournaments-fr-refresh');
    const status = document.getElementById('tournaments-fr-status');
    const summary = document.getElementById('tournaments-fr-summary');
    const results = document.getElementById('tournaments-fr-results');
    const pagination = document.getElementById('tournaments-fr-pagination');

    if (!form || !modeSelect || !results) {
      return;
    }

    const modeFields = Array.from(form.querySelectorAll('[data-mode-field]'));
    const state = {
      pager: { current: 1, total: 1 },
      mode: modeSelect.value || 'fide',
    };

    const fillSelect = (select, items) => {
      if (!select) {
        return;
      }
      const rows = Array.isArray(items) ? items : [];
      const previous = select.value;
      select.innerHTML = '';
      rows.forEach((item) => {
        const option = document.createElement('option');
        option.value = (item.value || '').toString();
        option.textContent = (item.label || item.value || '').toString();
        if (item.selected) {
          option.selected = true;
        }
        select.appendChild(option);
      });
      if (previous && Array.from(select.options).some((option) => option.value === previous)) {
        select.value = previous;
      }
    };

    const syncModeFields = () => {
      const activeMode = (modeSelect.value || 'fide').toLowerCase();
      state.mode = activeMode;
      modeFields.forEach((field) => {
        const fieldMode = (field.dataset.modeField || '').toLowerCase();
        const visible = fieldMode === activeMode;
        field.hidden = !visible;
      });
    };

    const buildListUrl = (page, refresh) => {
      const params = new URLSearchParams();
      params.set('scope', 'fr');
      params.set('mode', state.mode || 'fide');
      params.set('page', String(page || 1));

      if (state.mode === 'fide' && fideSelect?.value) {
        params.set('level', fideSelect.value);
      } else if (state.mode === 'rapide' && rapideSelect?.value) {
        params.set('level', rapideSelect.value);
      } else if (state.mode === 'annonce' && cadenceSelect?.value) {
        params.set('cadence', cadenceSelect.value);
      } else if (state.mode === 'res') {
        if (monthSelect?.value) {
          params.set('month', monthSelect.value);
        }
        if (yearSelect?.value) {
          params.set('year', yearSelect.value);
        }
      } else if (state.mode === 'parties' && partiesYearSelect?.value) {
        params.set('year', partiesYearSelect.value);
      }

      if (refresh) {
        params.set('refresh', '1');
      }

      return `${LIST_ENDPOINT}?${params.toString()}`;
    };

    const renderPagination = () => {
      if (!pagination) {
        return;
      }
      const current = Number.parseInt(state.pager.current || 1, 10) || 1;
      const total = Number.parseInt(state.pager.total || 1, 10) || 1;
      pagination.innerHTML = '';
      pagination.hidden = total <= 1;
      if (total <= 1) {
        return;
      }

      const createButton = (label, page, disabled, currentFlag) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tournaments-pagination__button';
        if (currentFlag) {
          button.classList.add('is-current');
        }
        button.disabled = Boolean(disabled);
        button.textContent = label;
        button.addEventListener('click', () => {
          if (!button.disabled) {
            loadList(page, false);
          }
        });
        return button;
      };

      pagination.appendChild(createButton('Precedent', Math.max(1, current - 1), current <= 1, false));

      const start = Math.max(1, current - 2);
      const end = Math.min(total, current + 2);
      for (let p = start; p <= end; p += 1) {
        pagination.appendChild(createButton(String(p), p, false, p === current));
      }

      pagination.appendChild(createButton('Suivant', Math.min(total, current + 1), current >= total, false));
    };

    const loadList = async (pageToLoad, refresh) => {
      setText(status, 'Recherche en cours...');
      try {
        const payload = await fetchJson(buildListUrl(pageToLoad, refresh));
        const items = Array.isArray(payload.items) ? payload.items : [];
        state.pager = payload.pager || { current: pageToLoad || 1, total: 1 };
        renderListCards(results, items, { mode: state.mode });
        const noun = state.mode === 'parties' ? 'base(s)' : 'tournoi(s)';
        const title = (payload.title || '').toString().trim();
        const pager = state.pager || {};
        const current = Number.parseInt(pager.current || pageToLoad || 1, 10) || 1;
        const total = Number.parseInt(pager.total || 1, 10) || 1;
        let summaryText = `${items.length} ${noun} sur cette page (page ${current}/${total}).`;
        if (title) {
          summaryText = `${title} - ${summaryText}`;
        }
        setText(summary, summaryText);
        setText(status, '');
        renderPagination();
      } catch (error) {
        setText(status, 'Impossible de charger la recherche France.');
      }
    };

    const loadOptions = async () => {
      setText(status, 'Chargement des options de recherche...');
      try {
        const payload = await fetchJson(OPTIONS_ENDPOINT);
        fillSelect(cadenceSelect, payload.cadences || []);
        fillSelect(monthSelect, payload.resultMonths || []);
        fillSelect(yearSelect, payload.resultYears || []);
        fillSelect(partiesYearSelect, payload.partiesYears || payload.resultYears || []);
        fillSelect(fideSelect, payload.fideLevels || []);
        fillSelect(rapideSelect, payload.rapideLevels || []);
      } catch (error) {
        setText(status, 'Options indisponibles, valeurs par defaut utilisees.');
      }

      syncModeFields();
      await loadList(1, false);
    };

    modeSelect.addEventListener('change', () => {
      syncModeFields();
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      syncModeFields();
      loadList(1, false);
    });

    refreshButton?.addEventListener('click', () => {
      syncModeFields();
      loadList(1, true);
    });

    loadOptions();
  };

  const initDetail = () => {
    const status = document.getElementById('tournament-detail-status');
    const host = document.getElementById('tournament-detail');
    const backLink = document.querySelector('[data-tournament-back]');

    if (!host) {
      return;
    }

    const getRefFromLocation = () => {
      const path = (window.location.pathname || '').replace(/\/+$/u, '');
      const pathMatch = path.match(/\/tournoi\/(\d{1,10})$/u);
      if (pathMatch && pathMatch[1]) {
        return pathMatch[1];
      }
      const params = new URLSearchParams(window.location.search || '');
      const queryRef = (params.get('ref') || '').trim();
      if (/^\d{1,10}$/u.test(queryRef)) {
        return queryRef;
      }
      return '';
    };

    const updateBackLink = () => {
      if (!backLink) {
        return;
      }
      const params = new URLSearchParams(window.location.search || '');
      const from = (params.get('from') || '').trim();
      if (!from || !from.startsWith('/')) {
        return;
      }
      backLink.href = from;
      const path = from.split('?')[0].split('#')[0] || '/';
      if (path === '/tournois' || path === '/tournois-france') {
        backLink.textContent = 'Retour aux tournois France';
      } else {
        backLink.textContent = 'Retour aux tournois du 92';
      }
    };

    const appendDetailRow = (list, label, value) => {
      if (!value) {
        return;
      }
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      list.appendChild(dt);
      list.appendChild(dd);
    };

    const renderDetail = (payload) => {
      host.innerHTML = '';

      const title = document.createElement('h2');
      title.className = 'tournament-detail-card__title';
      title.textContent = payload.name || `Tournoi ${payload.ref || ''}`;

      const location = document.createElement('p');
      location.className = 'tournament-detail-card__location';
      location.textContent = payload.location || '';

      const dl = document.createElement('dl');
      dl.className = 'tournament-detail-card__meta';
      appendDetailRow(dl, 'Dates', payload.details?.dates);
      appendDetailRow(dl, 'Elo rapide', payload.details?.eloRapide);
      appendDetailRow(dl, 'Elo FIDE', payload.details?.eloFide);
      appendDetailRow(dl, 'Homologue par', payload.details?.homologuePar);
      appendDetailRow(dl, 'Nombre de rondes', payload.details?.nombreRondes);
      appendDetailRow(dl, 'Cadence', payload.details?.cadence);
      appendDetailRow(dl, 'Appariements', payload.details?.appariements);
      appendDetailRow(dl, 'Organisateur', payload.details?.organisateur);
      appendDetailRow(dl, 'Arbitre', payload.details?.arbitre);
      appendDetailRow(dl, 'Adresse', payload.details?.adresse);
      appendDetailRow(dl, 'Contact', payload.details?.contact);
      appendDetailRow(dl, 'Inscription senior', payload.details?.inscriptionSenior);
      appendDetailRow(dl, 'Inscription jeunes', payload.details?.inscriptionJeune);

      host.appendChild(title);
      if (payload.location) {
        host.appendChild(location);
      }
      if (dl.children.length) {
        host.appendChild(dl);
      }

      if (payload.announcementHtml) {
        const announcement = document.createElement('section');
        announcement.className = 'tournament-detail-card__announcement';
        const heading = document.createElement('h3');
        heading.textContent = 'Annonce';
        const body = document.createElement('div');
        body.className = 'tournament-detail-card__announcement-body';
        body.innerHTML = payload.announcementHtml;
        announcement.appendChild(heading);
        announcement.appendChild(body);
        host.appendChild(announcement);
      }

      if (Array.isArray(payload.resultLinks) && payload.resultLinks.length) {
        const results = document.createElement('section');
        results.className = 'tournament-detail-card__results';
        const heading = document.createElement('h3');
        heading.textContent = 'Resultats';
        const list = document.createElement('ul');
        payload.resultLinks.forEach((entry) => {
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.href = entry.url;
          link.textContent = entry.label;
          link.target = '_blank';
          link.rel = 'noopener';
          item.appendChild(link);
          list.appendChild(item);
        });
        results.appendChild(heading);
        results.appendChild(list);
        host.appendChild(results);
      }

      const source = document.createElement('p');
      source.className = 'tournament-detail-card__source';
      const sourceLink = document.createElement('a');
      sourceLink.href = payload.sourceUrl || '#';
      sourceLink.target = '_blank';
      sourceLink.rel = 'noopener';
      sourceLink.textContent = 'Voir la fiche source sur echecs.asso.fr';
      source.appendChild(sourceLink);
      host.appendChild(source);
    };

    const load = async () => {
      const ref = getRefFromLocation();
      if (!ref) {
        setText(status, 'Reference tournoi manquante dans l URL.');
        return;
      }

      updateBackLink();
      setText(status, 'Chargement de la fiche tournoi...');

      try {
        const payload = await fetchJson(`${DETAIL_ENDPOINT}?ref=${encodeURIComponent(ref)}`);
        renderDetail(payload || {});
        setText(status, '');
      } catch (error) {
        setText(status, 'Impossible de charger la fiche tournoi.');
      }
    };

    load();
  };

  if (mode === 'list-92') {
    initList92();
    return;
  }
  if (mode === 'list-fr') {
    initListFrance();
    return;
  }
  if (mode === 'detail') {
    initDetail();
  }
})();
