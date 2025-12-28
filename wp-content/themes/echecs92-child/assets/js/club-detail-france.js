/**
 * Club detail view renderer.
 * Loads the clubs dataset and displays the selected club based on ?id= query param.
 */
(function () {
  const GEO_HINTS_VERSION = '20250201';
  const DATA_MANIFEST_URL = '/wp-content/themes/echecs92-child/assets/data/clubs-france.json';
  const DATA_FALLBACK_BASE_PATH = '/wp-content/themes/echecs92-child/assets/data/clubs-france/';
  const FFE_MANIFEST_URL = '/wp-content/themes/echecs92-child/assets/data/clubs-france-ffe.json';
  const FFE_FALLBACK_BASE_PATH = '/wp-content/themes/echecs92-child/assets/data/clubs-france-ffe/';
  const FFE_URL_BASE = 'https://www.echecs.asso.fr/FicheClub.aspx?Ref=';
  const GEO_HINTS_REMOTE_URL = `/wp-content/themes/echecs92-child/assets/data/clubs-france-hints.json?v=${GEO_HINTS_VERSION}`;
  const CLUBS_NAV_STORAGE_KEY = 'echecs92:clubs-fr:last-listing';
  const detailContainer = document.getElementById('club-detail');
  const backLink = document.querySelector('[data-club-back]');
  const backLinkMap = document.querySelector('[data-club-back-map]');
  const actionsContainer = document.querySelector('.club-detail__actions');
  let manifestPromise = null;
  let datasetPromise = null;

  const fetchJson = (url) =>
    fetch(url, { headers: { Accept: 'application/json' } }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    });

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

  let ffeManifestPromise = null;
  const loadFfeManifest = () => {
    if (!ffeManifestPromise) {
      ffeManifestPromise = fetchJson(FFE_MANIFEST_URL)
        .then((payload) => {
          const basePath = payload?.basePath || FFE_FALLBACK_BASE_PATH;
          const departments = Array.isArray(payload?.departments) ? payload.departments : [];
          return { basePath, departments };
        })
        .catch(() => ({ basePath: FFE_FALLBACK_BASE_PATH, departments: [] }));
    }
    return ffeManifestPromise;
  };

  const fetchDepartmentFfeRefs = async (entry, manifestMeta) => {
    const url = buildDeptUrl(entry, manifestMeta.basePath);
    if (!url) {
      return [];
    }
    try {
      const payload = await fetchJson(url);
      return Array.isArray(payload) ? payload : [];
    } catch (error) {
      console.warn(`[club-detail-fr] FFE refs indisponibles pour ${entry.code || '?'} (${url}).`, error);
      return [];
    }
  };

  let ffeRefsPromise = null;
  const loadFfeRefs = () => {
    if (!ffeRefsPromise) {
      ffeRefsPromise = loadFfeManifest().then(async (manifestMeta) => {
        const departments = manifestMeta.departments || [];
        if (!departments.length) {
          return [];
        }
        const chunks = await Promise.all(
          departments.map((entry) => fetchDepartmentFfeRefs(entry, manifestMeta))
        );
        return chunks.flat();
      });
    }
    return ffeRefsPromise;
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
      console.warn(`[club-detail-fr] Département ${entry.code || '?'} indisponible (${url}).`, error);
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
            map.set(slug, {
              lat,
              lng,
              postalCode: value.postalCode || '',
            });
          });
          return map;
        })
        .catch(() => new Map());
    }
    return staticGeoHintsPromise;
  };

  if (!detailContainer) {
    return;
  }

  const consumeStoredClubsNavigation = () => {
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
      const timestamp = payload && typeof payload.ts === 'number' ? payload.ts : null;
      if (!timestamp) {
        return null;
      }
      if (Date.now() - timestamp > 10 * 60 * 1000) {
        return null;
      }
      return payload;
    } catch (error) {
      return null;
    }
  };

  const storedNavigation = consumeStoredClubsNavigation();

  const getStoredBackPath = (fallback) => {
    if (storedNavigation && storedNavigation.back) {
      try {
        const url = new URL(storedNavigation.back, window.location.origin);
        if (url.origin === window.location.origin) {
          return url.pathname + url.search + url.hash;
        }
      } catch (error) {
        // ignore invalid URLs
      }
    }
    return fallback;
  };

  const cameFromClubsSearch = () => {
    if (storedNavigation && storedNavigation.context === 'detail:list') {
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

  const cameFromClubsMap = () => {
    if (storedNavigation && storedNavigation.context === 'detail:map') {
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
      return normalized === '/carte-des-clubs';
    } catch (error) {
      return false;
    }
  };

  const updateBackLinkVisibility = () => {
    const showMapBack = cameFromClubsMap();
    const showListBack = !showMapBack && cameFromClubsSearch();

    if (backLink) {
      if (showListBack) {
        backLink.href = getStoredBackPath('/clubs');
        backLink.removeAttribute('hidden');
      } else {
        backLink.setAttribute('hidden', '');
      }
    }
    if (backLinkMap) {
      if (showMapBack) {
        backLinkMap.href = getStoredBackPath('/carte-des-clubs');
        backLinkMap.removeAttribute('hidden');
      } else {
        backLinkMap.setAttribute('hidden', '');
      }
    }
  };

  updateBackLinkVisibility();

  const deriveClubSlugFromPath = () => {
    const pathMatch = window.location.pathname.match(/\/club\/([^\/?#]+)/i);
    if (pathMatch && pathMatch[1]) {
      try {
        return decodeURIComponent(pathMatch[1]);
      } catch (err) {
        return pathMatch[1];
      }
    }
    const params = new URLSearchParams(window.location.search || '');
    const fallback = params.get('id') || params.get('club') || '';
    return fallback || '';
  };

  const clubSlug = deriveClubSlugFromPath();

  const renderMessage = (message, tone = 'error') => {
    detailContainer.innerHTML = `<p class="clubs-empty" data-tone="${tone}">${message}</p>`;
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

  const splitLines = (value) => {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.map((line) => String(line).trim()).filter(Boolean);
    }
    return value
      .toString()
      .split(/\r?\n|;/)
      .map((line) => line.trim())
      .filter(Boolean);
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
        entries[0]._communeSlug = slugify(entries[0].commune || '');
        return;
      }
      const sorted = entries
        .map((club) => ({ club, key: stableKey(club) }))
        .sort((a, b) => a.key.localeCompare(b.key, 'en', { sensitivity: 'base' }));
      sorted.forEach((entry, idx) => {
        const suffix = idx === 0 ? '' : `-${toBase36(idx + 1)}`;
        entry.club.slug = `${base}${suffix}`;
        entry.club._communeSlug = slugify(entry.club.commune || '');
      });
    });
  };

  const buildClubLookup = (clubs) => {
    const map = new Map();
    (clubs || []).forEach((club) => {
      if (!club || typeof club !== 'object') {
        return;
      }
      const buildVariantSlug = (overrides) =>
        buildShortSlugBase({
          ...club,
          ...overrides,
        });
      const legacySlugNoDept = buildVariantSlug({
        departmentCode: '',
        departmentSlug: '',
        departmentName: '',
      });
      const legacySlugNoCommune = buildVariantSlug({
        commune: '',
      });
      const legacySlugNoDeptNoCommune = buildVariantSlug({
        departmentCode: '',
        departmentSlug: '',
        departmentName: '',
        commune: '',
      });
      const aliases = new Set([
        club.slug,
        club.id,
        club._communeSlug,
        slugify(club.name || ''),
        slugify(club.commune || ''),
        legacySlugNoDept,
        legacySlugNoCommune,
        legacySlugNoDeptNoCommune,
      ]);
      aliases.forEach((alias) => {
        const key = (alias || '').toString().trim().toLowerCase();
        if (key && !map.has(key)) {
          map.set(key, club);
        }
      });
    });
    return map;
  };

  const findClubBySlug = (slug, lookup) => {
    if (!slug) {
      return null;
    }
    const key = slug.toString().trim().toLowerCase();
    if (!key) {
      return null;
    }
    if (lookup && lookup.has(key)) {
      return lookup.get(key);
    }
    return null;
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
      const lat = Number.parseFloat(hint.lat);
      const lng = Number.parseFloat(hint.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return;
      }
      club.latitude = lat;
      club.longitude = lng;
      if (!club.postalCode && hint.postalCode) {
        club.postalCode = hint.postalCode;
      }
    });
  };

  const sanitiseFfeRef = (value) => {
    const str = (value || '').toString().trim();
    if (!str) {
      return '';
    }
    const match = str.match(/(\d{2,})$/);
    return match ? match[1] : '';
  };

  const buildFfeLookupKey = (name, postalCode, commune) => {
    const normalizedName = normalise(name || '').replace(/[^a-z0-9]/g, '');
    const normalizedCity = normalise(commune || '').replace(/[^a-z0-9]/g, '');
    const normalizedPostal = (postalCode || '').toString().trim();
    if (!normalizedName && !normalizedCity && !normalizedPostal) {
      return '';
    }
    return [normalizedName || 'club', normalizedPostal || '00000', normalizedCity || ''].join('|');
  };

  const buildFfeLookup = (entries) => {
    const bySlug = new Map();
    const byKey = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const ref = sanitiseFfeRef(entry.ref || entry.ffe_ref || entry.fiche_ffe || entry.ffeRef);
      if (!ref) {
        return;
      }
      const slug = entry.slug || entry.id || '';
      if (slug && !bySlug.has(slug)) {
        bySlug.set(slug, ref);
      }
      const key = buildFfeLookupKey(
        entry.name || '',
        entry.postalCode || entry.postal_code || '',
        entry.commune || entry.city || ''
      );
      if (key && !byKey.has(key)) {
        byKey.set(key, ref);
      }
    });
    return { bySlug, byKey };
  };

  const applyFfeRefs = (clubs, lookup) => {
    if (!Array.isArray(clubs) || !lookup) {
      return;
    }
    const applyRef = (club, refCandidate) => {
      const ref = sanitiseFfeRef(refCandidate);
      if (!ref) {
        return false;
      }
      club.ffeRef = ref;
      club.fiche_ffe = `${FFE_URL_BASE}${encodeURIComponent(ref)}`;
      return true;
    };
    clubs.forEach((club) => {
      if (!club || typeof club !== 'object') {
        return;
      }
      const existingUrl =
        club.fiche_ffe && /^https?:/i.test(club.fiche_ffe) ? club.fiche_ffe : '';
      const slugKey = club.slug || club.id || '';
      if (slugKey && lookup.bySlug && lookup.bySlug.has(slugKey)) {
        if (applyRef(club, lookup.bySlug.get(slugKey))) {
          return;
        }
      }
      const lookupKey = buildFfeLookupKey(club.name, club.postalCode, club.commune);
      if (lookupKey && lookup.byKey && lookup.byKey.has(lookupKey)) {
        if (applyRef(club, lookup.byKey.get(lookupKey))) {
          return;
        }
      }
      if (applyRef(club, club.ffeRef || club.fiche_ffe)) {
        return;
      }
      if (existingUrl) {
        club.fiche_ffe = existingUrl;
      }
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

  const stripCedexSuffix = (value) => {
    if (!value) {
      return '';
    }
    return value
      .toString()
      .replace(/\bcedex\b(?:\s*[-/]?\s*\d{1,3})?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
      stripCedexSuffix(
        (raw || '')
          .toString()
          .replace(/\b\d{4,5}\b/g, ' ')
          .replace(/^[,;\s-–—]+/, '')
          .replace(/\s+/g, ' ')
          .trim()
      );

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
      const parts = result.full.split(',').map((part) => part.trim()).filter(Boolean);
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
    /\b(rue|avenue|av\.?|boulevard|bd|bld|place|route|chemin|impasse|all[ée]e|voie|quai|cours|passage|square|sentier|mail|esplanade|terrasse|pont|faubourg|clos|cité|cite|hameau|lotissement|residence|résidence|allee)\b/i;

  const ADDRESS_SPLIT_PATTERN = /[,;/\n]+/;

  const stripAddressNotes = (segment) => {
    if (!segment) {
      return '';
    }
    return segment
      .replace(/\bpendant\s+la\s+semaine\b.*$/gi, '')
      .replace(/\b(?:en\s+semaine|semaine)\b.*$/gi, '')
      .replace(/\b(?:le|du)?\s*(?:w\.?e\.?|w-?e|week[-\s]?end|weekend)\b.*$/gi, '')
      .replace(/\(\s*(?:we|w-?e|week[-\s]?end|weekend)[^)]*\)/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[,;\s-–—]+|[,;\s-–—]+$/g, '')
      .trim();
  };

  const scoreAddressSegment = (segment) => {
    if (!segment) {
      return -Infinity;
    }
    let score = 0;
    if (STREET_KEYWORDS.test(segment)) {
      score += 5;
    }
    if (/\b\d{5}\b/.test(segment)) {
      score += 2;
    }
    if (/\d/.test(segment)) {
      score += 1;
    }
    if (segment.length >= 10) {
      score += 1;
    }
    if (/\b(?:semaine|week[-\s]?end|w-?e|w\.?e\.?)\b/i.test(segment)) {
      score -= 2;
    }
    return score;
  };

  const looksLikePostalOnly = (value) => {
    if (!value || !/\b\d{5}\b/.test(value)) {
      return false;
    }
    if (STREET_KEYWORDS.test(value)) {
      return false;
    }
    const withoutPostal = value.replace(/\b\d{5}\b/g, ' ').replace(/\s+/g, ' ').trim();
    return withoutPostal && withoutPostal.split(' ').length <= 3;
  };

  const simplifyStreetSegment = (value) => {
    if (!value) {
      return '';
    }
    const cleaned = value.replace(/\([^)]*\)/g, ' ');
    const parts = cleaned
      .split(ADDRESS_SPLIT_PATTERN)
      .map((part) => stripAddressNotes(part.trim()))
      .filter(Boolean);
    if (!parts.length) {
      return cleaned.replace(/\s+/g, ' ').trim();
    }
    const tests = [
      (part) => /\b\d+[\p{L}]?\b/iu.test(part) && STREET_KEYWORDS.test(part),
      (part) => STREET_KEYWORDS.test(part),
      (part) => /\b\d+[\p{L}]?\b/iu.test(part) && !looksLikePostalOnly(part),
    ];
    for (const test of tests) {
      const match = parts.find((part) => test(part));
      if (match) {
        return match.replace(/\s+/g, ' ').trim();
      }
    }
    const fallback = parts.find((part) => !looksLikePostalOnly(part)) || parts[0];
    return fallback || '';
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

  const normaliseCommuneForCompare = (value) => {
    const formatted = formatCommune(value || '');
    if (!formatted) {
      return '';
    }
    return normalise(formatted)
      .replace(/['’`]/g, ' ')
      .replace(/[-\s]+/g, ' ')
      .trim();
  };

  const dedupeCommuneLabel = (value) => {
    const raw = (value || '').toString();
    if (!raw.trim()) {
      return '';
    }
    const withoutPostal = raw.replace(/\b\d{4,5}\b/g, ' ');
    const segments = withoutPostal
      .split(/[,;\/]+/g)
      .map((part) => part.replace(/^[\s-–—]+|[\s-–—]+$/g, '').trim())
      .filter(Boolean);

    const collapseRepeatedPhrase = (formatted) => {
      const key = normaliseCommuneForCompare(formatted);
      if (!key) {
        return formatted;
      }
      const tokens = key.split(' ').filter(Boolean);
      if (tokens.length >= 2 && tokens.length % 2 === 0) {
        const midpoint = tokens.length / 2;
        const first = tokens.slice(0, midpoint).join(' ');
        const second = tokens.slice(midpoint).join(' ');
        if (first && first === second) {
          return formatCommune(first);
        }
      }
      return formatted;
    };

    const seen = new Set();
    const parts = [];
    const pushSegment = (segment) => {
      if (!segment) {
        return;
      }
      const formattedSegment = collapseRepeatedPhrase(formatCommune(segment));
      const key = normaliseCommuneForCompare(formattedSegment);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      parts.push(formattedSegment);
    };

    if (segments.length) {
      segments.forEach(pushSegment);
    } else {
      pushSegment(withoutPostal);
    }

    if (!parts.length) {
      return '';
    }
    return parts.length === 1 ? parts[0] : parts.join(', ');
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

  const normaliseAddressField = (raw) => {
    const base = (raw || '').toString().replace(/\s+/g, ' ').trim();
    if (!base) {
      return { full: '', best: '', streetLike: '' };
    }
    const segments = base
      .split(ADDRESS_SPLIT_PATTERN)
      .map((part) => stripAddressNotes(part))
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    if (!segments.length) {
      const fallback = stripAddressNotes(base).replace(/\s+/g, ' ').trim();
      return {
        full: fallback,
        best: fallback,
        streetLike: looksLikeDetailedAddress(fallback) ? fallback : '',
      };
    }

    const uniqueSegments = [];
    const seen = new Set();
    segments.forEach((segment) => {
      const key = segment.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueSegments.push(segment);
      }
    });

    const scored = uniqueSegments
      .map((segment, idx) => ({
        segment,
        score: scoreAddressSegment(segment),
        order: idx,
      }))
      .sort((a, b) => b.score - a.score || a.order - b.order);

    const best = scored[0]?.segment || uniqueSegments[0];
    const streetCandidate =
      scored.find((entry) => looksLikeDetailedAddress(entry.segment) || STREET_KEYWORDS.test(entry.segment))
        ?.segment || '';
    const orderedSegments = [best, ...uniqueSegments.filter((segment) => segment !== best)];
    return { full: orderedSegments.join(', '), best, streetLike: streetCandidate || '' };
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
      return stripCedexSuffix(after.replace(/^[,;\s-–—]+/, '').trim());
    }
    const before = raw.slice(0, idx).trim();
    if (!before) {
      return '';
    }
    const segments = before.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
    return stripCedexSuffix((segments.length ? segments[segments.length - 1] : before).trim());
  };

  const cleanCommuneCandidate = (value, postalCode) => {
    if (!value) {
      return '';
    }
    const postal = (postalCode || '').toString().replace(/\D/g, '');
    let cleaned = value
      .toString()
      .replace(/\b\d{4,5}\b/g, ' ')
      .replace(/^[,;\s-–—]+/, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (postal) {
      const pattern = new RegExp(`\\b${postal.slice(0, 2)}\\s*${postal.slice(2)}\\b`, 'gi');
      cleaned = cleaned.replace(pattern, ' ').trim();
    }
    cleaned = cleaned.replace(/^\d+\s+/, '').replace(/\s+/g, ' ').trim();
    cleaned = stripCedexSuffix(cleaned);
    const looksStreety = STREET_KEYWORDS.test(cleaned) && (/\d/.test(cleaned) || cleaned.split(/\s+/).length >= 3);
    if (looksStreety) {
      return '';
    }
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
    const postalCoords = getPostalCoordinates(postalCode) || null;
    const postalLabel = postalCoords ? formatCommuneWithPostal(postalCoords.label || '', postalCode) : '';
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
    return best || postalLabel || '';
  };

  const normaliseCommuneKey = (value) => normalise(value).replace(/[^a-z0-9]/g, '');

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

  const getPostalCoordinates = (postalCode, preferredCommune = '') => {
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
    const label = formatCommuneWithPostal(preferredCommune || entry.label || '', key) || entry.label;
    return { postalCode: key, lat: entry.lat, lng: entry.lng, label };
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

  const collectPostalCodes = (club) => {
    const codes = new Set();
    if (club.postalCode) {
      codes.add(club.postalCode);
    }
    [club.address, club.siege, club.addressStandard].forEach((value) => {
      const parsed = parsePostalCodeFromString(value || '');
      if (parsed) {
        codes.add(parsed);
      }
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

  const geocodeClubIfNeeded = async (club) => {
    if (!club || typeof club !== 'object') {
      return false;
    }
    const hasCoords =
      Number.isFinite(Number.parseFloat(club.latitude)) &&
      Number.isFinite(Number.parseFloat(club.longitude));
    if (hasCoords) {
      return false;
    }
    const query = club.addressStandard || club.address || club.siege || club.commune || club.name || '';
    if (!query.trim()) {
      return false;
    }
    try {
      const place = await geocodePlace(query);
      if (!place) {
        return false;
      }
      club.latitude = place.lat;
      club.longitude = place.lng;
      if (!club.postalCode && place.postalCode) {
        club.postalCode = place.postalCode;
      }
      return true;
    } catch {
      return false;
    }
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

  const GEOCODE_STORAGE_KEY = `echecs92:club-detail-fr:geocode:${GEO_HINTS_VERSION}`;
  const GEOCODE_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
  const geocodeCache = new Map();

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
      // ignore storage errors
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
      // ignore storage errors
    }
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
        'User-Agent': 'echecs92-club-detail-fr/1.0 (contact@echecs92.com)',
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
        return {
          lat,
          lng,
          label: formatCommune(first.display_name || ''),
          postalCode,
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

  const resolveClubCoordinates = (club) => {
    if (!club || typeof club !== 'object') {
      return null;
    }

    const lat = Number.parseFloat(club.latitude ?? club.lat);
    const lng = Number.parseFloat(club.longitude ?? club.lng ?? club.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        lat,
        lng,
        label: club.commune || club.name || '',
        postalCode: club.postalCode || '',
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
        };
      }
    }

    if (club.commune) {
      const coords = getCommuneCoordinatesByName(club.commune);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode };
      }
    }

    const postalCandidates = collectPostalCodes(club);
    for (let i = 0; i < postalCandidates.length; i += 1) {
      const coords = getPostalCoordinates(postalCandidates[i], club.commune);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode };
      }
    }

    for (let i = 0; i < postalCandidates.length; i += 1) {
      const fallback = getDeptFallbackCoordinates(postalCandidates[i]);
      if (fallback) {
        return fallback;
      }
    }

    const parisPostal = deriveParisPostalFromClub(club);
    if (parisPostal) {
      const coords = getPostalCoordinates(parisPostal, club.commune);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode };
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
        };
      }
    }

    return null;
  };

  const buildDirectionsUrl = (coords, club) => {
    const addressCandidate = (
      club?.addressStandard ||
      club?.address ||
      club?.siege ||
      coords?.label ||
      club?.commune ||
      ''
    ).trim();
    let destinationValue = '';
    if (addressCandidate) {
      destinationValue = addressCandidate;
    } else {
      const lat = Number.parseFloat(coords?.lat);
      const lng = Number.parseFloat(coords?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return '';
      }
      destinationValue = `${lat},${lng}`;
    }
    const destination = encodeURIComponent(destinationValue);
    const label = encodeURIComponent(club?.name || coords?.label || 'Club');
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const isAppleMobile =
      /iP(hone|od|ad)/i.test(ua) ||
      (/Mac/i.test(platform) && 'ontouchend' in window);
    if (isAppleMobile) {
      return `http://maps.apple.com/?daddr=${destination}&q=${label}`;
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${destination}&destination_place_id=&travelmode=driving`;
  };

  const renderClubMap = (club, container, statusElement, directionsButton) => {
    if (!container) {
      return;
    }

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

    const coords = resolveClubCoordinates(club);
    if (!coords) {
      updateStatus('Localisation indisponible pour ce club.', 'error');
      if (directionsButton) {
        directionsButton.hidden = true;
      }
      return;
    }

    const activateDirections = () => {
      if (!directionsButton) {
        return;
      }
      const url = buildDirectionsUrl(coords, club);
      if (!url) {
        directionsButton.hidden = true;
        return;
      }
      directionsButton.href = url;
      directionsButton.hidden = false;
    };

    const initialiseMap = (attempt = 0) => {
      if (typeof L === 'undefined') {
        if (attempt > 30) {
          updateStatus('Carte indisponible pour le moment.', 'error');
          activateDirections();
          return;
        }
        window.setTimeout(() => initialiseMap(attempt + 1), 150);
        return;
      }
      try {
        const map = L.map(container, {
          zoomControl: true,
          scrollWheelZoom: true,
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 18,
        }).addTo(map);
        const popupLines = [`<strong>${club.name}</strong>`];
        if (club.addressDisplay) {
          popupLines.push(club.addressDisplay);
        } else if (coords.label) {
          popupLines.push(coords.label);
        }
        const marker = L.marker([coords.lat, coords.lng], {
          title: club.name,
        });
        marker.addTo(map).bindPopup(popupLines.join('<br>'));
        map.setView([coords.lat, coords.lng], 14);
        window.setTimeout(() => {
          map.invalidateSize();
        }, 150);
        updateStatus('Localisation du club affichée.', 'success');
        activateDirections();
      } catch (error) {
        updateStatus('Carte indisponible pour le moment.', 'error');
        activateDirections();
      }
    };

    updateStatus('Chargement de la carte…', 'info');
    initialiseMap();
  };

  const adaptClubRecord = (raw) => {
    if (!raw || typeof raw !== 'object') {
      return raw;
    }
    if (raw.id && raw.name) {
      return raw;
    }
    const name = raw.nom || raw.name || '';
    const primaryAddressMeta = normaliseAddressField(
      raw.salle_jeu || raw.salle || raw.adresse || raw.address || ''
    );
    const secondaryAddressMeta = normaliseAddressField(raw.siege || raw.siege_social || raw.address2 || '');
    const salleMeta = normaliseAddressField(raw.salle_jeu || raw.salle || '');
    const primaryAddress = primaryAddressMeta.full;
    const secondaryAddress = secondaryAddressMeta.full;
    const addressParts = extractAddressParts(primaryAddress || secondaryAddress);
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
    const baseCommune = dedupeCommuneLabel(pickBestCommune(communeCandidates, postalForCommune));
    const commune = formatCommuneWithPostal(baseCommune, postalForCommune);
    const streetHint = primaryAddressMeta.streetLike || secondaryAddressMeta.streetLike || '';
    const standardAddress = buildStandardAddress(
      streetHint,
      secondaryAddress,
      postalCode,
      commune || baseCommune || addressParts.city || secondaryParts.city || ''
    );
    const slugSource = name || commune || postalForCommune || primaryAddress || secondaryAddress;
    const id = raw.id || slugify(slugSource) || 'club';

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
    const initialFfeRef = sanitiseFfeRef(raw.ffe_ref ?? raw.ffeRef ?? raw.fiche_ffe);

    return {
      id,
      name: name || commune || 'Club sans nom',
      commune,
      address: primaryAddress || secondaryAddress || '',
      siege: secondaryAddress || '',
      salle: salleMeta.full || '',
      addressStandard: standardAddress,
      addressDisplay: standardAddress || primaryAddress || secondaryAddress || '',
      phone: raw.telephone || raw.phone || '',
      fax: raw.fax || '',
      email: raw.email || '',
      site,
      president: raw.president || '',
      contact: raw.contact || '',
      hours: raw.horaires || raw.hours || '',
      publics: raw.publics || '',
      tarifs: raw.tarifs || '',
      notes: raw.notes || '',
      accesPmr: raw.acces_pmr || '',
      interclubs: raw.interclubs || '',
      interclubsJeunes: raw.interclubs_jeunes || '',
      interclubsFeminins: raw.interclubs_feminins || '',
      labelFederal: raw.label_federal || '',
      ffeRef: initialFfeRef,
      fiche_ffe: raw.fiche_ffe || '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      latitude,
      longitude,
      licenses: {
        A: toNumber(raw.licences_a ?? raw.licenses_a ?? raw.license_a),
        B: toNumber(raw.licences_b ?? raw.licenses_b ?? raw.license_b),
      },
      postalCode,
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

  const createChip = (text, variant) => {
    const span = document.createElement('span');
    span.className = `club-chip${variant ? ` club-chip--${variant}` : ''}`;
    span.textContent = text;
    return span;
  };

  const createSection = (title) => {
    const section = document.createElement('section');
    section.className = 'club-section';

    const heading = document.createElement('h2');
    heading.textContent = title;
    section.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'club-section__list';
    section.appendChild(list);

    return { section, list };
  };

  const appendDetail = (list, label, value, options = {}) => {
    if (value == null || value === '') {
      return false;
    }
    const lines = options.type === 'lines' ? splitLines(value) : null;
    if (options.type === 'lines' && !lines.length) {
      return false;
    }
    const item = document.createElement('li');
    item.className = 'club-section__item';
    if (options.variant) {
      item.classList.add(`club-section__item--${options.variant}`);
    }

    const labelNode = document.createElement('span');
    labelNode.className = 'club-section__label';
    if (options.icon) {
      labelNode.dataset.icon = options.icon;
    }
    labelNode.textContent = label;
    item.appendChild(labelNode);

    const valueContainer = document.createElement('div');
    valueContainer.className = 'club-section__value';

    if (options.type === 'lines') {
      const linesWrap = document.createElement('div');
      linesWrap.className = 'club-section__lines';
      lines.forEach((line) => {
        const lineNode = document.createElement('div');
        lineNode.textContent = line;
        linesWrap.appendChild(lineNode);
      });
      valueContainer.appendChild(linesWrap);
    } else if (options.type === 'link') {
      const link = document.createElement('a');
      link.href = value;
      link.rel = 'noopener';
      link.target = '_blank';
      link.textContent = options.label || value;
      valueContainer.appendChild(link);
    } else if (options.type === 'mail') {
      const link = document.createElement('a');
      link.href = `mailto:${value}`;
      link.textContent = value;
      valueContainer.appendChild(link);
    } else if (options.type === 'phone') {
      const formatted = formatPhone(value) || value;
      const cleaned = value.replace(/[^\d+]/g, '');
      const link = document.createElement('a');
      link.href = `tel:${cleaned || value}`;
      link.textContent = formatted;
      valueContainer.appendChild(link);
    } else {
      valueContainer.textContent = value;
    }

    item.appendChild(valueContainer);
    list.appendChild(item);
    return true;
  };

  const renderClub = (club) => {
    detailContainer.innerHTML = '';

    const sheet = document.createElement('div');
    sheet.className = 'club-sheet';

    const header = document.createElement('header');
    header.className = 'club-sheet__header';

    const titleRow = document.createElement('div');
    titleRow.className = 'club-sheet__title-row';

    const title = document.createElement('h1');
    title.className = 'club-sheet__title';
    title.textContent = club.name;
    titleRow.appendChild(title);

    const shareUrl = `${window.location.origin}/club/${encodeURIComponent(club.slug || club.id || '')}/`;
    const shareBlock = document.createElement('div');
    shareBlock.className = 'club-sheet__share';

    const copyToClipboard = async (value) => {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        return true;
      }
      try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
      } catch (err) {
        return false;
      }
    };

    const shareButton = document.createElement('button');
    shareButton.type = 'button';
    shareButton.className = 'club-share-button';
    shareButton.setAttribute('aria-label', 'Partager ce club');
    shareButton.title = 'Partager';
    shareButton.addEventListener('click', async () => {
      try {
        if (navigator.share && typeof navigator.share === 'function') {
          await navigator.share({
            title: club.name,
            text: `Découvrez ${club.name} sur le site du Comité d'Échecs des Hauts-de-Seine`,
            url: shareUrl,
          });
          return;
        }
        const ok = await copyToClipboard(shareUrl);
        if (!ok) {
          console.warn('Partage indisponible');
        }
      } catch (error) {
        if (error && error.name === 'AbortError') {
          return;
        }
        const ok = await copyToClipboard(shareUrl);
        if (!ok) {
          console.warn('Partage indisponible');
        }
      }
    });

    shareBlock.appendChild(shareButton);
    header.appendChild(titleRow);

    const summaryText = club.publics || club.notes;
    if (summaryText) {
      const summary = document.createElement('p');
      summary.className = 'club-sheet__summary';
      summary.textContent = summaryText;
      header.appendChild(summary);
    }

    if (actionsContainer) {
      const existingShare = actionsContainer.querySelector('.club-sheet__share');
      if (existingShare) {
        existingShare.remove();
      }
      actionsContainer.appendChild(shareBlock);
    } else {
      sheet.appendChild(shareBlock);
    }
    sheet.appendChild(header);

    const sections = [];

    const coords = createSection('Coordonnées');
    const normalizeAddress = (value) =>
      normalise(value || '')
        .replace(/[^a-z0-9]+/g, '')
        .trim();
    const addressKey = normalizeAddress(club.address);
    const siegeKey = normalizeAddress(club.siege);
    appendDetail(coords.list, 'Salle de jeu', club.address, {
      icon: 'address',
      variant: 'featured',
    });
    if (
      club.siege &&
      siegeKey &&
      siegeKey !== addressKey
    ) {
      appendDetail(coords.list, 'Siège social', club.siege);
    }
    appendDetail(coords.list, 'Ville', club.commune && !club.address ? club.commune : '');
    appendDetail(coords.list, 'Email', club.email, { type: 'mail', icon: 'mail' });
    appendDetail(coords.list, 'Téléphone', club.phone, { type: 'phone', icon: 'phone' });
    appendDetail(coords.list, 'Fax', club.fax);
    appendDetail(coords.list, 'Site internet', club.site, {
      type: 'link',
      label: 'Accéder au site du club',
      icon: 'website',
    });
    appendDetail(coords.list, 'Accès PMR', club.accesPmr);
    if (coords.list.childElementCount) {
      sections.push(coords.section);
    }

    const activities = createSection('Activités');
    appendDetail(activities.list, 'Publics accueillis', club.publics);
    appendDetail(activities.list, 'Horaires', club.hours, { type: 'lines', icon: 'hours' });
    appendDetail(activities.list, 'Tarifs', club.tarifs);
    appendDetail(activities.list, 'Informations complémentaires', club.notes && club.publics ? club.notes : '');
    if (activities.list.childElementCount) {
      sections.push(activities.section);
    }

    const organisation = createSection('Organisation');
    appendDetail(organisation.list, 'Président·e', club.president);
    appendDetail(organisation.list, 'Contact', club.contact);
    appendDetail(organisation.list, 'Label fédéral', club.labelFederal);
    if (club.licenses && (club.licenses.A || club.licenses.B)) {
      const licenseParts = [];
      if (club.licenses.A) {
        licenseParts.push(`Licence A : ${club.licenses.A}`);
      }
      if (club.licenses.B) {
        licenseParts.push(`Licence B : ${club.licenses.B}`);
      }
      appendDetail(organisation.list, 'Répartition licences', licenseParts.join(' · '));
    }
    if (club.totalLicenses) {
      const label = `${club.totalLicenses} licencié${club.totalLicenses > 1 ? 's' : ''}`;
      appendDetail(organisation.list, 'Total licenciés', label);
    }
    if (organisation.list.childElementCount) {
      sections.push(organisation.section);
    }

    const competitions = createSection('Compétitions');
    appendDetail(competitions.list, 'Interclubs', club.interclubs);
    appendDetail(competitions.list, 'Interclubs Jeunes', club.interclubsJeunes);
    appendDetail(competitions.list, 'Interclubs Féminins', club.interclubsFeminins);
    if (competitions.list.childElementCount) {
      sections.push(competitions.section);
    }

    const resources = createSection('Ressources');
    const ficheFfeUrl =
      club.fiche_ffe ||
      (club.ffeRef ? `${FFE_URL_BASE}${encodeURIComponent(club.ffeRef)}` : '');
    appendDetail(resources.list, 'Fiche FFE', ficheFfeUrl, {
      type: 'link',
      label: 'Consulter la fiche FFE',
    });
    if (resources.list.childElementCount) {
      sections.push(resources.section);
    }

    sections.forEach((section) => sheet.appendChild(section));

    detailContainer.appendChild(sheet);

    const mapSection = document.createElement('section');
    mapSection.className = 'club-map-section';
    mapSection.setAttribute('aria-label', `Carte de localisation pour ${club.name}`);

    const mapHeading = document.createElement('h2');
    mapHeading.className = 'club-map__heading';
    mapHeading.textContent = 'Localisation sur la carte';
    mapSection.appendChild(mapHeading);

    const mapContainerWrapper = document.createElement('div');
    mapContainerWrapper.className = 'club-map__container';

    const mapContainer = document.createElement('div');
    mapContainer.className = 'club-map';
    mapContainer.id = 'club-map';
    mapContainerWrapper.appendChild(mapContainer);

    const mapStatus = document.createElement('p');
    mapStatus.id = 'club-map-status';
    mapStatus.className = 'club-map__status';
    mapStatus.setAttribute('role', 'status');
    mapStatus.setAttribute('aria-live', 'polite');
    mapStatus.textContent = 'Chargement de la carte…';
    mapContainerWrapper.appendChild(mapStatus);

    mapSection.appendChild(mapContainerWrapper);

    const directionsButton = document.createElement('a');
    directionsButton.className = 'btn btn-secondary club-map__directions';
    directionsButton.target = '_blank';
    directionsButton.rel = 'noopener';
    directionsButton.textContent = 'Ouvrir dans mon app de navigation';
    directionsButton.hidden = true;
    mapSection.appendChild(directionsButton);

    detailContainer.appendChild(mapSection);

    renderClubMap(club, mapContainer, mapStatus, directionsButton);

    if (club.name) {
      document.title = `${club.name} – Clubs en France`;
    }
  };

  const hydrateClub = (raw) => {
    const club = { ...adaptClubRecord(raw) };
    const licenseA = Number.parseInt(club.licenses?.A, 10);
    const licenseB = Number.parseInt(club.licenses?.B, 10);
    const totalLicenses =
      (Number.isFinite(licenseA) ? licenseA : 0) + (Number.isFinite(licenseB) ? licenseB : 0);
    club.totalLicenses = totalLicenses > 0 ? totalLicenses : null;
    return club;
  };

  const init = () => {
    if (!clubSlug) {
      renderMessage(detailContainer.dataset.emptyMessage || 'Club introuvable.');
      return;
    }
    const releaseSpinner =
      typeof window !== 'undefined' && window.cdjeSpinner && typeof window.cdjeSpinner.show === 'function'
        ? window.cdjeSpinner.show('Chargement du club…')
        : () => {};
    Promise.all([loadFranceClubsDataset(), loadStaticGeoHints(), loadFfeRefs()])
      .then(async ([data, staticHints, ffeRefs]) => {
        const ffeLookup = buildFfeLookup(ffeRefs);
        const clubs = (Array.isArray(data) ? data : []).map(hydrateClub);
        ensureUniqueSlugs(clubs);
        applyStaticHints(clubs, staticHints);
        applyFfeRefs(clubs, ffeLookup);
        const lookup = buildClubLookup(clubs);
        const club = findClubBySlug(clubSlug, lookup) || null;
        if (!club) {
          renderMessage(detailContainer.dataset.emptyMessage || 'Club introuvable.');
          return;
        }
        await geocodeClubIfNeeded(club);
        renderClub(club);
      })
      .catch(() => {
        renderMessage('Impossible de charger la fiche du club pour le moment.');
      })
      .finally(() => {
        releaseSpinner();
      });
  };

  if (backLink && document.referrer) {
    try {
      const ref = new URL(document.referrer);
      if (ref.origin === window.location.origin) {
        backLink.href = ref.pathname + ref.search;
      }
    } catch (err) {
      // Ignore malformed referrer
    }
  }

  loadGeocodeCache();
  init();
})();
