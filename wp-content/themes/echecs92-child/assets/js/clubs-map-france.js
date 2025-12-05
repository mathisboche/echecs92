(function () {
  const GEO_HINTS_VERSION = '20251205';
  const DATA_MANIFEST_URL = '/wp-content/themes/echecs92-child/assets/data/clubs-france.json';
  const DATA_FALLBACK_BASE_PATH = '/wp-content/themes/echecs92-child/assets/data/clubs-france/';
  const GEO_HINTS_REMOTE_URL = `/wp-content/themes/echecs92-child/assets/data/clubs-france-hints.json?v=${GEO_HINTS_VERSION}`;
  const CLUBS_NAV_STORAGE_KEY = 'echecs92:clubs-fr:last-listing';
  const mapElement = document.getElementById('clubs-map');
  const mapBackLink = document.querySelector('[data-clubs-map-back]');
  if (!mapElement) {
    return;
  }

  let manifestPromise = null;
  let datasetPromise = null;

  const FETCH_TIMEOUT_MS = 8000;
  const fetchJson = (url) => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId =
      controller && Number.isFinite(FETCH_TIMEOUT_MS) && FETCH_TIMEOUT_MS > 0
        ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        : null;
    return fetch(url, { headers: { Accept: 'application/json' }, signal: controller?.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .finally(() => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      });
  };

  const loadManifest = () => {
    if (!manifestPromise) {
      manifestPromise = fetchJson(DATA_MANIFEST_URL)
        .then((payload) => {
          const basePath = payload?.basePath || DATA_FALLBACK_BASE_PATH;
          const departments = Array.isArray(payload?.departments) ? payload.departments : [];
          return { basePath, departments };
        })
        .catch(() => ({ basePath: DATA_FALLBACK_BASE_PATH, departments: [] }));
    }
    return manifestPromise;
  };

  const buildDeptUrl = (entry, basePath) => {
    if (!entry || !entry.file) {
      return null;
    }
    if (/^https?:/i.test(entry.file)) {
      return entry.file;
    }
    const base = (entry.basePath || basePath || DATA_FALLBACK_BASE_PATH || '').replace(/\/+$/u, '');
    const file = entry.file.replace(/^\/+/u, '');
    return `${base}/${file}`;
  };

  const annotateClub = (club, entry) => ({
    ...club,
    departement: club.departement || entry.code || '',
    departement_nom: club.departement_nom || entry.name || '',
    departement_slug: club.departement_slug || entry.slug || '',
  });

  const fetchDepartmentClubs = async (entry, manifestMeta) => {
    const url = buildDeptUrl(entry, manifestMeta.basePath);
    if (!url) {
      return [];
    }
    try {
      const payload = await fetchJson(url);
      const records = Array.isArray(payload) ? payload : [];
      return records.map((club) => annotateClub(club, entry));
    } catch (error) {
      console.warn(`[clubs-fr-map] Département ${entry.code || '?'} indisponible (${url}).`, error);
      return [];
    }
  };

  const loadFranceClubsDataset = () => {
    if (!datasetPromise) {
      datasetPromise = loadManifest().then(async (manifestMeta) => {
        const departments = manifestMeta.departments || [];
        if (!departments.length) {
          return [];
        }
        const chunks = await Promise.all(departments.map((entry) => fetchDepartmentClubs(entry, manifestMeta)));
        return chunks.flat();
      });
    }
    return datasetPromise;
  };

  const statusElement = document.getElementById('clubs-map-status');
  const detailBase = mapElement.dataset.detailBase || '/club/';
  const mapHostPath = (() => {
    try {
      const path = window.location && window.location.pathname ? window.location.pathname : '';
      const normalized = path.replace(/\/+$/u, '') || '/';
      return normalized;
    } catch (error) {
      return '';
    }
  })();
  const getCurrentBackPath = () => {
    try {
      const url = new URL(window.location.href);
      return url.pathname + url.search + url.hash;
    } catch (error) {
      return mapHostPath || '/clubs';
    }
  };
  const navigationContext = (() => {
    try {
      const storage = window.localStorage;
      if (!storage) {
        return null;
      }
      const raw = storage.getItem(CLUBS_NAV_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      storage.removeItem(CLUBS_NAV_STORAGE_KEY);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        payload = null;
      }
      if (!payload || typeof payload.ts !== 'number') {
        return null;
      }
      if (Date.now() - payload.ts > 10 * 60 * 1000) {
        return null;
      }
      return payload;
    } catch (error) {
      return null;
    }
  })();

  const rememberNavigation = (context, backPath) => {
    try {
      const storage = window.localStorage;
      if (!storage) {
        return;
      }
      storage.setItem(
        CLUBS_NAV_STORAGE_KEY,
        JSON.stringify({ ts: Date.now(), context, back: backPath || '/clubs' })
      );
    } catch (error) {
      // ignore
    }
  };

  const cameFromClubsPage = () => {
    if (navigationContext && navigationContext.context === 'map:from-list') {
      return true;
    }
    const referrer = document.referrer;
    if (!referrer) {
      return false;
    }
    try {
      const refUrl = new URL(referrer, window.location.origin);
      if (refUrl.origin !== window.location.origin) {
        return false;
      }
      const normalized = refUrl.pathname.replace(/\/+$/u, '') || '/';
      return normalized === '/clubs';
    } catch (error) {
      return false;
    }
  };

  if (mapBackLink) {
    if (cameFromClubsPage()) {
      mapBackLink.removeAttribute('hidden');
    } else {
      mapBackLink.setAttribute('hidden', '');
    }
  }

  let mapInstance = null;
  let markersLayer = null;
  let mapFeatures = [];
  let fullBounds = null;
  let hasFittedView = false;
  let pendingMapFocus = null;

  const clampZoom = (value, fallback = 12) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(16, Math.max(3, parsed));
  };

  const normaliseFocusDetail = (detail) => {
    if (!detail || typeof detail !== 'object') {
      return null;
    }
    if (detail.reset) {
      return { reset: true };
    }
    const lat = Number.parseFloat(detail.lat ?? detail.latitude);
    const lng = Number.parseFloat(detail.lng ?? detail.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    return {
      lat,
      lng,
      zoom: clampZoom(detail.zoom, 12),
      label: detail.label || detail.display || detail.commune || '',
    };
  };

  const focusMapOnLocation = (detail) => {
    const normalized = normaliseFocusDetail(detail);
    if (!normalized) {
      pendingMapFocus = null;
      return;
    }
    if (!mapInstance) {
      pendingMapFocus = normalized;
      return;
    }
    if (normalized.reset) {
      if (fullBounds && fullBounds.isValid && fullBounds.isValid()) {
        mapInstance.fitBounds(fullBounds, { padding: [32, 32], maxZoom: 14 });
        hasFittedView = true;
      }
      return;
    }
    const target = [normalized.lat, normalized.lng];
    const zoom = clampZoom(normalized.zoom, mapInstance.getZoom ? mapInstance.getZoom() : 12);
    try {
      mapInstance.flyTo(target, zoom, { duration: 0.65 });
    } catch (error) {
      mapInstance.setView(target, zoom);
    }
    hasFittedView = true;
  };

  const flushPendingMapFocus = () => {
    if (!pendingMapFocus) {
      return;
    }
    const detail = pendingMapFocus;
    pendingMapFocus = null;
    focusMapOnLocation(detail);
  };

  window.addEventListener('clubs:focus-location', (event) => {
    focusMapOnLocation(event?.detail || {});
  });

  const updateStatus = (message, tone = 'info') => {
    if (!statusElement) {
      return;
    }
    statusElement.textContent = message || '';
    if (message) {
      statusElement.dataset.tone = tone;
    } else {
      delete statusElement.dataset.tone;
    }
  };

  const normalise = (value) =>
    (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const normaliseCommuneKey = (value) => normalise(value).replace(/[^a-z0-9]/g, '');

  const COORD_PRECISION_ALLOWED = {
    exact: true,
    geocoded: true,
    hint: true,
    postal: true,
    commune: true,
    approx: true,
    department: true,
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

  const slugify = (value) => {
    const base = normalise(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return base;
  };

  const getParisArrondissementFromPostal = (postalCode) => {
    const code = (postalCode || '').toString().trim();
    if (!/^75\d{3}$/.test(code)) {
      return null;
    }
    const arr = Number.parseInt(code.slice(3), 10);
    if (!Number.isFinite(arr) || arr < 1 || arr > 20) {
      return null;
    }
    return arr;
  };

  const formatParisArrondissementLabel = (postalCode) => {
    const arr = getParisArrondissementFromPostal(postalCode);
    if (!arr) {
      return '';
    }
    const suffix = arr === 1 ? 'er' : 'e';
    return `Paris ${arr}${suffix}`;
  };

  const isParisPostal = (postalCode) => {
    const code = (postalCode || '').toString().trim();
    if (code === '75116') {
      return true;
    }
    return /^75\d{3}$/.test(code);
  };

  const formatCommuneWithPostal = (commune, postalCode) => {
    const base = formatCommune(commune || '');
    const parisLabel = formatParisArrondissementLabel(postalCode);
    if (parisLabel) {
      const looksNumeric = /^\d/.test(base);
      if (!base || base.toLowerCase().startsWith('paris') || looksNumeric) {
        return parisLabel;
      }
    }
    return base;
  };

  const hashStringToInt = (value) => {
    const str = value || '';
    let hash = 2166136261 >>> 0; // FNV-1a seed
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };

  const toBase36 = (value) => {
    const n = Number.isFinite(value) ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(n)) {
      return '';
    }
    return Math.abs(n >>> 0).toString(36);
  };

  const buildShortSlugBase = (club) => {
    const seedParts = [
      club.id || '',
      club.name || '',
      club.commune || '',
      club.postalCode || '',
      club.departmentCode || club.departmentSlug || club.departmentName || '',
    ];
    const seed = seedParts.filter(Boolean).join('|') || 'club';
    const hash = hashStringToInt(seed);
    const code = toBase36(hash).padStart(6, '0').slice(0, 8);
    return `c${code}`;
  };

  const ensureUniqueSlugs = (clubs) => {
    const byBase = new Map();
    const stableKey = (club) =>
      `${club.id || ''}|${club.name || ''}|${club.commune || ''}|${club.postalCode || ''}|${
        club.departmentCode || club.departmentSlug || club.departmentName || ''
      }`;

    clubs.forEach((club) => {
      const base = buildShortSlugBase(club) || 'cclub';
      if (!byBase.has(base)) {
        byBase.set(base, []);
      }
      byBase.get(base).push(club);
    });

    byBase.forEach((entries, base) => {
      if (entries.length === 1) {
        entries[0].slug = base;
        return;
      }
      const sorted = entries
        .map((club) => ({ club, key: stableKey(club) }))
        .sort((a, b) => a.key.localeCompare(b.key, 'en', { sensitivity: 'base' }));
      sorted.forEach((entry, idx) => {
        const suffix = idx === 0 ? '' : `-${toBase36(idx + 1)}`;
        entry.club.slug = `${base}${suffix}`;
      });
    });
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

  const STREET_KEYWORDS =
    /\b(rue|avenue|av\.?|boulevard|bd|place|route|chemin|impasse|all[ée]e|voie|quai|cours|passage|square|sentier|mail|esplanade|terrasse|pont|faubourg|clos|cité|cite|hameau|lotissement|residence|résidence|allee)\b/i;

  const simplifyStreetSegment = (value) => {
    if (!value) {
      return '';
    }
    const cleaned = value.replace(/\([^)]*\)/g, ' ');
    const parts = cleaned
      .split(/[,;/]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) {
      return cleaned.replace(/\s+/g, ' ').trim();
    }
    const tests = [
      (part) => /\b\d+[\p{L}]?\b/iu.test(part) && STREET_KEYWORDS.test(part),
      (part) => STREET_KEYWORDS.test(part),
      (part) => /\b\d+[\p{L}]?\b/iu.test(part),
    ];
    for (const test of tests) {
      const match = parts.find((part) => test(part));
      if (match) {
        return match.replace(/\s+/g, ' ').trim();
      }
    }
    return parts[0];
  };

  const buildStandardAddress = (primaryAddress, secondaryAddress, postalCode, city) => {
    const street =
      simplifyStreetSegment(primaryAddress) || simplifyStreetSegment(secondaryAddress) || '';
    const formattedCity = formatCommune(city);
    const components = [];
    if (street) {
      components.push(street);
    }
    const localityParts = [];
    if (postalCode) {
      localityParts.push(postalCode);
    }
    if (formattedCity) {
      localityParts.push(formattedCity);
    }
    if (localityParts.length) {
      components.push(localityParts.join(' ').trim());
    }
    return components.join(', ').trim();
  };

  const collectPostalCodes = (club) => {
    const codes = new Set();
    if (club.postalCode) {
      codes.add(club.postalCode);
    }
    [club.address, club.siege, club.addressStandard].forEach((value) => {
      const matches = (value || '').match(/\b\d{5}\b/g);
      if (matches) {
        matches.forEach((code) => codes.add(code));
      }
    });
    return Array.from(codes);
  };

  const extractParisPostal = (value) => {
    if (!value) {
      return null;
    }
    const raw = value.toString();
    const direct = raw.match(/\b75\d{3}\b/);
    if (direct && direct[0]) {
      return direct[0];
    }
    const arr = raw.match(/paris[^0-9]{0,3}(\d{1,2})\s*(?:e|eme|ème|er)?\b/i);
    if (arr && arr[1]) {
      const num = Number.parseInt(arr[1], 10);
      if (Number.isFinite(num) && num >= 1 && num <= 20) {
        return `750${num.toString().padStart(2, '0')}`;
      }
    }
    return null;
  };

  const deriveParisPostalFromClub = (club) => {
    const fields = [
      club.postalCode,
      club.addressStandard,
      club.address,
      club.siege,
      club.commune,
      club.name,
    ];
    for (let i = 0; i < fields.length; i += 1) {
      const code = extractParisPostal(fields[i]);
      if (code) {
        return code;
      }
    }
    return null;
  };

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
    '75001': { label: 'Paris 1er', lat: 48.8627, lng: 2.335 },
    '75002': { label: 'Paris 2e', lat: 48.8697, lng: 2.3431 },
    '75003': { label: 'Paris 3e', lat: 48.8638, lng: 2.3616 },
    '75004': { label: 'Paris 4e', lat: 48.8546, lng: 2.3582 },
    '75005': { label: 'Paris 5e', lat: 48.8443, lng: 2.3506 },
    '75006': { label: 'Paris 6e', lat: 48.8493, lng: 2.3331 },
    '75007': { label: 'Paris 7e', lat: 48.8566, lng: 2.3125 },
    '75008': { label: 'Paris 8e', lat: 48.8754, lng: 2.3174 },
    '75009': { label: 'Paris 9e', lat: 48.8829, lng: 2.3499 },
    '75010': { label: 'Paris 10e', lat: 48.875, lng: 2.359 },
    '75011': { label: 'Paris 11e', lat: 48.8599, lng: 2.3775 },
    '75012': { label: 'Paris 12e', lat: 48.8353, lng: 2.3958 },
    '75013': { label: 'Paris 13e', lat: 48.8292, lng: 2.3551 },
    '75014': { label: 'Paris 14e', lat: 48.8323, lng: 2.325 },
    '75015': { label: 'Paris 15e', lat: 48.8419, lng: 2.3034 },
    '75016': { label: 'Paris 16e', lat: 48.8602, lng: 2.27 },
    '75017': { label: 'Paris 17e', lat: 48.8876, lng: 2.3079 },
    '75018': { label: 'Paris 18e', lat: 48.8913, lng: 2.344 },
    '75019': { label: 'Paris 19e', lat: 48.8896, lng: 2.3772 },
    '75020': { label: 'Paris 20e', lat: 48.8674, lng: 2.3984 },
  };

  const DEPT_FALLBACK_COORDS = {
    '75': { label: 'Paris', lat: 48.8566, lng: 2.3522 },
    '77': { label: 'Seine-et-Marne', lat: 48.5396, lng: 2.6526 },
    '78': { label: 'Yvelines', lat: 48.8049, lng: 2.1204 },
    '91': { label: 'Essonne', lat: 48.6298, lng: 2.4417 },
    '92': { label: 'Hauts-de-Seine', lat: 48.8927825, lng: 2.2073652 },
    '93': { label: 'Seine-Saint-Denis', lat: 48.9047, lng: 2.4395 },
    '94': { label: 'Val-de-Marne', lat: 48.7904, lng: 2.455 },
    '95': { label: "Val-d'Oise", lat: 49.036, lng: 2.063 },
  };

  const getDeptFallbackCoordinates = (postalCode) => {
    if (!postalCode) {
      return null;
    }
    const str = postalCode.toString().trim();
    if (str.length < 2) {
      return null;
    }
    const dept = str.slice(0, 2);
    const entry = DEPT_FALLBACK_COORDS[dept];
    if (!entry) {
      return null;
    }
    return { lat: entry.lat, lng: entry.lng, label: entry.label, postalCode: str };
  };

  const GEOCODE_STORAGE_KEY = `echecs92:clubs-fr:geocode:${GEO_HINTS_VERSION}`;
  const GEO_WARM_KEY = `echecs92:clubs-fr:geocode-warm:${GEO_HINTS_VERSION}`;
  const GEO_WARM_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours : les adresses changent rarement
  const GEOCODE_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
  const geocodeCache = new Map();
  const GEO_HINTS_STORAGE_KEY = `echecs92:clubs-fr:geo-hints:${GEO_HINTS_VERSION}`;
  const geoHintsCache = new Map();

  const loadGeocodeCache = () => {
    try {
      const raw = window.localStorage.getItem(GEOCODE_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([key, value]) => geocodeCache.set(key, value));
      }
    } catch {
      // ignore
    }
  };

  const persistGeocodeCache = () => {
    try {
      const obj = {};
      geocodeCache.forEach((value, key) => {
        obj[key] = value;
      });
      window.localStorage.setItem(GEOCODE_STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  };

  const loadGeoHintsCache = () => {
    try {
      const raw = window.localStorage.getItem(GEO_HINTS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([key, value]) => geoHintsCache.set(key, value));
      }
    } catch {
      // ignore
    }
  };

  const persistGeoHintsCache = () => {
    try {
      const obj = {};
      geoHintsCache.forEach((value, key) => {
        obj[key] = value;
      });
      window.localStorage.setItem(GEO_HINTS_STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  };

  const loadGeocodeWarmTs = () => {
    try {
      const raw = window.localStorage.getItem(GEO_WARM_KEY);
      if (!raw) {
        return 0;
      }
      const ts = Number.parseInt(raw, 10);
      return Number.isFinite(ts) ? ts : 0;
    } catch {
      return 0;
    }
  };

  const persistGeocodeWarmTs = () => {
    try {
      window.localStorage.setItem(GEO_WARM_KEY, `${Date.now()}`);
    } catch {
      // ignore
    }
  };

  const GEOCODE_ENABLED = false;

  const geocodePlace = (query, options = {}) => {
    if (!GEOCODE_ENABLED) {
      return Promise.resolve(null);
    }
    const expectedPostal = (options.postalCode || '').toString().trim();
    const allowPostalMismatch = options.allowMismatch === true;
    const normalizedQuery = normalise(query).replace(/\s+/g, ' ').trim();
    const key = `${normalizedQuery}|${expectedPostal}`;
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
      q: expectedPostal ? `${query} ${expectedPostal}` : query,
    });

    const request = fetch(`${GEOCODE_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'echecs92-clubs-map-fr/1.0 (contact@echecs92.com)',
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
        const first = payload[0];
        const lat = Number.parseFloat(first.lat);
        const lng = Number.parseFloat(first.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return null;
        }
        const postalCodeRaw = first?.address?.postcode || '';
        const postalCode = postalCodeRaw.split(';')[0].trim();
        if (!allowPostalMismatch && expectedPostal && postalCode && postalCode !== expectedPostal) {
          return null;
        }
        return {
          lat,
          lng,
          label: formatCommune(first.display_name || ''),
          postalCode: postalCode || expectedPostal,
        };
      })
      .catch(() => null)
      .then((result) => {
        geocodeCache.set(key, result);
        persistGeocodeCache();
        return result;
      });

    geocodeCache.set(key, request);
    return request;
  };

  let staticGeoHintsPromise = null;
  const loadStaticGeoHints = () => {
    if (!staticGeoHintsPromise) {
      staticGeoHintsPromise = fetchJson(GEO_HINTS_REMOTE_URL)
        .then((payload) => {
          const hints = payload && typeof payload === 'object' ? payload.hints || {} : {};
          const map = new Map();
          Object.entries(hints).forEach(([slug, value]) => {
            if (!value || typeof value !== 'object') {
              return;
            }
            const lat = Number.parseFloat(value.lat);
            const lng = Number.parseFloat(value.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
              return;
            }
            const precision =
              value.precision ||
              (typeof value.source === 'string' && value.source.toLowerCase().includes('manual') ? 'exact' : 'geocoded');
            map.set(slug, {
              lat,
              lng,
              postalCode: value.postalCode || '',
              precision,
            });
          });
          return map;
        })
        .catch(() => new Map());
    }
    return staticGeoHintsPromise;
  };

  const geocodeClubIfNeeded = async (club) => {
    if (!club || typeof club !== 'object') {
      return false;
    }
    if (!needsPreciseCoordinates(club)) {
      return false;
    }
    const postalCandidates = collectPostalCodes(club);
    const expectedPostal = postalCandidates[0] || '';
    const queries = [
      club.addressStandard || '',
      club.address || '',
      club.siege || '',
      (club.commune && expectedPostal) ? `${club.commune} ${expectedPostal}` : '',
      club.commune || '',
      expectedPostal,
      club.name || '',
    ]
      .map((q) => (q || '').trim())
      .filter(Boolean);

    const attemptGeocode = async (postalConstraint, allowMismatch) => {
      for (let i = 0; i < queries.length; i += 1) {
        const q = queries[i];
        try {
          const place = await geocodePlace(q, { postalCode: postalConstraint, allowMismatch });
          if (place) {
            club.latitude = place.lat;
            club.longitude = place.lng;
            club._coordPrecision = 'geocoded';
            if (!club.postalCode && place.postalCode) {
              club.postalCode = place.postalCode;
            }
            const signature = buildClubSignature(club);
            if (signature) {
              geoHintsCache.set(signature, {
                lat: club.latitude,
                lng: club.longitude,
                postalCode: club.postalCode || postalConstraint || '',
                precision: 'geocoded',
              });
              persistGeoHintsCache();
            }
            return true;
          }
        } catch {
          // try next query
        }
      }
      return false;
    };

    // First pass: keep postal constraint for precision.
    const strictResult = await attemptGeocode(expectedPostal, false);
    if (strictResult) {
      return true;
    }
    // Second pass: relax postal to match geocoder result if strict search failed.
    const relaxedResult = await attemptGeocode('', true);
    if (relaxedResult) {
      return true;
    }

    return false;
  };

  const buildClubSignature = (club) => {
    const parts = [
      club.id || '',
      club.name || '',
      club.addressStandard || club.address || '',
      club.siege || '',
      club.postalCode || '',
      club.commune || '',
    ]
      .map((part) => (part || '').toString().trim().toLowerCase())
      .filter(Boolean);
    return parts.join('|');
  };

  const applyStaticHints = (clubs, hints) => {
    if (!(hints instanceof Map) || !hints.size) {
      return;
    }
    clubs.forEach((club) => {
      const key = club.slug || club.id || '';
      if (!key || !hints.has(key)) {
        return;
      }
      const hint = hints.get(key);
      if (!hint) {
        return;
      }
      const lat = Number.parseFloat(hint.lat);
      const lng = Number.parseFloat(hint.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return;
      }
      const precision = hint.precision || 'geocoded';
      club.latitude = lat;
      club.longitude = lng;
      club._coordPrecision = precision;
      if (!club.postalCode && hint.postalCode) {
        club.postalCode = hint.postalCode;
      }
      const signature = buildClubSignature(club);
      if (signature) {
        geoHintsCache.set(signature, { lat, lng, postalCode: club.postalCode || '', precision });
      }
    });
  };

  const needsPreciseCoordinates = () => false;

  const geocodeClubsBatch = async (clubs, options = {}) => {
    const items = Array.isArray(clubs) ? clubs : [];
    const limit = Number.isFinite(options.limit) ? options.limit : 120;
    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 150;
    const concurrency = Math.max(1, Math.min(8, Number.parseInt(options.concurrency || 4, 10)));
    let processed = 0;
    let index = 0;

    const worker = async () => {
      while (processed < limit && index < items.length) {
        const current = items[index];
        index += 1;
        if (!current) {
          continue;
        }
        const did = await geocodeClubIfNeeded(current);
        if (did) {
          processed += 1;
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }
    };

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
    return processed;
  };

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
    const baseCommune = formatCommune(communeRaw);
    const postalCode = raw.code_postal || raw.postal_code || addressParts.postalCode || secondaryParts.postalCode || '';
    const commune = formatCommuneWithPostal(baseCommune, postalCode);
    const standardAddress = buildStandardAddress(
      primaryAddress,
      secondaryAddress,
      postalCode,
      commune || baseCommune || addressParts.city || secondaryParts.city || ''
    );
    const slugSource = name || commune || postalCode || primaryAddress || secondaryAddress;
    const id = raw.id || slugify(slugSource) || 'club';

    const toFloat = (value) => {
      if (value == null || value === '') {
        return null;
      }
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const latitude =
      toFloat(raw.latitude ?? raw.lat ?? raw.location?.latitude ?? raw.location?.lat) ?? null;
    const longitude =
      toFloat(raw.longitude ?? raw.lng ?? raw.lon ?? raw.location?.longitude ?? raw.location?.lng) ??
      null;

    return {
      id,
      name: name || commune || 'Club sans nom',
      commune,
      address: primaryAddress || secondaryAddress || '',
      siege: secondaryAddress || '',
      phone: raw.telephone || raw.phone || '',
      email: raw.email || '',
      site: raw.site || raw.website || '',
      postalCode,
      addressStandard: standardAddress,
      addressDisplay: standardAddress || primaryAddress || secondaryAddress || '',
      latitude,
      longitude,
      slug: '',
      _communeSlug: slugify(commune || baseCommune || ''),
      departmentCode:
        raw.departmentCode ||
        raw.department_code ||
        raw.department ||
        raw.departement ||
        raw.dept ||
        '',
      departmentName: raw.departmentName || raw.department_name || raw.departement_nom || raw.departmentLabel || '',
      departmentSlug: raw.departmentSlug || raw.department_slug || raw.departement_slug || '',
    };
  };

  const resolveClubCoordinates = (club) => {
    if (!club) {
      return null;
    }

    const signature = buildClubSignature(club);
    if (signature && geoHintsCache.has(signature)) {
      const hint = geoHintsCache.get(signature);
      const lat = Number.parseFloat(hint.lat);
      const lng = Number.parseFloat(hint.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        club.latitude = lat;
        club.longitude = lng;
        if (hint.postalCode && !club.postalCode) {
          club.postalCode = hint.postalCode;
        }
        club._coordPrecision = hint.precision || 'hint';
      }
    }

    const directLat = Number.parseFloat(club.latitude ?? club.lat);
    const directLng = Number.parseFloat(club.longitude ?? club.lng ?? club.lon);
    if (Number.isFinite(directLat) && Number.isFinite(directLng)) {
      const precision = club._coordPrecision || 'exact';
      return {
        lat: directLat,
        lng: directLng,
        label: club.commune || club.addressStandard || club.address || club.name || '',
        postalCode: club.postalCode || '',
        precision,
      };
    }

    if (club.addressStandard) {
      const addressFallback = lookupLocalCoordinates(club.addressStandard);
      if (addressFallback) {
        return {
          lat: addressFallback.latitude,
          lng: addressFallback.longitude,
          label: addressFallback.label || club.addressStandard,
          postalCode: addressFallback.postalCode || '',
          precision: 'approx',
        };
      }
    }

    if (club.commune) {
      const coords = getCommuneCoordinatesByName(club.commune);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode, precision: 'commune' };
      }
    }

    const postalCandidates = collectPostalCodes(club);
    for (let i = 0; i < postalCandidates.length; i += 1) {
      const coords = getPostalCoordinates(postalCandidates[i]);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode, precision: 'postal' };
      }
    }

    const parisPostal = deriveParisPostalFromClub(club);
    if (parisPostal) {
      const coords = getPostalCoordinates(parisPostal);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode, precision: 'postal' };
      }
    }

    if (club.addressStandard) {
      const addressFallback = lookupLocalCoordinates(club.addressStandard);
      if (addressFallback) {
        return {
          lat: addressFallback.latitude,
          lng: addressFallback.longitude,
          label: addressFallback.label || club.addressStandard,
          postalCode: addressFallback.postalCode || '',
          precision: 'approx',
        };
      }
    }

    if (club.commune) {
      const fallback = lookupLocalCoordinates(club.commune);
      if (fallback) {
        return {
          lat: fallback.latitude,
          lng: fallback.longitude,
          label: fallback.label || club.commune,
          postalCode: fallback.postalCode || '',
          precision: 'commune',
        };
      }
    }

    return null;
  };

  const buildFeaturesFromClubs = (clubs) => {
    const list = [];
    (Array.isArray(clubs) ? clubs : []).forEach((club) => {
      const coords = resolveClubCoordinates(club);
      const precision = coords?.precision || 'unknown';
      const isParisHint = precision === 'hint' && isParisPostal(club.postalCode);
      if (coords && COORD_PRECISION_ALLOWED[precision] && !isParisHint) {
        list.push({ club, coords });
      }
    });
    return list;
  };

  const getClubDetailUrl = (club) => {
    if (!club) {
      return '#';
    }
    const base = detailBase || '';
    const slug = club.slug || club._communeSlug || club.id || slugify(club.name || '');
    if (!base) {
      return `?club=${encodeURIComponent(slug)}`;
    }
    if (base.includes('?')) {
      const url = new URL(base, window.location.origin);
      const firstParam = Array.from(url.searchParams.keys())[0] || 'id';
      url.searchParams.set(firstParam, slug);
      return url.pathname + url.search;
    }
    const normalized = base.endsWith('/') ? base : `${base}/`;
    return `${normalized}${encodeURIComponent(slug)}/`;
  };

  const formatPrecisionLabel = (precision) => {
    if (precision === 'exact') {
      return 'Précision : adresse exacte';
    }
    if (precision === 'hint') {
      return 'Précision : point validé';
    }
    return '';
  };

  const createPopupContent = (club, coords) => {
    const lines = [`<strong>${club.name}</strong>`];
    if (club.commune) {
      lines.push(club.commune);
    }
    if (club.addressDisplay) {
      lines.push(club.addressDisplay);
    }
    const precisionLabel = formatPrecisionLabel(coords?.precision);
    if (precisionLabel) {
      lines.push(`<span class="clubs-map__precision">${precisionLabel}</span>`);
    }
    const detailUrl = getClubDetailUrl(club);
    lines.push(`<a class="clubs-map__detail-link" href="${detailUrl}">Voir la fiche</a>`);
    return lines.join('<br>');
  };

  const handleMapLinkInteraction = (event) => {
    const target = event.target;
    if (!target || !(target instanceof Element)) {
      return;
    }
    if (!target.classList.contains('clubs-map__detail-link')) {
      return;
    }
    if (event.type === 'auxclick' && event.button !== 1) {
      return;
    }
    const fromListingPage = mapHostPath === '/clubs';
    const backPath = getCurrentBackPath();
    const fallbackBackPath = fromListingPage ? '/clubs' : '/carte-des-clubs';
    rememberNavigation('detail:map', backPath || fallbackBackPath);
  };

  mapElement.addEventListener('click', handleMapLinkInteraction);
  mapElement.addEventListener('auxclick', handleMapLinkInteraction);

  updateStatus('Chargement de la carte…', 'info');
  const releaseSpinner =
    typeof window !== 'undefined' && window.cdjeSpinner && typeof window.cdjeSpinner.show === 'function'
      ? window.cdjeSpinner.show('Chargement de la carte…')
      : () => {};

  const waitForLeaflet = () =>
    new Promise((resolve, reject) => {
      if (typeof L !== 'undefined') {
        resolve(true);
        return;
      }
      const started = Date.now();
      const check = setInterval(() => {
        if (typeof L !== 'undefined') {
          clearInterval(check);
          resolve(true);
          return;
        }
        if (Date.now() - started > 8000) {
          clearInterval(check);
          reject(new Error('leaflet-unavailable'));
        }
      }, 80);
    });

  loadGeocodeCache();
  loadGeoHintsCache();

  waitForLeaflet()
    .then(() => Promise.all([loadFranceClubsDataset(), loadStaticGeoHints()]))
    .then(([payload, staticHints]) => {
      const data = Array.isArray(payload) ? payload : [];
      if (!data.length) {
        updateStatus('Aucun club à afficher pour le moment.', 'error');
        return;
      }

      const clubs = data.map(adaptClubRecord);
      ensureUniqueSlugs(clubs);
      applyStaticHints(clubs, staticHints);

      mapFeatures = buildFeaturesFromClubs(clubs);

      mapInstance = L.map(mapElement, {
        zoomControl: true,
        scrollWheelZoom: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(mapInstance);

      markersLayer =
        typeof L.markerClusterGroup === 'function'
          ? L.markerClusterGroup({
              showCoverageOnHover: false,
              spiderfyOnMaxZoom: true,
              maxClusterRadius: 60,
              chunkedLoading: true,
              disableClusteringAtZoom: 14,
            }).addTo(mapInstance)
          : L.layerGroup().addTo(mapInstance);

      const renderMarkers = (list, { refit = false } = {}) => {
        markersLayer.clearLayers();
        const bounds = L.latLngBounds();
        list.forEach(({ club, coords }) => {
          const marker = L.marker([coords.lat, coords.lng], {
            title: club.name,
          });
          marker.bindPopup(createPopupContent(club, coords), {
            keepInView: true,
          });
          if (typeof markersLayer.addLayer === 'function') {
            markersLayer.addLayer(marker);
          } else {
            marker.addTo(markersLayer);
          }
          bounds.extend([coords.lat, coords.lng]);
        });
        if (bounds.isValid()) {
          fullBounds = bounds;
        }
        if (bounds.isValid() && (refit || !hasFittedView)) {
          if (list.length === 1) {
            mapInstance.setView(bounds.getCenter(), 13);
          } else {
            mapInstance.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
          }
          hasFittedView = true;
        }
      };

      if (mapFeatures.length) {
        renderMarkers(mapFeatures, { refit: true });
        updateStatus(
          `${mapFeatures.length} club${mapFeatures.length > 1 ? 's' : ''} affiché${mapFeatures.length > 1 ? 's' : ''} sur la carte.`,
          'success'
        );
      } else {
        updateStatus('Aucun club positionné pour le moment.', 'error');
      }

      flushPendingMapFocus();
      setTimeout(() => {
        mapInstance.invalidateSize();
        flushPendingMapFocus();
      }, 100);
    })
    .catch((error) => {
      console.error('[clubs-fr-map] Chargement de la carte impossible', error);
      const code = error && typeof error.message === 'string' ? error.message : '';
      if (code === 'leaflet-unavailable') {
        updateStatus('Impossible de charger la carte (Leaflet indisponible). Réessayez dans un instant.', 'error');
      } else {
        updateStatus('Impossible de charger la carte pour le moment. Veuillez réessayer plus tard.', 'error');
      }
    })
    .finally(() => {
      if (typeof releaseSpinner === 'function') {
        releaseSpinner();
      } else if (releaseSpinner && typeof releaseSpinner.hide === 'function') {
        releaseSpinner.hide();
      }
    });
})();
