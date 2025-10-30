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

  const searchInput = document.getElementById('clubs-search');
  const resultsEl = document.getElementById('clubs-results');
  const sortSelect = document.getElementById('clubs-sort');
  const locationInput = document.getElementById('clubs-location');
  const locationButton = document.getElementById('clubs-location-apply');
  const locationStatus = document.getElementById('clubs-location-status');
  const toggleMapButton = document.getElementById('clubs-toggle-map');
  const mapContainer = document.getElementById('clubs-map');
  const totalCounter = document.createElement('p');

  if (!resultsEl) {
    return;
  }

  totalCounter.className = 'clubs-total';
  totalCounter.setAttribute('aria-live', 'polite');
  resultsEl.before(totalCounter);

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

  const state = {
    clubs: [],
    filtered: [],
    query: '',
    sort: 'name',
    userLocation: null,
    userLocationLabel: '',
    lastLocationQuery: '',
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
    if (typeof club.distanceKm !== 'number') {
      return null;
    }
    const round = club.distanceKm < 10 ? club.distanceKm.toFixed(1) : Math.round(club.distanceKm);
    return `${round} km de vous`;
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
    if (!state.userLocation) {
      state.clubs.forEach((club) => {
        delete club.distanceKm;
      });
      applyFilters();
      return;
    }

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
  };

  const applyFilters = () => {
    const query = normalise(state.query);

    const filtered = state.clubs.filter((club) => {
      if (!query) {
        return true;
      }
      return club._search.includes(query);
    });

    const sorter = getSorter(state.sort);
    filtered.sort(sorter);

    state.filtered = filtered;
    renderResults();
    refreshMapMarkers();
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

  const renderResults = () => {
    const suffix = state.userLocationLabel
      ? ` · distances depuis ${state.userLocationLabel}`
      : '';
    totalCounter.textContent = `${state.filtered.length} club${
      state.filtered.length > 1 ? 's' : ''
    } dans les Hauts-de-Seine${suffix}`;

    if (!state.filtered.length) {
      resultsEl.innerHTML =
        '<p class="clubs-empty">Aucun club ne correspond à votre recherche pour le moment.</p>';
      return;
    }

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
  };

  const setCardExpansion = (article, expand, options = {}) => {
    const toggle = article.querySelector('.club-card__toggle');
    const body = article.querySelector('.club-card__body');
    if (!toggle || !body) {
      return;
    }
    const { silent = false } = options;
    const currentlyExpanded = toggle.getAttribute('aria-expanded') === 'true';
    const nextState = typeof expand === 'boolean' ? expand : !currentlyExpanded;
    toggle.setAttribute('aria-expanded', nextState ? 'true' : 'false');
    body.hidden = !nextState;
    if (nextState && !silent) {
      article.classList.add('club-card--highlight');
      window.setTimeout(() => {
        article.classList.remove('club-card--highlight');
      }, 900);
    }
  };

  const createClubCard = (club) => {
    const article = document.createElement('article');
    article.className = 'club-card';
    article.dataset.clubId = club.id;
    article.setAttribute('role', 'listitem');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'club-card__toggle';
    toggle.setAttribute('aria-expanded', 'false');
    const bodyId = `club-details-${club.id}`;
    toggle.setAttribute('aria-controls', bodyId);

    const header = document.createElement('div');
    header.className = 'club-card__header';
    const title = document.createElement('h2');
    title.textContent = club.name;
    header.appendChild(title);

    const metaParts = [];
    if (club.commune) {
      metaParts.push(club.commune);
    }
    const distanceLabel = getDistanceLabel(club);
    if (distanceLabel) {
      metaParts.push(distanceLabel);
    }
    if (metaParts.length) {
      const meta = document.createElement('p');
      meta.className = 'club-card__meta';
      meta.textContent = metaParts.join(' · ');
      header.appendChild(meta);
    }

    if (Number.isFinite(club.totalLicenses) && club.totalLicenses > 0) {
      const stats = document.createElement('span');
      stats.className = 'club-card__stats';
      stats.textContent = `${club.totalLicenses} licencié${
        club.totalLicenses > 1 ? 's' : ''
      }`;
      header.appendChild(stats);
    }

    toggle.appendChild(header);

    const icon = document.createElement('span');
    icon.className = 'club-card__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '▾';
    toggle.appendChild(icon);

    toggle.addEventListener('click', () => {
      setCardExpansion(article);
    });

    article.appendChild(toggle);

    const body = document.createElement('div');
    body.className = 'club-card__body';
    body.hidden = true;
    body.id = bodyId;

    if (club.address) {
      const address = document.createElement('p');
      address.className = 'club-card__address';
      address.textContent = club.address;
      body.appendChild(address);
    }

    const infoList = document.createElement('ul');
    infoList.className = 'club-card__details';

    const addItem = (term, value, options = {}) => {
      if (!value) {
        return;
      }
      const item = document.createElement('li');
      const label = document.createElement('span');
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
        text.textContent = value;
        item.appendChild(text);
      }
      infoList.appendChild(item);
    };

    addItem('Président·e', club.president);
    addItem('Email', club.email, { isMail: true });
    addItem('Téléphone', club.phone, { isPhone: true });
    addItem('Publics', club.publics);
    addItem('Horaires', club.hours);
    addItem('Tarifs', club.tarifs);
    if (club.licenses && (club.licenses.A || club.licenses.B)) {
      const licenseInfo = [];
      if (club.licenses.A) {
        licenseInfo.push(`Licence A : ${club.licenses.A}`);
      }
      if (club.licenses.B) {
        licenseInfo.push(`Licence B : ${club.licenses.B}`);
      }
      addItem('Licences', licenseInfo.join(' · '));
    }
    addItem('Site web', club.site, { isLink: true, label: 'Ouvrir le site' });
    addItem('Fiche FFE', club.fiche_ffe, { isLink: true, label: 'Voir la fiche FFE' });

    if (infoList.childElementCount) {
      body.appendChild(infoList);
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
      body.appendChild(actions);
    }

    article.appendChild(body);

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

  const handleSearchInput = (event) => {
    state.query = event.target.value.trim();
    applyFilters();
  };

  const handleSortChange = (event) => {
    const selected = event.target.value;
    if (selected === 'distance' && !state.userLocation) {
      setLocationStatus('Indiquez votre ville pour trier par distance.', 'info');
      state.sort = 'name';
      if (sortSelect) {
        sortSelect.value = 'name';
      }
      applyFilters();
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

  const handleLocationSubmit = () => {
    if (!locationInput) {
      return;
    }
    const raw = locationInput.value.trim();
    const button = locationButton;
    const baseLabel = button?.dataset.label || button?.textContent || 'Définir';
    if (button) {
      button.dataset.label = baseLabel;
    }
    if (!raw) {
      state.userLocation = null;
      state.userLocationLabel = '';
      state.lastLocationQuery = '';
      if (state.sort === 'distance') {
        state.sort = 'name';
        if (sortSelect) {
          sortSelect.value = 'name';
        }
      }
      setLocationStatus('Localisation effacée.', 'info');
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.label || 'Définir';
      }
      refreshDistances();
      return;
    }

    if (state.userLocation && raw === state.lastLocationQuery) {
      setLocationStatus(`Distances calculées depuis ${state.userLocationLabel}.`, 'success');
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.label || 'Définir';
      }
      return;
    }

    setLocationStatus('Recherche en cours…', 'info');
    if (button) {
      button.disabled = true;
      button.textContent = 'Recherche…';
    }
    geocodePlace(raw)
      .then(({ latitude, longitude, label }) => {
        state.userLocation = { latitude, longitude };
        state.userLocationLabel = label;
        state.lastLocationQuery = raw;
        setLocationStatus(`Distances calculées depuis ${label}.`, 'success');
        if (button) {
          button.disabled = false;
          button.textContent = button.dataset.label || 'Définir';
        }
        refreshDistances();
      })
      .catch(() => {
        state.userLocation = null;
        state.userLocationLabel = '';
        state.lastLocationQuery = '';
        setLocationStatus(
          'Localisation introuvable. Essayez un autre nom de ville ou code postal.',
          'error'
        );
        if (state.sort === 'distance') {
          state.sort = 'name';
          if (sortSelect) {
            sortSelect.value = 'name';
          }
        }
        if (button) {
          button.disabled = false;
          button.textContent = button.dataset.label || 'Définir';
        }
        refreshDistances();
      });
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
    searchInput?.addEventListener('input', handleSearchInput);
    locationButton?.addEventListener('click', handleLocationSubmit);
    locationInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleLocationSubmit();
      }
    });
    sortSelect?.addEventListener('change', handleSortChange);
    toggleMapButton?.addEventListener('click', toggleMapVisibility);

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
      ]
        .filter(Boolean)
        .join(' ')
    );
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
        state.filtered = state.clubs.slice().sort(getSorter(state.sort));
        renderResults();
      })
      .catch(() => {
        resultsEl.innerHTML =
          '<p class="clubs-error">Impossible de charger la liste des clubs pour le moment. Veuillez réessayer plus tard.</p>';
      });

    bindEvents();
  };

  init();
})();
