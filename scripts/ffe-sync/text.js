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

module.exports = {
  cleanText,
  decodeHtml,
  hashStringToInt,
  normalise,
  slugify,
  stripTags,
  toBase36,
};

