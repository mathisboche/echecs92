#!/usr/bin/env node
/**
 * Builds a local player index from the downloaded FFE club member lists.
 * Output: wp-content/themes/echecs92-child/assets/data/ffe-players/by-id/<00-99>.json
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_ROOT = path.join(ROOT, 'wp-content', 'themes', 'echecs92-child', 'assets', 'data');
const FFE_DETAILS_DIR = path.join(DATA_ROOT, 'clubs-france-ffe-details');
const OUTPUT_DIR = path.join(DATA_ROOT, 'ffe-players', 'by-id');
const MANIFEST_PATH = path.join(DATA_ROOT, 'ffe-players', 'manifest.json');

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

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const writeJson = (filePath, data) => {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
};

const buildEmptyShards = () => {
  const shards = new Map();
  for (let i = 0; i < 100; i += 1) {
    shards.set(String(i).padStart(2, '0'), new Map());
  }
  return shards;
};

const main = () => {
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
  };
  ensureDir(path.dirname(MANIFEST_PATH));
  writeJson(MANIFEST_PATH, manifest);

  console.log(`→ ${playersById.size} joueurs indexés.`);
};

main();

