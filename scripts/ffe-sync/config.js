const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DATA_ROOT = path.join(ROOT, 'wp-content', 'themes', 'echecs92-child', 'assets', 'data');

const CLUBS_DIR = path.join(DATA_ROOT, 'clubs-france');
const FFE_DIR = path.join(DATA_ROOT, 'clubs-france-ffe');
const FFE_DETAILS_DIR = path.join(DATA_ROOT, 'clubs-france-ffe-details');
const MANIFEST_PATH = path.join(DATA_ROOT, 'clubs-france.json');
const FFE_MANIFEST_PATH = path.join(DATA_ROOT, 'clubs-france-ffe.json');
const CLUBS_92_PATH = path.join(DATA_ROOT, 'clubs.json');

const BASE_URL = 'https://echecs.asso.fr';
const HEADERS = {
  'User-Agent': 'echecs92-data-sync/1.0 (+https://echecs92.fr)',
};
const FETCH_TIMEOUT_MS = 20000;
const DETAIL_CONCURRENCY = 8;
const LIST_CONCURRENCY = 3;
const EXCLUDED_CLUB_REFS = new Set(['1901']);
const EXCLUDED_CLUB_NAME_PATTERNS = [/championnat de france/i];

module.exports = {
  ROOT,
  DATA_ROOT,
  CLUBS_DIR,
  FFE_DIR,
  FFE_DETAILS_DIR,
  MANIFEST_PATH,
  FFE_MANIFEST_PATH,
  CLUBS_92_PATH,
  BASE_URL,
  HEADERS,
  FETCH_TIMEOUT_MS,
  DETAIL_CONCURRENCY,
  LIST_CONCURRENCY,
  EXCLUDED_CLUB_REFS,
  EXCLUDED_CLUB_NAME_PATTERNS,
};

