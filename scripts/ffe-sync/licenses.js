const fs = require('node:fs');

const { extractPostalCode } = require('./address');
const { normalise } = require('./text');
const { writeJson } = require('./util');

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
    const ref = (entry.ffe_ref || entry.ref || entry.ffeRef || entry.fiche_ffe || '')
      .toString()
      .trim();
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
  const ref = (entry.ffe_ref || entry.ref || entry.ffeRef || entry.fiche_ffe || '')
    .toString()
    .trim();
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

module.exports = {
  buildLicenseLookup,
  updateLicenseCountsInFile,
};

