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
  const POSITIVE_MATCH_THRESHOLD = 1.15;

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
    if (state.filtered.length > state.visibleCount && state.visibleCount > 0) {
      const proximityMode = Boolean(state.userLocation);
      if (state.visibleCount === 1) {
        return `${message} Le club le plus ${proximityMode ? 'proche' : 'pertinent'} est affiché en premier.`;
      }
      return `${message} Les ${state.visibleCount} clubs les plus ${proximityMode ? 'proches' : 'pertinents'} sont affichés en premier.`;
    }
    return message;
  };

  const updateSearchStatus = (meta) => {
    if (!meta) {
      setSearchStatus(
        withVisibilityNote(
          `${state.filtered.length} club${state.filtered.length > 1 ? 's' : ''} affiché${state.filtered.length > 1 ? 's' : ''}.`
        ),
        'info'
      );
      return;
    }
    if (!meta.termsCount) {
      setSearchStatus(
        withVisibilityNote(
          `${meta.total} club${meta.total > 1 ? 's' : ''} dans les Hauts-de-Seine.`
        ),
        'info'
      );
      return;
    }
    if (meta.matches > 0) {
      const label = meta.matches === 1 ? 'résultat pertinent' : 'résultats pertinents';
      setSearchStatus(withVisibilityNote(`${meta.matches} ${label}.`), 'success');
    } else if (meta.fallbackUsed) {
      setSearchStatus(
        withVisibilityNote('Aucun résultat exact. Affichage des clubs les plus pertinents disponibles.'),
        'info'
      );
    } else {
      setSearchStatus(
        withVisibilityNote(
          `${meta.total} club${meta.total > 1 ? 's' : ''} correspondant${meta.total > 1 ? 's' : ''} trouvé${meta.total > 1 ? 's' : ''}.`
        ),
        'info'
      );
    }
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
    if (!force && state.pendingDistanceClubIds.size > 0) {
      return;
    }
    state.distanceLoading = false;
    state.pendingDistanceClubIds.clear();
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
    if (state.distanceLoading && state.pendingDistanceClubIds.size === 0) {
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
  };

  const normalise = (value) =>
    (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

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
        scheduleDistanceRefresh({ preserveVisibility: true });
      })
      .catch(() => finish(false));
  };

  const refreshDistances = (options = {}) => {
    let preserveVisibility = false;
    let trackGeocodes = state.distanceLoading;
    if (typeof options === 'boolean') {
      preserveVisibility = options;
    } else if (options && typeof options === 'object') {
      preserveVisibility = Boolean(options.preserveVisibility);
      if (typeof options.trackGeocodes === 'boolean') {
        trackGeocodes = options.trackGeocodes;
      }
    }
    const requestId = trackGeocodes ? state.activeDistanceRequest : null;

    if (state.userLocation) {
      const { latitude, longitude } = state.userLocation;
      state.clubs.forEach((club) => {
        if (club.lat == null || club.lng == null) {
          delete club.distanceKm;
          queueGeocoding(club, { track: trackGeocodes, requestId });
          return;
        }
        club.distanceKm = haversineKm(latitude, longitude, club.lat, club.lng);
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
    if (state.distanceRefreshScheduled) {
      return;
    }
    state.distanceRefreshScheduled = true;
    window.requestAnimationFrame(() => {
      state.distanceRefreshScheduled = false;
      const opts = state.distanceRefreshOptions || {};
      state.distanceRefreshOptions = null;
      refreshDistances(opts);
    });
  }

  const computeSearchScore = (club, terms) => {
    if (!terms.length) {
      return 0;
    }
    const keywords = club._keywords || [];
    const searchString = club._search || '';
    const nameNormalized = club._nameNormalized || '';
    const communeNormalized = club._communeNormalized || '';
    const tagTokens = club._tagTokens || [];
    const combinedLabel = [nameNormalized, communeNormalized].filter(Boolean).join(' ');
    let score = 0;

    terms.forEach((term) => {
      if (!term) {
        return;
      }
      let best = 0;
      if (nameNormalized) {
        if (nameNormalized === term) {
          best = Math.max(best, 8.5);
        } else if (nameNormalized.startsWith(term)) {
          best = Math.max(best, 6.8);
        } else if (term.startsWith(nameNormalized)) {
          best = Math.max(best, 6);
        } else if (nameNormalized.includes(term)) {
          best = Math.max(best, 5.2);
        } else {
          const distance = levenshtein(nameNormalized, term);
          const similarity = 1 - distance / Math.max(nameNormalized.length, term.length);
          if (similarity >= 0.55) {
            best = Math.max(best, similarity * 6.5);
          }
        }
      }
      if (communeNormalized) {
        if (communeNormalized === term) {
          best = Math.max(best, 5.5);
        } else if (communeNormalized.startsWith(term) || term.startsWith(communeNormalized)) {
          best = Math.max(best, 4.6);
        } else if (communeNormalized.includes(term)) {
          best = Math.max(best, 3.8);
        } else {
          const distance = levenshtein(communeNormalized, term);
          const similarity = 1 - distance / Math.max(communeNormalized.length, term.length);
          if (similarity >= 0.6) {
            best = Math.max(best, similarity * 4.8);
          }
        }
      }
      if (combinedLabel && combinedLabel.includes(term)) {
        best = Math.max(best, 4.2);
      }
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
      if (tagTokens.length) {
        if (tagTokens.includes(term)) {
          best = Math.max(best, 4.2);
        } else {
          for (let i = 0; i < tagTokens.length; i += 1) {
            const tag = tagTokens[i];
            const distance = levenshtein(tag, term);
            const similarity = 1 - distance / Math.max(tag.length, term.length);
            if (similarity >= 0.65) {
              best = Math.max(best, similarity * 3.6);
              break;
            }
          }
        }
      }
      score += best;
    });

    return score;
  };

  const applyFilters = (options = {}) => {
    const { silentStatus = false, preserveVisibility = false } = options;
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
      const positives = scored.filter((entry) => entry.score >= POSITIVE_MATCH_THRESHOLD);
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

    orderedClubs.sort((a, b) => {
      if (state.userLocation) {
        const da = typeof a.distanceKm === 'number' ? a.distanceKm : Number.POSITIVE_INFINITY;
        const db = typeof b.distanceKm === 'number' ? b.distanceKm : Number.POSITIVE_INFINITY;
        if (da !== db) {
          return da - db;
        }
      }
      if (terms.length) {
        const diff = (scoreMap.get(b.id) || 0) - (scoreMap.get(a.id) || 0);
        if (diff !== 0) {
          return diff;
        }
      }
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });

    state.filtered = orderedClubs;
    renderResults({ resetVisible: !preserveVisibility });

    updateTotalCounter();

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

    if (!state.filtered.length) {
      resultsEl.innerHTML =
        '<p class="clubs-empty">Aucun club ne correspond à votre recherche pour le moment.</p>';
      if (moreButton) {
        moreButton.hidden = true;
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    state.filtered.slice(0, state.visibleCount).forEach((club) => {
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

  const maybeTriggerLocationFallback = (meta = {}) => {
    if (!meta || typeof meta !== 'object') {
      return false;
    }
    const rawQuery = (meta.query || '').trim();
    if (!rawQuery) {
      return false;
    }
    if (state.userLocation) {
      return false;
    }
    if (!meta.fallbackUsed || meta.matches > 0) {
      return false;
    }
    if (!isLikelyLocationQuery(rawQuery)) {
      return false;
    }
    const key = normaliseQueryKey(rawQuery);
    if (!key) {
      return false;
    }
    const cached = locationFallbackCache.get(key);
    if (cached) {
      if (cached.status === 'success') {
        if (normaliseQueryKey(state.query || '') === key) {
          applyUserLocation({
            latitude: cached.latitude,
            longitude: cached.longitude,
            label: cached.label,
            query: rawQuery,
          });
        }
        return true;
      }
      if (cached.status === 'pending') {
        setSearchStatus('Localisation détectée, recherche des clubs proches…', 'info');
        return true;
      }
      const elapsed = Date.now() - (cached.timestamp || 0);
      if (elapsed < 60000) {
        return false;
      }
    }

    const entry = {
      status: 'pending',
      timestamp: Date.now(),
      query: rawQuery,
    };
    locationFallbackCache.set(key, entry);
    setSearchStatus('Localisation détectée, recherche des clubs proches…', 'info');

    geocodePlace(rawQuery)
      .then(({ latitude, longitude, label }) => {
        entry.status = 'success';
        entry.timestamp = Date.now();
        entry.latitude = latitude;
        entry.longitude = longitude;
        entry.label = label || rawQuery;
        if (normaliseQueryKey(state.query || '') === key) {
          applyUserLocation({ latitude, longitude, label: entry.label, query: rawQuery });
        }
      })
      .catch(() => {
        entry.status = 'error';
        entry.timestamp = Date.now();
        if (normaliseQueryKey(state.query || '') === key) {
          setSearchStatus(
            'Aucun club ne correspond à cette recherche. Essayez un autre nom ou une autre localisation.',
            'error'
          );
        }
      });

    return true;
  };

  const performSearch = () => {
    if (searchInput) {
      state.pendingQuery = searchInput.value;
    }
    state.query = (state.pendingQuery || '').trim();
    if (state.userLocation) {
      handleLocationClear({ silent: true });
    }
    window.clearTimeout(searchTimer);
    setSearchStatus('Recherche en cours…', 'info');
    setLoading(true, 'search');
    searchTimer = window.setTimeout(() => {
      let meta;
      try {
        meta = applyFilters();
      } finally {
        setLoading(false, 'search');
      }
      if (meta) {
        maybeTriggerLocationFallback(meta);
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
    const club = { ...raw };
    const tagList = Array.isArray(club.tags) ? club.tags : [];
    club._nameNormalized = normalise(club.name);
    club._communeNormalized = normalise(club.commune);
    club._tagTokens = tagList.map((value) => normalise(value)).filter(Boolean);
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
        tagList.join(' '),
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
      })
      .catch(() => {
        resultsEl.innerHTML =
          '<p class="clubs-error">Impossible de charger la liste des clubs pour le moment. Veuillez réessayer plus tard.</p>';
      });

    bindEvents();
  };

  init();
})();
