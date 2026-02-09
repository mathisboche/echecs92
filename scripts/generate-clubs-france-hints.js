#!/usr/bin/env node
/**
 * Geocode all France clubs and produce a static hints file to speed up map rendering.
 * Uses Nominatim with a small delay to stay polite.
 */
const fs = require('fs/promises');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_ROOT = path.join(ROOT, 'wp-content', 'themes', 'echecs92-child', 'assets', 'data');
const MANIFEST_PATH = path.join(DATA_ROOT, 'clubs-france.json');
const OUTPUT_PATH = path.join(DATA_ROOT, 'clubs-france-hints.json');
const POSTAL_COORDINATES_PATH = path.join(DATA_ROOT, 'postal-coordinates-fr.json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalise = (value) =>
  (value || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const normaliseCommuneKey = (value) => normalise(value).replace(/[^a-z0-9]/g, '');

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

const getParisArrondissementFromPostal = (postalCode) => {
  const code = (postalCode || '').toString().trim();
  if (code === '75116') {
    return 16;
  }
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

const slugify = (value) => {
  const base = normalise(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

const parsePostalCodeFromString = (input) => {
  const str = (input || '').toString();
  const strict = str.match(/\b(\d{5})\b/);
  if (strict) {
    return strict[1];
  }
  const spaced = str.match(/\b(\d{2})\s*(\d{3})\b/);
  if (spaced) {
    return `${spaced[1]}${spaced[2]}`;
  }
  return '';
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

	  const cleanCity = (raw) =>
	    (raw || '')
	      .toString()
	      .replace(/\b\d{4,5}\b/g, ' ')
	      .replace(/^[,;\s\-\u2013\u2014]+/, '')
	      .replace(/\s+/g, ' ')
	      .trim();

  const postal = parsePostalCodeFromString(result.full);
  if (postal) {
    result.postalCode = postal;
    const pattern = new RegExp(`\\b${postal.slice(0, 2)}\\s*${postal.slice(2)}\\b`, 'i');
    const match = result.full.match(pattern);
    if (match) {
      const idx = Number.isFinite(match.index) ? match.index : result.full.indexOf(match[0]);
      const after = result.full.slice(idx + match[0].length).trim();
      const before = result.full.slice(0, idx).trim();
      if (after) {
        result.city = cleanCity(after);
      }
      if (!result.city && before) {
        const segments = before.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
        const tail = segments.length ? segments[segments.length - 1] : before;
        result.city = cleanCity(tail);
      }
    }
  }

  if (!result.city) {
    const parts = result.full
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length) {
      const last = parts[parts.length - 1];
      const cleaned = cleanCity(last);
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

const looksLikeDetailedAddress = (value) => {
  const raw = (value || '').toString().trim();
  if (!raw) {
    return false;
  }
  if (!/\d/.test(raw)) {
    return false;
  }
  return STREET_KEYWORDS.test(raw);
};

const deriveCityFromPostal = (address, postalHint = '') => {
  const raw = (address || '').toString();
  if (!raw.trim()) {
    return '';
  }
  const postal = parsePostalCodeFromString(raw) || (postalHint || '').toString().replace(/\D/g, '');
  if (!postal) {
    return '';
  }
  const pattern = new RegExp(`\\b${postal.slice(0, 2)}\\s*${postal.slice(2)}\\b`, 'i');
  const match = raw.match(pattern);
  if (!match) {
    return '';
  }
  const idx = Number.isFinite(match.index) ? match.index : raw.indexOf(match[0]);
	  const after = raw.slice(idx + match[0].length).trim();
	  if (after) {
	    return after.replace(/^[,;\s\-\u2013\u2014]+/, '').trim();
	  }
  const before = raw.slice(0, idx).trim();
  if (!before) {
    return '';
  }
  const segments = before.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
  return (segments.length ? segments[segments.length - 1] : before).trim();
};

const cleanCommuneCandidate = (value, postalCode) => {
  if (!value) {
    return '';
  }
  const postal = (postalCode || '').toString().replace(/\D/g, '');
	  let cleaned = value
	    .toString()
	    .replace(/\b\d{4,5}\b/g, ' ')
	    .replace(/^[,;\s\-\u2013\u2014]+/, ' ')
	    .replace(/\s+/g, ' ')
	    .trim();
  if (postal) {
    const pattern = new RegExp(`\\b${postal.slice(0, 2)}\\s*${postal.slice(2)}\\b`, 'gi');
    cleaned = cleaned.replace(pattern, ' ').trim();
  }
  cleaned = cleaned.replace(/^\d+\s+/, '').replace(/\s+/g, ' ').trim();
  return formatCommune(cleaned);
};

const scoreCommuneCandidate = (value) => {
  if (!value) {
    return -Infinity;
  }
  let score = 0;
  const hasDigits = /\d/.test(value);
  if (!hasDigits) {
    score += 4;
  } else if (!/^paris\s*\d{1,2}/i.test(value)) {
    score -= 2;
  }
  if (looksLikeDetailedAddress(value)) {
    score -= 4;
  }
  if (value.length >= 3) {
    score += 1;
  }
  return score;
};

const pickBestCommune = (candidates, postalCode) => {
  let best = '';
  let bestScore = -Infinity;
  (candidates || []).forEach((raw) => {
    const cleaned = cleanCommuneCandidate(raw, postalCode);
    if (!cleaned) {
      return;
    }
    const score = scoreCommuneCandidate(cleaned);
    if (score > bestScore) {
      bestScore = score;
      best = cleaned;
    }
  });
  return best || '';
};

const rankPostalCandidate = (code) => {
  if (!code) {
    return -Infinity;
  }
  let score = 0;
  if (/^\d{5}$/.test(code)) {
    score += 1;
  }
  if (postalCoordinatesIndex.size && postalCoordinatesIndex.has(code)) {
    score += 3;
  }
  return score;
};

const collectPostalCodes = (club) => {
  const codes = new Set();
  const add = (value) => {
    const parsed = parsePostalCodeFromString(value || '');
    const canonical = parsed ? canonicalizeParisPostalCode(parsed) || parsed : '';
    if (canonical) {
      codes.add(canonical);
    }
  };
  if (club.postalCode) {
    add(club.postalCode);
  }
  [club.address, club.siege, club.addressStandard].forEach((value) => {
    add(value);
    const matches = (value || '').match(/\b\d{5}\b/g);
    if (matches) {
      matches.forEach((code) => add(code));
    }
  });
  return Array.from(codes).sort((a, b) => rankPostalCandidate(b) - rankPostalCandidate(a));
};

const adaptClubRecord = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return raw;
  }
  if (raw.id && raw.name && raw.slug) {
    return raw;
  }
  const name = raw.nom || raw.name || '';
  const primaryAddress = raw.adresse || raw.address || '';
  const addressParts = extractAddressParts(primaryAddress);
  const secondaryAddress = raw.siege || raw.siege_social || raw.address2 || '';
  const secondaryParts = extractAddressParts(secondaryAddress);
  const postalCode =
    raw.code_postal ||
    raw.postal_code ||
    raw.postalCode ||
    addressParts.postalCode ||
    secondaryParts.postalCode ||
    '';
  const postalForCommune = postalCode || addressParts.postalCode || secondaryParts.postalCode || '';
  const communeCandidates = [
    raw.commune,
    raw.ville,
    addressParts.city,
    secondaryParts.city,
    deriveCityFromPostal(primaryAddress, postalForCommune),
    deriveCityFromPostal(secondaryAddress, postalForCommune),
  ];
  const baseCommune = pickBestCommune(communeCandidates, postalForCommune);
  const commune = formatCommuneWithPostal(baseCommune, postalForCommune);
  const standardAddress = buildStandardAddress(
    primaryAddress,
    secondaryAddress,
    postalCode,
    commune || baseCommune || addressParts.city || secondaryParts.city || ''
  );
  const slugSource = commune || name || postalForCommune || primaryAddress || secondaryAddress;
  const id = raw.id || slugify(name || slugSource) || 'club';

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
    ...raw,
    id,
    name: name || commune || 'Club sans nom',
    commune,
    address: primaryAddress || secondaryAddress || '',
    siege: secondaryAddress || '',
    postalCode,
    addressStandard: standardAddress,
    addressDisplay: standardAddress || primaryAddress || secondaryAddress || '',
    latitude,
    longitude,
    slug: '',
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

const issueLog = {
  suspect: [],
  failed: [],
  fallback: [],
  forced: [],
};

const buildIssueLabel = (club) =>
  `${club.name || 'Club'}${club.slug ? ` (${club.slug})` : ''}`;

const recordIssue = (type, club, details = {}) => {
  if (!issueLog[type]) {
    issueLog[type] = [];
  }
  const payload = {
    name: club?.name || '',
    slug: club?.slug || '',
    postalCode: club?.postalCode || '',
    commune: club?.commune || '',
    ...details,
  };
  issueLog[type].push(payload);
  const base = buildIssueLabel(club);
  const info = details.message ? ` - ${details.message}` : '';
  console.warn(`[geocode:${type}] ${base}${info}`);
};

const printIssueSummary = () => {
  const order = ['failed', 'suspect', 'fallback', 'forced'];
  const total = order.reduce((sum, key) => sum + (issueLog[key]?.length || 0), 0);
  if (!total) {
    return;
  }
  console.warn('--- Geocode issues summary ---');
  order.forEach((key) => {
    const entries = issueLog[key] || [];
    if (!entries.length) {
      return;
    }
    console.warn(`${key.toUpperCase()} (${entries.length})`);
    entries.forEach((entry) => {
      const label = entry.name || entry.slug || 'club';
      const extras = [];
      if (entry.postalCode) {
        extras.push(`CP ${entry.postalCode}`);
      }
      if (entry.commune) {
        extras.push(entry.commune);
      }
      if (Number.isFinite(entry.distanceKm)) {
        extras.push(`${entry.distanceKm.toFixed(1)} km`);
      }
      if (Number.isFinite(entry.lat) && Number.isFinite(entry.lng)) {
        extras.push(`(${entry.lat.toFixed(5)}, ${entry.lng.toFixed(5)})`);
      }
      if (entry.message) {
        extras.push(entry.message);
      }
      const suffix = extras.length ? ` | ${extras.join(' | ')}` : '';
      console.warn(`- ${label}${suffix}`);
    });
  });
  console.warn('--- End geocode issues summary ---');
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

const MONACO_COORDS = {
  label: 'Monaco',
  lat: 43.7384,
  lng: 7.4246,
  postalCode: '98000',
};

const MAX_GEO_DISTANCE_KM = 200;

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
  return { lat: entry.lat, lng: entry.lng, postalCode: str };
};

const postalCoordinatesIndex = new Map();

const canonicalizeParisPostalCode = (postalCode) => {
  const code = (postalCode || '').toString().trim();
  if (code === '75116') {
    return '75016';
  }
  return code;
};

const loadPostalCoordinatesIndex = async () => {
  if (postalCoordinatesIndex.size) {
    return;
  }
  try {
    const raw = await fs.readFile(POSTAL_COORDINATES_PATH, 'utf8');
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) {
      return;
    }
    entries.forEach((entry) => {
      if (!Array.isArray(entry) || entry.length < 3) {
        return;
      }
      const [code, lat, lng, label] = entry;
      const postal = code ? code.toString().trim() : '';
      const latValue = Number.parseFloat(lat);
      const lngValue = Number.parseFloat(lng);
      if (!postal || !Number.isFinite(latValue) || !Number.isFinite(lngValue)) {
        return;
      }
      postalCoordinatesIndex.set(postal, { lat: latValue, lng: lngValue, label: label || '' });
    });
  } catch (error) {
    // ignore missing or invalid postal coordinate data
  }
};

const getPostalCoordinates = (postalCode) => {
  if (!postalCode) {
    return null;
  }
  const code = canonicalizeParisPostalCode(postalCode);
  if (code === MONACO_COORDS.postalCode) {
    return { ...MONACO_COORDS };
  }
  const entry = postalCoordinatesIndex.get(code);
  if (!entry) {
    return null;
  }
  return { postalCode: code, lat: entry.lat, lng: entry.lng, label: entry.label };
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

const isPlausibleCoordinate = (lat, lng, postalCode) => {
  const reference = getPostalCoordinates(postalCode);
  if (!reference) {
    return true;
  }
  const distance = haversineKm(lat, lng, reference.lat, reference.lng);
  return distance <= MAX_GEO_DISTANCE_KM;
};

const GEOCODE_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const GEOCODE_BAN_ENDPOINT = 'https://api-adresse.data.gouv.fr/search/';
const GEO_COMPARE_DISTANCE_KM = 80;

const geocodePlace = async (query, options = {}) => {
  const expectedPostal = canonicalizeParisPostalCode((options.postalCode || '').toString().trim());
  const allowMismatch = options.allowMismatch === true;
  const q = (query || '').trim();
  if (!q) {
    return null;
  }
  const params = new URLSearchParams({
    format: 'json',
    addressdetails: '1',
    limit: '1',
    countrycodes: 'fr',
    q: expectedPostal && !q.includes(expectedPostal) ? `${q} ${expectedPostal}` : q,
  });
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller && Number.isFinite(options.timeoutMs || 0) && (options.timeoutMs || 0) > 0
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : controller
      ? setTimeout(() => controller.abort(), 15000)
      : null;
  try {
    const response = await fetch(`${GEOCODE_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'echecs92-clubs-fr/1.0 (contact@echecs92.com)',
      },
      signal: controller?.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
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
    const postalCode = canonicalizeParisPostalCode(postalCodeRaw.split(';')[0].trim());
    if (!allowMismatch && expectedPostal && postalCode && postalCode !== expectedPostal) {
      return null;
    }
    return {
      lat,
      lng,
      postalCode: postalCode || expectedPostal,
      label: first.display_name || '',
      source: allowMismatch ? 'geocode-relaxed' : 'geocode-strict',
    };
  } catch (error) {
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const geocodePlaceBan = async (query, options = {}) => {
  const expectedPostal = canonicalizeParisPostalCode((options.postalCode || '').toString().trim());
  const allowMismatch = options.allowMismatch === true;
  const q = (query || '').trim();
  if (!q) {
    return null;
  }
  const params = new URLSearchParams({
    q,
    limit: '1',
    autocomplete: '0',
  });
  if (expectedPostal) {
    params.set('postcode', expectedPostal);
  }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller && Number.isFinite(options.timeoutMs || 0) && (options.timeoutMs || 0) > 0
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : controller
      ? setTimeout(() => controller.abort(), 15000)
      : null;
  try {
    const response = await fetch(`${GEOCODE_BAN_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'echecs92-clubs-fr/1.0 (contact@echecs92.com)',
      },
      signal: controller?.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    const feature = Array.isArray(payload?.features) ? payload.features[0] : null;
    if (!feature) {
      return null;
    }
    const coords = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
    const lng = Number.parseFloat(coords[0]);
    const lat = Number.parseFloat(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    const postalCodeRaw = feature?.properties?.postcode || feature?.properties?.postalcode || '';
    const postalCode = canonicalizeParisPostalCode(postalCodeRaw.toString().trim());
    if (!allowMismatch && expectedPostal && postalCode && postalCode !== expectedPostal) {
      return null;
    }
    return {
      lat,
      lng,
      postalCode: postalCode || expectedPostal,
      label: feature?.properties?.label || '',
      source: allowMismatch ? 'ban-relaxed' : 'ban-strict',
    };
  } catch (error) {
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const isMonacoClub = (club, postalCandidates) => {
  if ((postalCandidates || []).some((code) => /^980\d{2}$/.test((code || '').toString()))) {
    return true;
  }
  const name = normalise(club.name || '');
  const commune = normalise(club.commune || '');
  if (name.includes('monaco') || commune.includes('monaco')) {
    return true;
  }
  const addressCity = extractAddressParts(club.address || '').city || '';
  const siegeCity = extractAddressParts(club.siege || '').city || '';
  const standardCity = extractAddressParts(club.addressStandard || '').city || '';
  const cityProbe = normalise([addressCity, siegeCity, standardCity].filter(Boolean).join(' '));
  return cityProbe.includes('monaco');
};

const validateGeocodeResult = (result, expectedPostal) => {
  if (!result || !Number.isFinite(result.lat) || !Number.isFinite(result.lng)) {
    return { ok: false, reason: 'invalid' };
  }
  const postalForCheck = expectedPostal || result.postalCode || '';
  if (!postalForCheck) {
    return { ok: true, reason: 'no-postal' };
  }
  const reference = getPostalCoordinates(postalForCheck);
  if (!reference) {
    return { ok: true, reason: 'no-reference' };
  }
  const distance = haversineKm(result.lat, result.lng, reference.lat, reference.lng);
  if (distance <= MAX_GEO_DISTANCE_KM) {
    return { ok: true, distance };
  }
  return { ok: false, reason: 'distance', distance };
};

const pickBestGeocodeCandidate = (expectedPostal, candidates) => {
  const scored = (candidates || [])
    .filter(Boolean)
    .map((candidate) => ({ candidate, check: validateGeocodeResult(candidate, expectedPostal) }));
  if (!scored.length) {
    return null;
  }
  const chooseBest = (list) => {
    const withDistance = list.filter((item) => Number.isFinite(item.check.distance));
    if (withDistance.length) {
      withDistance.sort((a, b) => a.check.distance - b.check.distance);
      return withDistance[0].candidate;
    }
    return list[0].candidate;
  };
  const valid = scored.filter((item) => item.check.ok);
  if (valid.length) {
    return chooseBest(valid);
  }
  return chooseBest(scored);
};

const compareGeocodeProviders = (club, nominatim, ban, contextLabel = '') => {
  if (!nominatim || !ban) {
    return;
  }
  const distance = haversineKm(nominatim.lat, nominatim.lng, ban.lat, ban.lng);
  if (!Number.isFinite(distance) || distance <= GEO_COMPARE_DISTANCE_KM) {
    return;
  }
  const label = contextLabel ? ` pour "${contextLabel}"` : '';
  recordIssue('suspect', club, {
    message: `Écart Nominatim/BAN (${distance.toFixed(1)} km)${label}.`,
    distanceKm: distance,
    lat: nominatim.lat,
    lng: nominatim.lng,
    source: 'compare',
  });
};

const geocodeClub = async (club, options = {}) => {
  const postalCandidates = collectPostalCodes(club);
  const expectedPostal = postalCandidates[0] || '';
  if (isMonacoClub(club, postalCandidates)) {
    recordIssue('forced', club, { message: 'Coordonnées Monaco forcées.' });
    return { ...MONACO_COORDS, source: 'manual-monaco' };
  }
  const nameQuery =
    club.name && (club.commune || expectedPostal)
      ? `${club.name} ${club.commune || ''} ${expectedPostal || ''}`.trim()
      : '';
  const rawQueries = [
    club.addressStandard || '',
    club.address || '',
    club.siege || '',
    club.commune && expectedPostal ? `${club.commune} ${expectedPostal}` : '',
    club.commune || '',
    expectedPostal,
    nameQuery,
  ]
    .map((q) => (q || '').trim())
    .filter(Boolean);
  const queries = Array.from(new Set(rawQueries));
  if (!queries.length) {
    recordIssue('failed', club, { message: 'Aucune adresse exploitable.' });
    return null;
  }

  const attemptGeocode = async (postalConstraint, allowMismatch) => {
    for (const q of queries) {
      const nominatim = await geocodePlace(q, { postalCode: postalConstraint, allowMismatch });
      const ban = await geocodePlaceBan(q, { postalCode: postalConstraint, allowMismatch });
      compareGeocodeProviders(club, nominatim, ban, q);
      const place = pickBestGeocodeCandidate(expectedPostal, [nominatim, ban]);
      if (place) {
        return place;
      }
    }
    return null;
  };

  const strict = await attemptGeocode(expectedPostal, false);
  if (strict) {
    const strictCheck = validateGeocodeResult(strict, expectedPostal);
    if (strictCheck.ok) {
      return strict;
    }
    recordIssue('suspect', club, {
      message: `Coordonnées trop éloignées du code postal ${expectedPostal || 'n/a'}.`,
      distanceKm: strictCheck.distance,
      lat: strict.lat,
      lng: strict.lng,
      source: strict.source,
    });
  }
  const relaxed = await attemptGeocode('', true);
  if (relaxed) {
    const relaxedCheck = validateGeocodeResult(relaxed, expectedPostal);
    if (relaxedCheck.ok) {
      return relaxed;
    }
    recordIssue('suspect', club, {
      message: `Coordonnées trop éloignées du code postal ${expectedPostal || 'n/a'} (recherche relâchée).`,
      distanceKm: relaxedCheck.distance,
      lat: relaxed.lat,
      lng: relaxed.lng,
      source: relaxed.source,
    });
  }
  const postalFallback = getPostalCoordinates(expectedPostal);
  if (postalFallback) {
    recordIssue('fallback', club, { message: `Fallback sur le centroïde postal ${expectedPostal}.` });
    return { ...postalFallback, source: 'postal-fallback' };
  }
  const deptFallback = getDeptFallbackCoordinates(expectedPostal);
  if (deptFallback) {
    recordIssue('fallback', club, { message: `Fallback sur le département ${expectedPostal.slice(0, 2)}.` });
    return { ...deptFallback, source: 'dept-fallback' };
  }
  return null;
};

const loadDepartments = async () => {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  const baseDir = path.join(DATA_ROOT, 'clubs-france');
  const departments = Array.isArray(manifest.departments) ? manifest.departments : [];
  const clubs = [];
  for (const entry of departments) {
    const file = entry.file || '';
    const url = file.startsWith('/') ? file.slice(1) : file;
    const fullPath = path.join(baseDir, url || '');
    const raw = JSON.parse(await fs.readFile(fullPath, 'utf8'));
    const records = Array.isArray(raw) ? raw : [];
    records.forEach((record) => {
      record.departmentCode = entry.code || record.departmentCode || record.departement || '';
      record.departmentName = entry.name || record.departmentName || '';
      record.departmentSlug = entry.slug || record.departmentSlug || '';
    });
    clubs.push(...records);
  }
  return clubs;
};

const loadExistingHints = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') {
      return { meta: null, hints: {} };
    }
    const hints = payload.hints && typeof payload.hints === 'object' ? payload.hints : {};
    return { meta: payload, hints };
  } catch (error) {
    return { meta: null, hints: {} };
  }
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    delay: 650,
    resume: false,
    offset: 0,
    limit: null,
  };
  args.forEach((arg) => {
    if (arg === '--resume') {
      options.resume = true;
    } else if (arg.startsWith('--delay=')) {
      const value = Number.parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(value) && value >= 0) {
        options.delay = value;
      }
    } else if (arg.startsWith('--offset=')) {
      const value = Number.parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(value) && value >= 0) {
        options.offset = value;
      }
    } else if (arg.startsWith('--limit=')) {
      const value = Number.parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(value) && value > 0) {
        options.limit = value;
      }
    }
  });
  return options;
};

const main = async () => {
  const options = parseArgs();
  const DELAY_MS = options.delay;
  await loadPostalCoordinatesIndex();
  const clubsAll = (await loadDepartments()).map(adaptClubRecord);
  const clubs =
    options.limit == null
      ? clubsAll.slice(options.offset)
      : clubsAll.slice(options.offset, options.offset + options.limit);
  ensureUniqueSlugs(clubs);

  let processed = 0;
  let geocoded = 0;
  let fallback = 0;
  const existing = options.resume ? await loadExistingHints(OUTPUT_PATH) : { meta: null, hints: {} };
  const hints = { ...(existing.hints || {}) };
  const flushHints = async () => {
    const sortedKeys = Object.keys(hints).sort();
    const sortedHints = {};
    sortedKeys.forEach((key) => {
      sortedHints[key] = hints[key];
    });
    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      total: options.offset + processed,
      hints: sortedHints,
    };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
    return sortedKeys.length;
  };

  for (const club of clubs) {
    processed += 1;
    if (processed % 120 === 0 || processed === clubs.length) {
      console.log(`→ ${processed}/${clubs.length} clubs traités…`);
    }
    const postalCandidates = collectPostalCodes(club);
    const expectedPostal = postalCandidates[0] || club.postalCode || '';
    const existingHint = hints[club.slug];
    if (existingHint) {
      const lat = Number.parseFloat(existingHint.lat);
      const lng = Number.parseFloat(existingHint.lng);
      const check = validateGeocodeResult(
        { lat, lng, postalCode: existingHint.postalCode || expectedPostal },
        expectedPostal
      );
      if (Number.isFinite(lat) && Number.isFinite(lng) && check.ok) {
        continue;
      }
      recordIssue('suspect', club, {
        message: `Indice existant trop éloigné du code postal ${expectedPostal || 'n/a'}.`,
        distanceKm: check.distance,
        lat,
        lng,
        source: existingHint.source || 'hint',
      });
      delete hints[club.slug];
    }
    if (Number.isFinite(club.latitude) && Number.isFinite(club.longitude)) {
      const check = validateGeocodeResult(
        { lat: club.latitude, lng: club.longitude, postalCode: club.postalCode || expectedPostal },
        expectedPostal
      );
      if (check.ok) {
        hints[club.slug] = { lat: club.latitude, lng: club.longitude, postalCode: club.postalCode || '' };
        continue;
      }
      recordIssue('suspect', club, {
        message: `Coordonnées existantes trop éloignées du code postal ${expectedPostal || 'n/a'}.`,
        distanceKm: check.distance,
        lat: club.latitude,
        lng: club.longitude,
        source: 'club-data',
      });
    }
    const result = await geocodeClub(club);
    if (result) {
      geocoded += result.source && result.source.includes('fallback') ? 0 : 1;
      if (result.source === 'dept-fallback' || result.source === 'postal-fallback') {
        fallback += 1;
      }
      hints[club.slug] = {
        lat: result.lat,
        lng: result.lng,
        postalCode: result.postalCode || club.postalCode || '',
        source: result.source || 'geocode',
      };
    } else {
      recordIssue('failed', club, { message: 'Aucune coordonnée trouvée.' });
    }
    // Be polite with the geocoding service
    await sleep(DELAY_MS);
    if (processed % 50 === 0) {
      await flushHints();
    }
  }

  const totalKeys = await flushHints();
  console.log(`Generated ${OUTPUT_PATH}`);
  console.log(`Clubs: ${processed}, hints: ${totalKeys}, geocoded: ${geocoded}, dept fallback: ${fallback}`);
  printIssueSummary();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
