const { cleanText } = require('./text');

const STREET_KEYWORDS =
  /\b(rue|avenue|av\.?|boulevard|bd|bld|place|route|chemin|impasse|all[ée]e|voie|quai|cours|passage|square|sentier|mail|esplanade|terrasse|pont|faubourg|clos|cité|cite|hameau|lotissement|residence|résidence|allee)\b/i;

const VENUE_KEYWORDS =
  /\b(maison|espace|centre|complexe|gymnase|salle|foyer|club|ecole|école|stade|dojo|arena|halle)\b/i;

const ADDRESS_SPLIT_PATTERN = /[,;/\n]+/;

const SCHEDULE_TAIL_PATTERN =
  /\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|semaine|week[-\s]?end|w-?e|w\.?e\.?)\b.*$/i;

const escapeRegex = (value) => (value || '').toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractPostalCode = (...fields) => {
  for (let i = 0; i < fields.length; i += 1) {
    const field = (fields[i] || '').toString();
    const strict = field.match(/\b(\d{5})\b/);
    if (strict && strict[1]) {
      return strict[1];
    }
    const spaced = field.match(/\b(\d{2})\s*(\d{3})\b/);
    if (spaced && spaced[1] && spaced[2]) {
      return `${spaced[1]}${spaced[2]}`;
    }
  }
  return '';
};

const stripCedexSuffix = (value) =>
  (value || '')
    .toString()
    .replace(/\bcedex\b(?:\s*[-/]?\s*\d{1,3})?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractCityFromAddress = (value) => {
  if (!value) {
    return '';
  }
  const str = value.toString();
  const postal = extractPostalCode(str);
  if (postal) {
    const idx = str.indexOf(postal);
    if (idx >= 0) {
      const after = str.slice(idx + postal.length).trim();
      if (after) {
        return after.replace(/^[,;\u2013\u2014-]+/, '').trim();
      }
    }
  }
  const parts = str
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return stripCedexSuffix(parts[parts.length - 1] || '');
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

  let formatted = lower.replace(
    /(^|[\s\-’'])(\p{L})/gu,
    (match, boundary, letter) => `${boundary}${letter.toUpperCase()}`
  );
  formatted = formatted.replace(/\b(De|Du|Des|La|Le|Les|Sur|Sous|Et|Aux|Au)\b/gu, (match) =>
    match.toLowerCase()
  );
  formatted = formatted.replace(/\bD'([A-Z])/g, (match, letter) => `d'${letter}`);
  formatted = formatted.replace(/\bL'([A-Z])/g, (match, letter) => `l'${letter}`);
  return formatted.replace(/\s+/g, ' ').trim();
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

const tidyAddress = (value) =>
  cleanText((value || '').replace(/<br\s*\/?\s*>/gi, ', '))
    .replace(/\s+,/g, ',')
    .replace(/,\s+/g, ', ')
    .trim();

const stripAddressNotes = (segment) =>
  (segment || '')
    .toString()
    .replace(SCHEDULE_TAIL_PATTERN, '')
    .replace(/\(\s*(?:we|w-?e|week[-\s]?end|weekend)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,;\s\-]+|[,;\s\-]+$/g, '')
    .trim();

const looksLikePostalOnly = (value) => {
  const raw = (value || '').toString().trim();
  if (!raw || !/\b\d{5}\b/.test(raw)) {
    return false;
  }
  if (STREET_KEYWORDS.test(raw)) {
    return false;
  }
  if (VENUE_KEYWORDS.test(raw)) {
    return false;
  }
  const withoutPostal = stripCedexSuffix(raw.replace(/\b\d{5}\b/g, ' ')).trim();
  if (!withoutPostal) {
    return true;
  }
  if (/^[\p{L}\s'’-]+$/u.test(withoutPostal)) {
    return true;
  }
  return withoutPostal.split(/\s+/).length <= 3;
};

const stripLeadingCity = (value, cityHint) => {
  const city = formatCommune(cityHint || '');
  if (!city) {
    return (value || '').toString().trim();
  }
  const cleaned = (value || '').toString().trim();
  if (!cleaned) {
    return '';
  }
  const pattern = new RegExp(`^${escapeRegex(city)}\\b[\\s,;:\\-]+`, 'i');
  const stripped = cleaned.replace(pattern, '').trim();
  return stripped || cleaned;
};

const extractStreetCore = (value) => {
  const cleaned = (value || '').toString().replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return '';
  }
  const keywordMatch = cleaned.match(STREET_KEYWORDS);
  if (!keywordMatch || keywordMatch.index == null) {
    return cleaned;
  }

  let startIndex = keywordMatch.index;
  const before = cleaned.slice(0, startIndex);
  const numberRegex = /\b\d+[A-Za-z]?\b/g;
  let numberMatch;
  let lastNumber = null;
  while ((numberMatch = numberRegex.exec(before)) !== null) {
    lastNumber = numberMatch;
  }
  if (lastNumber && lastNumber.index != null) {
    const distance = startIndex - (lastNumber.index + lastNumber[0].length);
    if (distance >= 0 && distance <= 24) {
      startIndex = lastNumber.index;
    }
  }

  return cleaned
    .slice(startIndex)
    .replace(/^[,;\s\-]+/, '')
    .replace(/\b\d{5}\b.*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const simplifyStreetSegment = (value, { cityHint = '' } = {}) => {
  if (!value) {
    return '';
  }
  const cleaned = value.toString().replace(/\([^)]*\)/g, ' ');
  const parts = cleaned
    .split(ADDRESS_SPLIT_PATTERN)
    .map((part) => stripAddressNotes(part))
    .filter(Boolean);

  if (!parts.length) {
    return '';
  }

  const uniqueParts = [];
  const seen = new Set();
  parts.forEach((part) => {
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueParts.push(part);
    }
  });

  const tests = [
    (part) => /\b\d+[A-Za-z]?\b/.test(part) && STREET_KEYWORDS.test(part),
    (part) => STREET_KEYWORDS.test(part),
    (part) => /\b\d+[A-Za-z]?\b/.test(part) && !looksLikePostalOnly(part),
    (part) => VENUE_KEYWORDS.test(part) && !looksLikePostalOnly(part),
    (part) => !looksLikePostalOnly(part),
  ];

  for (const test of tests) {
    const match = uniqueParts.find((part) => test(part));
    if (!match) {
      continue;
    }

    let candidate = match;
    if (STREET_KEYWORDS.test(candidate)) {
      candidate = extractStreetCore(candidate);
    }
    candidate = stripLeadingCity(candidate, cityHint);
    candidate = stripCedexSuffix(candidate)
      .replace(/\b\d{5}\b.*$/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[,;\s\-]+|[,;\s\-]+$/g, '')
      .trim();

    if (candidate && !looksLikePostalOnly(candidate)) {
      return candidate;
    }
  }

  const fallback = uniqueParts.find((part) => !looksLikePostalOnly(part)) || '';
  if (!fallback) {
    return '';
  }
  const cleanedFallback = stripLeadingCity(fallback, cityHint).replace(/\s+/g, ' ').trim();
  if (!cleanedFallback || looksLikePostalOnly(cleanedFallback)) {
    return '';
  }
  return cleanedFallback;
};

const buildStandardAddress = (
  primaryAddress,
  secondaryAddress,
  postalCode,
  city,
  { preferPrimary = true } = {}
) => {
  const fallbackPostal = extractPostalCode(postalCode, primaryAddress, secondaryAddress);
  const fallbackCity = formatCommune(
    city || extractCityFromAddress(primaryAddress) || extractCityFromAddress(secondaryAddress) || ''
  );

  const primaryStreet = simplifyStreetSegment(primaryAddress, { cityHint: fallbackCity });
  const secondaryStreet = simplifyStreetSegment(secondaryAddress, { cityHint: fallbackCity });

  let street = '';
  let localityPostal = fallbackPostal;
  let localityCity = fallbackCity;

  const applyLocalityFrom = (address) => {
    const postalFromAddress = extractPostalCode(address);
    const cityFromAddress = formatCommune(extractCityFromAddress(address));
    if (postalFromAddress) {
      localityPostal = postalFromAddress;
    }
    if (cityFromAddress) {
      localityCity = cityFromAddress;
    }
  };

  if (preferPrimary) {
    if (primaryStreet) {
      street = primaryStreet;
      applyLocalityFrom(primaryAddress);
    } else if (secondaryStreet) {
      street = secondaryStreet;
      applyLocalityFrom(secondaryAddress);
    }
  } else if (secondaryStreet) {
    street = secondaryStreet;
    applyLocalityFrom(secondaryAddress);
  } else if (primaryStreet) {
    street = primaryStreet;
    applyLocalityFrom(primaryAddress);
  }

  const locality = [localityPostal, localityCity].filter(Boolean).join(' ').trim();
  if (street && locality) {
    return `${street}, ${locality}`;
  }
  return street || locality || '';
};

module.exports = {
  buildStandardAddress,
  extractCityFromAddress,
  extractPostalCode,
  formatCommune,
  formatCommuneWithPostal,
  formatParisArrondissementLabel,
  getParisArrondissementFromPostal,
  tidyAddress,
};
