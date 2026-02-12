/**
 * Players directory interactions for echecs92.fr.
 * Provides a top players spotlight + local search over a generated index.
 */
(function () {
  const DEFAULT_INDEX_URL = '/wp-content/themes/echecs92-child/assets/data/ffe-players/search-index.json';
  const DEFAULT_TOP_URL = '/wp-content/themes/echecs92-child/assets/data/ffe-players/top-elo.json';
  const DEFAULT_DETAIL_BASE = '/joueur/';
  const DASH_RX = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE63\uFF0D]/g;

  const normaliseDashes = (value) => (value == null ? '' : String(value)).replace(DASH_RX, '-');

  const normalise = (value) =>
    normaliseDashes(value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const parseEloValue = (value) => {
    const str = value == null ? '' : String(value);
    const match = str.match(/(\d{1,4})/);
    if (!match) {
      return 0;
    }
    const n = Number.parseInt(match[1], 10);
    return Number.isFinite(n) ? n : 0;
  };

  const fetchJson = (url) =>
    fetch(url, { headers: { Accept: 'application/json' } }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    });

  const shell = typeof document !== 'undefined' ? document.querySelector('.players-page') : null;
  if (!shell) {
    return;
  }

  const indexUrl = (shell.dataset.playerIndexUrl || DEFAULT_INDEX_URL).trim() || DEFAULT_INDEX_URL;
  const topUrl = (shell.dataset.playerTopUrl || DEFAULT_TOP_URL).trim() || DEFAULT_TOP_URL;
  const detailBase = (shell.dataset.playerDetailBase || DEFAULT_DETAIL_BASE).trim() || DEFAULT_DETAIL_BASE;
  const isScope92 = shell.classList.contains('players-page--92');

  const spotlightSection = shell.querySelector('.players-spotlight');
  const topHost = document.getElementById('players-top');
  const topStatus = document.getElementById('players-top-status');

  const input = document.getElementById('players-search');
  const searchForm = document.getElementById('players-search-form');
  const clearButton = document.getElementById('players-search-clear');
  const submitButton = document.getElementById('players-search-submit');
  const statusNode = document.getElementById('players-search-status');
  const resultsHost = document.getElementById('players-results');
  const moreButton = document.getElementById('players-more-button');

  if (!input || !statusNode || !resultsHost) {
    return;
  }

  const VISIBLE_DEFAULT = 20;
  const VISIBLE_STEP = 20;
  const MIN_QUERY_LEN = 2;
  const MIN_NO_RESULT_MODAL_DELAY_MS = 520;

  const indexState = {
    loaded: false,
    loading: null,
    rows: [],
  };

  const searchCache = {
    mode: '',
    query: '',
    matches: [],
  };

  let currentMatches = [];
  let visibleCount = VISIBLE_DEFAULT;
  let activeSearchToken = 0;
  let indexPrefetchStarted = false;

  const getDetailBasePath = () => {
    const raw = detailBase || DEFAULT_DETAIL_BASE;
    if (raw.includes('?')) {
      return raw.split('?')[0];
    }
    return raw.endsWith('/') ? raw : `${raw}/`;
  };

  const buildPlayerUrl = (playerId) => {
    const id = (playerId || '').toString().trim();
    if (!id) {
      return '';
    }
    const basePath = getDetailBasePath();
    const params = new URLSearchParams();
    params.set('ffe_player', id);
    const from = window.location.pathname + window.location.search + window.location.hash;
    if (from) {
      params.set('from', from);
    }
    return `${basePath}?${params.toString()}`;
  };

  const setStatus = (message, tone) => {
    const text = (message || '').toString();
    statusNode.textContent = text;
    statusNode.hidden = !text;
    if (tone) {
      statusNode.dataset.tone = tone;
    } else {
      delete statusNode.dataset.tone;
    }
  };

  const buildFrancePlayersSearchUrl = (query) => {
    const params = new URLSearchParams();
    const raw = (query || '').toString().trim();
    if (raw) {
      params.set('q', raw);
    }
    params.set('focus', '1');
    const search = params.toString();
    return search ? `/joueurs?${search}` : '/joueurs';
  };

  let scopeModalState = null;
  const ensureScopeModal = () => {
    if (scopeModalState) {
      return scopeModalState;
    }
    if (typeof document === 'undefined' || !document.body) {
      return null;
    }

    const modal = document.createElement('div');
    modal.id = 'players-scope-modal';
    modal.className = 'clubs-scope-modal';
    modal.setAttribute('hidden', '');

    const backdrop = document.createElement('div');
    backdrop.className = 'clubs-scope-modal__backdrop';
    backdrop.dataset.scopeAction = 'close';
    modal.appendChild(backdrop);

    const panel = document.createElement('div');
    panel.className = 'clubs-scope-modal__panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'players-scope-modal-title');
    modal.appendChild(panel);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'clubs-scope-modal__close';
    closeButton.setAttribute('aria-label', 'Fermer');
    closeButton.textContent = 'x';
    closeButton.dataset.scopeAction = 'close';
    panel.appendChild(closeButton);

    const title = document.createElement('h2');
    title.id = 'players-scope-modal-title';
    title.className = 'clubs-scope-modal__title';
    panel.appendChild(title);

    const text = document.createElement('p');
    text.className = 'clubs-scope-modal__text';
    panel.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'clubs-scope-modal__actions';
    panel.appendChild(actions);

    const ignoreButton = document.createElement('button');
    ignoreButton.type = 'button';
    ignoreButton.className = 'btn btn-secondary clubs-scope-modal__stay';
    ignoreButton.dataset.scopeAction = 'close';
    actions.appendChild(ignoreButton);

    const goButton = document.createElement('button');
    goButton.type = 'button';
    goButton.className = 'btn clubs-scope-modal__go';
    goButton.dataset.scopeAction = 'go';
    actions.appendChild(goButton);

    document.body.appendChild(modal);

    scopeModalState = {
      modal,
      title,
      text,
      ignoreButton,
      goButton,
      lastFocus: null,
      resolve: null,
    };

    const handleAction = (action) => {
      if (!scopeModalState || !scopeModalState.resolve) {
        return;
      }
      const resolve = scopeModalState.resolve;
      scopeModalState.resolve = null;
      scopeModalState.modal.setAttribute('hidden', '');
      if (scopeModalState.lastFocus && typeof scopeModalState.lastFocus.focus === 'function') {
        scopeModalState.lastFocus.focus();
      }
      resolve(action === 'go');
    };

    modal.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const action = target.dataset.scopeAction;
      if (!action) {
        return;
      }
      event.preventDefault();
      handleAction(action);
    });

    document.addEventListener('keydown', (event) => {
      if (!scopeModalState || scopeModalState.modal.hasAttribute('hidden')) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        handleAction('close');
      }
    });

    return scopeModalState;
  };

  const openScopeModal = (query) => {
    const modalState = ensureScopeModal();
    if (!modalState) {
      return Promise.resolve(false);
    }
    const raw = (query || '').toString().trim();
    modalState.title.textContent = 'Recherche hors du 92';
    modalState.text.textContent = raw
      ? `Aucun joueur n'a été trouvé dans le 92 pour "${raw}". Voulez-vous lancer la recherche sur toute la France ?`
      : "Aucun joueur n'a été trouvé dans le 92. Voulez-vous lancer la recherche sur toute la France ?";
    modalState.ignoreButton.textContent = 'Ignorer';
    modalState.goButton.textContent = 'Rechercher partout en France';
    modalState.lastFocus = typeof document !== 'undefined' ? document.activeElement : null;
    modalState.modal.removeAttribute('hidden');
    modalState.goButton.focus();
    return new Promise((resolve) => {
      modalState.resolve = resolve;
    });
  };

  const setResultsLoading = (label) => {
    // Loading feedback is handled by the global logo spinner overlay.
    void label;
  };

  const clearResultsLoading = () => {
    if (!resultsHost) {
      return;
    }
    resultsHost.classList.remove('is-loading');
    delete resultsHost.dataset.loadingLabel;
  };

  const clearResults = () => {
    resultsHost.innerHTML = '';
    currentMatches = [];
    visibleCount = VISIBLE_DEFAULT;
    if (moreButton) {
      moreButton.hidden = true;
    }
  };

  const resetSearchCache = () => {
    searchCache.mode = '';
    searchCache.query = '';
    searchCache.matches = [];
  };

  const toggleClearButton = () => {
    if (!clearButton) {
      return;
    }
    const hasValue = Boolean((input.value || '').trim());
    clearButton.hidden = !hasValue;
  };

  const createResultRow = (row) => {
    const wrap = document.createElement('div');
    wrap.className = 'player-row';
    wrap.setAttribute('role', 'listitem');

    const link = document.createElement('a');
    link.className = 'player-row__card';
    link.href = buildPlayerUrl(row.id);
    link.rel = 'noopener';
    wrap.appendChild(link);

    const top = document.createElement('div');
    top.className = 'player-row__top';
    link.appendChild(top);

    const heading = document.createElement('div');
    heading.className = 'player-row__heading';
    top.appendChild(heading);

    const name = document.createElement('p');
    name.className = 'player-row__name';
    name.textContent = normaliseDashes(row.name || '') || `Joueur ${row.id}`;
    heading.appendChild(name);

    if (row.club) {
      const club = document.createElement('p');
      club.className = 'player-row__club';
      club.textContent = normaliseDashes(row.club || '');
      heading.appendChild(club);
    }

    const badgeWrap = document.createElement('div');
    badgeWrap.className = 'player-row__badges';
    top.appendChild(badgeWrap);

    const badge = document.createElement('span');
    badge.className = 'player-row__badge';
    if (row.elo) {
      badge.dataset.tone = 'elo';
      badge.textContent = `Elo ${row.elo}`;
    } else {
      badge.dataset.tone = 'muted';
      badge.textContent = 'Elo -';
    }
    badgeWrap.appendChild(badge);

    const footer = document.createElement('div');
    footer.className = 'player-row__footer';
    link.appendChild(footer);

    const cta = document.createElement('span');
    cta.className = 'player-row__cta';
    cta.textContent = 'Voir la fiche';
    footer.appendChild(cta);

    return wrap;
  };

  const renderResults = () => {
    resultsHost.innerHTML = '';
    const fragment = document.createDocumentFragment();
    currentMatches.slice(0, visibleCount).forEach((row) => {
      fragment.appendChild(createResultRow(row));
    });
    resultsHost.appendChild(fragment);
    if (moreButton) {
      moreButton.hidden = currentMatches.length <= visibleCount;
    }
  };

  const getSpinnerApi = () => {
    if (typeof window === 'undefined') {
      return null;
    }
    const spinner = window.cdjeSpinner;
    if (!spinner || typeof spinner.show !== 'function') {
      return null;
    }
    return spinner;
  };

  const showLoadingOverlay = (label) => {
    const spinner = getSpinnerApi();
    if (!spinner) {
      return () => {};
    }
    try {
      return spinner.show(label || 'Recherche en cours…', {
        host: shell,
        lockScroll: false,
        pinToViewport: true,
      });
    } catch (error) {
      return () => {};
    }
  };

  const waitForMinimumSearchTime = (startedAt, minimum = MIN_NO_RESULT_MODAL_DELAY_MS) => {
    const start = Number.isFinite(startedAt) ? startedAt : Date.now();
    const minDelay = Number.isFinite(minimum) ? Math.max(0, minimum) : MIN_NO_RESULT_MODAL_DELAY_MS;
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, minDelay - elapsed);
    if (remaining <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      setTimeout(resolve, remaining);
    });
  };

  const ensureIndexLoaded = () => {
    if (indexState.loaded) {
      return Promise.resolve(indexState.rows);
    }
    if (indexState.loading) {
      return indexState.loading;
    }

    const loading = fetchJson(indexUrl)
      .then((payload) => {
        const columns = Array.isArray(payload?.columns) ? payload.columns : null;
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        const colIndex = (name, fallback) => {
          if (!columns) {
            return fallback;
          }
          const idx = columns.indexOf(name);
          return idx === -1 ? fallback : idx;
        };

        const ID = colIndex('id', 0);
        const NAME = colIndex('name', 1);
        const CLUB = colIndex('club', 2);
        const ELO = colIndex('elo', 3);

        const mapped = [];
        for (const entry of rows) {
          if (!Array.isArray(entry)) {
            continue;
          }
          const id = (entry[ID] || '').toString().trim();
          if (!id) {
            continue;
          }
          const name = (entry[NAME] || '').toString().trim();
          const club = (entry[CLUB] || '').toString().trim();
          const elo = (entry[ELO] || '').toString().trim();

          const nameKey = normalise(name);
          const clubKey = normalise(club);
          const searchKey = `${nameKey} ${clubKey} ${id}`;

          mapped.push({
            id,
            name,
            club,
            elo,
            eloValue: parseEloValue(elo),
            nameKey,
            clubKey,
            searchKey,
          });
        }
        indexState.rows = mapped;
        indexState.loaded = true;
        return mapped;
      })
      .catch((error) => {
        indexState.loaded = false;
        indexState.rows = [];
        throw error;
      })
      .finally(() => {
        indexState.loading = null;
      });

    indexState.loading = loading;
    return loading;
  };

  const scoreMatch = (row, qNorm, qDigits) => {
    let score = 0;
    if (qDigits) {
      if (row.id === qDigits) {
        score += 100;
      } else if (row.id.startsWith(qDigits)) {
        score += 80;
      } else if (row.id.includes(qDigits)) {
        score += 50;
      }
    }
    if (qNorm) {
      if (row.nameKey === qNorm) {
        score += 90;
      } else if (row.nameKey.startsWith(qNorm)) {
        score += 70;
      } else if (row.nameKey.includes(qNorm)) {
        score += 50;
      } else if (row.clubKey.includes(qNorm)) {
        score += 20;
      } else if (row.searchKey.includes(qNorm)) {
        score += 10;
      }
    }
    score += Math.min(9, Math.floor((row.eloValue || 0) / 300));
    return score;
  };

  const resolveSourceRows = (rows, mode, queryValue) => {
    if (!Array.isArray(rows) || !rows.length) {
      return [];
    }
    if (!Array.isArray(searchCache.matches) || !searchCache.matches.length) {
      return rows;
    }
    if (!searchCache.mode || !searchCache.query) {
      return rows;
    }
    if (searchCache.mode !== mode) {
      return rows;
    }
    if (!queryValue || queryValue.length < searchCache.query.length) {
      return rows;
    }
    if (!queryValue.startsWith(searchCache.query)) {
      return rows;
    }
    return searchCache.matches;
  };

  const runSearch = (query) => {
    const searchStartedAt = Date.now();
    const token = (activeSearchToken += 1);
    const raw = (query || '').toString().trim();
    toggleClearButton();

    if (!raw) {
      setStatus('');
      clearResultsLoading();
      clearResults();
      resetSearchCache();
      if (spotlightSection) {
        spotlightSection.hidden = false;
      }
      return;
    }

    if (raw.length < MIN_QUERY_LEN) {
      setStatus(`Tapez au moins ${MIN_QUERY_LEN} caracteres.`, 'info');
      clearResultsLoading();
      clearResults();
      resetSearchCache();
      if (spotlightSection) {
        spotlightSection.hidden = false;
      }
      return;
    }

    if (spotlightSection) {
      spotlightSection.hidden = true;
    }

    setStatus('Recherche en cours...', 'info');
    setResultsLoading(indexState.loaded ? 'Recherche en cours...' : "Chargement de l'index...");
    clearResults();
    const releaseOverlay = showLoadingOverlay(indexState.loaded ? 'Recherche en cours…' : "Chargement de l'index…");
    let overlayReleased = false;
    const releaseBusy = () => {
      if (overlayReleased) {
        return;
      }
      overlayReleased = true;
      if (typeof releaseOverlay === 'function') {
        releaseOverlay();
      }
    };

    const qDigits = raw.replace(/\D/g, '');
    const isPureDigits = qDigits && qDigits === raw.replace(/\s+/g, '');
    const qNorm = isPureDigits ? '' : normalise(raw);
    const mode = isPureDigits ? 'digits' : 'text';
    const queryValue = isPureDigits ? qDigits : qNorm;

    ensureIndexLoaded()
      .then((rows) => {
        if (token !== activeSearchToken) {
          releaseBusy();
          return;
        }

        const sourceRows = resolveSourceRows(rows, mode, queryValue);
        const matches = [];
        const q = queryValue;
        const qTerms = !isPureDigits ? q.split(' ').filter(Boolean) : [];
        for (const row of sourceRows) {
          if (!row) {
            continue;
          }
          if (isPureDigits) {
            if (row.id.includes(qDigits)) {
              matches.push(row);
            }
            continue;
          }
          if (!q) {
            continue;
          }
          if (qTerms.length <= 1) {
            if (row.searchKey.includes(q)) {
              matches.push(row);
            }
            continue;
          }
          let allTermsFound = true;
          for (const term of qTerms) {
            if (!row.searchKey.includes(term)) {
              allTermsFound = false;
              break;
            }
          }
          if (allTermsFound) {
            matches.push(row);
          }
        }

        const ranked = matches.map((row) => ({
          row,
          score: scoreMatch(row, qNorm, isPureDigits ? qDigits : ''),
        }));

        ranked.sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          if ((b.row.eloValue || 0) !== (a.row.eloValue || 0)) {
            return (b.row.eloValue || 0) - (a.row.eloValue || 0);
          }
          return (a.row.name || '').localeCompare(b.row.name || '', 'fr', { sensitivity: 'base' });
        });

        const sortedMatches = ranked.map((entry) => entry.row);
        searchCache.mode = mode;
        searchCache.query = queryValue;
        searchCache.matches = sortedMatches;

        clearResultsLoading();
        currentMatches = sortedMatches;
        visibleCount = VISIBLE_DEFAULT;

        if (!sortedMatches.length) {
          if (!isScope92) {
            clearResults();
            const searchToken = token;
            waitForMinimumSearchTime(searchStartedAt)
              .then(() => {
                if (searchToken !== activeSearchToken) {
                  releaseBusy();
                  return;
                }
                releaseBusy();
                setStatus('Aucun joueur trouve.', 'error');
              })
              .catch(() => {
                releaseBusy();
              });
            return;
          }
          setStatus('Aucun joueur trouve dans le 92.', 'info');
          clearResults();
          const searchToken = token;
          waitForMinimumSearchTime(searchStartedAt)
            .then(() => {
              if (searchToken !== activeSearchToken) {
                releaseBusy();
                return false;
              }
              releaseBusy();
              return openScopeModal(raw);
            })
            .then((accepted) => {
              if (!accepted || searchToken !== activeSearchToken) {
                return;
              }
              if (typeof window !== 'undefined') {
                window.location.assign(buildFrancePlayersSearchUrl(raw));
              }
            })
            .catch(() => {
              releaseBusy();
            });
          return;
        }

        releaseBusy();
        const total = sortedMatches.length;
        setStatus(total === 1 ? '1 joueur trouve.' : `${total} joueurs trouves.`, 'success');
        renderResults();
      })
      .catch(() => {
        releaseBusy();
        if (token !== activeSearchToken) {
          return;
        }
        clearResultsLoading();
        setStatus("Impossible de charger l'index des joueurs pour le moment.", 'error');
        clearResults();
        resetSearchCache();
      });
  };

  const initEvents = () => {
    toggleClearButton();

    input.addEventListener('input', () => {
      toggleClearButton();
      activeSearchToken += 1;
      clearResultsLoading();
      setStatus('');
      clearResults();
      if (spotlightSection) {
        spotlightSection.hidden = false;
      }
    });

    input.addEventListener('focus', () => {
      if (indexPrefetchStarted) {
        return;
      }
      indexPrefetchStarted = true;
      ensureIndexLoaded().catch(() => {
        // ignore prefetch failures; search will show a proper error.
      });
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if ((input.value || '').trim()) {
          input.value = '';
          toggleClearButton();
          runSearch('');
        }
      }
    });

    if (searchForm) {
      searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        runSearch(input.value || '');
      });
    } else if (submitButton) {
      submitButton.addEventListener('click', () => runSearch(input.value || ''));
    }

    if (clearButton) {
      clearButton.addEventListener('click', () => {
        input.value = '';
        input.focus();
        toggleClearButton();
        runSearch('');
      });
    }

    if (moreButton) {
      moreButton.addEventListener('click', () => {
        visibleCount = Math.min(currentMatches.length, visibleCount + VISIBLE_STEP);
        renderResults();
      });
    }
  };

  const renderTop = (payload) => {
    if (!topHost) {
      return;
    }
    topHost.innerHTML = '';

    const columns = Array.isArray(payload?.columns) ? payload.columns : null;
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const colIndex = (name, fallback) => {
      if (!columns) {
        return fallback;
      }
      const idx = columns.indexOf(name);
      return idx === -1 ? fallback : idx;
    };

    const ID = colIndex('id', 0);
    const NAME = colIndex('name', 1);
    const CLUB = colIndex('club', 2);
    const ELO = colIndex('elo', 3);

    rows.slice(0, 10).forEach((entry, idx) => {
      if (!Array.isArray(entry)) {
        return;
      }
      const id = (entry[ID] || '').toString().trim();
      if (!id) {
        return;
      }
      const name = (entry[NAME] || '').toString().trim();
      const club = (entry[CLUB] || '').toString().trim();
      const elo = (entry[ELO] || '').toString().trim();

      const card = document.createElement('a');
      card.className = 'player-top-card';
      card.href = buildPlayerUrl(id);
      card.setAttribute('role', 'listitem');

      const rank = document.createElement('div');
      rank.className = 'player-top-card__rank';
      rank.textContent = `#${idx + 1}`;
      card.appendChild(rank);

      const body = document.createElement('div');
      body.className = 'player-top-card__body';
      card.appendChild(body);

      const title = document.createElement('div');
      title.className = 'player-top-card__name';
      title.textContent = normaliseDashes(name) || `Joueur ${id}`;
      body.appendChild(title);

      if (club) {
        const meta = document.createElement('div');
        meta.className = 'player-top-card__club';
        meta.textContent = normaliseDashes(club);
        body.appendChild(meta);
      }

      const rating = document.createElement('div');
      rating.className = 'player-top-card__rating';
      rating.textContent = elo ? normaliseDashes(elo) : '-';
      card.appendChild(rating);

      topHost.appendChild(card);
    });
  };

  const initTop = () => {
    if (!topHost || !topStatus) {
      return;
    }
    topStatus.textContent = 'Chargement du classement...';
    fetchJson(topUrl)
      .then((payload) => {
        renderTop(payload);
        topStatus.textContent = '';
      })
      .catch(() => {
        topStatus.textContent = 'Classement indisponible pour le moment.';
      });
  };

  initTop();
  initEvents();

  let shouldFocus = false;
  let queryFromUrl = '';
  try {
    const params = new URLSearchParams(window.location.search || '');
    shouldFocus = params.get('focus') === '1';
    queryFromUrl = (params.get('q') || '').trim();
  } catch (error) {
    // ignore
  }

  if (queryFromUrl) {
    input.value = queryFromUrl;
    toggleClearButton();
    runSearch(queryFromUrl);
  }

  if (shouldFocus) {
    input.focus();
  }
})();
