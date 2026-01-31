#!/usr/bin/env node
/**
 * Generate placeholder files for FFE club references, one file per department.
 * The output mirrors the structure of the main clubs data but only keeps
 * the fields needed to later plug in the FFE reference numbers.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE_MANIFEST = path.join(
  ROOT,
  'wp-content/themes/echecs92-child/assets/data/clubs-france.json'
);
const SOURCE_BASE_DIR = path.join(
  ROOT,
  'wp-content/themes/echecs92-child/assets/data/clubs-france'
);
const TARGET_BASE_DIR = path.join(
  ROOT,
  'wp-content/themes/echecs92-child/assets/data/clubs-france-ffe'
);
const TARGET_MANIFEST = path.join(
  ROOT,
  'wp-content/themes/echecs92-child/assets/data/clubs-france-ffe.json'
);

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
        return after.replace(/^[,;–—\-]+/, '').trim();
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

const buildEntry = (raw, dept) => {
  const name = raw.nom || raw.name || '';
  const primaryAddress = raw.adresse || raw.address || '';
  const secondaryAddress = raw.siege || raw.siege_social || raw.address2 || '';
  const postalCode =
    raw.code_postal ||
    raw.postal_code ||
    extractPostalCode(primaryAddress, secondaryAddress);
  const addressCity =
    extractCityFromAddress(primaryAddress) || extractCityFromAddress(secondaryAddress);
  const commune = formatCommuneWithPostal(raw.commune || raw.ville || addressCity || '', postalCode);
  const slugSource = name || commune || postalCode || primaryAddress || secondaryAddress;

  return {
    id: raw.id || slugify(slugSource || 'club'),
    name: name || commune || 'Club',
    commune,
    postalCode: postalCode || '',
    departmentCode: dept.code || '',
    departmentName: dept.name || '',
    departmentSlug: dept.slug || '',
    ref: '',
  };
};

const writeJson = (filePath, data) => {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
};

const main = () => {
  const manifest = JSON.parse(fs.readFileSync(SOURCE_MANIFEST, 'utf8'));
  const departments = Array.isArray(manifest.departments) ? manifest.departments : [];
  if (!departments.length) {
    throw new Error('No departments found in clubs-france manifest');
  }

  fs.mkdirSync(TARGET_BASE_DIR, { recursive: true });

  const allEntries = [];
  const perDept = new Map();

  departments.forEach((dept) => {
    const sourcePath = path.join(SOURCE_BASE_DIR, dept.file);
    const payload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const records = Array.isArray(payload) ? payload : [];
    const entries = records.map((record) => buildEntry(record, dept));
    perDept.set(dept.code, entries);
    allEntries.push(...entries);
  });

  ensureUniqueSlugs(allEntries);

  departments.forEach((dept) => {
    const list = perDept.get(dept.code) || [];
    list.sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) ||
        a.commune.localeCompare(b.commune, 'fr', { sensitivity: 'base' })
    );
    const output = list.map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      commune: entry.commune,
      postalCode: entry.postalCode,
      ref: '',
    }));
    writeJson(path.join(TARGET_BASE_DIR, dept.file), output);
  });

  const targetManifest = {
    version: 1,
    updated: new Date().toISOString(),
    basePath: '/wp-content/themes/echecs92-child/assets/data/clubs-france-ffe/',
    departments: departments.map((dept) => ({
      code: dept.code,
      name: dept.name,
      slug: dept.slug,
      file: dept.file,
      count: (perDept.get(dept.code) || []).length,
    })),
  };
  writeJson(TARGET_MANIFEST, targetManifest);
  console.log('FFE templates generated in', TARGET_BASE_DIR);
};

main();
