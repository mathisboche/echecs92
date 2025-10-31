/**
 * Clubs directory interactions for echecs92.fr.
 * Provides client-side search, sorting and distance estimates
 * based on a user-supplied city or postcode.
 */
(function () {
  const DATA_URL = '/wp-content/themes/echecs92-child/assets/data/clubs.json';
  const STORAGE_PREFIX = 'echecs92-club-geo:';
  const GEOCODE_BASE_URL = 'https://nominatim.openstreetmap.org/search';
  const GEOCODE_MIN_DELAY = 1200; // ms between requests (respect Nominatim policy)
  const SEARCH_DELAY = 420;
  const VISIBLE_RESULTS_DEFAULT = 5;
  const POSTAL_COORDINATES = {
    '92000': { label: 'Nanterre', lat: 48.8927825, lng: 2.2073652 },
    '92100': { label: 'Boulogne-Billancourt', lat: 48.837494, lng: 2.2378546 },
    '92110': { label: 'Clichy', lat: 48.9027893, lng: 2.3093052 },
    '92120': { label: 'Montrouge', lat: 48.8150655, lng: 2.3163712 },
    '92130': { label: 'Issy-les-Moulineaux', lat: 48.8233607, lng: 2.2653052 },
    '92140': { label: 'Clamart', lat: 48.7959696, lng: 2.2549138 },
    '92150': { label: 'Suresnes', lat: 48.8711349, lng: 2.2217833 },
    '92160': { label: 'Antony', lat: 48.750728, lng: 2.2987872 },
    '92170': { label: 'Vanves', lat: 48.8219675, lng: 2.2901321 },
    '92190': { label: 'Meudon', lat: 48.8097395, lng: 2.229958 },
    '92200': { label: 'Neuilly-sur-Seine', lat: 48.8800801, lng: 2.257544 },
    '92210': { label: 'Saint-Cloud', lat: 48.8439913, lng: 2.2117806 },
    '92220': { label: 'Bagneux', lat: 48.7981949, lng: 2.3110192 },
    '92230': { label: 'Gennevilliers', lat: 48.9287242, lng: 2.2963202 },
    '92240': { label: 'Malakoff', lat: 48.8187167, lng: 2.3008083 },
    '92250': { label: 'La Garenne-Colombes', lat: 48.9070703, lng: 2.2445272 },
    '92260': { label: 'Fontenay-aux-Roses', lat: 48.7908946, lng: 2.2867846 },
    '92270': { label: 'Bois-Colombes', lat: 48.9165336, lng: 2.2690732 },
    '92290': { label: 'Châtenay-Malabry', lat: 48.7697842, lng: 2.2650969 },
    '92300': { label: 'Levallois-Perret', lat: 48.8935077, lng: 2.2886109 },
    '92310': { label: 'Sèvres', lat: 48.822245, lng: 2.2117665 },
    '92320': { label: 'Châtillon', lat: 48.8044684, lng: 2.2893633 },
    '92330': { label: 'Sceaux', lat: 48.7784655, lng: 2.2893399 },
    '92340': { label: 'Bourg-la-Reine', lat: 48.7794333, lng: 2.316237 },
    '92350': { label: 'Le Plessis-Robinson', lat: 48.7797706, lng: 2.2581995 },
    '92370': { label: 'Chaville', lat: 48.8090026, lng: 2.1924797 },
    '92380': { label: 'Garches', lat: 48.8469069, lng: 2.1893546 },
    '92400': { label: 'Courbevoie', lat: 48.9010419, lng: 2.266358 },
    '92410': { label: "Ville-d'Avray", lat: 48.8214672, lng: 2.1763211 },
    '92420': { label: 'Vaucresson', lat: 48.8364225, lng: 2.1506469 },
    '92430': { label: 'Marnes-la-Coquette', lat: 48.8287849, lng: 2.1646468 },
    '92500': { label: 'Rueil-Malmaison', lat: 48.8718031, lng: 2.1801931 },
    '92600': { label: 'Asnières-sur-Seine', lat: 48.9137552, lng: 2.288062 },
    '92700': { label: 'Colombes', lat: 48.9223905, lng: 2.2521192 },
    '92800': { label: 'Puteaux', lat: 48.8826865, lng: 2.2410641 },
  };
  let generatedIdCounter = 0;

  const searchInput = document.getElementById('clubs-search');
  const resultsEl = document.getElementById('clubs-results');
  const locationInput = document.getElementById('clubs-location');
  const locationApplyButton = document.getElementById('clubs-location-apply');
  const locationStatus = document.getElementById('clubs-location-status');
  const searchButton = document.getElementById('clubs-search-btn');
  const resetButton = document.getElementById('clubs-reset-btn');
  const searchStatus = document.getElementById('clubs-search-status');
  const geolocButton = document.getElementById('clubs-use-geoloc');
  const locationClearButton = document.getElementById('clubs-location-clear');
  const moreButton = document.getElementById('clubs-more-button');
  const optionsDetails = document.getElementById('clubs-options');
  const totalCounter = document.createElement('p');

  if (!resultsEl) {
    return;
  }

  totalCounter.className = 'clubs-total';
  totalCounter.setAttribute('aria-live', 'polite');
  resultsEl.before(totalCounter);
  resultsEl.setAttribute('data-loading-label', 'Recherche en cours…');

  let searchTimer = null;
  let loadingTimer = null;
  const loadingReasons = new Set();
  let loadingActive = false;
  const deriveLoadingLabel = () => {
    if (loadingReasons.has('distance')) {
      return 'Calcul des distances…';
    }
    if (loadingReasons.has('geocode')) {
      return 'Localisation en cours…';
    }
    return 'Recherche en cours…';
  };

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

  const withVisibilityNote = (message) => {
    if (!message) {
      return message;
    }
    const maxVisible = state.visibleCount <= 0 ? 0 : Math.min(state.visibleCount, state.filtered.length);
    if (state.filtered.length > maxVisible && maxVisible > 0) {
      const proximityMode = Boolean(state.userLocation);
      if (maxVisible === 1) {
        return `${message} Le club le plus ${proximityMode ? 'proche' : 'pertinent'} est affiché en premier.`;
      }
      return `${message} Les ${maxVisible} clubs les plus ${proximityMode ? 'proches' : 'pertinents'} sont affichés en premier.`;
    }
    return message;
  };

  const updateSearchStatus = (meta) => {
    if (!meta) {
      const total = state.filtered.length;
      const message = `${total} club${total > 1 ? 's' : ''} affiché${total > 1 ? 's' : ''}.`;
      setSearchStatus(withVisibilityNote(message), 'info');
      return;
    }

    const rawQuery = (meta.query || '').trim();

    if (!rawQuery && state.userLocation) {
      const reference = state.distanceReference || 'votre position';
      const baseMessage = `Clubs triés par distance depuis ${reference}.`;
      setSearchStatus(withVisibilityNote(baseMessage), 'info');
      return;
    }

    if (!rawQuery) {
      const total = state.filtered.length;
      const baseMessage = `${total} club${total > 1 ? 's' : ''} dans les Hauts-de-Seine.`;
      setSearchStatus(withVisibilityNote(baseMessage), 'info');
      return;
    }

    if (meta.matches > 0) {
      const label =
        meta.matches === 1
          ? `1 club correspond à "${rawQuery}".`
          : `${meta.matches} clubs correspondent à "${rawQuery}".`;
      setSearchStatus(withVisibilityNote(label), 'info');
      return;
    }

    setSearchStatus(`Aucun club ne correspond à "${rawQuery}".`, 'error');
  };

  const setLoading = (isLoading, reason = 'generic') => {
    if (isLoading) {
      loadingReasons.add(reason);
    } else {
      loadingReasons.delete(reason);
    }
    const shouldActivate = loadingReasons.size > 0;
    const loadingLabel = deriveLoadingLabel();
    window.clearTimeout(loadingTimer);
    if (shouldActivate) {
      if (resultsEl) {
        resultsEl.setAttribute('data-loading-label', loadingLabel);
      }
      if (searchButton) {
        searchButton.dataset.label = searchButton.dataset.label || searchButton.textContent;
        searchButton.textContent = loadingLabel;
        searchButton.disabled = true;
      }
      if (!loadingActive) {
        if (resultsEl) {
          resultsEl.classList.add('is-loading');
        }
        loadingActive = true;
      }
    } else if (loadingActive) {
      loadingTimer = window.setTimeout(() => {
        resultsEl?.classList.remove('is-loading');
        resultsEl?.removeAttribute('data-loading-label');
        if (searchButton) {
          searchButton.disabled = false;
          if (searchButton.dataset.label) {
            searchButton.textContent = searchButton.dataset.label;
          }
        }
        loadingActive = false;
      }, 150);
    }
  };

  const scheduleDistanceRelease = (delay = 200) => {
    window.clearTimeout(state.distanceReleaseTimer);
    state.distanceReleaseTimer = window.setTimeout(() => {
      endDistanceLoading(false);
    }, delay);
  };

  const scheduleDistanceFallback = () => {
    window.clearTimeout(state.distanceFallbackTimer);
    state.distanceFallbackTimer = window.setTimeout(() => {
      endDistanceLoading(true);
    }, 6500);
  };

  const startDistanceLoading = (options = {}) => {
    const { onComplete = null } = options || {};
    state.distanceLoading = true;
    state.activeDistanceRequest += 1;
    state.pendingDistanceClubIds.clear();
    state.distanceLoadingCallback = typeof onComplete === 'function' ? onComplete : null;
    window.clearTimeout(state.distanceReleaseTimer);
    state.distanceReleaseTimer = null;
    window.clearTimeout(state.distanceFallbackTimer);
    state.distanceFallbackTimer = null;
    setLoading(true, 'distance');
    scheduleDistanceFallback();
    return state.activeDistanceRequest;
  };

  const endDistanceLoading = (force = false) => {
    if (!state.distanceLoading) {
      return;
    }
    if (
      !force &&
      (state.pendingDistanceClubIds.size > 0 || state.awaitingDistanceRefresh || state.distanceRefreshScheduled)
    ) {
      return;
    }
    state.distanceLoading = false;
    state.pendingDistanceClubIds.clear();
    state.awaitingDistanceRefresh = false;
    window.clearTimeout(state.distanceReleaseTimer);
    state.distanceReleaseTimer = null;
    window.clearTimeout(state.distanceFallbackTimer);
    state.distanceFallbackTimer = null;
    setLoading(false, 'distance');
    if (typeof state.distanceLoadingCallback === 'function') {
      const callback = state.distanceLoadingCallback;
      state.distanceLoadingCallback = null;
      try {
        callback();
      } catch (err) {
        // Ignored – UX callback failures should not break flow
      }
    } else {
      state.distanceLoadingCallback = null;
    }
  };

  const registerPendingDistanceClub = (clubId, requestId) => {
    if (!state.distanceLoading || state.activeDistanceRequest !== requestId) {
      return;
    }
    state.pendingDistanceClubIds.add(`${requestId}:${clubId}`);
  };

  const markResolvedDistanceClub = (clubId, requestId) => {
    if (!requestId) {
      return;
    }
    const key = `${requestId}:${clubId}`;
    if (!state.pendingDistanceClubIds.has(key)) {
      return;
    }
    state.pendingDistanceClubIds.delete(key);
    if (state.distanceLoading && state.activeDistanceRequest === requestId && state.pendingDistanceClubIds.size === 0) {
      scheduleDistanceRelease(220);
    }
  };

  const ensureDistanceLoadingProgress = () => {
    if (
      state.distanceLoading &&
      state.pendingDistanceClubIds.size === 0 &&
      !state.awaitingDistanceRefresh &&
      !state.distanceRefreshScheduled
    ) {
      scheduleDistanceRelease(180);
    }
  };

  const state = {
    clubs: [],
    filtered: [],
    query: '',
    pendingQuery: searchInput ? searchInput.value.trim() : '',
    userLocation: null,
    distanceReference: '',
    lastSearchMeta: null,
    visibleCount: VISIBLE_RESULTS_DEFAULT,
    geocodingQueue: [],
    geocodingTimer: null,
    geocodingActive: false,
    distanceLoading: false,
    activeDistanceRequest: 0,
    pendingDistanceClubIds: new Set(),
    distanceReleaseTimer: null,
    distanceFallbackTimer: null,
    distanceRefreshScheduled: false,
    distanceRefreshOptions: null,
    distanceLoadingCallback: null,
    awaitingDistanceRefresh: false,
  };

  const normalise = (value) =>
    (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const normaliseForMatch = (value) =>
    normalise(value)
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const normaliseCommuneKey = (value) => normalise(value).replace(/[^a-z0-9]/g, '');

  const COMMUNE_COORDINATES_BY_NAME = Object.entries(POSTAL_COORDINATES).reduce(
    (acc, [postalCode, info]) => {
      const key = normaliseCommuneKey(info.label);
      if (key && !acc[key]) {
        acc[key] = { postalCode, lat: info.lat, lng: info.lng, label: info.label };
      }
      return acc;
    },
    {}
  );

  const slugify = (value) => {
    const base = normalise(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (base) {
      return base;
    }
    generatedIdCounter += 1;
    return `club-${generatedIdCounter}`;
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
      const parts = result.full.split(',').map((part) => part.trim()).filter(Boolean);
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

  const getPostalCoordinates = (postalCode) => {
    const code = (postalCode || '').toString().trim();
    if (!code) {
      return null;
    }
    const entry = POSTAL_COORDINATES[code];
    if (!entry) {
      return null;
    }
    return { postalCode: code, lat: entry.lat, lng: entry.lng, label: entry.label };
  };

  const getCommuneCoordinatesByName = (value) => {
    const key = normaliseCommuneKey(value);
    if (!key) {
      return null;
    }
    const entry = COMMUNE_COORDINATES_BY_NAME[key];
    if (!entry) {
      return null;
    }
    return {
      postalCode: entry.postalCode,
      lat: entry.lat,
      lng: entry.lng,
      label: entry.label,
    };
  };

  const resolveClubReferenceCoordinates = (club) => {
    if (!club || typeof club !== 'object') {
      return null;
    }
    if (club._referenceCoords) {
      return club._referenceCoords;
    }
    const postalCandidates = [];
    if (club.postalCode) {
      postalCandidates.push(club.postalCode);
    }
    if (Array.isArray(club._postalCodes)) {
      club._postalCodes.forEach((code) => {
        if (code && !postalCandidates.includes(code)) {
          postalCandidates.push(code);
        }
      });
    }
    for (let i = 0; i < postalCandidates.length; i += 1) {
      const coords = getPostalCoordinates(postalCandidates[i]);
      if (coords) {
        club._referenceCoords = coords;
        return coords;
      }
    }
    if (club.commune) {
      const coords = getCommuneCoordinatesByName(club.commune);
      if (coords) {
        club._referenceCoords = coords;
        return coords;
      }
    }
    return null;
  };

  const lookupLocalCoordinates = (query) => {
    if (!query) {
      return null;
    }
    const raw = query.toString();
    const postalMatches = raw.match(/\b\d{5}\b/g);
    if (postalMatches) {
      for (let i = 0; i < postalMatches.length; i += 1) {
        const coords = getPostalCoordinates(postalMatches[i]);
        if (coords) {
          return coords;
        }
      }
    }
    const nameCandidates = new Set();
    nameCandidates.add(raw);
    const formatted = formatCommune(raw);
    if (formatted) {
      nameCandidates.add(formatted);
    }
    raw
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        nameCandidates.add(part);
        const formattedPart = formatCommune(part);
        if (formattedPart) {
          nameCandidates.add(formattedPart);
        }
      });
    for (const candidate of nameCandidates) {
      const coords = getCommuneCoordinatesByName(candidate);
      if (coords) {
        return coords;
      }
    }
    return null;
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
    const id = raw.id || slugify(slugSource || `club-${generatedIdCounter + 1}`);

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
      lat: raw.lat != null ? Number.parseFloat(raw.lat) : null,
      lng: raw.lng != null ? Number.parseFloat(raw.lng) : null,
      licenses: {
        A: toNumber(raw.licences_a ?? raw.licenses_a ?? raw.license_a),
        B: toNumber(raw.licences_b ?? raw.licenses_b ?? raw.license_b),
      },
      postalCode,
    };
  };

  const locationFallbackCache = new Map();

  const normaliseQueryKey = (value) => normalise(value).replace(/\s+/g, ' ').trim();

  const isLikelyLocationQuery = (value) => {
    if (!value) {
      return false;
    }
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      return false;
    }
    const digitsCandidate = trimmed.replace(/\s/g, '');
    if (/^\d{2,5}$/.test(digitsCandidate)) {
      return true;
    }
    const ascii = trimmed
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s'’\-]/gi, '')
      .trim();
    if (!ascii) {
      return false;
    }
    const letters = ascii.replace(/[^a-z]/gi, '');
    if (letters.length < 3) {
      return false;
    }
    return true;
  };

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

  const getDistanceInfo = (club) => {
    if (!state.userLocation || typeof club.distanceKm !== 'number') {
      return null;
    }
    const round = club.distanceKm < 10 ? club.distanceKm.toFixed(1) : Math.round(club.distanceKm);
    const label = `${round} km`;
    const reference = state.distanceReference || 'votre position';
    const context = reference
      ? `Depuis ${reference.charAt(0).toUpperCase()}${reference.slice(1)}`
      : 'Depuis votre position';
    return { label, context };
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

  const queueGeocoding = (club, options = {}) => {
    const { track = false, requestId = null } = options;
    const resolvedRequestId = track ? requestId ?? state.activeDistanceRequest : null;

    if (track && resolvedRequestId != null) {
      registerPendingDistanceClub(club.id, resolvedRequestId);
    }

    if (club.lat != null && club.lng != null) {
      if (track && resolvedRequestId != null) {
        markResolvedDistanceClub(club.id, resolvedRequestId);
      }
      ensureDistanceLoadingProgress();
      return Promise.resolve(club);
    }

    if (club._geocodePromise) {
      if (track && resolvedRequestId != null) {
        club._geocodeTracking = Array.isArray(club._geocodeTracking) ? club._geocodeTracking : [];
        if (!club._geocodeTracking.includes(resolvedRequestId)) {
          club._geocodeTracking.push(resolvedRequestId);
          club._geocodePromise.finally(() => {
            markResolvedDistanceClub(club.id, resolvedRequestId);
          });
        }
      }
      return club._geocodePromise;
    }

    const promise = new Promise((resolve) => {
      state.geocodingQueue.push({ club, resolve, track, requestId: resolvedRequestId });
      processGeocodingQueue();
    });

    club._geocodePromise = promise;
    if (track && resolvedRequestId != null) {
      club._geocodeTracking = Array.isArray(club._geocodeTracking) ? club._geocodeTracking : [];
      if (!club._geocodeTracking.includes(resolvedRequestId)) {
        club._geocodeTracking.push(resolvedRequestId);
        promise.finally(() => {
          markResolvedDistanceClub(club.id, resolvedRequestId);
        });
      }
    }
    return promise;
  };

  const processGeocodingQueue = () => {
    if (state.geocodingActive || !state.geocodingQueue.length) {
      return;
    }

    const { club, resolve, track = false, requestId = null } = state.geocodingQueue.shift();
    state.geocodingActive = true;

    const finish = (success) => {
      if (!success) {
        state.geocodeFailures = (state.geocodeFailures || 0) + 1;
        state.geocodeLastFailure = Date.now();
      }
      if (track && requestId != null) {
        markResolvedDistanceClub(club.id, requestId);
      }
      state.geocodingActive = false;
      state.geocodingTimer = window.setTimeout(() => {
        state.geocodingTimer = null;
        processGeocodingQueue();
      }, GEOCODE_MIN_DELAY);
      club._geocodePromise = null;
      if (Array.isArray(club._geocodeTracking)) {
        const index = club._geocodeTracking.indexOf(requestId);
        if (index >= 0) {
          club._geocodeTracking.splice(index, 1);
        }
        if (!club._geocodeTracking.length) {
          delete club._geocodeTracking;
        }
      }
      resolve(success ? club : null);
      ensureDistanceLoadingProgress();
    };

    const now = Date.now();
    const failureCooldown = 45000;

    if (!navigator.onLine) {
      finish(false);
      return;
    }

    if (state.geocodeFailures && now - (state.geocodeLastFailure || 0) < failureCooldown) {
      finish(false);
      state.geocodingTimer = window.setTimeout(() => {
        state.geocodingTimer = null;
        processGeocodingQueue();
      }, failureCooldown);
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
        scheduleDistanceRefresh({ preserveVisibility: true });
      })
      .catch(() => finish(false));
  };

  const refreshDistances = (options = {}) => {
    let preserveVisibility = false;
    if (typeof options === 'boolean') {
      preserveVisibility = options;
    } else if (options && typeof options === 'object') {
      preserveVisibility = Boolean(options.preserveVisibility);
    }

    if (
      state.userLocation &&
      Number.isFinite(state.userLocation.latitude) &&
      Number.isFinite(state.userLocation.longitude)
    ) {
      const { latitude, longitude } = state.userLocation;
      state.clubs.forEach((club) => {
        const coords = resolveClubReferenceCoordinates(club);
        if (!coords) {
          delete club.distanceKm;
          return;
        }
        club.distanceKm = haversineKm(latitude, longitude, coords.lat, coords.lng);
      });
      applyFilters({ preserveVisibility });
      ensureDistanceLoadingProgress();
      return;
    }

    state.clubs.forEach((club) => {
      delete club.distanceKm;
    });
    applyFilters({ preserveVisibility });
    ensureDistanceLoadingProgress();
  };

  function scheduleDistanceRefresh(options = {}) {
    const mergedOptions =
      typeof options === 'boolean'
        ? { preserveVisibility: options, trackGeocodes: false }
        : { ...(options || {}) };
    if (typeof mergedOptions.trackGeocodes !== 'boolean') {
      mergedOptions.trackGeocodes = false;
    }
    state.distanceRefreshOptions = {
      ...(state.distanceRefreshOptions || {}),
      ...mergedOptions,
    };
    state.awaitingDistanceRefresh = true;
    if (state.distanceRefreshScheduled) {
      return;
    }
    state.distanceRefreshScheduled = true;
    window.requestAnimationFrame(() => {
      state.distanceRefreshScheduled = false;
      const opts = state.distanceRefreshOptions || {};
      state.distanceRefreshOptions = null;
      try {
        refreshDistances(opts);
      } finally {
        if (!state.distanceRefreshScheduled) {
          state.awaitingDistanceRefresh = false;
          ensureDistanceLoadingProgress();
        }
      }
    });
  }


  const applyFilters = (options = {}) => {
    const { silentStatus = false, preserveVisibility = false } = options || {};
    const rawQuery = (state.query || '').trim();
    const matchQuery = normaliseForMatch(rawQuery);

    let filtered;
    if (matchQuery) {
      filtered = state.clubs.filter((club) => {
        const haystack = club._matchHaystack || normaliseForMatch(club._search || '');
        return haystack.includes(matchQuery);
      });
    } else {
      filtered = state.clubs.slice();
    }

    if (state.userLocation && filtered.length) {
      filtered.sort((a, b) => {
        const da = typeof a.distanceKm === 'number' ? a.distanceKm : Number.POSITIVE_INFINITY;
        const db = typeof b.distanceKm === 'number' ? b.distanceKm : Number.POSITIVE_INFINITY;
        if (da !== db) {
          return da - db;
        }
        return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
      });
    } else {
      filtered.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    }

    state.filtered = filtered;
    renderResults({ resetVisible: !preserveVisibility });
    updateTotalCounter();

    const meta = {
      query: rawQuery,
      matches: filtered.length,
      total: filtered.length,
      mode: rawQuery ? 'text' : state.userLocation ? 'distance' : 'all',
    };

    state.lastSearchMeta = meta;

    if (!silentStatus) {
      updateSearchStatus(meta);
    }

    return meta;
  };

  function updateTotalCounter() {
    const total = state.filtered.length;
    const visibleCount = Math.min(state.visibleCount, total);
    const parts = [];
    if (state.userLocation && state.distanceReference) {
      const ref = state.distanceReference;
      const formattedRef = ref ? `${ref.charAt(0).toUpperCase()}${ref.slice(1)}` : 'votre position';
      parts.push(`distances depuis ${formattedRef}`);
    }
    if (total && visibleCount < total) {
      parts.push(`${visibleCount} affiché${visibleCount > 1 ? 's' : ''} en premier`);
    }
    const suffix = parts.length ? ` · ${parts.join(' · ')}` : '';
    totalCounter.textContent = `${total} club${total > 1 ? 's' : ''} dans les Hauts-de-Seine${suffix}`;
  }

  const detailBaseUrl = (() => {
    if (!resultsEl) {
      return null;
    }
    const base = resultsEl.dataset.detailBase || '';
    if (base) {
      return base;
    }
    const current = new URL(window.location.href);
    current.searchParams.delete('club');
    current.searchParams.delete('id');
    current.hash = '';
    return `${current.pathname}?club=`;
  })();

  const getClubDetailUrl = (clubId) => {
    if (!clubId) {
      return '#';
    }
    if (!detailBaseUrl) {
      return `?club=${encodeURIComponent(clubId)}`;
    }
    if (detailBaseUrl.includes('?')) {
      const url = new URL(detailBaseUrl, window.location.origin);
      const firstParam = Array.from(url.searchParams.keys())[0] || 'id';
      url.searchParams.set(firstParam, clubId);
      return url.pathname + url.search;
    }
    const base = detailBaseUrl.endsWith('/') ? detailBaseUrl : `${detailBaseUrl}/`;
    return `${base}${encodeURIComponent(clubId)}`;
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

    const distanceInfo = getDistanceInfo(club);
    if (distanceInfo) {
      const distanceNode = document.createElement('span');
      distanceNode.className = 'club-row__distance';
      distanceNode.textContent = distanceInfo.label;
      if (distanceInfo.context) {
        distanceNode.title = distanceInfo.context;
        distanceNode.setAttribute('aria-label', `${distanceInfo.label} (${distanceInfo.context})`);
      } else {
        distanceNode.setAttribute('aria-label', distanceInfo.label);
      }
      header.appendChild(distanceNode);
    }

    cardLink.appendChild(header);

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

  function renderResults({ resetVisible = false } = {}) {
    if (!resultsEl) {
      return;
    }

    if (resetVisible || state.visibleCount === 0) {
      state.visibleCount = Math.min(VISIBLE_RESULTS_DEFAULT, state.filtered.length);
    } else {
      state.visibleCount = Math.min(state.visibleCount, state.filtered.length);
      if (state.visibleCount === 0 && state.filtered.length) {
        state.visibleCount = Math.min(VISIBLE_RESULTS_DEFAULT, state.filtered.length);
      }
    }

    const awaitingDistances = state.userLocation && state.distanceLoading;

    if (!state.filtered.length && !awaitingDistances) {
      resultsEl.innerHTML =
        '<p class="clubs-empty">Aucun club ne correspond à votre recherche pour le moment.</p>';
      if (moreButton) {
        moreButton.hidden = true;
      }
      return;
    }

    if (awaitingDistances) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const visibleCount = Math.min(state.visibleCount, state.filtered.length);
    state.filtered.slice(0, visibleCount).forEach((club) => {
      const row = createResultRow(club);
      fragment.appendChild(row);
    });

    resultsEl.innerHTML = '';
    resultsEl.appendChild(fragment);

    if (moreButton) {
      if (state.visibleCount < state.filtered.length) {
        const remaining = state.filtered.length - state.visibleCount;
        moreButton.hidden = false;
        moreButton.textContent = `Afficher ${remaining} autre${remaining > 1 ? 's' : ''} club${remaining > 1 ? 's' : ''}`;
      } else {
        moreButton.hidden = true;
      }
    }
  }

  const showAllResults = () => {
    if (state.visibleCount >= state.filtered.length) {
      return;
    }
    state.visibleCount = state.filtered.length;
    renderResults({ resetVisible: false });
    updateTotalCounter();
    if (state.lastSearchMeta) {
      updateSearchStatus(state.lastSearchMeta);
    }
  };

  const handleSearchInputChange = (event) => {
    state.pendingQuery = event.target.value;
  };

  const resetSearch = () => {
    window.clearTimeout(searchTimer);
    setLoading(false, 'search');
    state.pendingQuery = '';
    state.query = '';
    if (searchInput) {
      searchInput.value = '';
    }
    applyFilters({ silentStatus: true });
    setSearchStatus('Recherche réinitialisée. Tous les clubs sont affichés.', 'success');
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
    const localCoordinates = lookupLocalCoordinates(query);
    if (localCoordinates) {
      return Promise.resolve({
        latitude: localCoordinates.lat,
        longitude: localCoordinates.lng,
        label: localCoordinates.label || formatCommune(query),
      });
    }

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
        'User-Agent': 'echecs92-clubs/1.0 (contact@echecs92.com)',
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
        'User-Agent': 'echecs92-clubs/1.0 (contact@echecs92.com)',
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

  const applyUserLocation = ({ latitude, longitude, label, query }) => {
    state.userLocation = { latitude, longitude };
    const referenceSource = (label || query || 'votre position') ?? 'votre position';
    state.distanceReference = referenceSource.trim() || 'votre position';
    state.query = '';
    state.pendingQuery = '';
    if (searchInput) {
      searchInput.value = '';
    }
    setSearchStatus('Tri des clubs par distance…', 'info');
    if (locationInput) {
      if (query) {
        locationInput.value = query;
      } else if (label) {
        locationInput.value = label;
      }
    }
    if (optionsDetails && !optionsDetails.open) {
      optionsDetails.open = true;
    }
    setLocationStatus('Calcul des distances…', 'info');
    startDistanceLoading({
      onComplete: () => {
        setLocationStatus(`Distances calculées depuis ${state.distanceReference}.`, 'success');
      },
    });
    refreshDistances({ preserveVisibility: true, trackGeocodes: true });
  };

  const triggerLocationSearchFromQuery = (rawQuery) => {
    const trimmed = (rawQuery || '').trim();
    if (!trimmed) {
      return false;
    }

    const localCoords = lookupLocalCoordinates(trimmed);
    if (localCoords) {
      const label = localCoords.label || trimmed;
      const key = normaliseQueryKey(trimmed);
      if (key) {
        locationFallbackCache.set(key, {
          status: 'success',
          timestamp: Date.now(),
          latitude: localCoords.lat,
          longitude: localCoords.lng,
          label,
          query: trimmed,
        });
      }
      applyUserLocation({
        latitude: localCoords.lat,
        longitude: localCoords.lng,
        label,
        query: trimmed,
      });
      return true;
    }

    const key = normaliseQueryKey(trimmed);
    if (!key) {
      return false;
    }

    const cached = locationFallbackCache.get(key);
    if (cached) {
      if (cached.status === 'success') {
        applyUserLocation({
          latitude: cached.latitude,
          longitude: cached.longitude,
          label: cached.label,
          query: trimmed,
        });
        return true;
      }
      if (cached.status === 'pending') {
        setSearchStatus('Localisation détectée, recherche des clubs proches…', 'info');
        return true;
      }
      const elapsed = Date.now() - (cached.timestamp || 0);
      if (cached.status === 'error' && elapsed < 60000) {
        return false;
      }
    }

    setSearchStatus('Localisation détectée, recherche des clubs proches…', 'info');
    setLoading(true, 'geocode');

    const entry = {
      status: 'pending',
      timestamp: Date.now(),
      query: trimmed,
    };
    locationFallbackCache.set(key, entry);

    geocodePlace(trimmed)
      .then(({ latitude, longitude, label }) => {
        entry.status = 'success';
        entry.timestamp = Date.now();
        entry.latitude = latitude;
        entry.longitude = longitude;
        entry.label = label || trimmed;
        applyUserLocation({
          latitude,
          longitude,
          label: entry.label,
          query: trimmed,
        });
      })
      .catch(() => {
        entry.status = 'error';
        entry.timestamp = Date.now();
        setSearchStatus(
          'Localisation introuvable. Essayez un autre nom de ville ou code postal.',
          'error'
        );
        if (state.userLocation) {
          handleLocationClear({ silent: true });
        }
        state.pendingQuery = trimmed;
        state.query = trimmed;
        applyFilters({ silentStatus: true });
      })
      .finally(() => {
        setLoading(false, 'geocode');
      });

    return true;
  };

  const performSearch = () => {
    if (searchInput) {
      state.pendingQuery = searchInput.value;
    }
    const rawQuery = (state.pendingQuery || '').trim();

    window.clearTimeout(searchTimer);

    if (!rawQuery) {
      if (state.userLocation) {
        handleLocationClear({ silent: true });
      }
      state.query = '';
      setLoading(true, 'search');
      searchTimer = window.setTimeout(() => {
        try {
          applyFilters();
        } finally {
          setLoading(false, 'search');
        }
      }, SEARCH_DELAY);
      return;
    }

    if (isLikelyLocationQuery(rawQuery) && triggerLocationSearchFromQuery(rawQuery)) {
      return;
    }

    if (state.userLocation) {
      handleLocationClear({ silent: true });
    }

    state.query = rawQuery;
    setSearchStatus('Recherche en cours…', 'info');
    setLoading(true, 'search');
    searchTimer = window.setTimeout(() => {
      try {
        applyFilters();
      } finally {
        setLoading(false, 'search');
      }
    }, SEARCH_DELAY);
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

    setLocationStatus('Recherche en cours…', 'info');
    if (button) {
      button.disabled = true;
      button.textContent = 'Recherche…';
    }
    setLoading(true, 'geocode');
    geocodePlace(raw)
      .then(({ latitude, longitude, label }) => {
        applyUserLocation({ latitude, longitude, label, query: raw });
      })
      .catch(() => {
        setLocationStatus(
          'Localisation introuvable. Essayez un autre nom de ville ou code postal.',
          'error'
        );
        setLoading(false, 'geocode');
      })
      .finally(() => {
        setLoading(false, 'geocode');
        if (button) {
          button.disabled = false;
          button.textContent = button.dataset.label || 'Valider';
        }
      });
  };

  const handleLocationClear = (eventOrOptions) => {
    let options = {};
    if (eventOrOptions && typeof eventOrOptions.preventDefault === 'function') {
      eventOrOptions.preventDefault();
    } else if (eventOrOptions && typeof eventOrOptions === 'object') {
      options = eventOrOptions;
    }
    const silent = Boolean(options.silent);
    state.userLocation = null;
    state.distanceReference = '';
    if (locationInput) {
      locationInput.value = '';
    }
    if (silent) {
      setLocationStatus('', 'info');
    } else {
      setLocationStatus('Localisation effacée.', 'info');
    }
    endDistanceLoading(true);
    setLoading(false, 'distance');
    setLoading(false, 'geocode');
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
    setLoading(true, 'geocode');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        reverseGeocode(latitude, longitude)
          .catch(() => '')
          .then((label) => {
            applyUserLocation({
              latitude,
              longitude,
              label: label || 'votre position',
              query: '',
            });
          })
          .finally(() => {
            if (geolocButton) {
              geolocButton.disabled = false;
              geolocButton.textContent = geolocButton.dataset.label || 'Autour de moi';
            }
            setLoading(false, 'geocode');
          });
      },
      () => {
        setLocationStatus('Impossible de récupérer votre position.', 'error');
        setLoading(false, 'geocode');
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
    moreButton?.addEventListener('click', showAllResults);

    document.addEventListener('visibilitychange', () => {
      if (!state.geocodingActive && state.geocodingQueue.length) {
        processGeocodingQueue();
      }
    });
  };

  const hydrateClub = (raw) => {
    const club = { ...adaptClubRecord(raw) };
    const tagList = Array.isArray(club.tags) ? club.tags : [];
    club._nameNormalized = normalise(club.name);
    club._communeNormalized = normalise(club.commune);
    club._tagTokens = tagList.map((value) => normalise(value)).filter(Boolean);
    club._search = normalise(
      [
        club.name,
        club.commune,
        club.address,
        club.siege,
        club.publics,
        club.hours,
        club.tarifs,
        club.president,
        club.notes,
        club.site,
        club.postalCode,
        tagList.join(' '),
      ]
        .filter(Boolean)
        .join(' ')
    );
    const matchSource = [
      club.name,
      club.commune,
      club.address,
      club.siege,
      tagList.join(' '),
    ]
      .filter(Boolean)
      .join(' ');
    club._matchHaystack = normaliseForMatch(matchSource);
    const keywordSource = [
      club.name,
      club.commune,
      club.address,
      club.siege,
      club.publics,
      club.hours,
      club.tarifs,
      club.president,
      club.notes,
      club.site,
      club.postalCode,
      ...tagList,
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
    club._tagTokens.forEach((token) => keywordSet.add(token));
    club._keywords = Array.from(keywordSet);
    const postalCodes = [];
    [club.address, club.commune, club.postalCode].forEach((value) => {
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
    resolveClubReferenceCoordinates(club);
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
        const meta = applyFilters({ silentStatus: true });
        updateSearchStatus(meta);
        if (state.userLocation) {
          scheduleDistanceRefresh({ preserveVisibility: true, trackGeocodes: true });
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
