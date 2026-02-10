#!/usr/bin/env node
/**
 * Builds a local player index from the downloaded FFE club member lists.
 * Output:
 * - wp-content/themes/echecs92-child/assets/data/ffe-players/by-id/<00-99>.json
 * - wp-content/themes/echecs92-child/assets/data/ffe-players/manifest.json
 * - wp-content/themes/echecs92-child/assets/data/ffe-players/search-index.json
 * - wp-content/themes/echecs92-child/assets/data/ffe-players/top-elo.json
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_ROOT = path.join(ROOT, 'wp-content', 'themes', 'echecs92-child', 'assets', 'data');
const FFE_DETAILS_DIR = path.join(DATA_ROOT, 'clubs-france-ffe-details');
const OUTPUT_DIR = path.join(DATA_ROOT, 'ffe-players', 'by-id');
const MANIFEST_PATH = path.join(DATA_ROOT, 'ffe-players', 'manifest.json');
const SEARCH_INDEX_PATH = path.join(DATA_ROOT, 'ffe-players', 'search-index.json');
const TOP_ELO_PATH = path.join(DATA_ROOT, 'ffe-players', 'top-elo.json');

const LIST_KEYS = ['members', 'members_by_elo', 'arbitrage', 'animation', 'entrainement', 'initiation'];

const safeReadJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
};

const toStringOrEmpty = (value) => (value == null ? '' : String(value)).trim();

const parseUpdated = (value) => {
  const str = toStringOrEmpty(value);
  const date = str ? new Date(str) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const pickLatestUpdated = (a, b) => {
  const da = parseUpdated(a);
  const db = parseUpdated(b);
  if (!da && !db) {
    return '';
  }
  if (!da) {
    return db.toISOString();
  }
  if (!db) {
    return da.toISOString();
  }
  return (da.getTime() >= db.getTime() ? da : db).toISOString();
};

const normalisePlayerId = (value) => {
  const str = toStringOrEmpty(value);
  if (!str) {
    return '';
  }
  const digits = str.replace(/\D/g, '');
  return digits || str;
};

const buildRecordFromRow = (row, updated) => ({
  id: normalisePlayerId(row?.playerId),
  nrFfe: toStringOrEmpty(row?.nrFfe),
  name: toStringOrEmpty(row?.name),
  club: toStringOrEmpty(row?.club),
  aff: toStringOrEmpty(row?.aff),
  elo: toStringOrEmpty(row?.elo),
  rapid: toStringOrEmpty(row?.rapid),
  blitz: toStringOrEmpty(row?.blitz),
  category: toStringOrEmpty(row?.category),
  gender: toStringOrEmpty(row?.gender),
  updated: toStringOrEmpty(updated),
});

const mergeRecords = (base, incoming) => {
  const out = { ...(base || {}) };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (!value) {
      return;
    }
    if (!out[key]) {
      out[key] = value;
    }
  });
  out.updated = pickLatestUpdated(base?.updated, incoming?.updated);
  out.id = normalisePlayerId(out.id || incoming?.id);
  return out;
};

const getShardPrefix = (playerId) => {
  const str = normalisePlayerId(playerId);
  if (!str) {
    return '';
  }
  const padded = str.padStart(2, '0');
  const prefix = padded.slice(0, 2);
  return /^\d{2}$/.test(prefix) ? prefix : '00';
};

const parseRatingValue = (value) => {
  const str = toStringOrEmpty(value);
  if (!str) {
    return 0;
  }
  const match = str.match(/(\d{1,4})/);
  if (!match) {
    return 0;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const writeJson = (filePath, data, options = {}) => {
  const pretty = options.pretty !== false;
  const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  fs.writeFileSync(filePath, `${json}\n`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const decodeHtmlEntities = (value) => {
  const str = toStringOrEmpty(value);
  if (!str) {
    return '';
  }
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
};

const fetchText = async (url, timeoutMs = 12_000) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,*/*',
        'User-Agent': 'echecs92/1.0 (+https://echecs92.com)',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(t);
  }
};

const extractFideUrlFromFfeHtml = (html) => {
  const body = toStringOrEmpty(html);
  if (!body) {
    return '';
  }
  const match = body.match(
    /id=(?:\"|')ctl00_ContentPlaceHolderMain_LinkFide(?:\"|')[^>]*href=(?:\"|')([^\"']+)(?:\"|')/i
  );
  if (!match) {
    return '';
  }
  return decodeHtmlEntities(match[1]);
};

const extractFederationFromFideHtml = (html) => {
  const body = toStringOrEmpty(html);
  if (!body) {
    return '';
  }
  const match = body.match(/images\/flags\/([a-z]{2})\.svg/i);
  if (!match) {
    return '';
  }
  return match[1].toLowerCase();
};

const mapWithConcurrency = async (items, limit, worker) => {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  const results = new Array(items.length);
  let cursor = 0;
  const runWorker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(safeLimit, items.length) }, () => runWorker()));
  return results;
};

const buildEmptyShards = () => {
  const shards = new Map();
  for (let i = 0; i < 100; i += 1) {
    shards.set(String(i).padStart(2, '0'), new Map());
  }
  return shards;
};

const main = async () => {
  if (!fs.existsSync(FFE_DETAILS_DIR)) {
    throw new Error(`Dossier introuvable: ${FFE_DETAILS_DIR}`);
  }

  const files = fs
    .readdirSync(FFE_DETAILS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));

  const playersById = new Map();

  files.forEach((filename) => {
    const filePath = path.join(FFE_DETAILS_DIR, filename);
    const payload = safeReadJson(filePath);
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const updated = payload.updated || '';
    LIST_KEYS.forEach((key) => {
      const list = payload[key];
      const rows = Array.isArray(list?.rows) ? list.rows : [];
      rows.forEach((row) => {
        const id = normalisePlayerId(row?.playerId);
        if (!id) {
          return;
        }
        const record = buildRecordFromRow(row, updated);
        const existing = playersById.get(id);
        playersById.set(id, existing ? mergeRecords(existing, record) : record);
      });
    });
  });

  ensureDir(OUTPUT_DIR);

  const shards = buildEmptyShards();
  playersById.forEach((record, id) => {
    const prefix = getShardPrefix(id);
    if (!prefix || !shards.has(prefix)) {
      return;
    }
    shards.get(prefix).set(id, record);
  });

  const updated = new Date().toISOString();
  const shardFiles = [];
  shards.forEach((entries, prefix) => {
    const ids = Array.from(entries.keys()).sort((a, b) =>
      a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
    );
    const players = {};
    ids.forEach((id) => {
      players[id] = entries.get(id);
    });
    const payload = {
      version: 1,
      updated,
      players,
    };
    const fileName = `${prefix}.json`;
    shardFiles.push(fileName);
    writeJson(path.join(OUTPUT_DIR, fileName), payload);
  });

  const manifest = {
    version: 1,
    updated,
    basePath: '/wp-content/themes/echecs92-child/assets/data/ffe-players/by-id/',
    shards: shardFiles,
    totalPlayers: playersById.size,
    searchIndex: '/wp-content/themes/echecs92-child/assets/data/ffe-players/search-index.json',
    topElo: '/wp-content/themes/echecs92-child/assets/data/ffe-players/top-elo.json',
  };
  ensureDir(path.dirname(MANIFEST_PATH));
  writeJson(MANIFEST_PATH, manifest);

  const indexColumns = ['id', 'name', 'club', 'elo'];
  const indexRows = Array.from(playersById.values())
    .map((record) => [
      normalisePlayerId(record?.id),
      toStringOrEmpty(record?.name),
      toStringOrEmpty(record?.club),
      toStringOrEmpty(record?.elo),
    ])
    .filter((row) => row[0] && row[1])
    .sort((a, b) => {
      const nameCompare = a[1].localeCompare(b[1], 'fr', { sensitivity: 'base' });
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return a[0].localeCompare(b[0], 'en', { numeric: true, sensitivity: 'base' });
    });

  writeJson(SEARCH_INDEX_PATH, {
    version: 1,
    updated,
    columns: indexColumns,
    rows: indexRows,
  }, { pretty: false });

  const ffePlayerUrl = (playerId) =>
    `https://www.echecs.asso.fr/FicheJoueur.aspx?Id=${encodeURIComponent(normalisePlayerId(playerId))}`;

  const getFideFederationForPlayer = async (playerId) => {
    const id = normalisePlayerId(playerId);
    if (!id) {
      return '';
    }
    const ffeHtml = await fetchText(ffePlayerUrl(id)).catch(() => '');
    const fideUrl = extractFideUrlFromFfeHtml(ffeHtml);
    if (!fideUrl) {
      return '';
    }
    const fideHtml = await fetchText(fideUrl).catch(() => '');
    return extractFederationFromFideHtml(fideHtml);
  };

  const topRows = Array.from(playersById.values())
    .map((record) => ({
      id: normalisePlayerId(record?.id),
      name: toStringOrEmpty(record?.name),
      club: toStringOrEmpty(record?.club),
      elo: toStringOrEmpty(record?.elo),
      aff: toStringOrEmpty(record?.aff).toUpperCase(),
      eloValue: parseRatingValue(record?.elo),
    }))
    .filter((entry) => entry.id && entry.name && entry.eloValue > 0 && entry.aff === 'A')
    .sort((a, b) => {
      if (b.eloValue !== a.eloValue) {
        return b.eloValue - a.eloValue;
      }
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });

  const TOP_CANDIDATE_LIMIT = 220;
  const TOP_OUTPUT_LIMIT = 80;
  const candidates = topRows.slice(0, TOP_CANDIDATE_LIMIT);
  const federations = await mapWithConcurrency(candidates, 4, async (entry) => {
    const fed = await getFideFederationForPlayer(entry.id);
    // Keep a small delay between each worker iteration (FIDE/FFE are public, but let's stay polite).
    await sleep(90);
    return fed;
  });

  const french = candidates.filter((entry, index) => (federations[index] || '') === 'fr');
  const selected = french.length ? french : candidates;

  const topPayloadRows = selected.slice(0, TOP_OUTPUT_LIMIT).map((entry) => [entry.id, entry.name, entry.club, entry.elo]);

  writeJson(TOP_ELO_PATH, {
    version: 1,
    updated,
    kind: 'elo',
    columns: indexColumns,
    rows: topPayloadRows,
  });

  console.log(`→ ${playersById.size} joueurs indexés.`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
