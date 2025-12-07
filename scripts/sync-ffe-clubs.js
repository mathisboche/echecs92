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
const MANIFEST_PATH = path.join(DATA_ROOT, 'clubs-france.json');
const FFE_MANIFEST_PATH = path.join(DATA_ROOT, 'clubs-france-ffe.json');

const BASE_URL = 'https://echecs.asso.fr';
const HEADERS = {
  'User-Agent': 'echecs92-data-sync/1.0 (+https://echecs92.fr)',
};
const FETCH_TIMEOUT_MS = 20000;
const DETAIL_CONCURRENCY = 8;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchText = async (url, retries = 3) => {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (error) {
      if (attempt >= retries) {
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
  const email = extractEmail(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelEMail'));
  const siteRaw = extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelURL');
  const siteHref = extractLinkHref(siteRaw);
  const site =
    siteHref && /^https?:/i.test(siteHref)
      ? siteHref
      : cleanText(siteRaw).replace(/\s+/g, '');
  const president = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelPresident'));
  const horaires = cleanText(
    extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelOuverture').replace(/<br\s*\/?\s*>/gi, '; ')
  );
  const licencesRaw = extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelAffilies');
  const licences = parseLicences(licencesRaw);

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
    telephone,
    email,
    site,
    president,
    horaires,
    licences_a: licences.a,
    licences_b: licences.b,
    postalCode,
    commune: city,
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
    nom: detail.name || listEntry.name,
    adresse: detail.adresse || '',
    siege: detail.siege || '',
    telephone: detail.telephone || '',
    email: detail.email || '',
    site: detail.site || '',
    president: detail.president || '',
    horaires: detail.horaires || '',
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
            telephone: '',
            email: '',
            site: '',
            president: '',
            horaires: '',
            licences_a: null,
            licences_b: null,
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

  departments.forEach((dept) => {
    const list = deptClubLists.get(dept.code) || [];
    const baseEntries = [];
    const ffeEntries = [];

    list.forEach((entry) => {
      const detail = allRefs.get(entry.ref) || { ref: entry.ref };
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

  ensureUniqueSlugs(allFfeEntries);

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
