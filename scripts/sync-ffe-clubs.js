#!/usr/bin/env node
/**
 * Synchronise tous les clubs France depuis le site FFE.
 * - Récupère la liste des comités (départements) depuis Comites.aspx
 * - Pour chaque comité, récupère la liste des clubs et les fiches individuelles
 * - Produit les fichiers `clubs-france` (données complètes) et `clubs-france-ffe` (refs FFE)
 *
 * Notes :
 * - Utilise uniquement les API HTTP publiques du site FFE.
 * - Les slugs sont générés avec la même logique que generate-ffe-templates.js.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_ROOT = path.join(
  ROOT,
  'wp-content',
  'themes',
  'echecs92-child',
  'assets',
  'data'
);
const CLUBS_DIR = path.join(DATA_ROOT, 'clubs-france');
const FFE_DIR = path.join(DATA_ROOT, 'clubs-france-ffe');
const FFE_DETAILS_DIR = path.join(DATA_ROOT, 'clubs-france-ffe-details');
const MANIFEST_PATH = path.join(DATA_ROOT, 'clubs-france.json');
const FFE_MANIFEST_PATH = path.join(DATA_ROOT, 'clubs-france-ffe.json');
const CLUBS_92_PATH = path.join(DATA_ROOT, 'clubs.json');

const LICENSES_ONLY = process.argv.includes('--licenses-only');

const BASE_URL = 'https://echecs.asso.fr';
const HEADERS = {
  'User-Agent': 'echecs92-data-sync/1.0 (+https://echecs92.fr)',
};
const FETCH_TIMEOUT_MS = 20000;
const DETAIL_CONCURRENCY = 8;
const LIST_CONCURRENCY = 3;
const EXCLUDED_CLUB_REFS = new Set(['1901']);
const EXCLUDED_CLUB_NAME_PATTERNS = [/championnat de france/i];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchText = async (url, options = {}, retries = 3) => {
  let requestOptions = options;
  let attempts = retries;
  if (typeof options === 'number') {
    requestOptions = {};
    attempts = options;
  }
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const headers = { ...HEADERS, ...(requestOptions.headers || {}) };
      const res = await fetch(url, { ...requestOptions, headers, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error(`Failed to fetch ${url}`);
};

const htmlEntities = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  auml: 'ä',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  ouml: 'ö',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  yuml: 'ÿ',
  rsquo: '’',
  lsquo: '’',
  ndash: '–',
  mdash: '—',
};

const decodeHtml = (value) => {
  const str = (value || '').toString();
  return str
    .replace(/&#(\d+);/g, (match, code) => {
      const num = Number.parseInt(code, 10);
      return Number.isFinite(num) ? String.fromCharCode(num) : match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      const num = Number.parseInt(hex, 16);
      return Number.isFinite(num) ? String.fromCharCode(num) : match;
    })
    .replace(/&([a-z]+);/gi, (match, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(htmlEntities, key) ? htmlEntities[key] : match;
    });
};

const stripTags = (value) => (value || '').toString().replace(/<[^>]+>/g, ' ');

const cleanText = (value) =>
  decodeHtml(stripTags(value || ''))
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();

const normalise = (value) =>
  (value || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const slugify = (value) =>
  normalise(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

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

const extractPostalCode = (...fields) => {
  for (let i = 0; i < fields.length; i += 1) {
    const match = (fields[i] || '').toString().match(/\b(\d{5})\b/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return '';
};

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
        return after.replace(/^[,;–—-]+/, '').trim();
      }
    }
  }
  const parts = str
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || '';
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
  cleanText((value || '').replace(/<br\s*\/?\s*>/gi, ', ')).replace(/\s+,/g, ',').replace(/,\s+/g, ', ').trim();

const parseDepartments = (html) => {
  const entries = [];
  const regex =
    /<area[^>]*href=FicheComite\.aspx\?Ref=([^ >"']+)[^>]*alt=([^>]+)>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const code = match[1].trim();
    const name = cleanText(match[2]);
    if (!code || !name) {
      continue;
    }
    entries.push({
      code,
      name,
      slug: slugify(name),
      file: `${code}.json`,
    });
  }
  const seen = new Set();
  const deduped = entries.filter((entry) => {
    const key = `${entry.code}|${entry.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true, sensitivity: 'base' }));
  return deduped;
};

const parseClubList = (html) => {
  const clubs = [];
  const regex =
    /<td[^>]*align=center[^>]*>\s*([\dA-Z]{2,3})\s*<\/td>\s*<td[^>]*align=left[^>]*>([^<]*)<\/td>\s*<td[^>]*align=left[^>]*><a[^>]*href="FicheClub\.aspx\?Ref=(\d{2,})"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const dept = cleanText(match[1]);
    const commune = cleanText(match[2]);
    const ref = (match[3] || '').trim();
    const name = cleanText(match[4]);
    if (!ref || !name) {
      continue;
    }
    clubs.push({ ref, name, commune, dept });
  }
  return clubs;
};

const extractSpan = (html, id) => {
  const regex = new RegExp(`<span[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/span>`, 'i');
  const match = html.match(regex);
  return match ? match[1] : '';
};

const extractLinkHref = (value) => {
  if (!value) {
    return '';
  }
  const hrefMatch = value.match(/href\s*=\s*"?([^"\s>]+)"?/i);
  return hrefMatch ? hrefMatch[1] : '';
};

const extractEmail = (value) => {
  const raw = value || '';
  const mailMatch = raw.match(/mailto:([^"\s>]+)/i);
  if (mailMatch) {
    return mailMatch[1];
  }
  const text = cleanText(raw);
  const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return emailMatch ? emailMatch[0] : '';
};

const parseLicences = (value) => {
  const result = { a: null, b: null };
  if (!value) {
    return result;
  }
  const aMatch = value.match(/Licences\s*A\s*:\s*<b>(\d+)/i);
  const bMatch = value.match(/Licences\s*B\s*:\s*<b>(\d+)/i);
  result.a = aMatch ? Number.parseInt(aMatch[1], 10) : null;
  result.b = bMatch ? Number.parseInt(bMatch[1], 10) : null;
  return result;
};

const parseClubDetails = (html, ref) => {
  const name = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelNom'));
  const siege = tidyAddress(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelAdresse'));
  const salle = tidyAddress(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelSalle'));
  const telephone = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelTel'));
  const fax = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelFax'));
  const email = extractEmail(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelEMail'));
  const siteRaw = extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelURL');
  const siteHref = extractLinkHref(siteRaw);
  const site =
    siteHref && /^https?:/i.test(siteHref)
      ? siteHref
      : cleanText(siteRaw).replace(/\s+/g, '');
  const presidentRaw = extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelPresident');
  const president = cleanText(presidentRaw);
  const presidentEmail = extractEmail(presidentRaw);
  const contactRaw = extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelCorrespondant');
  const contact = cleanText(contactRaw);
  const contactEmail = extractEmail(contactRaw);
  const horaires = cleanText(
    extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelOuverture').replace(/<br\s*\/?\s*>/gi, '; ')
  );
  const accesPmr = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelHandicape'));
  const licencesRaw = extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelAffilies');
  const licences = parseLicences(licencesRaw);
  const interclubs = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelDivisionAdulte'));
  const interclubsJeunes = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelDivisionJeune'));
  const interclubsFeminins = cleanText(
    extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelDivisionFeminines')
  );
  const labelFederal = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelLabel'));

  const primaryAddress = salle || siege;
  const postalCode = extractPostalCode(primaryAddress, siege);
  const city =
    extractCityFromAddress(primaryAddress) ||
    extractCityFromAddress(siege);

  return {
    ref,
    name,
    adresse: primaryAddress,
    siege,
    salle_jeu: salle,
    telephone,
    fax,
    email,
    site,
    president,
    president_email: presidentEmail,
    contact,
    contact_email: contactEmail,
    horaires,
    acces_pmr: accesPmr,
    licences_a: licences.a,
    licences_b: licences.b,
    interclubs,
    interclubs_jeunes: interclubsJeunes,
    interclubs_feminins: interclubsFeminins,
    label_federal: labelFederal,
    postalCode,
    commune: city,
  };
};

const extractHiddenFields = (html) => {
  const fields = {};
  const regex = /<input[^>]+type=["']?hidden["']?[^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const input = match[0];
    const nameMatch = input.match(/name=["']?([^"' >]+)/i);
    if (!nameMatch) {
      continue;
    }
    const valueMatch = input.match(/value=["']?([^"']*)/i);
    fields[nameMatch[1]] = decodeHtml(valueMatch ? valueMatch[1] : '');
  }
  return fields;
};

const extractPagerInfo = (html) => {
  const regex = /__doPostBack\('([^']+)',\s*'([^']+)'\)/g;
  let eventTarget = '';
  const pages = new Set();
  let match;
  while ((match = regex.exec(html)) !== null) {
    const target = match[1];
    const arg = match[2];
    if (!/Pager/i.test(target)) {
      continue;
    }
    if (!eventTarget) {
      eventTarget = target;
    }
    if (/^\d+$/.test(arg)) {
      pages.add(Number.parseInt(arg, 10));
    }
  }
  const maxPage = pages.size ? Math.max(...pages) : 1;
  return { eventTarget, maxPage };
};

const fetchPagedHtml = async (url) => {
  const pages = [];
  let html = await fetchText(url);
  pages.push(html);

  const { eventTarget, maxPage } = extractPagerInfo(html);
  if (!eventTarget || maxPage <= 1) {
    return pages;
  }

  let hiddenFields = extractHiddenFields(html);
  for (let page = 2; page <= maxPage; page += 1) {
    const bodyFields = {
      ...hiddenFields,
      __EVENTTARGET: eventTarget,
      __EVENTARGUMENT: String(page),
    };
    const body = new URLSearchParams(bodyFields);
    html = await fetchText(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    pages.push(html);
    hiddenFields = extractHiddenFields(html);
    await sleep(80);
  }
  return pages;
};

const extractTableRows = (html) => {
  const rows = [];
  const rowRegex = /<tr class=liste_[^>]*>[\s\S]*?<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[0];
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length) {
      rows.push({ cells, rowHtml });
    }
  }
  return rows;
};

const extractPlayerId = (html) => {
  const match = html.match(/FicheJoueur\.aspx\?Id=(\d+)/i);
  return match ? match[1] : '';
};

const parseMemberRows = (html) => {
  const rows = extractTableRows(html);
  const results = [];
  rows.forEach(({ cells, rowHtml }) => {
    if (cells.length < 10) {
      return;
    }
    const values = cells.map(cleanText);
    const nrFfe = values[0] || '';
    const name = values[1] || '';
    if (!nrFfe || !name) {
      return;
    }
    const playerId = extractPlayerId(rowHtml);
    results.push({
      nrFfe,
      name,
      aff: values[2] || '',
      playerId: playerId || '',
      elo: values[4] || '',
      rapid: values[5] || '',
      blitz: values[6] || '',
      category: values[7] || '',
      gender: values[8] || '',
      club: values[9] || '',
    });
  });
  return results;
};

const parseQualificationRows = (html) => {
  const rows = extractTableRows(html);
  const results = [];
  rows.forEach(({ cells, rowHtml }) => {
    if (cells.length < 5) {
      return;
    }
    const values = cells.map(cleanText);
    const nrFfe = values[0] || '';
    const name = values[1] || '';
    if (!nrFfe || !name) {
      return;
    }
    const email = extractEmail(rowHtml);
    results.push({
      nrFfe,
      name,
      email: email || '',
      role: values[2] || '',
      validity: values[3] || '',
      club: values[4] || '',
      playerId: '',
    });
  });
  return results;
};

const dedupeRows = (rows, getKey) => {
  const seen = new Set();
  const output = [];
  rows.forEach((row) => {
    const key = getKey(row);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push(row);
  });
  return output;
};

const buildMemberIdLookup = (rows) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = (row.nrFfe || '').toString().trim();
    const playerId = (row.playerId || '').toString().trim();
    if (!key || !playerId || map.has(key)) {
      return;
    }
    map.set(key, playerId);
  });
  return map;
};

const applyPlayerIds = (rows, lookup) =>
  rows.map((row) => {
    if (row.playerId || !row.nrFfe || !lookup.has(row.nrFfe)) {
      return row;
    }
    return { ...row, playerId: lookup.get(row.nrFfe) };
  });

const fetchListRows = async (url, parser, dedupeKey) => {
  const pages = await fetchPagedHtml(url);
  let rows = [];
  pages.forEach((html) => {
    rows = rows.concat(parser(html));
  });
  if (dedupeKey) {
    rows = dedupeRows(rows, dedupeKey);
  }
  return rows;
};

const buildListPayload = (rows, error = '') => ({
  count: Array.isArray(rows) ? rows.length : 0,
  rows: Array.isArray(rows) ? rows : [],
  error: error || '',
});

const sanitiseClubRef = (value) => {
  const match = (value || '').toString().trim().match(/(\d{2,})$/);
  return match ? match[1] : '';
};

const fetchClubLists = async (ref, name, errors) => {
  const refId = sanitiseClubRef(ref);
  if (!refId) {
    return null;
  }

  const memberUrl = `${BASE_URL}/ListeJoueurs.aspx?Action=JOUEURCLUBREF&ClubRef=${encodeURIComponent(refId)}`;
  const memberEloUrl = `${BASE_URL}/ListeJoueurs.aspx?Action=JOUEURCLUBREF&JrTri=Elo&ClubRef=${encodeURIComponent(refId)}`;
  const arbitrageUrl = `${BASE_URL}/ListeArbitres.aspx?Action=DNACLUB&ClubRef=${encodeURIComponent(refId)}`;
  const animationUrl = `${BASE_URL}/ListeArbitres.aspx?Action=DAFFECLUB&ClubRef=${encodeURIComponent(refId)}`;
  const trainingUrl = `${BASE_URL}/ListeArbitres.aspx?Action=DEFFECLUB&ClubRef=${encodeURIComponent(refId)}`;
  const initiationUrl = `${BASE_URL}/ListeArbitres.aspx?Action=DIFFECLUB&ClubRef=${encodeURIComponent(refId)}`;

  const listErrors = [];

  const safeFetch = async (label, url, parser, dedupeKey) => {
    try {
      const rows = await fetchListRows(url, parser, dedupeKey);
      return { rows, error: '' };
    } catch (error) {
      const message = error && error.message ? error.message : 'Erreur inconnue';
      listErrors.push(`${label}: ${message}`);
      return { rows: [], error: message };
    }
  };

  const memberKey = (row) => `${row.nrFfe || ''}|${row.name || ''}|${row.playerId || ''}`;
  const staffKey = (row) => `${row.nrFfe || ''}|${row.name || ''}|${row.role || ''}`;

  const members = await safeFetch('membres', memberUrl, parseMemberRows, memberKey);
  const memberLookup = buildMemberIdLookup(members.rows);
  members.rows = applyPlayerIds(members.rows, memberLookup);

  const membersByElo = await safeFetch('membres_par_elo', memberEloUrl, parseMemberRows, memberKey);
  membersByElo.rows = applyPlayerIds(membersByElo.rows, memberLookup);

  const arbitrage = await safeFetch('arbitrage', arbitrageUrl, parseQualificationRows, staffKey);
  arbitrage.rows = applyPlayerIds(arbitrage.rows, memberLookup);

  const animation = await safeFetch('animation', animationUrl, parseQualificationRows, staffKey);
  animation.rows = applyPlayerIds(animation.rows, memberLookup);

  const entrainement = await safeFetch('entrainement', trainingUrl, parseQualificationRows, staffKey);
  entrainement.rows = applyPlayerIds(entrainement.rows, memberLookup);

  const initiation = await safeFetch('initiation', initiationUrl, parseQualificationRows, staffKey);
  initiation.rows = applyPlayerIds(initiation.rows, memberLookup);

  if (listErrors.length && Array.isArray(errors)) {
    errors.push({
      ref: refId,
      name: name || '',
      details: listErrors,
    });
  }

  return {
    ref: refId,
    updated: new Date().toISOString(),
    members: buildListPayload(members.rows, members.error),
    members_by_elo: buildListPayload(membersByElo.rows, membersByElo.error),
    arbitrage: buildListPayload(arbitrage.rows, arbitrage.error),
    animation: buildListPayload(animation.rows, animation.error),
    entrainement: buildListPayload(entrainement.rows, entrainement.error),
    initiation: buildListPayload(initiation.rows, initiation.error),
  };
};

const limitConcurrency = (concurrency) => {
  const queue = [];
  let active = 0;

  const next = () => {
    if (active >= concurrency || queue.length === 0) {
      return;
    }
    const { fn, resolve, reject } = queue.shift();
    active += 1;
    Promise.resolve()
      .then(fn)
      .then((value) => {
        active -= 1;
        resolve(value);
        next();
      })
      .catch((err) => {
        active -= 1;
        reject(err);
        next();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
};

const buildClubEntries = (detail, listEntry, dept) => {
  const postalCode = detail.postalCode || extractPostalCode(detail.adresse, detail.siege);
  const commune =
    formatCommuneWithPostal(
      detail.commune || listEntry.commune || '',
      postalCode
    ) || formatCommune(listEntry.commune);
  const id = slugify(detail.name || listEntry.name || `${dept.code}-${detail.ref}`);

  const baseEntry = {
    ffe_ref: detail.ref || listEntry.ref,
    nom: detail.name || listEntry.name,
    adresse: detail.adresse || '',
    siege: detail.siege || '',
    salle_jeu: detail.salle_jeu || '',
    telephone: detail.telephone || '',
    fax: detail.fax || '',
    email: detail.email || '',
    site: detail.site || '',
    president: detail.president || '',
    president_email: detail.president_email || '',
    contact: detail.contact || '',
    contact_email: detail.contact_email || '',
    horaires: detail.horaires || '',
    acces_pmr: detail.acces_pmr || '',
    interclubs: detail.interclubs || '',
    interclubs_jeunes: detail.interclubs_jeunes || '',
    interclubs_feminins: detail.interclubs_feminins || '',
    label_federal: detail.label_federal || '',
    licences_a: detail.licences_a,
    licences_b: detail.licences_b,
  };

  const ffeEntry = {
    id,
    name: detail.name || listEntry.name,
    commune: commune || '',
    postalCode: postalCode || '',
    departmentCode: dept.code,
    departmentName: dept.name,
    departmentSlug: dept.slug,
    ref: detail.ref || listEntry.ref,
  };

  return { baseEntry, ffeEntry };
};

const shouldExcludeClub = (detail, listEntry) => {
  const ref = (detail?.ref || listEntry?.ref || '').toString().trim();
  if (ref && EXCLUDED_CLUB_REFS.has(ref)) {
    return true;
  }
  const name = (detail?.name || listEntry?.name || '').toString().trim();
  if (name && EXCLUDED_CLUB_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return true;
  }
  return false;
};

const coerceLicenseValue = (value) => {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildLicenseLookup = (entries) => {
  const byRef = new Map();
  const byNamePostal = new Map();
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const ref = (entry.ffe_ref || entry.ref || entry.ffeRef || entry.fiche_ffe || '').toString().trim();
    if (ref && !byRef.has(ref)) {
      byRef.set(ref, entry);
    }
    const name = (entry.nom || entry.name || '').toString().trim();
    const postal =
      extractPostalCode(entry.adresse, entry.siege, entry.salle_jeu, entry.address) ||
      (entry.postalCode || '').toString().trim();
    if (name && postal) {
      const key = `${normalise(name)}|${postal}`;
      if (!byNamePostal.has(key)) {
        byNamePostal.set(key, entry);
      }
    }
  });
  return { byRef, byNamePostal };
};

const findLicenseMatch = (entry, lookup) => {
  if (!entry || typeof entry !== 'object' || !lookup) {
    return null;
  }
  const ref = (entry.ffe_ref || entry.ref || entry.ffeRef || entry.fiche_ffe || '').toString().trim();
  if (ref && lookup.byRef && lookup.byRef.has(ref)) {
    return lookup.byRef.get(ref);
  }
  const name = (entry.nom || entry.name || '').toString().trim();
  const postal =
    extractPostalCode(entry.adresse, entry.siege, entry.salle_jeu, entry.address) ||
    (entry.postalCode || '').toString().trim();
  if (name && postal && lookup.byNamePostal) {
    const key = `${normalise(name)}|${postal}`;
    if (lookup.byNamePostal.has(key)) {
      return lookup.byNamePostal.get(key);
    }
  }
  return null;
};

const applyLicenseCounts = (entry, source) => {
  if (!entry || typeof entry !== 'object' || !source) {
    return entry;
  }
  const next = { ...entry };
  const licenseA = coerceLicenseValue(source.licences_a ?? source.licenses_a ?? source.license_a);
  const licenseB = coerceLicenseValue(source.licences_b ?? source.licenses_b ?? source.license_b);
  if (licenseA != null) {
    next.licences_a = licenseA;
  }
  if (licenseB != null) {
    next.licences_b = licenseB;
  }
  return next;
};

const updateLicenseCountsInFile = (filePath, lookup) => {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return false;
  }
  if (!Array.isArray(existing)) {
    return false;
  }
  const updated = existing.map((entry) => {
    const match = findLicenseMatch(entry, lookup);
    return match ? applyLicenseCounts(entry, match) : entry;
  });
  writeJson(filePath, updated);
  return true;
};

const writeJson = (filePath, data) => {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
};

const main = async () => {
  console.log('→ Récupération de la liste des comités...');
  const comitesHtml = await fetchText(`${BASE_URL}/Comites.aspx`);
  const departments = parseDepartments(comitesHtml);
  if (!departments.length) {
    throw new Error('Aucun comité trouvé sur Comites.aspx');
  }
  console.log(`→ ${departments.length} comités trouvés.`);

  fs.mkdirSync(CLUBS_DIR, { recursive: true });
  fs.mkdirSync(FFE_DIR, { recursive: true });

  const deptClubLists = new Map();
  const allRefs = new Map();

  for (const dept of departments) {
    process.stdout.write(`→ Clubs du ${dept.code} ${dept.name}... `);
    try {
      const listHtml = await fetchText(`${BASE_URL}/ListeClubs.aspx?Action=CLUBCOMITE&ComiteRef=${encodeURIComponent(dept.code)}`);
      const clubs = parseClubList(listHtml);
      deptClubLists.set(dept.code, clubs);
      clubs.forEach((club) => {
        if (!allRefs.has(club.ref)) {
          allRefs.set(club.ref, null);
        }
      });
      console.log(`${clubs.length} club(s)`);
    } catch (error) {
      console.log('erreur', error.message);
      deptClubLists.set(dept.code, []);
    }
    await sleep(120);
  }

  const refs = Array.from(allRefs.keys());
  console.log(`→ Téléchargement des fiches clubs (${refs.length})...`);
  const limiter = limitConcurrency(DETAIL_CONCURRENCY);
  let done = 0;
  await Promise.all(
    refs.map((ref) =>
      limiter(async () => {
        try {
          const html = await fetchText(`${BASE_URL}/FicheClub.aspx?Ref=${encodeURIComponent(ref)}`);
          const detail = parseClubDetails(html, ref);
          allRefs.set(ref, detail);
        } catch (error) {
          allRefs.set(ref, {
            ref,
            name: '',
            adresse: '',
            siege: '',
            salle_jeu: '',
            telephone: '',
            fax: '',
            email: '',
            site: '',
            president: '',
            president_email: '',
            contact: '',
            contact_email: '',
            horaires: '',
            acces_pmr: '',
            licences_a: null,
            licences_b: null,
            interclubs: '',
            interclubs_jeunes: '',
            interclubs_feminins: '',
            label_federal: '',
            postalCode: '',
            commune: '',
          });
        } finally {
          done += 1;
          if (done % 50 === 0 || done === refs.length) {
            process.stdout.write(`  ${done}/${refs.length} fiches\r`);
          }
        }
      })
    )
  );
  process.stdout.write('\n');

  const perDeptBase = new Map();
  const perDeptFfe = new Map();
  const allFfeEntries = [];
  const includedRefs = new Map();

  departments.forEach((dept) => {
    const list = deptClubLists.get(dept.code) || [];
    const baseEntries = [];
    const ffeEntries = [];

    list.forEach((entry) => {
      const detail = allRefs.get(entry.ref) || { ref: entry.ref };
      if (shouldExcludeClub(detail, entry)) {
        console.log(`→ Club exclu (${entry.ref}) ${entry.name || detail.name || ''}`.trim());
        return;
      }
      const refKey = detail.ref || entry.ref;
      if (refKey && !includedRefs.has(refKey)) {
        includedRefs.set(refKey, { name: detail.name || entry.name || '' });
      }
      const combined = buildClubEntries(detail, entry, dept);
      baseEntries.push(combined.baseEntry);
      ffeEntries.push(combined.ffeEntry);
      allFfeEntries.push(combined.ffeEntry);
    });

    baseEntries.sort(
      (a, b) =>
        (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }) ||
        (a.adresse || '').localeCompare(b.adresse || '', 'fr', { sensitivity: 'base' })
    );
    ffeEntries.sort(
      (a, b) =>
        (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' }) ||
        (a.commune || '').localeCompare(b.commune || '', 'fr', { sensitivity: 'base' })
    );

    perDeptBase.set(dept.code, baseEntries);
    perDeptFfe.set(dept.code, ffeEntries);
  });

  if (LICENSES_ONLY) {
    departments.forEach((dept) => {
      const freshEntries = perDeptBase.get(dept.code) || [];
      const lookup = buildLicenseLookup(freshEntries);
      updateLicenseCountsInFile(path.join(CLUBS_DIR, dept.file), lookup);
    });
    if (perDeptBase.has('92')) {
      const lookup92 = buildLicenseLookup(perDeptBase.get('92') || []);
      updateLicenseCountsInFile(CLUBS_92_PATH, lookup92);
    }
    console.log('→ Mise à jour des licences terminée.');
    return;
  }

  ensureUniqueSlugs(allFfeEntries);

  if (includedRefs.size) {
    console.log('→ Téléchargement des listes FFE (membres, arbitrage, animation, entrainement, initiation)...');
    fs.mkdirSync(FFE_DETAILS_DIR, { recursive: true });
    const refs = Array.from(includedRefs.entries()).map(([ref, meta]) => ({
      ref,
      name: meta?.name || '',
    }));
    const limiter = limitConcurrency(LIST_CONCURRENCY);
    const errors = [];
    let doneLists = 0;

    await Promise.all(
      refs.map((entry) =>
        limiter(async () => {
          const payload = await fetchClubLists(entry.ref, entry.name, errors);
          if (payload) {
            const filePath = path.join(FFE_DETAILS_DIR, `${payload.ref}.json`);
            writeJson(filePath, payload);
          }
          doneLists += 1;
          if (doneLists % 25 === 0 || doneLists === refs.length) {
            process.stdout.write(`  ${doneLists}/${refs.length} clubs traités\r`);
          }
        })
      )
    );
    process.stdout.write('\n');
    if (errors.length) {
      console.log('--- FFE lists issues summary ---');
      errors.slice(0, 20).forEach((item) => {
        const label = item.name ? `${item.name} (${item.ref})` : item.ref;
        console.log(`- ${label} | ${item.details.join('; ')}`);
      });
      if (errors.length > 20) {
        console.log(`… ${errors.length - 20} autres erreurs`);
      }
      console.log('--- End FFE lists issues summary ---');
    }
  }

  departments.forEach((dept) => {
    const baseEntries = perDeptBase.get(dept.code) || [];
    const ffeEntries = perDeptFfe.get(dept.code) || [];
    writeJson(path.join(CLUBS_DIR, dept.file), baseEntries);
    writeJson(
      path.join(FFE_DIR, dept.file),
      ffeEntries.map((entry) => ({
        slug: entry.slug,
        name: entry.name,
        commune: entry.commune,
        postalCode: entry.postalCode,
        ref: entry.ref,
      }))
    );
  });

  const manifestPayload = {
    version: 1,
    updated: new Date().toISOString(),
    basePath: '/wp-content/themes/echecs92-child/assets/data/clubs-france/',
    departments: departments.map((dept) => ({
      code: dept.code,
      name: dept.name,
      slug: dept.slug,
      file: dept.file,
      count: (perDeptBase.get(dept.code) || []).length,
    })),
  };
  writeJson(MANIFEST_PATH, manifestPayload);

  const ffeManifestPayload = {
    version: 1,
    updated: new Date().toISOString(),
    basePath: '/wp-content/themes/echecs92-child/assets/data/clubs-france-ffe/',
    departments: departments.map((dept) => ({
      code: dept.code,
      name: dept.name,
      slug: dept.slug,
      file: dept.file,
      count: (perDeptFfe.get(dept.code) || []).length,
    })),
  };
  writeJson(FFE_MANIFEST_PATH, ffeManifestPayload);

  console.log('→ Synchronisation terminée.');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
