/**
 * Clubs directory interactions for echecs92.fr.
 * Provides client-side search, filtering, sorting, map display (Leaflet)
 * and optional geolocation to surface nearby clubs.
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
  const geoButton = document.getElementById('clubs-geoloc');
  const toggleMapButton = document.getElementById('clubs-toggle-map');
  const filterButtons = Array.from(document.querySelectorAll('.filter-pill'));
  const mapContainer = document.getElementById('clubs-map');
  const totalCounter = document.createElement('p');

  if (!resultsEl) {
    return;
  }

  totalCounter.className = 'clubs-total';
  totalCounter.setAttribute('aria-live', 'polite');
  resultsEl.before(totalCounter);

  const state = {
    clubs: [],
    filtered: [],
    activeTags: new Set(),
    query: '',
    sort: 'name',
    userLocation: null,
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
      renderResults();
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
    applyFilters(); // ensures sorting updates with distances
  };

  const applyFilters = () => {
    const query = normalise(state.query);
    const activeTags = state.activeTags;

    const filtered = state.clubs.filter((club) => {
      if (activeTags.size && !club.tags.some((tag) => activeTags.has(tag))) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = club._search;
      return haystack.includes(query);
    });

    const sorter = getSorter(state.sort);
    filtered.sort(sorter);

    state.filtered = filtered;
    renderResults();
    refreshMapMarkers();
  };

  const getSorter = (sortKey) => {
    switch (sortKey) {
      case 'commune':
        return (a, b) => a.commune.localeCompare(b.commune, 'fr', { sensitivity: 'base' });
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
    totalCounter.textContent = `${state.filtered.length} club${
      state.filtered.length > 1 ? 's' : ''
    } dans les Hauts-de-Seine`;

    if (!state.filtered.length) {
      resultsEl.innerHTML =
        '<p class="clubs-empty">Aucun club ne correspond à votre recherche pour le moment.</p>';
      return;
    }

    const fragment = document.createDocumentFragment();
    state.filtered.forEach((club) => {
      fragment.appendChild(createClubCard(club));
    });

    resultsEl.innerHTML = '';
    resultsEl.appendChild(fragment);
  };

  const createClubCard = (club) => {
    const article = document.createElement('article');
    article.className = 'club-card';
    article.dataset.clubId = club.id;
    article.setAttribute('role', 'listitem');

    const header = document.createElement('header');
    header.className = 'club-card__header';
    const title = document.createElement('h2');
    title.textContent = club.name;
    header.appendChild(title);

    const meta = document.createElement('p');
    meta.className = 'club-card__meta';
    const parts = [];
    if (club.commune) {
      parts.push(club.commune);
    }
    const distanceLabel = getDistanceLabel(club);
    if (distanceLabel) {
      parts.push(distanceLabel);
    }
    meta.textContent = parts.join(' · ');
    header.appendChild(meta);

    if (club.tags && club.tags.length) {
      const tags = document.createElement('ul');
      tags.className = 'club-card__tags';
      club.tags.forEach((tag) => {
        const badge = document.createElement('li');
        badge.dataset.tag = tag;
        switch (tag) {
          case 'debutants':
            badge.textContent = 'Débutants bienvenus';
            break;
          case 'jeunes':
            badge.textContent = 'Jeunes';
            break;
          case 'adultes':
            badge.textContent = 'Adultes';
            break;
          case 'pmr':
            badge.textContent = 'Accessible PMR';
            break;
          default:
            badge.textContent = tag;
        }
        tags.appendChild(badge);
      });
      header.appendChild(tags);
    }

    article.appendChild(header);

    if (club.address) {
      const address = document.createElement('p');
      address.className = 'club-card__address';
      address.textContent = club.address;
      article.appendChild(address);
    }

    const infoList = document.createElement('dl');
    infoList.className = 'club-card__details';

    const addItem = (term, value, options = {}) => {
      if (!value) {
        return;
      }
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      if (options.isLink) {
        const link = document.createElement('a');
        link.href = value;
        link.rel = 'noopener';
        link.target = '_blank';
        link.textContent = options.label || value;
        dd.appendChild(link);
      } else if (options.isMail) {
        const link = document.createElement('a');
        link.href = `mailto:${value}`;
        link.textContent = value;
        dd.appendChild(link);
      } else if (options.isPhone) {
        const formatted = formatPhone(value) || value;
        const cleaned = value.replace(/[^\d+]/g, '');
        const link = document.createElement('a');
        link.href = `tel:${cleaned || value}`;
        link.textContent = formatted;
        dd.appendChild(link);
      } else {
        dd.textContent = value;
      }
      infoList.appendChild(dt);
      infoList.appendChild(dd);
    };

    addItem('Président·e', club.president);
    addItem('Email', club.email, { isMail: true });
    addItem('Téléphone', club.phone, { isPhone: true });
    addItem('Site web', club.site, { isLink: true, label: 'Voir le site' });
    addItem('Fiche FFE', club.fiche_ffe, { isLink: true, label: 'Voir la fiche' });
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
      addItem('Licenciés', licenseInfo.join(' · '));
    }
    addItem('Notes', club.notes);

    article.appendChild(infoList);

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

    const mapAction = document.createElement('button');
    mapAction.type = 'button';
    mapAction.className = 'btn btn-secondary';
    mapAction.textContent = 'Voir sur la carte';
    mapAction.addEventListener('click', () => focusOnMap(club));
    actions.appendChild(mapAction);

    article.appendChild(actions);

    return article;
  };

  const focusClubCard = (clubId) => {
    const target = resultsEl.querySelector(`[data-club-id="${clubId}"]`);
    if (!target) {
      return;
    }
    target.classList.add('club-card--highlight');
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      target.classList.remove('club-card--highlight');
    }, 1500);
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

  const handleFilterClick = (event) => {
    const btn = event.currentTarget;
    const tag = btn.dataset.tag;
    if (!tag) {
      return;
    }
    if (state.activeTags.has(tag)) {
      state.activeTags.delete(tag);
      btn.setAttribute('aria-pressed', 'false');
    } else {
      state.activeTags.add(tag);
      btn.setAttribute('aria-pressed', 'true');
    }
    applyFilters();
  };

  const handleSortChange = (event) => {
    state.sort = event.target.value;
    if (state.sort === 'distance' && !state.userLocation) {
      requestGeolocation();
    } else {
      applyFilters();
    }
  };

  const requestGeolocation = () => {
    if (!navigator.geolocation) {
      geoButton.disabled = true;
      geoButton.textContent = 'Géolocalisation indisponible';
      return;
    }

    geoButton.disabled = true;
    geoButton.textContent = 'Recherche…';
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.userLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        geoButton.textContent = 'Près de moi';
        geoButton.disabled = false;
        refreshDistances();
      },
      () => {
        geoButton.textContent = 'Autoriser la localisation';
        geoButton.disabled = false;
        if (state.sort === 'distance') {
          state.sort = 'name';
          if (sortSelect) {
            sortSelect.value = 'name';
          }
          applyFilters();
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
      }
    );
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
    filterButtons.forEach((btn) => btn.addEventListener('click', handleFilterClick));
    sortSelect?.addEventListener('change', handleSortChange);
    geoButton?.addEventListener('click', requestGeolocation);
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
      [club.name, club.commune, club.address, club.notes, club.publics].filter(Boolean).join(' ')
    );
    if (!Array.isArray(club.tags)) {
      club.tags = [];
    }
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
