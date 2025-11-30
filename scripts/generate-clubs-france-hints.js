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
  const communeRaw = raw.commune || raw.ville || addressParts.city || secondaryParts.city || '';
  const commune = formatCommune(communeRaw);
  const postalCode = raw.code_postal || raw.postal_code || addressParts.postalCode || secondaryParts.postalCode || '';
  const standardAddress = buildStandardAddress(
    primaryAddress,
    secondaryAddress,
    postalCode,
    commune || addressParts.city || secondaryParts.city || ''
  );
  const slugSource = commune || name || postalCode || primaryAddress || secondaryAddress;
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
  return { lat: entry.lat, lng: entry.lng, postalCode: str };
};

const GEOCODE_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

const geocodePlace = async (query, options = {}) => {
  const expectedPostal = (options.postalCode || '').toString().trim();
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
  try {
    const response = await fetch(`${GEOCODE_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'echecs92-clubs-fr/1.0 (contact@echecs92.com)',
      },
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
    const postalCode = postalCodeRaw.split(';')[0].trim();
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
  }
};

const geocodeClub = async (club, options = {}) => {
  const postalCandidates = collectPostalCodes(club);
  const expectedPostal = postalCandidates[0] || '';
  const queries = [
    club.addressStandard || '',
    club.address || '',
    club.siege || '',
    club.commune && expectedPostal ? `${club.commune} ${expectedPostal}` : '',
    club.commune || '',
    expectedPostal,
    club.name || '',
  ]
    .map((q) => (q || '').trim())
    .filter(Boolean);

  const attemptGeocode = async (postalConstraint, allowMismatch) => {
    for (const q of queries) {
      const place = await geocodePlace(q, { postalCode: postalConstraint, allowMismatch });
      if (place) {
        return place;
      }
    }
    return null;
  };

  const strict = await attemptGeocode(expectedPostal, false);
  if (strict) {
    return strict;
  }
  const relaxed = await attemptGeocode('', true);
  if (relaxed) {
    return relaxed;
  }
  const deptFallback = getDeptFallbackCoordinates(expectedPostal);
  if (deptFallback) {
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

const main = async () => {
  const DELAY_MS = 650;
  const clubs = (await loadDepartments()).map(adaptClubRecord);
  ensureUniqueSlugs(clubs);

  let processed = 0;
  let geocoded = 0;
  let fallback = 0;
  const hints = {};

  for (const club of clubs) {
    processed += 1;
    if (Number.isFinite(club.latitude) && Number.isFinite(club.longitude)) {
      hints[club.slug] = { lat: club.latitude, lng: club.longitude, postalCode: club.postalCode || '' };
      continue;
    }
    const result = await geocodeClub(club);
    if (result) {
      geocoded += result.source && result.source.includes('fallback') ? 0 : 1;
      if (result.source === 'dept-fallback') {
        fallback += 1;
      }
      hints[club.slug] = {
        lat: result.lat,
        lng: result.lng,
        postalCode: result.postalCode || club.postalCode || '',
        source: result.source || 'geocode',
      };
    }
    // Be polite with the geocoding service
    await sleep(DELAY_MS);
  }

  const sortedKeys = Object.keys(hints).sort();
  const sortedHints = {};
  sortedKeys.forEach((key) => {
    sortedHints[key] = hints[key];
  });

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    total: processed,
    hints: sortedHints,
  };

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Generated ${OUTPUT_PATH}`);
  console.log(`Clubs: ${processed}, hints: ${sortedKeys.length}, geocoded: ${geocoded}, dept fallback: ${fallback}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
