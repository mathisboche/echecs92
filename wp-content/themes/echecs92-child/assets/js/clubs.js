/**
 * Minimal clubs list renderer for echecs92.fr.
 * Search and distance features are temporarily disabled.
 */
(function () {
  const DATA_URL = '/wp-content/themes/echecs92-child/assets/data/clubs.json';
  const VISIBLE_RESULTS_DEFAULT = 12;

  const resultsEl = document.getElementById('clubs-results');
  if (!resultsEl) {
    return;
  }

  const searchInput = document.getElementById('clubs-search');
  const searchButton = document.getElementById('clubs-search-btn');
  const resetButton = document.getElementById('clubs-reset-btn');
  const searchStatus = document.getElementById('clubs-search-status');
  const locationInput = document.getElementById('clubs-location');
  const locationApplyButton = document.getElementById('clubs-location-apply');
  const locationClearButton = document.getElementById('clubs-location-clear');
  const geolocButton = document.getElementById('clubs-use-geoloc');
  const locationStatus = document.getElementById('clubs-location-status');
  const moreButton = document.getElementById('clubs-more-button');
  const optionsDetails = document.getElementById('clubs-options');

  const totalCounter = document.createElement('p');
  totalCounter.className = 'clubs-total';
  totalCounter.setAttribute('aria-live', 'polite');
  resultsEl.before(totalCounter);

  const state = {
    clubs: [],
    visibleCount: VISIBLE_RESULTS_DEFAULT,
  };

  const disableControl = (element) => {
    if (!element) {
      return;
    }
    element.setAttribute('disabled', 'disabled');
    element.setAttribute('aria-disabled', 'true');
  };

  const disableSearchUI = () => {
    disableControl(searchInput);
    disableControl(searchButton);
    disableControl(resetButton);
    disableControl(locationInput);
    disableControl(locationApplyButton);
    disableControl(locationClearButton);
    disableControl(geolocButton);

    if (optionsDetails) {
      optionsDetails.open = false;
      optionsDetails.setAttribute('aria-hidden', 'true');
    }

    if (searchStatus) {
      searchStatus.textContent = 'La recherche est temporairement désactivée. Tous les clubs sont affichés.';
      searchStatus.dataset.tone = 'info';
    }

    if (locationStatus) {
      locationStatus.textContent = 'Tri par distance indisponible pour le moment.';
      locationStatus.dataset.tone = 'info';
    }
  };

  const setSearchStatus = (message, tone = 'info') => {
    if (!searchStatus) {
      return;
    }
    searchStatus.textContent = message || '';
    if (message) {
      searchStatus.dataset.tone = tone;
    } else {
      delete searchStatus.dataset.tone;
    }
  };

  const normalise = (value) =>
    (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const slugify = (value) => {
    const base = normalise(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (base) {
      return base;
    }
    return `club-${Math.random().toString(36).slice(2, 10)}`;
  };

  const extractAddressParts = (value) => {
    const result = {
      full: value ? String(value).trim() : '',
      postalCode: '',
      city: '',
    };
    if (!result.full) {
      return result;
    }
    const postalMatch = result.full.match(/\b(\d{5})\b/);
    if (postalMatch) {
      result.postalCode = postalMatch[1];
      const after = result.full.slice(postalMatch.index + postalMatch[0].length).trim();
      if (after) {
        result.city = after.replace(/^[,;\-–—]+/, '').trim();
      }
    }
    if (!result.city) {
      const parts = result.full
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length) {
        const last = parts[parts.length - 1];
        const cleaned = last.replace(/\b\d{5}\b/g, '').trim();
        if (cleaned) {
          result.city = cleaned;
        }
      }
    }
    result.city = result.city.replace(/\s+/g, ' ').trim();
    return result;
  };

  const formatCommune = (value) => {
    if (!value) {
      return '';
    }
    const lower = value
      .toString()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\s+-\s+/g, '-');

    let formatted = lower.replace(/(^|[\s\-’'])(\p{L})/gu, (match, boundary, letter) => `${boundary}${letter.toUpperCase()}`);
    formatted = formatted.replace(/\b(De|Du|Des|La|Le|Les|Sur|Sous|Et|Aux|Au)\b/gu, (match) => match.toLowerCase());
    formatted = formatted.replace(/\bD'([A-Z])/g, (match, letter) => `d'${letter}`);
    formatted = formatted.replace(/\bL'([A-Z])/g, (match, letter) => `l'${letter}`);
    return formatted.replace(/\s+/g, ' ').trim();
  };

  const adaptClubRecord = (raw) => {
    if (!raw || typeof raw !== 'object') {
      return raw;
    }
    if (raw.id && raw.name) {
      return raw;
    }

    const name = raw.nom || raw.name || '';
    const primaryAddress = raw.adresse || raw.address || '';
    const addressParts = extractAddressParts(primaryAddress);
    const secondaryAddress = raw.siege || raw.siege_social || raw.address2 || '';
    const secondaryParts = extractAddressParts(secondaryAddress);
    const communeRaw = raw.commune || raw.ville || addressParts.city || secondaryParts.city || '';
    const commune = formatCommune(communeRaw);
    const postalCode = raw.code_postal || raw.postal_code || addressParts.postalCode || secondaryParts.postalCode || '';
    const slugSource = name || commune || postalCode || primaryAddress || secondaryAddress;
    const id = raw.id || slugify(slugSource || `club-${Date.now()}`);

    const rawSite = raw.site || raw.website || '';
    let site = rawSite;
    if (site && !/^https?:/i.test(site)) {
      site = `https://${site.replace(/^\/+/g, '')}`;
    }

    const toNumber = (value) => {
      if (value == null || value === '') {
        return null;
      }
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    };

    return {
      id,
      name: name || commune || 'Club sans nom',
      commune,
      address: primaryAddress || secondaryAddress || '',
      siege: secondaryAddress || '',
      phone: raw.telephone || raw.phone || '',
      email: raw.email || '',
      site,
      president: raw.president || '',
      hours: raw.horaires || raw.hours || '',
      publics: raw.publics || '',
      tarifs: raw.tarifs || '',
      notes: raw.notes || '',
      fiche_ffe: raw.fiche_ffe || '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      licenses: {
        A: toNumber(raw.licences_a ?? raw.licenses_a ?? raw.license_a),
        B: toNumber(raw.licences_b ?? raw.licenses_b ?? raw.license_b),
      },
      postalCode,
    };
  };

  const hydrateClub = (raw) => {
    const club = { ...adaptClubRecord(raw) };
    const licenseA = Number.parseInt(club.licenses?.A, 10);
    const licenseB = Number.parseInt(club.licenses?.B, 10);
    const totalLicenses = (Number.isFinite(licenseA) ? licenseA : 0) + (Number.isFinite(licenseB) ? licenseB : 0);
    club.totalLicenses = totalLicenses > 0 ? totalLicenses : null;
    return club;
  };

  const getClubDetailUrl = (clubId) => {
    if (!clubId) {
      return '#';
    }
    const base = resultsEl.dataset.detailBase || '';
    if (!base) {
      return `?club=${encodeURIComponent(clubId)}`;
    }
    if (base.includes('?')) {
      const url = new URL(base, window.location.origin);
      const firstParam = Array.from(url.searchParams.keys())[0] || 'id';
      url.searchParams.set(firstParam, clubId);
      return url.pathname + url.search;
    }
    const normalized = base.endsWith('/') ? base : `${base}/`;
    return `${normalized}${encodeURIComponent(clubId)}`;
  };

  const createResultRow = (club) => {
    const article = document.createElement('article');
    article.className = 'club-row';
    article.dataset.clubId = club.id;
    article.setAttribute('role', 'listitem');

    const cardLink = document.createElement('a');
    cardLink.className = 'club-row__card';
    cardLink.href = getClubDetailUrl(club.id);
    cardLink.setAttribute('aria-label', `Voir la fiche du club ${club.name}`);

    const header = document.createElement('div');
    header.className = 'club-row__top';

    const title = document.createElement('h2');
    title.className = 'club-row__name';
    title.textContent = club.name;
    header.appendChild(title);

    if (club.commune) {
      const communeNode = document.createElement('span');
      communeNode.className = 'club-row__commune';
      communeNode.textContent = club.commune;
      header.appendChild(communeNode);
    }

    cardLink.appendChild(header);

    if (club.address) {
      const address = document.createElement('p');
      address.className = 'club-row__address';
      address.textContent = club.address;
      cardLink.appendChild(address);
    }

    const footer = document.createElement('div');
    footer.className = 'club-row__footer';

    const cta = document.createElement('span');
    cta.className = 'club-row__cta';
    cta.textContent = 'Voir la fiche du club';
    footer.appendChild(cta);

    cardLink.appendChild(footer);
    article.appendChild(cardLink);

    return article;
  };

  const updateTotalCounter = () => {
    const total = state.clubs.length;
    const visible = Math.min(state.visibleCount, total);
    if (!total) {
      totalCounter.textContent = 'Aucun club disponible pour le moment.';
      return;
    }
    if (visible >= total) {
      totalCounter.textContent = `${total} club${total > 1 ? 's' : ''} dans les Hauts-de-Seine.`;
      return;
    }
    totalCounter.textContent = `${total} clubs dans les Hauts-de-Seine · ${visible} affichés.`;
  };

  const renderResults = () => {
    if (!state.clubs.length) {
      resultsEl.innerHTML = '<p class="clubs-empty">Aucune fiche club à afficher.</p>';
      if (moreButton) {
        moreButton.hidden = true;
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    const visible = Math.min(state.visibleCount, state.clubs.length);
    state.clubs.slice(0, visible).forEach((club) => {
      fragment.appendChild(createResultRow(club));
    });

    resultsEl.innerHTML = '';
    resultsEl.appendChild(fragment);

    if (moreButton) {
      if (visible < state.clubs.length) {
        const remaining = state.clubs.length - visible;
        moreButton.hidden = false;
        moreButton.textContent = `Afficher ${remaining} autre${remaining > 1 ? 's' : ''} club${remaining > 1 ? 's' : ''}`;
      } else {
        moreButton.hidden = true;
      }
    }
  };

  const showAllResults = () => {
    state.visibleCount = state.clubs.length;
    renderResults();
    updateTotalCounter();
    setSearchStatus('Tous les clubs sont affichés.', 'info');
  };

  const init = () => {
    disableSearchUI();
    setSearchStatus('Chargement de la liste des clubs…', 'info');

    fetch(DATA_URL, { headers: { Accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        const data = Array.isArray(payload) ? payload : [];
        state.clubs = data.map(hydrateClub).sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
        state.visibleCount = Math.min(VISIBLE_RESULTS_DEFAULT, state.clubs.length);
        renderResults();
        updateTotalCounter();
        setSearchStatus('Tous les clubs sont affichés.', 'info');
      })
      .catch(() => {
        resultsEl.innerHTML = '<p class="clubs-error">Impossible de charger la liste des clubs pour le moment. Veuillez réessayer plus tard.</p>';
        totalCounter.textContent = '';
        setSearchStatus('Erreur lors du chargement de la liste des clubs.', 'error');
      });

    moreButton?.addEventListener('click', showAllResults);
  };

  init();
})();
