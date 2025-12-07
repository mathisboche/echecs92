#!/usr/bin/env node
/**
 * Fill missing FFE club references by querying the FFE search endpoint directly.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'wp-content/themes/echecs92-child/assets/data/clubs-france-ffe');
const SEARCH_URL = 'https://www.echecs.asso.fr/ListeClubs.aspx?Action=CLUB';
const USER_AGENT = 'Mozilla/5.0 (compatible; echecs92-bot/1.0)';
const PAUSE_MS = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalise = (value) =>
  (value || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const cleanText = (value) =>
  (value || '')
    .toString()
    .replace(/\s+/g, ' ')
    .replace(/,+/g, ',')
    .trim();

const sanitiseRef = (value) => {
  const match = (value || '').toString().match(/(\d{2,})/);
  return match ? match[1] : '';
};

const parseCandidates = (html) => {
  const candidates = [];
  const regex =
    /<td[^>]*align=left[^>]*>([^<]*)<\/td>\s*<td[^>]*align=left[^>]*><a href="FicheClub\.aspx\?Ref=(\d{2,})">([^<]+)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    candidates.push({
      commune: cleanText(match[1]),
      name: cleanText(match[3]),
      ref: sanitiseRef(match[2]),
    });
  }
  return candidates;
};

const scoreCandidate = (entry, candidate) => {
  const nameEntry = normalise(entry.name);
  const nameCand = normalise(candidate.name);
  const cityEntry = normalise(entry.commune);
  const cityCand = normalise(candidate.commune);

  let score = 0;
  if (nameEntry && nameCand) {
    if (nameEntry === nameCand) {
      score += 6;
    } else if (nameEntry.includes(nameCand) || nameCand.includes(nameEntry)) {
      score += 4;
    }
  }
  if (cityEntry && cityCand) {
    if (cityEntry === cityCand) {
      score += 3;
    } else if (cityEntry.includes(cityCand) || cityCand.includes(cityEntry)) {
      score += 1;
    }
  }
  return score;
};

const curlPost = (data) =>
  new Promise((resolve, reject) => {
    execFile(
      'curl',
      ['-sL', '--max-time', '15', '-A', USER_AGENT, '-d', data, SEARCH_URL],
      { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout || '');
      }
    );
  });

const searchClub = async (query) => {
  const body = `ClubNom=${encodeURIComponent(query)}`;
  const html = await curlPost(body);
  return parseCandidates(html);
};

const resolveRef = async (entry) => {
  const attempts = [entry.name, `${entry.name} ${entry.commune}`, entry.commune].filter(Boolean);
  for (let i = 0; i < attempts.length; i += 1) {
    const query = attempts[i];
    if (!query || !query.trim()) {
      continue;
    }
    try {
      const candidates = await searchClub(query);
      if (!candidates.length) {
        await sleep(PAUSE_MS);
        continue;
      }
      if (candidates.length === 1) {
        return candidates[0].ref;
      }
      const scored = candidates
        .map((cand) => ({ ...cand, score: scoreCandidate(entry, cand) }))
        .sort((a, b) => b.score - a.score);
      if (scored[0] && scored[0].score >= 3) {
        return scored[0].ref;
      }
    } catch (error) {
      // ignore and try next attempt
    }
    await sleep(PAUSE_MS);
  }
  return '';
};

const processFile = async (filePath) => {
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let changed = false;
  for (const entry of payload) {
    if (entry.ref) {
      continue;
    }
    process.stdout.write(`→ ${path.basename(filePath)} :: ${entry.name}... `);
    const ref = await resolveRef(entry);
    if (ref) {
      entry.ref = ref;
      changed = true;
      process.stdout.write(`${ref}\n`);
    } else {
      process.stdout.write('not found\n');
    }
    await sleep(PAUSE_MS);
  }
  if (changed) {
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  }
  return changed;
};

const main = async () => {
  const selected = process.argv.slice(2).filter(Boolean);
  const files = (selected.length
    ? selected
    : fs.readdirSync(DATA_DIR).filter((file) => file.endsWith('.json'))
  ).map((file) => (path.isAbsolute(file) ? file : path.join(DATA_DIR, file)));
  let updated = 0;
  for (const file of files) {
    const changed = await processFile(file);
    if (changed) {
      updated += 1;
    }
  }
  console.log(`Done. Updated ${updated} file(s).`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
