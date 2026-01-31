#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(
  ROOT,
  'wp-content',
  'themes',
  'echecs92-child',
  'assets',
  'data',
  'postal-coordinates-fr.json'
);
const API_ENDPOINT = 'https://geo.api.gouv.fr/communes';
const API_FIELDS = 'nom,codesPostaux,centre';
const FETCH_TIMEOUT_MS = 20000;

const fetchJson = async (url) => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const normalisePostalCode = (value) => {
  const code = (value || '').toString().replace(/\D/g, '').trim();
  return code.length === 5 ? code : '';
};

const buildEntries = (payload) => {
  const items = Array.isArray(payload) ? payload : [];
  const seen = new Set();
  const entries = [];

  items.forEach((item) => {
    if (!item) {
      return;
    }
    const name = (item.nom || item.name || '').toString().trim();
    const codes = Array.isArray(item.codesPostaux) ? item.codesPostaux : [];
    const coords = Array.isArray(item?.centre?.coordinates) ? item.centre.coordinates : [];
    const lng = Number.parseFloat(coords[0]);
    const lat = Number.parseFloat(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }
    codes.forEach((rawCode) => {
      const postalCode = normalisePostalCode(rawCode);
      if (!postalCode) {
        return;
      }
      const label = name || postalCode;
      const key = `${postalCode}|${label}|${lat}|${lng}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      entries.push([postalCode, lat, lng, label]);
    });
  });

  entries.sort((a, b) => {
    if (a[0] !== b[0]) {
      return a[0].localeCompare(b[0]);
    }
    if (a[3] !== b[3]) {
      return a[3].localeCompare(b[3], 'fr', { sensitivity: 'base' });
    }
    return a[1] - b[1] || a[2] - b[2];
  });

  return entries;
};

const main = async () => {
  const url = `${API_ENDPOINT}?${new URLSearchParams({
    fields: API_FIELDS,
  }).toString()}`;
  const payload = await fetchJson(url);
  const entries = buildEntries(payload);
  if (!entries.length) {
    throw new Error('Aucune coordonnee postale recuperée.');
  }
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`→ ${entries.length} codes postaux ecrits dans ${OUTPUT_PATH}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
