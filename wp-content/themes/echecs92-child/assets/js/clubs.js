/**
 * Clubs directory interactions for echecs92.fr.
 * Provides client-side search, sorting, map display (Leaflet)
 * and distance estimates based on a user-supplied city or postcode.
 */
(function () {
  const DATA_URL = '/wp-content/themes/echecs92-child/assets/data/clubs.json';
  const DEFAULT_CENTER = [48.875, 2.231]; // Hauts-de-Seine centroid approximation
  const STORAGE_PREFIX = 'echecs92-club-geo:';
  const GEOCODE_BASE_URL = 'https://nominatim.openstreetmap.org/search';
  const GEOCODE_MIN_DELAY = 1200; // ms between requests (respect Nominatim policy)
  const USER_LOCATION_KEY = 'echecs92-user-location';
  const SEARCH_DELAY = 420;

  const searchInput = document.getElementById('clubs-search');
  const resultsEl = document.getElementById('clubs-results');
  const sortSelect = document.getElementById('clubs-sort');
  const locationInput = document.getElementById('clubs-location');
  const locationApplyButton = document.getElementById('clubs-location-apply');
  const locationStatus = document.getElementById('clubs-location-status');
  const searchButton = document.getElementById('clubs-search-btn');
  const resetButton = document.getElementById('clubs-reset-btn');
  const searchStatus = document.getElementById('clubs-search-status');
  const geolocButton = document.getElementById('clubs-use-geoloc');
  const locationClearButton = document.getElementById('clubs-location-clear');
  const advancedToggle = document.getElementById('clubs-advanced-toggle');
  const advancedPanel = document.getElementById('clubs-advanced-panel');
  const toggleMapButton = document.getElementById('clubs-toggle-map');
  const mapContainer = document.getElementById('clubs-map');
  const totalCounter = document.createElement('p');

  if (!resultsEl) {
    return;
  }

  totalCounter.className = 'clubs-total';
  totalCounter.setAttribute('aria-live', 'polite');
  resultsEl.before(totalCounter);

  let searchTimer = null;
  let loadingTimer = null;

  const setLocationStatus = (message, tone = 'info') => {
    if (!locationStatus) {
      return;
    }
    locationStatus.textContent = message || '';
    if (message) {
      locationStatus.dataset.tone = tone;
    } else {
      delete locationStatus.dataset.tone;
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

  const updateSearchStatus = (meta) => {
    if (!meta) {
      setSearchStatus(`${state.filtered.length} club${state.filtered.length > 1 ? 's' : ''} affiché${state.filtered.length > 1 ? 's' : ''}.`, 'info');
      return;
    }
    if (!meta.termsCount) {
      setSearchStatus(`${meta.total} club${meta.total > 1 ? 's' : ''} dans les Hauts-de-Seine.`, 'info');
      return;
    }
    if (meta.matches > 0) {
      const label = meta.matches === 1 ? 'résultat pertinent' : 'résultats pertinents';
      setSearchStatus(`${meta.matches} ${label}.`, 'success');
    } else if (meta.fallbackUsed) {
      if (state.queryLocation) {
        setSearchStatus(
          `Aucun résultat exact. Clubs les plus proches de ${state.queryLocation.label}.`,
          'info'
        );
      } else {
        setSearchStatus('Aucun résultat exact. Affichage des clubs les plus proches et pertinents.', 'info');
      }
    } else {
      setSearchStatus(
        `${meta.total} club${meta.total > 1 ? 's' : ''} correspondant${meta.total > 1 ? 's' : ''} trouvé${meta.total > 1 ? 's' : ''}.`,
        'info'
      );
    }
  };

  const setLoading = (isLoading) => {
    window.clearTimeout(loadingTimer);
    if (isLoading) {
      if (resultsEl) {
        resultsEl.classList.add('is-loading');
      }
      if (searchButton) {
        searchButton.disabled = true;
        searchButton.dataset.label = searchButton.dataset.label || searchButton.textContent;
        searchButton.textContent = 'Recherche…';
      }
    } else {
      loadingTimer = window.setTimeout(() => {
        resultsEl?.classList.remove('is-loading');
        if (searchButton) {
          searchButton.disabled = false;
          if (searchButton.dataset.label) {
            searchButton.textContent = searchButton.dataset.label;
          }
        }
      }, 150);
    }
  };

  const state = {
    clubs: [],
    filtered: [],
    query: '',
    pendingQuery: searchInput ? searchInput.value.trim() : '',
    sort: 'name',
    userLocation: null,
    userLocationLabel: '',
    lastLocationQuery: '',
    queryLocation: null,
    queryLocationToken: null,
    queryLocationCache: new Map(),
    lastSearchMeta: null,
    map: null,
    markers: new Map(),
    geocodingQueue: [],
    geocodingTimer: null,
    geocodingActive: false,
  };

  const normalise = (value) =>
    (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const haversineKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const getDistanceLabel = (club) => {
    let distanceValue = null;
    let suffix = 'de vous';
    if (state.userLocation && typeof club.distanceKm === 'number') {
      distanceValue = club.distanceKm;
    } else if (!state.userLocation && state.queryLocation && typeof club.distanceFromQueryKm === 'number') {
      distanceValue = club.distanceFromQueryKm;
      suffix = `depuis ${state.queryLocation.label}`;
    }
    if (typeof distanceValue !== 'number') {
      return null;
    }
    const round = distanceValue < 10 ? distanceValue.toFixed(1) : Math.round(distanceValue);
    return `${round} km ${suffix}`;
  };

  const formatPhone = (value) => {
    if (!value) {
      return null;
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 10) {
      return value;
    }
    return digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
  };

  const levenshtein = (a, b) => {
    if (a === b) {
      return 0;
    }
    if (!a.length) {
      return b.length;
    }
    if (!b.length) {
      return a.length;
    }
    const matrix = [];
    for (let i = 0; i <= b.length; i += 1) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j += 1) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i += 1) {
      for (let j = 1; j <= a.length; j += 1) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j - 1] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  };

  const persistClubCoordinates = (club) => {
    try {
      const key = `${STORAGE_PREFIX}${club.id}`;
      localStorage.setItem(
        key,
        JSON.stringify({
          lat: club.lat,
          lng: club.lng,
          ts: Date.now(),
        })
      );
    } catch (err) {
      // Ignored – storage could be unavailable (Safari private mode, etc.)
    }
  };

  const restoreClubCoordinates = (club) => {
    try {
      const key = `${STORAGE_PREFIX}${club.id}`;
      const cached = localStorage.getItem(key);
      if (!cached) {
        return false;
      }
      const parsed = JSON.parse(cached);
      if (!parsed || typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') {
        return false;
      }
      club.lat = parsed.lat;
      club.lng = parsed.lng;
      return true;
    } catch (err) {
      return false;
    }
  };

  const saveUserLocation = (payload) => {
    try {
      localStorage.setItem(
        USER_LOCATION_KEY,
        JSON.stringify({
          ...payload,
          ts: Date.now(),
        })
      );
    } catch (err) {
      // Ignore storage failures (private browsing, quota, etc.)
    }
  };

  const loadStoredLocation = () => {
    try {
      const cached = localStorage.getItem(USER_LOCATION_KEY);
      if (!cached) {
        return null;
      }
      const parsed = JSON.parse(cached);
      if (
        !parsed ||
        typeof parsed.latitude !== 'number' ||
        typeof parsed.longitude !== 'number' ||
        Number.isNaN(parsed.latitude) ||
        Number.isNaN(parsed.longitude)
      ) {
        return null;
      }
      return parsed;
    } catch (err) {
      return null;
    }
  };

  const clearStoredLocation = () => {
    try {
      localStorage.removeItem(USER_LOCATION_KEY);
    } catch (err) {
      // Ignore
    }
  };

  const queueGeocoding = (club) => {
    if (club.lat != null && club.lng != null) {
      return Promise.resolve(club);
    }

    if (club._geocodePromise) {
      return club._geocodePromise;
    }

    const promise = new Promise((resolve) => {
      state.geocodingQueue.push({ club, resolve });
      processGeocodingQueue();
    });

    club._geocodePromise = promise;
    return promise;
  };

  const processGeocodingQueue = () => {
    if (state.geocodingActive || !state.geocodingQueue.length) {
      return;
    }

    const { club, resolve } = state.geocodingQueue.shift();
    state.geocodingActive = true;

    const finish = (success) => {
      state.geocodingActive = false;
      state.geocodingTimer = window.setTimeout(() => {
        state.geocodingTimer = null;
        processGeocodingQueue();
      }, GEOCODE_MIN_DELAY);
      club._geocodePromise = null;
      resolve(success ? club : null);
    };

    if (!navigator.onLine) {
      finish(false);
      return;
    }

    if (restoreClubCoordinates(club)) {
      finish(true);
      return;
    }

    const query = [club.address, club.commune, 'France'].filter(Boolean).join(', ');
    const params = new URLSearchParams({
      format: 'json',
      addressdetails: '0',
      limit: '1',
      q: query,
    });

    fetch(`${GEOCODE_BASE_URL}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'fr',
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        if (!Array.isArray(payload) || !payload.length) {
          finish(false);
          return;
        }
        club.lat = Number.parseFloat(payload[0].lat);
        club.lng = Number.parseFloat(payload[0].lon);
        persistClubCoordinates(club);
        finish(true);
        refreshMapMarkers();
        refreshDistances();
      })
      .catch(() => finish(false));
  };

  const ensureMap = () => {
    if (!window.L || state.map) {
      return;
    }
    state.map = L.map(mapContainer, {
      scrollWheelZoom: false,
      closePopupOnClick: false,
    }).setView(DEFAULT_CENTER, 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(state.map);
  };

  const refreshMapMarkers = () => {
    if (!state.map) {
      return;
    }
    const visibleIds = new Set(state.filtered.map((club) => club.id));
    state.markers.forEach((marker, id) => {
      if (!visibleIds.has(id)) {
        marker.remove();
        state.markers.delete(id);
      }
    });

    if (!state.filtered.length) {
      state.map.setView(DEFAULT_CENTER, 11);
      return;
    }

    const bounds = [];
    state.filtered.forEach((club) => {
      if (club.lat == null || club.lng == null) {
        queueGeocoding(club);
        return;
      }
      if (state.markers.has(club.id)) {
        bounds.push([club.lat, club.lng]);
        return;
      }
      const marker = L.marker([club.lat, club.lng], { title: club.name }).addTo(state.map);
      marker.bindPopup(
        `<strong>${club.name}</strong><br>${club.commune || ''}${
          club.address ? `<br>${club.address}` : ''
        }`
      );
      marker.on('click', () => {
        focusClubCard(club.id);
      });
      state.markers.set(club.id, marker);
      bounds.push([club.lat, club.lng]);
    });

    if (bounds.length) {
      state.map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
    }
  };

  const refreshDistances = () => {
    if (state.userLocation) {
      const { latitude, longitude } = state.userLocation;
      state.clubs.forEach((club) => {
        if (club.lat == null || club.lng == null) {
          delete club.distanceKm;
          queueGeocoding(club);
          return;
        }
        club.distanceKm = haversineKm(latitude, longitude, club.lat, club.lng);
      });
      applyFilters();
      return;
    }

    if (state.queryLocation) {
      computeDistancesForQueryLocation();
      applyFilters();
      return;
    }

    state.clubs.forEach((club) => {
      delete club.distanceKm;
      delete club.distanceFromQueryKm;
    });
    applyFilters();
  };

  const computeSearchScore = (club, terms) => {
    if (!terms.length) {
      return 0;
    }
    const keywords = club._keywords || [];
    const searchString = club._search || '';
    let score = 0;

    terms.forEach((term) => {
      if (!term) {
        return;
      }
      let best = 0;
      if (searchString.includes(term)) {
        best = Math.max(best, 2.5);
      }
      for (let i = 0; i < keywords.length; i += 1) {
        const keyword = keywords[i];
        if (!keyword) {
          continue;
        }
        if (keyword === term) {
          best = Math.max(best, 5);
          continue;
        }
        if (keyword.startsWith(term)) {
          best = Math.max(best, 3.5);
          continue;
        }
        if (term.startsWith(keyword)) {
          best = Math.max(best, 2.8);
          continue;
        }
        if (keyword.includes(term)) {
          best = Math.max(best, 2);
          continue;
        }
        const distance = levenshtein(keyword, term);
        const length = Math.max(keyword.length, term.length);
        if (length) {
          const similarity = 1 - distance / length;
          if (similarity >= 0.6) {
            best = Math.max(best, similarity * 3);
          }
        }
      }
      if (/^\d{2,5}$/.test(term)) {
        const numericTerm = Number.parseInt(term, 10);
        if (Number.isFinite(numericTerm)) {
          (club._postalCodes || []).forEach((postal) => {
            if (postal === term) {
              best = Math.max(best, 5);
            } else if (postal.startsWith(term) || term.startsWith(postal)) {
              best = Math.max(best, 4);
            } else {
              const numericPostal = Number.parseInt(postal, 10);
              if (Number.isFinite(numericPostal)) {
                const diff = Math.abs(numericPostal - numericTerm);
                const closeness = Math.max(0, 1 - diff / 400);
                if (closeness > 0) {
                  best = Math.max(best, closeness * 3);
                }
              }
            }
          });
        }
      }
      if (best === 0 && keywords.length) {
        let minDistance = Infinity;
        keywords.forEach((keyword) => {
          const distance = levenshtein(keyword, term);
          if (distance < minDistance) {
            minDistance = distance;
          }
        });
        if (minDistance !== Infinity) {
          const closeness = Math.max(0, 1 - minDistance / Math.max(term.length, 3));
          if (closeness > 0) {
            best = Math.max(best, closeness * 1.8);
          }
        }
      }
      score += best;
    });

    return score;
  };

  const computeDistancesForQueryLocation = () => {
    if (!state.queryLocation) {
      state.clubs.forEach((club) => {
        delete club.distanceFromQueryKm;
      });
      return;
    }
    const { latitude, longitude } = state.queryLocation;
    state.clubs.forEach((club) => {
      if (club.lat == null || club.lng == null) {
        delete club.distanceFromQueryKm;
        queueGeocoding(club);
        return;
      }
      club.distanceFromQueryKm = haversineKm(latitude, longitude, club.lat, club.lng);
    });
  };

  const applyFilters = (options = {}) => {
    const { silentStatus = false } = options;
    const rawQuery = state.query || '';
    const query = normalise(rawQuery);
    const terms = query ? query.split(/\s+/).filter(Boolean) : [];
    const scoreMap = new Map();
    let matches = 0;
    let fallbackUsed = false;

    let orderedClubs;

    if (terms.length) {
      const scored = state.clubs.map((club, index) => {
        const score = computeSearchScore(club, terms);
        scoreMap.set(club.id, score);
        return { club, score, index };
      });
      const positives = scored.filter((entry) => entry.score > 0);
      matches = positives.length;
      const candidates = positives.length ? positives : scored;
      fallbackUsed = positives.length === 0;
      candidates.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.index - b.index;
      });
      orderedClubs = candidates.map((entry) => entry.club);
    } else {
      orderedClubs = state.clubs.slice();
      state.clubs.forEach((club) => scoreMap.set(club.id, 0));
    }

    const sorter = getSorter(state.sort);
    orderedClubs.sort((a, b) => {
      if (state.userLocation && state.sort === 'distance') {
        const distanceDiff = sorter(a, b);
        if (distanceDiff !== 0) {
          return distanceDiff;
        }
      } else if (!state.userLocation && state.queryLocation) {
        const distanceA = a.distanceFromQueryKm;
        const distanceB = b.distanceFromQueryKm;
        if (typeof distanceA === 'number' && typeof distanceB === 'number' && distanceA !== distanceB) {
          return distanceA - distanceB;
        }
      }
      if (terms.length) {
        const diff = (scoreMap.get(b.id) || 0) - (scoreMap.get(a.id) || 0);
        if (diff !== 0) {
          return diff;
        }
      }
      if (state.sort !== 'distance') {
        return sorter(a, b);
      }
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });

    state.filtered = orderedClubs;
    let suffix = '';
    if (state.userLocation && state.userLocationLabel) {
      suffix = ` · distances depuis ${state.userLocationLabel}`;
    } else if (!state.userLocation && state.queryLocation) {
      suffix = ` · distances estimées depuis ${state.queryLocation.label}`;
    }
    totalCounter.textContent = `${state.filtered.length} club${
      state.filtered.length > 1 ? 's' : ''
    } dans les Hauts-de-Seine${suffix}`;

    if (!state.filtered.length) {
      resultsEl.innerHTML =
        '<p class="clubs-empty">Aucun club ne correspond à votre recherche pour le moment.</p>';
    } else {
      const expandedIds = new Set(
        Array.from(resultsEl.querySelectorAll('.club-card__toggle[aria-expanded="true"]'))
          .map((toggle) => toggle.closest('.club-card'))
          .filter(Boolean)
          .map((card) => card.dataset.clubId)
      );

      const fragment = document.createDocumentFragment();
      state.filtered.forEach((club) => {
        const card = createClubCard(club);
        if (expandedIds.has(club.id)) {
          setCardExpansion(card, true, { silent: true });
        }
        fragment.appendChild(card);
      });

      resultsEl.innerHTML = '';
      resultsEl.appendChild(fragment);
    }

    refreshMapMarkers();

    const meta = {
      query: rawQuery,
      termsCount: terms.length,
      matches,
      fallbackUsed,
      total: state.filtered.length,
    };
    state.lastSearchMeta = meta;
    if (!silentStatus) {
      updateSearchStatus(meta);
    }
    return meta;
  };

  const getSorter = (sortKey) => {
    switch (sortKey) {
      case 'licenses':
        return (a, b) => {
          const totalA = Number.isFinite(a.totalLicenses) ? a.totalLicenses : 0;
          const totalB = Number.isFinite(b.totalLicenses) ? b.totalLicenses : 0;
          return totalB - totalA;
        };
      case 'distance':
        return (a, b) => {
          const da = typeof a.distanceKm === 'number' ? a.distanceKm : Number.POSITIVE_INFINITY;
          const db = typeof b.distanceKm === 'number' ? b.distanceKm : Number.POSITIVE_INFINITY;
          return da - db;
        };
      case 'name':
      default:
        return (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    }
  };

  const setCardExpansion = (article, expand, options = {}) => {
    const toggle = article.querySelector('.club-card__toggle');
    const body = article.querySelector('.club-card__body');
    if (!toggle || !body) {
      if (!options.silent) {
        article.classList.add('club-card--highlight');
        window.setTimeout(() => {
          article.classList.remove('club-card--highlight');
        }, 900);
      }
      return;
    }
    const { silent = false } = options;
    const currentlyExpanded = toggle.getAttribute('aria-expanded') === 'true';
    const nextState = typeof expand === 'boolean' ? expand : !currentlyExpanded;
    toggle.setAttribute('aria-expanded', nextState ? 'true' : 'false');
    body.hidden = !nextState;
    const labelNode = toggle.querySelector('.club-card__toggle-label');
    if (labelNode) {
      const closed = toggle.dataset.labelClosed || 'Voir les détails';
      const open = toggle.dataset.labelOpen || 'Masquer les détails';
      labelNode.textContent = nextState ? open : closed;
    }
    if (nextState && !silent) {
      article.classList.add('club-card--highlight');
      window.setTimeout(() => {
        article.classList.remove('club-card--highlight');
      }, 900);
    }
  };

  const createMetaChip = (type, text) => {
    const chip = document.createElement('span');
    chip.className = `club-chip club-chip--${type}`;
    chip.textContent = text;
    return chip;
  };

  const createContactLink = (label, href, textContent) => {
    const link = document.createElement('a');
    link.className = 'club-card__contact';
    link.href = href;
    link.textContent = textContent || label;
    link.title = label;
    link.setAttribute('aria-label', `${label}: ${link.textContent}`);
    link.rel = 'noopener';
    return link;
  };

  const createDetailSection = (title) => {
    const container = document.createElement('section');
    container.className = 'club-card__section';
    const heading = document.createElement('h3');
    heading.textContent = title;
    container.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'club-card__details';
    container.appendChild(list);

    return { container, list };
  };

  const createClubCard = (club) => {
    const article = document.createElement('article');
    article.className = 'club-card';
    article.dataset.clubId = club.id;
    article.setAttribute('role', 'listitem');

    const summary = document.createElement('div');
    summary.className = 'club-card__summary';

    const title = document.createElement('h2');
    title.textContent = club.name;
    summary.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'club-card__meta';
    if (club.commune) {
      meta.appendChild(createMetaChip('commune', club.commune));
    }
    const distanceLabel = getDistanceLabel(club);
    if (distanceLabel) {
      meta.appendChild(createMetaChip('distance', distanceLabel));
    }
    if (Number.isFinite(club.totalLicenses) && club.totalLicenses > 0) {
      const licenseLabel = `${club.totalLicenses} licencié${
        club.totalLicenses > 1 ? 's' : ''
      }`;
      meta.appendChild(createMetaChip('licenses', licenseLabel));
    }
    if (meta.childElementCount) {
      summary.appendChild(meta);
    }

    if (club.address) {
      const address = document.createElement('p');
      address.className = 'club-card__address';
      address.textContent = club.address;
      summary.appendChild(address);
    }

    const contacts = document.createElement('div');
    contacts.className = 'club-card__contacts';
    if (club.email) {
      contacts.appendChild(createContactLink('Email', `mailto:${club.email}`, club.email));
    }
    if (club.phone) {
      const telValue = club.phone.replace(/[^\d+]/g, '');
      const phoneLabel = formatPhone(club.phone) || club.phone;
      contacts.appendChild(createContactLink('Téléphone', `tel:${telValue || club.phone}`, phoneLabel));
    }
    if (contacts.childElementCount) {
      summary.appendChild(contacts);
    }

    const actions = document.createElement('div');
    actions.className = 'club-card__actions';
    if (club.site) {
      const siteLink = document.createElement('a');
      siteLink.className = 'btn';
      siteLink.href = club.site;
      siteLink.target = '_blank';
      siteLink.rel = 'noopener';
      siteLink.textContent = 'Site du club';
      actions.appendChild(siteLink);
    }
    if (mapContainer) {
      const mapAction = document.createElement('button');
      mapAction.type = 'button';
      mapAction.className = 'btn btn-secondary';
      mapAction.textContent = 'Voir sur la carte';
      mapAction.addEventListener('click', (event) => {
        event.stopPropagation();
        focusOnMap(club);
      });
      actions.appendChild(mapAction);
    }
    if (actions.childElementCount) {
      summary.appendChild(actions);
    }

    article.appendChild(summary);

    const detailsWrapper = document.createElement('div');
    detailsWrapper.className = 'club-card__details-wrapper';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'club-card__toggle';
    toggle.setAttribute('aria-expanded', 'false');
    const bodyId = `club-details-${club.id}`;
    toggle.setAttribute('aria-controls', bodyId);
    toggle.dataset.labelClosed = 'Voir les détails';
    toggle.dataset.labelOpen = 'Masquer les détails';

    const toggleLabel = document.createElement('span');
    toggleLabel.className = 'club-card__toggle-label';
    toggleLabel.textContent = toggle.dataset.labelClosed;
    toggle.appendChild(toggleLabel);

    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'club-card__toggle-icon';
    toggleIcon.setAttribute('aria-hidden', 'true');
    toggleIcon.textContent = '▾';
    toggle.appendChild(toggleIcon);

    toggle.addEventListener('click', () => {
      setCardExpansion(article);
    });

    detailsWrapper.appendChild(toggle);

    const body = document.createElement('div');
    body.className = 'club-card__body';
    body.hidden = true;
    body.id = bodyId;

    const sections = {
      activites: createDetailSection('Activités'),
      organisation: createDetailSection('Organisation'),
      ressources: createDetailSection('Ressources'),
    };

    const addDetail = (sectionKey, term, value, options = {}) => {
      if (!value) {
        return;
      }
      const section = sections[sectionKey];
      if (!section) {
        return;
      }
      const item = document.createElement('li');
      item.className = 'club-card__detail-item';

      const label = document.createElement('span');
      label.className = 'club-card__detail-label';
      label.textContent = term;
      item.appendChild(label);

      if (options.isLink) {
        const link = document.createElement('a');
        link.href = value;
        link.rel = 'noopener';
        link.target = '_blank';
        link.textContent = options.label || value;
        item.appendChild(link);
      } else if (options.isMail) {
        const link = document.createElement('a');
        link.href = `mailto:${value}`;
        link.textContent = value;
        item.appendChild(link);
      } else if (options.isPhone) {
        const formatted = formatPhone(value) || value;
        const cleaned = value.replace(/[^\d+]/g, '');
        const link = document.createElement('a');
        link.href = `tel:${cleaned || value}`;
        link.textContent = formatted;
        item.appendChild(link);
      } else {
        const text = document.createElement('div');
        text.className = 'club-card__detail-value';
        text.textContent = value;
        item.appendChild(text);
      }

      section.list.appendChild(item);
    };

    addDetail('activites', 'Publics accueillis', club.publics);
    addDetail('activites', 'Horaires', club.hours);
    addDetail('activites', 'Tarifs', club.tarifs);

    addDetail('organisation', 'Président·e', club.president);
    if (club.licenses && (club.licenses.A || club.licenses.B)) {
      const licenseInfo = [];
      if (club.licenses.A) {
        licenseInfo.push(`Licence A : ${club.licenses.A}`);
      }
      if (club.licenses.B) {
        licenseInfo.push(`Licence B : ${club.licenses.B}`);
      }
      addDetail('organisation', 'Répartition licences', licenseInfo.join(' · '));
    }

    addDetail('ressources', 'Fiche FFE', club.fiche_ffe, {
      isLink: true,
      label: 'Consulter la fiche FFE',
    });

    Object.values(sections).forEach((section) => {
      if (section.list.childElementCount) {
        body.appendChild(section.container);
      }
    });

    if (body.childElementCount) {
      detailsWrapper.appendChild(body);
      article.appendChild(detailsWrapper);
    }

    return article;
  };

  const focusClubCard = (clubId) => {
    const target = resultsEl.querySelector(`[data-club-id="${clubId}"]`);
    if (!target) {
      return;
    }
    setCardExpansion(target, true);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const focusOnMap = (club) => {
    if (mapContainer.hasAttribute('hidden')) {
      mapContainer.removeAttribute('hidden');
      toggleMapButton.setAttribute('aria-expanded', 'true');
      toggleMapButton.textContent = 'Masquer la carte';
      ensureMap();
    }
    queueGeocoding(club).then(() => {
      ensureMap();
      refreshMapMarkers();
      const marker = state.markers.get(club.id);
      if (marker) {
        marker.openPopup();
        state.map.setView(marker.getLatLng(), 14);
      }
    });
  };

  const handleSearchInputChange = (event) => {
    state.pendingQuery = event.target.value;
  };

  const performSearch = () => {
    if (searchInput) {
      state.pendingQuery = searchInput.value;
    }
    state.query = (state.pendingQuery || '').trim();
    state.queryLocation = null;
    state.queryLocationToken = null;
    computeDistancesForQueryLocation();
    window.clearTimeout(searchTimer);
    setSearchStatus('Recherche en cours…', 'info');
    setLoading(true);
    searchTimer = window.setTimeout(() => {
      try {
        const meta = applyFilters();
        maybeApplyQueryLocation(meta);
      } finally {
        setLoading(false);
      }
    }, SEARCH_DELAY);
  };

  const resetSearch = () => {
    window.clearTimeout(searchTimer);
    setLoading(false);
    state.pendingQuery = '';
    state.query = '';
    if (searchInput) {
      searchInput.value = '';
    }
    state.queryLocation = null;
    state.queryLocationToken = null;
    computeDistancesForQueryLocation();
    applyFilters({ silentStatus: true });
    setSearchStatus('Recherche réinitialisée. Tous les clubs sont affichés.', 'success');
  };

  const maybeApplyQueryLocation = (meta) => {
    if (
      state.userLocation ||
      !meta ||
      !meta.termsCount ||
      !state.query ||
      (!meta.fallbackUsed && meta.matches > 0)
    ) {
      state.queryLocation = null;
      state.queryLocationToken = null;
      computeDistancesForQueryLocation();
      return;
    }

    const postalMatch = state.query.match(/\b\d{5}\b/);
    if (!postalMatch) {
      state.queryLocation = null;
      state.queryLocationToken = null;
      computeDistancesForQueryLocation();
      return;
    }

    const token = postalMatch[0];
    if (state.queryLocation && state.queryLocationToken === token) {
      computeDistancesForQueryLocation();
      applyFilters({ silentStatus: true });
      updateSearchStatus(state.lastSearchMeta);
      return;
    }

    const cached = state.queryLocationCache.get(token);
    if (cached) {
      state.queryLocationToken = token;
      state.queryLocation = cached;
      computeDistancesForQueryLocation();
      const metaWithDistances = applyFilters({ silentStatus: true });
      updateSearchStatus(metaWithDistances);
      return;
    }

    geocodePlace(token)
      .then(({ latitude, longitude, label }) => {
        const locationData = { latitude, longitude, label };
        state.queryLocationCache.set(token, locationData);
        state.queryLocationToken = token;
        state.queryLocation = locationData;
        computeDistancesForQueryLocation();
        const metaWithDistances = applyFilters({ silentStatus: true });
        updateSearchStatus(metaWithDistances);
      })
      .catch(() => {
        state.queryLocation = null;
        state.queryLocationToken = null;
      });
  };

  const handleSortChange = (event) => {
    const selected = event.target.value;
    if (selected === 'distance' && !state.userLocation) {
      setSearchStatus(
        'Indiquez votre ville ou utilisez la géolocalisation pour activer le tri par distance.',
        'info'
      );
      if (sortSelect) {
        sortSelect.value = state.sort;
      }
      return;
    }
    state.sort = selected;
    applyFilters();
  };

  const formatPlaceLabel = (place) => {
    if (!place) {
      return '';
    }
    const { address = {}, display_name: displayName = '' } = place;
    const locality =
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.suburb ||
      address.hamlet ||
      '';
    const postalCode = address.postcode;
    const department = address.county || address.state || '';
    const parts = [locality, postalCode, department].filter(Boolean);
    if (!parts.length && displayName) {
      const [first] = displayName.split(',');
      parts.push(first.trim());
    }
    return parts.join(' · ');
  };

  const geocodePlace = (query) => {
    const params = new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      limit: '1',
      countrycodes: 'fr',
      q: query,
    });

    return fetch(`${GEOCODE_BASE_URL}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'fr',
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        if (!Array.isArray(payload) || !payload.length) {
          throw new Error('NO_RESULT');
        }
        const result = payload[0];
        const latitude = Number.parseFloat(result.lat);
        const longitude = Number.parseFloat(result.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          throw new Error('INVALID_COORDS');
        }
        return {
          latitude,
          longitude,
          label: formatPlaceLabel(result) || query,
        };
      });
  };

  const reverseGeocode = (latitude, longitude) => {
    const params = new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      zoom: '14',
      lat: String(latitude),
      lon: String(longitude),
    });

    return fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'fr',
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => formatPlaceLabel(payload) || '');
  };

  const applyUserLocation = ({ latitude, longitude, label, query, source }) => {
    state.queryLocation = null;
    state.queryLocationToken = null;
    computeDistancesForQueryLocation();
    state.userLocation = { latitude, longitude };
    state.userLocationLabel = label || query || 'Votre position';
    state.lastLocationQuery = query || label || '';
    if (locationInput) {
      if (query) {
        locationInput.value = query;
      } else if (label) {
        locationInput.value = label;
      }
    }
    state.sort = 'distance';
    if (sortSelect) {
      sortSelect.value = 'distance';
    }
    saveUserLocation({
      latitude,
      longitude,
      label: state.userLocationLabel,
      query: query || '',
      source,
    });
    setLocationStatus(`Distances calculées depuis ${state.userLocationLabel}.`, 'success');
    refreshDistances();
  };

  const handleLocationSubmit = () => {
    if (!locationInput) {
      return;
    }
    const raw = locationInput.value.trim();
    const button = locationApplyButton;
    const baseLabel = button?.dataset.label || button?.textContent || 'Valider';
    if (button) {
      button.dataset.label = baseLabel;
    }
    if (!raw) {
      handleLocationClear();
      return;
    }

    if (state.userLocation && raw === state.lastLocationQuery) {
      setLocationStatus(`Distances calculées depuis ${state.userLocationLabel}.`, 'success');
      return;
    }

    setLocationStatus('Recherche en cours…', 'info');
    if (button) {
      button.disabled = true;
      button.textContent = 'Recherche…';
    }
    geocodePlace(raw)
      .then(({ latitude, longitude, label }) => {
        applyUserLocation({ latitude, longitude, label, query: raw, source: 'manual' });
      })
      .catch(() => {
        setLocationStatus(
          'Localisation introuvable. Essayez un autre nom de ville ou code postal.',
          'error'
        );
      })
      .finally(() => {
        if (button) {
          button.disabled = false;
          button.textContent = button.dataset.label || 'Valider';
        }
      });
  };

  const handleLocationClear = () => {
    state.userLocation = null;
    state.userLocationLabel = '';
    state.lastLocationQuery = '';
    clearStoredLocation();
    state.queryLocation = null;
    state.queryLocationToken = null;
    computeDistancesForQueryLocation();
    if (locationInput) {
      locationInput.value = '';
    }
    if (state.sort === 'distance') {
      state.sort = 'name';
      if (sortSelect) {
        sortSelect.value = 'name';
      }
    }
    setLocationStatus('Localisation effacée.', 'info');
    refreshDistances();
  };

  const handleUseGeolocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('Géolocalisation indisponible sur cet appareil.', 'error');
      return;
    }
    if (geolocButton) {
      geolocButton.dataset.label = geolocButton.dataset.label || geolocButton.textContent;
      geolocButton.disabled = true;
      geolocButton.textContent = 'Recherche…';
    }
    setLocationStatus('Recherche de votre position…', 'info');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        reverseGeocode(latitude, longitude)
          .catch(() => '')
          .then((label) => {
            applyUserLocation({
              latitude,
              longitude,
              label: label || 'Votre position',
              query: '',
              source: 'geoloc',
            });
          })
          .finally(() => {
            if (geolocButton) {
              geolocButton.disabled = false;
              geolocButton.textContent = geolocButton.dataset.label || 'Autour de moi';
            }
          });
      },
      () => {
        setLocationStatus('Impossible de récupérer votre position.', 'error');
        if (geolocButton) {
          geolocButton.disabled = false;
          geolocButton.textContent = geolocButton.dataset.label || 'Autour de moi';
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
      }
    );
  };

  const toggleAdvancedOptions = () => {
    if (!advancedToggle || !advancedPanel) {
      return;
    }
    const expanded = advancedToggle.getAttribute('aria-expanded') === 'true';
    const next = !expanded;
    advancedToggle.setAttribute('aria-expanded', String(next));
    advancedToggle.textContent = next ? 'Masquer les options avancées' : 'Options avancées';
    if (next) {
      advancedPanel.removeAttribute('hidden');
    } else {
      advancedPanel.setAttribute('hidden', '');
    }
  };

  const toggleMapVisibility = () => {
    const visible = !mapContainer.hasAttribute('hidden');
    if (visible) {
      mapContainer.setAttribute('hidden', '');
      toggleMapButton.setAttribute('aria-expanded', 'false');
      toggleMapButton.textContent = 'Afficher la carte';
      return;
    }
    mapContainer.removeAttribute('hidden');
    toggleMapButton.setAttribute('aria-expanded', 'true');
    toggleMapButton.textContent = 'Masquer la carte';
    ensureMap();
    refreshMapMarkers();
  };

  const bindEvents = () => {
    searchInput?.addEventListener('input', handleSearchInputChange);
    searchInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        performSearch();
      }
    });
    searchButton?.addEventListener('click', performSearch);
    resetButton?.addEventListener('click', resetSearch);
    locationApplyButton?.addEventListener('click', handleLocationSubmit);
    locationClearButton?.addEventListener('click', handleLocationClear);
    geolocButton?.addEventListener('click', handleUseGeolocation);
    locationInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleLocationSubmit();
      }
    });
    sortSelect?.addEventListener('change', handleSortChange);
    toggleMapButton?.addEventListener('click', toggleMapVisibility);
    advancedToggle?.addEventListener('click', toggleAdvancedOptions);

    document.addEventListener('visibilitychange', () => {
      if (!state.geocodingActive && state.geocodingQueue.length) {
        processGeocodingQueue();
      }
    });
  };

  const hydrateClub = (raw) => {
    const club = { ...raw };
    club._search = normalise(
      [
        club.name,
        club.commune,
        club.address,
        club.publics,
        club.hours,
        club.tarifs,
        club.president,
        club.notes,
      ]
        .filter(Boolean)
        .join(' ')
    );
    const keywordSource = [
      club.name,
      club.commune,
      club.address,
      club.publics,
      club.hours,
      club.tarifs,
      club.president,
      club.notes,
    ].filter(Boolean);
    const keywordSet = new Set();
    keywordSource.forEach((value) => {
      const normalised = normalise(value);
      if (!normalised) {
        return;
      }
      normalised
        .split(/[\s,;:·\-\/]+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .forEach((token) => keywordSet.add(token));
    });
    club._keywords = Array.from(keywordSet);
    const postalCodes = [];
    [club.address, club.commune].forEach((value) => {
      if (!value) {
        return;
      }
      const matches = value.match(/\b\d{5}\b/g);
      if (matches) {
        matches.forEach((code) => postalCodes.push(code));
      }
    });
    club._postalCodes = Array.from(new Set(postalCodes));
    const licenseA = Number.parseInt(club.licenses?.A, 10);
    const licenseB = Number.parseInt(club.licenses?.B, 10);
    const totalLicenses =
      (Number.isFinite(licenseA) ? licenseA : 0) + (Number.isFinite(licenseB) ? licenseB : 0);
    club.totalLicenses = totalLicenses > 0 ? totalLicenses : null;
    if (club.lat != null) {
      club.lat = Number.parseFloat(club.lat);
    }
    if (club.lng != null) {
      club.lng = Number.parseFloat(club.lng);
    }
    if (Number.isFinite(club.lat) && Number.isFinite(club.lng)) {
      persistClubCoordinates(club);
    } else {
      restoreClubCoordinates(club);
    }
    return club;
  };

  const restorePersistedLocation = () => {
    const stored = loadStoredLocation();
    if (!stored) {
      return false;
    }
    const { latitude, longitude } = stored;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return false;
    }
    applyUserLocation({
      latitude,
      longitude,
      label: stored.label || 'Votre position',
      query: stored.query || '',
      source: stored.source || 'stored',
    });
    return true;
  };

  const init = () => {
    fetch(DATA_URL, { headers: { Accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Impossible de charger la liste des clubs (HTTP ${response.status})`);
        }
        return response.json();
      })
      .then((data) => {
        state.clubs = (Array.isArray(data) ? data : []).map(hydrateClub);
        if (!restorePersistedLocation()) {
          const meta = applyFilters({ silentStatus: true });
          updateSearchStatus(meta);
        }
      })
      .catch(() => {
        resultsEl.innerHTML =
          '<p class="clubs-error">Impossible de charger la liste des clubs pour le moment. Veuillez réessayer plus tard.</p>';
      });

    bindEvents();
  };

  init();
})();
