#!/usr/bin/env node
/**
 * Synchronise les donnees officielles FIDE depuis les fichiers publies.
 *
 * Sorties:
 * - wp-content/themes/echecs92-child/assets/data/fide-players/by-id/<00-99>.json
 * - wp-content/themes/echecs92-child/assets/data/fide-players/manifest.json
 * - wp-content/themes/echecs92-child/assets/data/fide-players/archives.json
 * - wp-content/themes/echecs92-child/assets/data/fide-players/rank-stats.json
 * - wp-content/themes/echecs92-child/assets/data/fide-players/archives/<period>/*.zip (optionnel)
 *
 * Variables d'environnement:
 * - FIDE_ARCHIVE_PERIODS: nombre de periodes d'archives a telecharger (defaut: 1, 0 pour desactiver, "all" pour toutes)
 * - FIDE_ARCHIVE_INCLUDE_XML: "1" pour telecharger aussi les XML d'archives (defaut: 0)
 * - FIDE_MAX_ROWS: limite de lignes a parser dans players_list.zip (debug local uniquement)
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, spawn } = require('node:child_process');
const readline = require('node:readline');

const ROOT = path.join(__dirname, '..');
const DATA_ROOT = path.join(ROOT, 'wp-content', 'themes', 'echecs92-child', 'assets', 'data');
const OUTPUT_ROOT = path.join(DATA_ROOT, 'fide-players');
const OUTPUT_SHARDS_DIR = path.join(OUTPUT_ROOT, 'by-id');
const OUTPUT_ARCHIVES_DIR = path.join(OUTPUT_ROOT, 'archives');
const MANIFEST_PATH = path.join(OUTPUT_ROOT, 'manifest.json');
const ARCHIVES_INDEX_PATH = path.join(OUTPUT_ROOT, 'archives.json');
const RANK_STATS_PATH = path.join(OUTPUT_ROOT, 'rank-stats.json');
const CONTINENT_MAP_PATH = path.join(ROOT, 'scripts', 'data', 'iso-alpha3-continent.json');

const DOWNLOAD_PAGE_URL = 'https://ratings.fide.com/download_lists.phtml';
const DOWNLOAD_ARCHIVE_ENDPOINT = 'https://ratings.fide.com/a_download.php?period=';
const DEFAULT_PLAYERS_TXT_URL = 'https://ratings.fide.com/download/players_list.zip';
const USER_AGENT = 'Mozilla/5.0 (compatible; echecs92-bot/1.0; +https://echecs92.com)';

const SHARD_COUNT = 100;
const BUFFER_FLUSH_BYTES = 512 * 1024;

const archivePeriodsRaw = (process.env.FIDE_ARCHIVE_PERIODS || '1').trim().toLowerCase();
const includeArchiveXml = (process.env.FIDE_ARCHIVE_INCLUDE_XML || '0').trim() === '1';
const maxRows = Number.isFinite(Number(process.env.FIDE_MAX_ROWS))
  ? Math.max(0, Number.parseInt(process.env.FIDE_MAX_ROWS, 10))
  : 0;

const FIDE_FEDERATION_CONTINENT_OVERRIDES = {
  AHO: 'Americas',
  ALG: 'Africa',
  ANG: 'Africa',
  ANT: 'Americas',
  ARU: 'Americas',
  BAH: 'Americas',
  BAN: 'Asia',
  BAR: 'Americas',
  BER: 'Americas',
  BHU: 'Asia',
  BIZ: 'Americas',
  BOT: 'Africa',
  BRU: 'Asia',
  BUL: 'Europe',
  BUR: 'Africa',
  CAM: 'Asia',
  CAY: 'Americas',
  CGO: 'Africa',
  CHA: 'Africa',
  CHI: 'Americas',
  CRC: 'Americas',
  CRO: 'Europe',
  DEN: 'Europe',
  ENG: 'Europe',
  ESA: 'Americas',
  FAI: 'Europe',
  FIJ: 'Oceania',
  FID: 'Europe',
  GAM: 'Africa',
  GCI: 'Europe',
  GEQ: 'Africa',
  GER: 'Europe',
  GRE: 'Europe',
  GRN: 'Americas',
  GUA: 'Americas',
  GUI: 'Africa',
  HAI: 'Americas',
  HON: 'Americas',
  INA: 'Asia',
  IOM: 'Europe',
  IRI: 'Asia',
  ISV: 'Americas',
  IVB: 'Americas',
  JCI: 'Europe',
  KOS: 'Europe',
  KSA: 'Asia',
  KUW: 'Asia',
  LAT: 'Europe',
  LBA: 'Africa',
  LES: 'Africa',
  MAD: 'Africa',
  MAS: 'Asia',
  MAW: 'Africa',
  MGL: 'Asia',
  MNC: 'Europe',
  MRI: 'Africa',
  MTN: 'Africa',
  MYA: 'Asia',
  NCA: 'Americas',
  NED: 'Europe',
  NEP: 'Asia',
  NIG: 'Africa',
  NIR: 'Europe',
  NON: 'Unknown',
  OMA: 'Asia',
  PAR: 'Americas',
  PHI: 'Asia',
  PLE: 'Asia',
  POR: 'Europe',
  PUR: 'Americas',
  RSA: 'Africa',
  SCO: 'Europe',
  SEY: 'Africa',
  SKN: 'Americas',
  SLO: 'Europe',
  SOL: 'Oceania',
  SRI: 'Asia',
  SUD: 'Africa',
  SUI: 'Europe',
  TAN: 'Africa',
  TGA: 'Oceania',
  TOG: 'Africa',
  TPE: 'Asia',
  UAE: 'Asia',
  UNK: 'Unknown',
  URU: 'Americas',
  VAN: 'Oceania',
  VIE: 'Asia',
  VIN: 'Americas',
  WLS: 'Europe',
  ZAM: 'Africa',
  ZIM: 'Africa',
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const loadContinentMap = () => {
  try {
    const raw = fs.readFileSync(CONTINENT_MAP_PATH, 'utf8');
    const decoded = JSON.parse(raw);
    const byAlpha3 = decoded && typeof decoded === 'object' && decoded.byAlpha3 && typeof decoded.byAlpha3 === 'object' ? decoded.byAlpha3 : {};
    const out = {};
    Object.keys(byAlpha3).forEach((key) => {
      const code = (key || '').toString().trim().toUpperCase();
      const continent = (byAlpha3[key] || '').toString().trim();
      if (code && continent) {
        out[code] = continent;
      }
    });
    Object.entries(FIDE_FEDERATION_CONTINENT_OVERRIDES).forEach(([code, continent]) => {
      out[code] = continent;
    });
    return out;
  } catch (error) {
    console.warn(`Continent map unavailable at ${CONTINENT_MAP_PATH}: ${error.message}`);
    return { ...FIDE_FEDERATION_CONTINENT_OVERRIDES };
  }
};

const decodeHtmlEntities = (value) => {
  const str = (value || '').toString();
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
};

const normalizeUrl = (value) => {
  const raw = decodeHtmlEntities((value || '').toString().trim());
  if (!raw) {
    return '';
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (raw.startsWith('//')) {
    return `https:${raw}`;
  }
  if (raw.startsWith('/')) {
    return `https://ratings.fide.com${raw}`;
  }
  return raw;
};

const fetchText = async (url, timeoutMs = 20_000) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*',
        'User-Agent': USER_AGENT,
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

const parseCurrentDownloadLinks = (html) => {
  const body = (html || '').toString();
  const links = Array.from(
    body.matchAll(/href=([^\s>]+?\/download\/[^"' >]+\.zip)/gi),
    (match) => normalizeUrl(match[1])
  ).filter(Boolean);

  const findByFile = (needle) => links.find((url) => url.toLowerCase().includes(needle.toLowerCase())) || '';

  return {
    playersTxt: findByFile('/download/players_list.zip'),
    playersXml: findByFile('/download/players_list_xml.zip'),
    playersLegacyTxt: findByFile('/download/players_list_legacy.zip'),
    playersLegacyXml: findByFile('/download/players_list_xml_legacy.zip'),
    standardTxt: findByFile('/download/standard_rating_list.zip'),
    standardXml: findByFile('/download/standard_rating_list_xml.zip'),
    rapidTxt: findByFile('/download/rapid_rating_list.zip'),
    rapidXml: findByFile('/download/rapid_rating_list_xml.zip'),
    blitzTxt: findByFile('/download/blitz_rating_list.zip'),
    blitzXml: findByFile('/download/blitz_rating_list_xml.zip'),
  };
};

const parseArchivePeriods = (html) => {
  const body = (html || '').toString();
  const out = [];
  const matches = body.matchAll(/<option\s+value="(\d{4}-\d{2}-\d{2})">([^<]+)<\/option>/gi);
  for (const match of matches) {
    const value = (match[1] || '').trim();
    const label = decodeHtmlEntities((match[2] || '').trim());
    if (!value || !label) {
      continue;
    }
    out.push({ value, label });
  }
  return out;
};

const parseArchiveLinksForPeriod = (html) => {
  const body = (html || '').toString();
  const links = Array.from(
    body.matchAll(/href=([^\s>]+?\/download\/[^"' >]+\.zip)/gi),
    (match) => normalizeUrl(match[1])
  ).filter(Boolean);

  const result = {
    standard: {},
    rapid: {},
    blitz: {},
  };

  links.forEach((url) => {
    const lower = url.toLowerCase();
    const format = lower.endsWith('_xml.zip') ? 'xml' : 'txt';
    if (lower.includes('/download/standard_')) {
      result.standard[format] = url;
    } else if (lower.includes('/download/rapid_')) {
      result.rapid[format] = url;
    } else if (lower.includes('/download/blitz_')) {
      result.blitz[format] = url;
    }
  });

  return result;
};

const fetchArchiveLinksForPeriod = async (period) => {
  const html = await fetchText(`${DOWNLOAD_ARCHIVE_ENDPOINT}${encodeURIComponent(period)}`, 15_000).catch(() => '');
  if (!html) {
    return null;
  }
  return parseArchiveLinksForPeriod(html);
};

const shell = (command, args, options = {}) => {
  const run = spawnSync(command, args, {
    stdio: options.stdio || 'pipe',
    encoding: options.encoding || 'utf8',
  });
  if (run.status !== 0) {
    const stdout = run.stdout ? run.stdout.toString() : '';
    const stderr = run.stderr ? run.stderr.toString() : '';
    throw new Error(`${command} ${args.join(' ')} failed: ${stderr || stdout}`.trim());
  }
  return run;
};

const downloadFile = (url, targetPath) => {
  ensureDir(path.dirname(targetPath));
  shell('curl', ['-sSL', '-A', USER_AGENT, '-o', targetPath, url], { stdio: 'inherit' });
};

const parseHeaderPositions = (headerLine) => {
  const header = (headerLine || '').toString();
  const tokenMatches = Array.from(header.matchAll(/\S+/g), (m) => ({ token: m[0], index: m.index || 0 }));

  const findIndex = (token) => {
    const entry = tokenMatches.find((m) => m.token === token);
    return entry ? entry.index : -1;
  };

  const nameStart = findIndex('Name');
  const fedStart = findIndex('Fed');
  const sexStart = findIndex('Sex');
  const titStart = findIndex('Tit');
  const wTitStart = findIndex('WTit');
  const oTitStart = findIndex('OTit');
  const foaStart = findIndex('FOA');
  const sgmStart = findIndex('SGm');
  const skStart = findIndex('SK');
  const rrtngStart = findIndex('RRtng');
  const rgmStart = findIndex('RGm');
  const rkStart = findIndex('Rk');
  const brtngStart = findIndex('BRtng');
  const bgmStart = findIndex('BGm');
  const bkStart = findIndex('BK');
  const bdayStart = findIndex('B-day');
  const flagStart = findIndex('Flag');
  const srtngStart = findIndex('SRtng');

  if (
    [nameStart, fedStart, sexStart, titStart, wTitStart, oTitStart, foaStart, srtngStart, sgmStart, skStart, rrtngStart, rgmStart, rkStart, brtngStart, bgmStart, bkStart, bdayStart, flagStart].some(
      (value) => value < 0
    )
  ) {
    throw new Error(`Format d'entete FIDE inattendu: ${header}`);
  }

  return {
    nameStart,
    fedStart,
    sexStart,
    titStart,
    wTitStart,
    oTitStart,
    foaStart,
    srtngStart,
    sgmStart,
    skStart,
    rrtngStart,
    rgmStart,
    rkStart,
    brtngStart,
    bgmStart,
    bkStart,
    bdayStart,
    flagStart,
    minLength: flagStart + 6,
  };
};

const toInt = (value) => {
  const str = (value || '').toString().trim();
  if (!str) {
    return 0;
  }
  const n = Number.parseInt(str, 10);
  return Number.isFinite(n) ? n : 0;
};

const normalizeFederationCode = (value) => (value || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

const normalizeSex = (value) => (value || '').toString().trim().toUpperCase().replace(/[^A-Z]/g, '');

const normalizeFlag = (value) => (value || '').toString().trim().toLowerCase().replace(/[^a-z]/g, '');

const isInactiveFlag = (flag) => normalizeFlag(flag).includes('i');

const isWomanFlag = (flag) => normalizeFlag(flag).includes('w');

const continentForFederation = (fedCode, continentMap) => {
  const code = normalizeFederationCode(fedCode);
  if (!code) {
    return 'Unknown';
  }
  return continentMap[code] || 'Unknown';
};

const createAggregateCounter = (meta = {}) => ({
  ...meta,
  allPlayers: 0,
  activePlayers: 0,
  inactivePlayers: 0,
  womenPlayers: 0,
  womenInactivePlayers: 0,
  standardRatedPlayers: 0,
  rapidRatedPlayers: 0,
  blitzRatedPlayers: 0,
});

const accumulateCounter = (target, record, context = {}) => {
  if (!target || !record) {
    return;
  }
  const inactive = isInactiveFlag(record.fl);
  const womanByFlag = isWomanFlag(record.fl);
  const womanBySex = normalizeSex(record.sx) === 'F';
  const woman = womanByFlag || womanBySex;

  target.allPlayers += 1;
  if (inactive) {
    target.inactivePlayers += 1;
  } else {
    target.activePlayers += 1;
  }
  if (woman) {
    target.womenPlayers += 1;
    if (inactive) {
      target.womenInactivePlayers += 1;
    }
  }
  if (toInt(record.sr) > 0) {
    target.standardRatedPlayers += 1;
  }
  if (toInt(record.rr) > 0) {
    target.rapidRatedPlayers += 1;
  }
  if (toInt(record.br) > 0) {
    target.blitzRatedPlayers += 1;
  }
  if (context.recordIdsSet && context.fedCode) {
    context.recordIdsSet.add(context.fedCode);
  }
};

const createRankStatsAccumulator = () => ({
  world: createAggregateCounter(),
  federations: new Map(),
  continents: new Map(),
  knownFederations: new Set(),
  unknownFederations: new Set(),
});

const accumulateRankStats = (acc, record, continentMap) => {
  if (!acc || !record || typeof record !== 'object') {
    return;
  }

  const fedCode = normalizeFederationCode(record.f);
  const continent = continentForFederation(fedCode, continentMap);
  record.f = fedCode;
  record.ct = continent;

  accumulateCounter(acc.world, record);

  const federationKey = fedCode || 'UNK';
  if (!acc.federations.has(federationKey)) {
    acc.federations.set(
      federationKey,
      createAggregateCounter({
        federation: federationKey,
        continent,
      })
    );
  }
  const federationStats = acc.federations.get(federationKey);
  if (federationStats && continent && federationStats.continent === 'Unknown' && continent !== 'Unknown') {
    federationStats.continent = continent;
  }
  accumulateCounter(federationStats, record);

  if (!acc.continents.has(continent)) {
    acc.continents.set(
      continent,
      createAggregateCounter({
        continent,
      })
    );
  }
  accumulateCounter(acc.continents.get(continent), record);

  if (fedCode) {
    if (continent === 'Unknown') {
      acc.unknownFederations.add(fedCode);
    } else {
      acc.knownFederations.add(fedCode);
    }
  }
};

const mapToSortedObject = (map, sortNumericField = 'allPlayers') => {
  const entries = Array.from(map.entries());
  entries.sort((a, b) => {
    const av = Number(a[1]?.[sortNumericField] || 0);
    const bv = Number(b[1]?.[sortNumericField] || 0);
    if (bv !== av) {
      return bv - av;
    }
    return a[0].localeCompare(b[0], 'en', { numeric: true, sensitivity: 'base' });
  });
  const out = {};
  entries.forEach(([key, value]) => {
    out[key] = value;
  });
  return out;
};

const buildRankStatsPayload = (acc, updatedIso, playersTxtUrl) => ({
  version: 1,
  updated: updatedIso,
  provider: 'FIDE',
  mode: 'official-files',
  source: {
    playersListTxt: playersTxtUrl,
    continentMap: 'CLDR codeMappings + territoryContainment (+ FIDE federation overrides)',
  },
  world: acc.world,
  continents: mapToSortedObject(acc.continents, 'allPlayers'),
  federations: mapToSortedObject(acc.federations, 'allPlayers'),
  coverage: {
    knownFederations: acc.knownFederations.size,
    unknownFederations: acc.unknownFederations.size,
    unknownFederationList: Array.from(acc.unknownFederations).sort(),
  },
});

const sliceField = (line, start, end) => {
  const from = Math.max(0, start || 0);
  const to = Number.isFinite(end) ? Math.max(from, end) : line.length;
  return line.slice(from, to).trim();
};

const parsePlayersListRow = (line, schema) => {
  const safeLine = line.length >= schema.minLength ? line : line.padEnd(schema.minLength, ' ');
  const id = sliceField(safeLine, 0, schema.nameStart).replace(/[^\d]/g, '');
  if (!id) {
    return null;
  }

  return {
    id,
    n: sliceField(safeLine, schema.nameStart, schema.fedStart),
    f: sliceField(safeLine, schema.fedStart, schema.sexStart),
    sx: sliceField(safeLine, schema.sexStart, schema.titStart),
    t: sliceField(safeLine, schema.titStart, schema.wTitStart),
    wt: sliceField(safeLine, schema.wTitStart, schema.oTitStart),
    ot: sliceField(safeLine, schema.oTitStart, schema.foaStart),
    ft: sliceField(safeLine, schema.foaStart, schema.srtngStart),
    sr: toInt(sliceField(safeLine, schema.srtngStart, schema.sgmStart)),
    sg: toInt(sliceField(safeLine, schema.sgmStart, schema.skStart)),
    sk: toInt(sliceField(safeLine, schema.skStart, schema.rrtngStart)),
    rr: toInt(sliceField(safeLine, schema.rrtngStart, schema.rgmStart)),
    rg: toInt(sliceField(safeLine, schema.rgmStart, schema.rkStart)),
    rk: toInt(sliceField(safeLine, schema.rkStart, schema.brtngStart)),
    br: toInt(sliceField(safeLine, schema.brtngStart, schema.bgmStart)),
    bg: toInt(sliceField(safeLine, schema.bgmStart, schema.bkStart)),
    bk: toInt(sliceField(safeLine, schema.bkStart, schema.bdayStart)),
    by: toInt(sliceField(safeLine, schema.bdayStart, schema.flagStart)),
    fl: sliceField(safeLine, schema.flagStart),
  };
};

const shardPrefix = (id) => {
  const digits = (id || '').toString().replace(/[^\d]/g, '');
  if (!digits) {
    return '00';
  }
  return digits.padStart(2, '0').slice(0, 2);
};

const createShardWriters = (updatedIso) => {
  ensureDir(OUTPUT_SHARDS_DIR);
  const writers = new Map();
  for (let i = 0; i < SHARD_COUNT; i += 1) {
    const prefix = String(i).padStart(2, '0');
    const filePath = path.join(OUTPUT_SHARDS_DIR, `${prefix}.json`);
    fs.writeFileSync(filePath, `{"version":1,"updated":"${updatedIso}","players":{`);
    writers.set(prefix, {
      filePath,
      first: true,
      count: 0,
      buffer: '',
    });
  }
  return writers;
};

const flushWriterBuffer = (state) => {
  if (!state || !state.buffer) {
    return;
  }
  fs.appendFileSync(state.filePath, state.buffer);
  state.buffer = '';
};

const appendShardRecord = (writers, record) => {
  const prefix = shardPrefix(record.id);
  const state = writers.get(prefix) || writers.get('00');
  if (!state) {
    return;
  }
  const chunk = `${state.first ? '' : ','}\n${JSON.stringify(record.id)}:${JSON.stringify(record)}`;
  state.first = false;
  state.count += 1;
  state.buffer += chunk;
  if (state.buffer.length >= BUFFER_FLUSH_BYTES) {
    flushWriterBuffer(state);
  }
};

const finalizeShardWriters = (writers) => {
  const shardFiles = [];
  let totalPlayers = 0;
  writers.forEach((state, prefix) => {
    flushWriterBuffer(state);
    fs.appendFileSync(state.filePath, '\n}}\n');
    shardFiles.push(`${prefix}.json`);
    totalPlayers += state.count || 0;
  });
  shardFiles.sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
  return { shardFiles, totalPlayers };
};

const parsePlayersZipToShards = (zipPath, updatedIso, continentMap) =>
  new Promise((resolve, reject) => {
    const unzip = spawnSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
    if (unzip.status !== 0) {
      reject(new Error(`Impossible de lire ${zipPath}`));
      return;
    }

    const writers = createShardWriters(updatedIso);
    const rankStatsAcc = createRankStatsAccumulator();
    const child = spawn('unzip', ['-p', zipPath], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const rl = readline.createInterface({ input: child.stdout });

    let headerParsed = false;
    let schema = null;
    let lineCount = 0;
    let parsedRows = 0;
    let skippedRows = 0;
    let childClosed = false;
    let childCode = 0;
    let readerClosed = false;
    let settled = false;
    let terminatedEarly = false;

    const settle = (error = null) => {
      if (settled) {
        return;
      }
      if (!readerClosed || !childClosed) {
        return;
      }
      settled = true;

      if (error) {
        reject(error);
        return;
      }
      if (childCode !== 0 && !terminatedEarly) {
        reject(new Error(`unzip -p ${zipPath} a echoue avec le code ${childCode}`));
        return;
      }

      const { shardFiles, totalPlayers } = finalizeShardWriters(writers);
      resolve({
        shardFiles,
        totalPlayers,
        lineCount,
        parsedRows,
        skippedRows,
        rankStats: buildRankStatsPayload(rankStatsAcc, updatedIso, ''),
      });
    };

    rl.on('line', (line) => {
      if (!headerParsed) {
        schema = parseHeaderPositions(line);
        headerParsed = true;
        return;
      }

      if (maxRows > 0 && parsedRows >= maxRows) {
        terminatedEarly = true;
        rl.close();
        try {
          child.kill('SIGTERM');
        } catch (error) {
          // ignore kill errors in debug mode
        }
        return;
      }

      lineCount += 1;
      const record = parsePlayersListRow(line, schema);
      if (!record) {
        skippedRows += 1;
        return;
      }
      accumulateRankStats(rankStatsAcc, record, continentMap);
      parsedRows += 1;
      appendShardRecord(writers, record);
    });

    child.on('close', (code) => {
      childClosed = true;
      childCode = Number.isFinite(code) ? code : 1;
      settle();
    });
    child.on('error', (error) => settle(error));
    rl.on('error', (error) => settle(error));
    rl.on('close', () => {
      readerClosed = true;
      settle();
    });
  });

const periodToFolder = (period) => (period || '').toString().replace(/[^0-9-]/g, '');

const selectArchivePeriodsToDownload = (periods) => {
  if (!Array.isArray(periods) || periods.length === 0) {
    return [];
  }
  if (archivePeriodsRaw === 'all') {
    return periods.slice();
  }
  const n = Number.parseInt(archivePeriodsRaw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return [];
  }
  return periods.slice(0, n);
};

const writeJson = (targetPath, payload, pretty = true) => {
  ensureDir(path.dirname(targetPath));
  const body = pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
  fs.writeFileSync(targetPath, `${body}\n`);
};

const main = async () => {
  ensureDir(OUTPUT_ROOT);
  const continentMap = loadContinentMap();

  const updatedIso = new Date().toISOString();
  console.log('Fetching FIDE download page...');
  const downloadPageHtml = await fetchText(DOWNLOAD_PAGE_URL, 20_000);
  const currentLinks = parseCurrentDownloadLinks(downloadPageHtml);
  const archivePeriods = parseArchivePeriods(downloadPageHtml);

  const playersTxtUrl = currentLinks.playersTxt || DEFAULT_PLAYERS_TXT_URL;
  if (!playersTxtUrl) {
    throw new Error('Lien players_list.zip introuvable sur la page FIDE.');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echecs92-fide-'));
  const playersZipPath = path.join(tmpDir, 'players_list.zip');
  console.log(`Downloading players list: ${playersTxtUrl}`);
  downloadFile(playersTxtUrl, playersZipPath);

  console.log('Parsing official players list...');
  const parsedPlayers = await parsePlayersZipToShards(playersZipPath, updatedIso, continentMap);
  if (maxRows === 0 && parsedPlayers.totalPlayers < 100000) {
    throw new Error(
      `Le volume de joueurs parses semble anormal (${parsedPlayers.totalPlayers}). Synchronisation interrompue.`
    );
  }

  console.log(`Collecting archive links for ${archivePeriods.length} periods...`);
  const archiveItems = [];
  for (const period of archivePeriods) {
    const links = await fetchArchiveLinksForPeriod(period.value);
    archiveItems.push({
      period: period.value,
      label: period.label,
      links: links || { standard: {}, rapid: {}, blitz: {} },
    });
  }

  const toDownload = selectArchivePeriodsToDownload(archiveItems);
  console.log(`Downloading archive files for ${toDownload.length} period(s)...`);
  const downloadedArchives = [];
  for (const item of toDownload) {
    const periodFolder = path.join(OUTPUT_ARCHIVES_DIR, periodToFolder(item.period));
    ensureDir(periodFolder);
    const formats = includeArchiveXml ? ['txt', 'xml'] : ['txt'];
    const kinds = ['standard', 'rapid', 'blitz'];
    for (const kind of kinds) {
      for (const format of formats) {
        const url = item?.links?.[kind]?.[format] || '';
        if (!url) {
          continue;
        }
        const fileName = `${kind}-${format}.zip`;
        const targetPath = path.join(periodFolder, fileName);
        try {
          downloadFile(url, targetPath);
          downloadedArchives.push({
            period: item.period,
            kind,
            format,
            url,
            path: path.relative(ROOT, targetPath),
          });
        } catch (error) {
          console.warn(`Archive download failed for ${item.period} ${kind}/${format}: ${error.message}`);
        }
      }
    }
  }

  const rankStatsPayload = {
    ...(parsedPlayers.rankStats || {}),
    source: {
      playersListTxt: playersTxtUrl,
      continentMap: 'CLDR codeMappings + territoryContainment (+ FIDE federation overrides)',
    },
  };

  const manifest = {
    version: 1,
    updated: updatedIso,
    provider: 'FIDE',
    mode: 'official-files',
    totalPlayers: parsedPlayers.totalPlayers,
    basePath: '/wp-content/themes/echecs92-child/assets/data/fide-players/by-id/',
    shards: parsedPlayers.shardFiles,
    sources: {
      downloadPage: DOWNLOAD_PAGE_URL,
      archiveEndpoint: DOWNLOAD_ARCHIVE_ENDPOINT,
      playersListTxt: playersTxtUrl,
      playersListXml: currentLinks.playersXml || '',
      standardCurrentTxt: currentLinks.standardTxt || '',
      rapidCurrentTxt: currentLinks.rapidTxt || '',
      blitzCurrentTxt: currentLinks.blitzTxt || '',
      fetchedAt: updatedIso,
    },
    schema: {
      id: 'FIDE ID',
      n: 'name',
      f: 'federation',
      sx: 'sex',
      t: 'title',
      wt: 'women_title',
      ot: 'other_title',
      ft: 'foa_title',
      sr: 'standard_rating',
      sg: 'standard_games',
      sk: 'standard_k',
      rr: 'rapid_rating',
      rg: 'rapid_games',
      rk: 'rapid_k',
      br: 'blitz_rating',
      bg: 'blitz_games',
      bk: 'blitz_k',
      by: 'birth_year',
      fl: 'flag',
    },
    stats: {
      parsedRows: parsedPlayers.parsedRows,
      skippedRows: parsedPlayers.skippedRows,
      rawLines: parsedPlayers.lineCount,
      maxRowsApplied: maxRows > 0 ? maxRows : null,
    },
    archives: {
      index: '/wp-content/themes/echecs92-child/assets/data/fide-players/archives.json',
      downloadedPeriods: downloadedArchives,
    },
    rankings: {
      statsIndex: '/wp-content/themes/echecs92-child/assets/data/fide-players/rank-stats.json',
    },
  };

  const archivesIndex = {
    version: 1,
    updated: updatedIso,
    provider: 'FIDE',
    source: DOWNLOAD_PAGE_URL,
    periods: archiveItems,
  };

  writeJson(MANIFEST_PATH, manifest);
  writeJson(ARCHIVES_INDEX_PATH, archivesIndex);
  writeJson(RANK_STATS_PATH, rankStatsPayload);

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(
    `FIDE official sync completed: ${parsedPlayers.totalPlayers} players, ${archiveItems.length} archive periods indexed, ${downloadedArchives.length} archive files downloaded.`
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
