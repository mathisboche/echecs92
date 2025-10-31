/**
 * Clubs directory interactions for echecs92.fr.
 * Provides fuzzy text search with automatic distance fallback.
 */
(function () {
  const DATA_URL = '/wp-content/themes/echecs92-child/assets/data/clubs.json';
  const VISIBLE_RESULTS_DEFAULT = 12;
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

  const GEOCODE_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

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
    filtered: [],
    query: '',
    visibleCount: VISIBLE_RESULTS_DEFAULT,
    distanceMode: false,
    distanceReference: '',
  };

  let searchRequestId = 0;
  let locationRequestId = 0;
  const geocodeCache = new Map();
  const reverseGeocodeCache = new Map();

  const initialiseLocationControls = () => {
    [locationInput, locationApplyButton, locationClearButton, geolocButton].forEach((element) => {
      if (element) {
        element.removeAttribute('disabled');
        element.removeAttribute('aria-disabled');
        element.removeAttribute('aria-busy');
        if (element.dataset && element.dataset.label) {
          delete element.dataset.label;
        }
      }
    });
    if (optionsDetails) {
      optionsDetails.removeAttribute('aria-hidden');
    }
    if (locationStatus) {
      setLocationStatus('Indiquez une ville, un code postal ou utilisez Autour de moi.', 'info');
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

  const beginButtonWait = (button, busyLabel) => {
    if (!button) {
      return () => {};
    }
    const originalText = button.dataset.label || button.textContent || '';
    button.dataset.label = originalText;
    if (busyLabel) {
      button.textContent = busyLabel;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    return () => {
      if (button.dataset.label !== undefined) {
        button.textContent = button.dataset.label;
        delete button.dataset.label;
      } else {
        button.textContent = originalText;
      }
      button.disabled = false;
      button.removeAttribute('aria-busy');
    };
  };

  const normalise = (value) =>
    (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const normaliseForSearch = (value) =>
    normalise(value)
      .replace(/[^a-z0-9\s]/g, ' ')
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

  const getPostalCoordinates = (postalCode) => {
    if (!postalCode) {
      return null;
    }
    const key = postalCode.toString().trim();
    if (!key) {
      return null;
    }
    const entry = POSTAL_COORDINATES[key];
    if (!entry) {
      return null;
    }
    return { postalCode: key, lat: entry.lat, lng: entry.lng, label: entry.label };
  };

  const getCommuneCoordinatesByName = (value) => {
    if (!value) {
      return null;
    }
    const key = normaliseCommuneKey(value);
    if (!key) {
      return null;
    }
    const entry = COMMUNE_COORDINATES_BY_NAME[key];
    if (!entry) {
      return null;
    }
    return { postalCode: entry.postalCode, lat: entry.lat, lng: entry.lng, label: entry.label };
  };

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

  const formatGeocodeLabel = (place) => {
    if (!place || typeof place !== 'object') {
      return '';
    }
    const { address = {}, display_name: displayName = '' } = place;
    const localityRaw =
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.hamlet ||
      address.suburb ||
      '';
    const locality = formatCommune(localityRaw);
    if (locality) {
      return locality;
    }
    if (displayName) {
      const [first] = displayName.split(',');
      return formatCommune(first);
    }
    return '';
  };

  const toDistanceReferenceLabel = (baseLabel, postalCode) => {
    const label = (baseLabel || '').trim();
    const code = (postalCode || '').trim();
    if (label && code) {
      return label.includes(code) ? label : `${label} (${code})`;
    }
    return label || code;
  };

  const lookupLocalCoordinates = (query) => {
    const raw = (query || '').toString().trim();
    if (!raw) {
      return null;
    }

    const postalMatches = raw.match(/\b(\d{5})\b/g);
    if (postalMatches) {
      for (let i = 0; i < postalMatches.length; i += 1) {
        const coords = getPostalCoordinates(postalMatches[i]);
        if (coords) {
          return { latitude: coords.lat, longitude: coords.lng, label: coords.label, postalCode: coords.postalCode };
        }
      }
    }

    const candidates = new Set();
    candidates.add(raw);
    const formatted = formatCommune(raw);
    if (formatted) {
      candidates.add(formatted);
    }
    raw
      .split(/[;,\/\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        candidates.add(part);
        const formattedPart = formatCommune(part);
        if (formattedPart) {
          candidates.add(formattedPart);
        }
      });

    for (const candidate of candidates) {
      const coords = getCommuneCoordinatesByName(candidate);
      if (coords) {
        return { latitude: coords.lat, longitude: coords.lng, label: coords.label, postalCode: coords.postalCode };
      }
    }

    return null;
  };

  const collectPostalCodes = (club) => {
    const codes = new Set();
    if (club.postalCode) {
      codes.add(club.postalCode);
    }
    [club.address, club.siege].forEach((value) => {
      const matches = (value || '').match(/\b\d{5}\b/g);
      if (matches) {
        matches.forEach((code) => codes.add(code));
      }
    });
    return Array.from(codes);
  };

  const resolveClubDistanceCoordinates = (club) => {
    if (Object.prototype.hasOwnProperty.call(club, '_distanceCoords')) {
      return club._distanceCoords;
    }

    if (club.commune) {
      const coords = getCommuneCoordinatesByName(club.commune);
      if (coords) {
        club._distanceCoords = coords;
        return coords;
      }
    }

    const postalCandidates = collectPostalCodes(club);
    for (let i = 0; i < postalCandidates.length; i += 1) {
      const coords = getPostalCoordinates(postalCandidates[i]);
      if (coords) {
        club._distanceCoords = coords;
        return coords;
      }
    }

    if (club.commune) {
      const fallback = lookupLocalCoordinates(club.commune);
      if (fallback) {
        club._distanceCoords = {
          postalCode: fallback.postalCode || '',
          lat: fallback.latitude,
          lng: fallback.longitude,
          label: fallback.label || club.commune,
        };
        return club._distanceCoords;
      }
    }

    club._distanceCoords = null;
    return null;
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

  const formatDistanceLabel = (distanceKm) => {
    if (!Number.isFinite(distanceKm)) {
      return '';
    }
    if (distanceKm < 1) {
      return `${(distanceKm * 1000).toFixed(0)} m`;
    }
    if (distanceKm < 10) {
      return `${distanceKm.toFixed(1)} km`;
    }
    return `${Math.round(distanceKm)} km`;
  };

  const geocodePlace = (query) => {
    const key = normalise(query).replace(/\s+/g, ' ').trim();
    if (!key) {
      return Promise.resolve(null);
    }
    const cached = geocodeCache.get(key);
    if (cached) {
      if (typeof cached.then === 'function') {
        return cached;
      }
      return Promise.resolve(cached);
    }

    const params = new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      limit: '1',
      countrycodes: 'fr',
      q: query,
    });

    const request = fetch(`${GEOCODE_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
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
          return null;
        }
        const result = payload[0];
        const latitude = Number.parseFloat(result.lat);
        const longitude = Number.parseFloat(result.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return null;
        }
        const label = formatGeocodeLabel(result);
        const postalCodeRaw = result?.address?.postcode || '';
        const postalCode = postalCodeRaw.split(';')[0].trim();
        return {
          latitude,
          longitude,
          label,
          postalCode,
        };
      })
      .catch(() => null)
      .then((finalResult) => {
        geocodeCache.set(key, finalResult);
        return finalResult;
      });

    geocodeCache.set(key, request);
    return request;
  };

  const reverseGeocode = (latitude, longitude) => {
    const lat = Number.parseFloat(latitude);
    const lng = Number.parseFloat(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Promise.resolve(null);
    }
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = reverseGeocodeCache.get(key);
    if (cached) {
      if (typeof cached.then === 'function') {
        return cached;
      }
      return Promise.resolve(cached);
    }

    const params = new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      zoom: '13',
      lat: String(lat),
      lon: String(lng),
    });

    const request = fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
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
        if (!payload) {
          return null;
        }
        const label = formatGeocodeLabel(payload) || '';
        const postalCodeRaw = payload?.address?.postcode || '';
        const postalCode = postalCodeRaw.split(';')[0].trim();
        return {
          label,
          postalCode,
        };
      })
      .catch(() => null)
      .then((finalResult) => {
        reverseGeocodeCache.set(key, finalResult);
        return finalResult;
      });

    reverseGeocodeCache.set(key, request);
    return request;
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
          matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + 1);
        }
      }
    }
    return matrix[b.length][a.length];
  };

  const scoreClubMatch = (club, terms, fullQuery) => {
    if (!terms.length) {
      return { matched: true, score: 0 };
    }
    const haystack = club._search;
    if (!haystack) {
      return { matched: false, score: 0 };
    }
    let total = 0;
    const tokens = Array.isArray(club._tokens) ? club._tokens : [];

    for (let i = 0; i < terms.length; i += 1) {
      const term = terms[i];
      if (!term) {
        continue;
      }
      if (haystack.includes(term)) {
        total += 4 + Math.min(term.length * 0.2, 2.5);
        continue;
      }
      if (!tokens.length) {
        return { matched: false, score: 0 };
      }
      let bestDistance = Infinity;
      for (let j = 0; j < tokens.length; j += 1) {
        const token = tokens[j];
        if (!token) {
          continue;
        }
        if (token === term) {
          bestDistance = 0;
          break;
        }
        const distance = levenshtein(token, term);
        if (distance < bestDistance) {
          bestDistance = distance;
        }
        if (bestDistance === 0) {
          break;
        }
      }
      if (!Number.isFinite(bestDistance)) {
        return { matched: false, score: 0 };
      }
      const termLength = term.length;
      let threshold = 2;
      if (termLength <= 2) {
        threshold = 0;
      } else if (termLength <= 4) {
        threshold = 1;
      }
      if (bestDistance > threshold) {
        return { matched: false, score: 0 };
      }
      const proximityBoost = Math.max(0, termLength - bestDistance);
      total += 1.5 + proximityBoost * 0.4;
    }

    const fullInName = fullQuery && club._nameSearch && club._nameSearch.includes(fullQuery);
    const startsWithName = fullQuery && club._nameSearch && club._nameSearch.startsWith(fullQuery);
    if (startsWithName) {
      total += 3;
    } else if (fullInName) {
      total += 1.5;
    }

    const addressMatch = fullQuery && club._addressSearch && club._addressSearch.includes(fullQuery);
    if (addressMatch) {
      total += 1;
    }

    return { matched: true, score: total };
  };

  const applySearch = (rawQuery) => {
    const trimmed = (rawQuery || '').trim();
    state.query = trimmed;
    const normalisedQuery = normaliseForSearch(trimmed);
    const terms = normalisedQuery ? normalisedQuery.split(/\s+/).filter(Boolean) : [];

    state.distanceMode = false;
    state.distanceReference = '';
    state.clubs.forEach((club) => {
      if (Object.prototype.hasOwnProperty.call(club, 'distanceKm')) {
        delete club.distanceKm;
      }
    });

    if (!terms.length) {
      state.filtered = state.clubs.slice();
    } else {
      const matches = [];
      for (let i = 0; i < state.clubs.length; i += 1) {
        const club = state.clubs[i];
        const { matched, score } = scoreClubMatch(club, terms, normalisedQuery);
        if (matched) {
          matches.push({ club, score });
        }
      }
      matches.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.club.name.localeCompare(b.club.name, 'fr', { sensitivity: 'base' });
      });
      state.filtered = matches.map((entry) => entry.club);
    }

    state.visibleCount = Math.min(VISIBLE_RESULTS_DEFAULT, state.filtered.length);
    renderResults();
    updateTotalCounter();

    return {
      total: state.filtered.length,
      hasQuery: terms.length > 0,
      rawQuery: trimmed,
    };
  };

  const runDistanceSearch = ({ latitude, longitude, label, query }) => {
    const lat = Number.parseFloat(latitude);
    const lng = Number.parseFloat(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      state.filtered = [];
      state.visibleCount = 0;
      state.distanceMode = true;
      state.distanceReference = label || query || '';
      renderResults();
      updateTotalCounter();
      return { total: 0, finite: 0, label: state.distanceReference };
    }

    const scored = state.clubs.map((club) => {
      const coords = resolveClubDistanceCoordinates(club);
      if (!coords) {
        return { club, distance: Number.POSITIVE_INFINITY };
      }
      const distance = haversineKm(lat, lng, coords.lat, coords.lng);
      return { club, distance };
    });

    scored.sort((a, b) => {
      const aFinite = Number.isFinite(a.distance);
      const bFinite = Number.isFinite(b.distance);
      if (aFinite && bFinite) {
        if (a.distance !== b.distance) {
          return a.distance - b.distance;
        }
        return a.club.name.localeCompare(b.club.name, 'fr', { sensitivity: 'base' });
      }
      if (aFinite) {
        return -1;
      }
      if (bFinite) {
        return 1;
      }
      return a.club.name.localeCompare(b.club.name, 'fr', { sensitivity: 'base' });
    });

    const finiteCount = scored.filter((entry) => Number.isFinite(entry.distance)).length;

    scored.forEach((entry) => {
      if (Number.isFinite(entry.distance)) {
        entry.club.distanceKm = entry.distance;
      } else if (Object.prototype.hasOwnProperty.call(entry.club, 'distanceKm')) {
        delete entry.club.distanceKm;
      }
    });

    state.filtered = scored.map((entry) => entry.club);
    state.distanceMode = true;
    state.distanceReference = label || query || '';
    state.query = query || '';
    state.visibleCount = Math.min(VISIBLE_RESULTS_DEFAULT, state.filtered.length);
    renderResults();
    updateTotalCounter();

    return {
      total: state.filtered.length,
      finite: finiteCount,
      label: state.distanceReference,
    };
  };

  const performSearch = async () => {
    const raw = searchInput ? searchInput.value : '';
    const trimmed = (raw || '').trim();
    const requestId = ++searchRequestId;

    const updateStatusIfCurrent = (message, tone = 'info') => {
      if (requestId === searchRequestId) {
        setSearchStatus(message, tone);
      }
    };

    if (!trimmed) {
      const meta = applySearch('');
      if (requestId !== searchRequestId) {
        return;
      }
      if (meta.total > 0) {
        updateStatusIfCurrent('Tous les clubs sont affichés.', 'info');
      } else {
        updateStatusIfCurrent('Aucun club disponible pour le moment.', 'info');
      }
      return;
    }

    updateStatusIfCurrent('Recherche en cours…', 'info');

    const postalMatch = trimmed.match(/\b(\d{5})\b/);
    if (postalMatch) {
      const postalCode = postalMatch[1];
      let coords = getPostalCoordinates(postalCode) || lookupLocalCoordinates(postalCode);
      if (!coords) {
        updateStatusIfCurrent(`Recherche des clubs proches de ${postalCode}…`, 'info');
        try {
          const geocoded = await geocodePlace(postalCode);
          if (requestId !== searchRequestId) {
            return;
          }
          if (geocoded) {
            coords = geocoded;
          }
        } catch {
          // ignore, handled below
        }
      }
      if (coords) {
        if (requestId !== searchRequestId) {
          return;
        }
        const referenceLabel = toDistanceReferenceLabel(
          coords.label || formatCommune(trimmed) || trimmed,
          coords.postalCode || postalCode
        );
        const meta = runDistanceSearch({
          latitude: coords.latitude ?? coords.lat,
          longitude: coords.longitude ?? coords.lng,
          label: referenceLabel,
          query: trimmed,
        });
        if (requestId !== searchRequestId) {
          return;
        }
        if (meta.finite > 0) {
          updateStatusIfCurrent(
            `Clubs triés par distance depuis ${meta.label || referenceLabel || trimmed}.`,
            'info'
          );
        } else {
          updateStatusIfCurrent('Impossible de calculer les distances pour cette localisation.', 'error');
        }
        return;
      }
      updateStatusIfCurrent(`Localisation "${postalCode}" introuvable.`, 'error');
      return;
    }

    const meta = applySearch(trimmed);
    if (requestId !== searchRequestId) {
      return;
    }

    if (!meta.hasQuery) {
      updateStatusIfCurrent('Tous les clubs sont affichés.', 'info');
      return;
    }

    if (meta.total > 0) {
      const label =
        meta.total === 1
          ? `1 club correspond à "${meta.rawQuery}".`
          : `${meta.total} clubs correspondent à "${meta.rawQuery}".`;
      updateStatusIfCurrent(label, 'info');
      return;
    }

    let location = lookupLocalCoordinates(trimmed);

    if (!location) {
      updateStatusIfCurrent(`Recherche de la localisation "${trimmed}"…`, 'info');
      try {
        location = await geocodePlace(trimmed);
      } catch {
        location = null;
      }
      if (requestId !== searchRequestId) {
        return;
      }
    }

    if (location) {
      if (requestId !== searchRequestId) {
        return;
      }

      const referenceLabel = toDistanceReferenceLabel(
        location.label || formatCommune(trimmed) || trimmed,
        location.postalCode
      );
      const distanceMeta = runDistanceSearch({
        latitude: location.latitude,
        longitude: location.longitude,
        label: referenceLabel,
        query: trimmed,
      });
      if (requestId !== searchRequestId) {
        return;
      }
      if (distanceMeta.finite > 0) {
        const reference = distanceMeta.label || referenceLabel || trimmed;
        updateStatusIfCurrent(
          `Aucun club nommé "${trimmed}". Classement par distance depuis ${reference}.`,
          'info'
        );
      } else {
        updateStatusIfCurrent('Impossible de calculer les distances pour cette localisation.', 'error');
      }
      return;
    }

    updateStatusIfCurrent(`Aucun club ne correspond à "${meta.rawQuery}".`, 'error');
  };

  const resetSearch = () => {
    searchRequestId += 1;
    if (searchInput) {
      searchInput.value = '';
    }
    const meta = applySearch('');
    if (meta.total > 0) {
      setSearchStatus('Recherche réinitialisée. Tous les clubs sont affichés.', 'success');
    } else {
      setSearchStatus('Aucun club disponible pour le moment.', 'info');
    }
  };

  const handleLocationClear = (event) => {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    locationRequestId += 1;
    state.distanceMode = false;
    state.distanceReference = '';
    state.clubs.forEach((club) => {
      if (Object.prototype.hasOwnProperty.call(club, 'distanceKm')) {
        delete club.distanceKm;
      }
    });
    if (locationInput) {
      locationInput.value = '';
    }
    setLocationStatus('Localisation effacée.', 'info');
    void performSearch();
  };

  const handleLocationSubmit = async (event) => {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    if (!locationInput) {
      return;
    }
    const raw = locationInput.value.trim();
    if (!raw) {
      handleLocationClear();
      return;
    }

    const requestId = ++locationRequestId;
    setLocationStatus(`Recherche de ${raw}…`, 'info');
    const releaseButton = beginButtonWait(locationApplyButton, 'Recherche…');

    try {
      let coords = lookupLocalCoordinates(raw);
      if (!coords) {
        try {
          coords = await geocodePlace(raw);
        } catch {
          coords = null;
        }
      }

      if (requestId !== locationRequestId) {
        return;
      }

      if (!coords) {
        setLocationStatus('Localisation introuvable. Essayez un autre nom de ville ou code postal.', 'error');
        return;
      }

      const label = toDistanceReferenceLabel(
        coords.label || formatCommune(raw) || raw,
        coords.postalCode
      );

      if (locationInput) {
        locationInput.value = label || raw;
      }

      if (optionsDetails && !optionsDetails.open) {
        optionsDetails.open = true;
      }

      searchRequestId += 1;
      const meta = runDistanceSearch({
        latitude: coords.latitude ?? coords.lat,
        longitude: coords.longitude ?? coords.lng,
        label,
        query: raw,
      });

      if (meta.finite > 0) {
        const reference = meta.label || label || raw;
        setLocationStatus(`Distances calculées depuis ${reference}.`, 'success');
        setSearchStatus(`Clubs triés par distance depuis ${reference}.`, 'info');
      } else {
        setLocationStatus('Impossible de calculer les distances pour cette localisation.', 'error');
      }
    } finally {
      releaseButton();
    }
  };

  const handleUseGeolocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('Géolocalisation indisponible sur cet appareil.', 'error');
      return;
    }

    const requestId = ++locationRequestId;
    setLocationStatus('Recherche de votre position…', 'info');
    const releaseButton = beginButtonWait(geolocButton, 'Recherche…');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        reverseGeocode(latitude, longitude)
          .catch(() => null)
          .then((place) => {
            if (requestId !== locationRequestId) {
              return;
            }

            const label = toDistanceReferenceLabel(
              place?.label || 'votre position',
              place?.postalCode
            );

            if (locationInput) {
              locationInput.value = place?.label || '';
            }

            if (optionsDetails && !optionsDetails.open) {
              optionsDetails.open = true;
            }

            searchRequestId += 1;
            const meta = runDistanceSearch({
              latitude,
              longitude,
              label,
              query: place?.label || 'votre position',
            });

            if (meta.finite > 0) {
              const reference = meta.label || label || 'votre position';
              setLocationStatus(`Distances calculées depuis ${reference}.`, 'success');
              setSearchStatus(`Clubs triés par distance depuis ${reference}.`, 'info');
            } else {
              setLocationStatus('Impossible de calculer les distances pour cette localisation.', 'error');
            }
          })
          .finally(() => {
            releaseButton();
          });
      },
      () => {
        if (requestId === locationRequestId) {
          setLocationStatus('Impossible de récupérer votre position.', 'error');
        }
        releaseButton();
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
      }
    );
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
    const searchSource = [club.name, club.address].filter(Boolean).join(' ');
    const searchIndex = normaliseForSearch(searchSource);
    club._search = searchIndex;
    club._tokens = searchIndex ? searchIndex.split(/\s+/) : [];
    club._nameSearch = normaliseForSearch(club.name || '');
    club._addressSearch = normaliseForSearch(club.address || '');
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

    const heading = document.createElement('div');
    heading.className = 'club-row__heading';
    header.appendChild(heading);

    const title = document.createElement('h2');
    title.className = 'club-row__name';
    title.textContent = club.name;
    heading.appendChild(title);

    if (club.commune) {
      const communeNode = document.createElement('span');
      communeNode.className = 'club-row__commune';
      communeNode.textContent = club.commune;
      heading.appendChild(communeNode);
    }

    if (state.distanceMode && Number.isFinite(club.distanceKm)) {
      const distanceNode = document.createElement('span');
      distanceNode.className = 'club-row__distance';
      distanceNode.textContent = formatDistanceLabel(club.distanceKm);
      header.appendChild(distanceNode);
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
    const filtered = state.filtered.length;
    const visible = Math.min(state.visibleCount, filtered);

    if (!total) {
      totalCounter.textContent = 'Aucun club disponible pour le moment.';
      return;
    }

    if (!filtered) {
      const parts = [`Aucun club trouvé`, `${total} au total`];
      if (state.distanceMode && state.distanceReference) {
        parts.splice(1, 0, `distances depuis ${state.distanceReference}`);
      }
      totalCounter.textContent = `${parts.join(' · ')}.`;
      return;
    }

    const parts = [];
    if (filtered === total && visible >= filtered) {
      parts.push(`${total} club${total > 1 ? 's' : ''} dans les Hauts-de-Seine`);
    } else {
      parts.push(`${filtered} trouvé${filtered > 1 ? 's' : ''} sur ${total}`);
      if (visible < filtered) {
        parts.push(`${visible} affiché${visible > 1 ? 's' : ''}`);
      }
    }
    if (state.distanceMode && state.distanceReference) {
      parts.push(`distances depuis ${state.distanceReference}`);
    }
    totalCounter.textContent = `${parts.join(' · ')}.`;
  };

  const renderResults = () => {
    if (!state.filtered.length) {
      const message = state.clubs.length
        ? 'Aucun club ne correspond à votre recherche.'
        : 'Aucune fiche club à afficher.';
      resultsEl.innerHTML = `<p class="clubs-empty">${message}</p>`;
      if (moreButton) {
        moreButton.hidden = true;
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    const visible = Math.min(state.visibleCount, state.filtered.length);
    state.filtered.slice(0, visible).forEach((club) => {
      fragment.appendChild(createResultRow(club));
    });

    resultsEl.innerHTML = '';
    resultsEl.appendChild(fragment);

    if (moreButton) {
      if (visible < state.filtered.length) {
        const remaining = state.filtered.length - visible;
        moreButton.hidden = false;
        moreButton.textContent = `Afficher ${remaining} autre${remaining > 1 ? 's' : ''} club${remaining > 1 ? 's' : ''}`;
      } else {
        moreButton.hidden = true;
      }
    }
  };

  const showAllResults = () => {
    if (!state.filtered.length) {
      return;
    }
    state.visibleCount = state.filtered.length;
    renderResults();
    updateTotalCounter();
    if (state.query) {
      setSearchStatus('Tous les clubs correspondants sont affichés.', 'info');
    } else {
      setSearchStatus('Tous les clubs sont affichés.', 'info');
    }
  };

  const init = () => {
    initialiseLocationControls();
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
        state.clubs = data
          .map(hydrateClub)
          .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
        const meta = applySearch('');
        if (meta.total > 0) {
          setSearchStatus('Tous les clubs sont affichés.', 'info');
        } else {
          setSearchStatus('Aucun club disponible pour le moment.', 'info');
        }
      })
      .catch(() => {
        resultsEl.innerHTML = '<p class="clubs-error">Impossible de charger la liste des clubs pour le moment. Veuillez réessayer plus tard.</p>';
        totalCounter.textContent = '';
        setSearchStatus('Erreur lors du chargement de la liste des clubs.', 'error');
      });

    searchButton?.addEventListener('click', performSearch);
    resetButton?.addEventListener('click', resetSearch);
    searchInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        performSearch();
      }
    });
    locationApplyButton?.addEventListener('click', handleLocationSubmit);
    locationClearButton?.addEventListener('click', handleLocationClear);
    locationInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleLocationSubmit(event);
      }
    });
    geolocButton?.addEventListener('click', handleUseGeolocation);
    moreButton?.addEventListener('click', showAllResults);
  };

  init();
})();
