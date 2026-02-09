const { cleanText } = require('./text');

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
        return after.replace(/^[,;\u2013\u2014-]+/, '').trim();
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

module.exports = {
  extractCityFromAddress,
  extractPostalCode,
  formatCommune,
  formatCommuneWithPostal,
  formatParisArrondissementLabel,
  getParisArrondissementFromPostal,
  tidyAddress,
};
