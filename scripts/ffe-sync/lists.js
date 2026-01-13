const { BASE_URL } = require('./config');
const { fetchText } = require('./http');
const { sleep } = require('./util');
const { cleanText } = require('./text');
const { extractEmail, extractHiddenFields, extractPagerInfo } = require('./parsers');

const fetchPagedHtml = async (url) => {
  const pages = [];
  let html = await fetchText(url);
  pages.push(html);

  const { eventTarget, maxPage } = extractPagerInfo(html);
  if (!eventTarget || maxPage <= 1) {
    return pages;
  }

  let hiddenFields = extractHiddenFields(html);
  for (let page = 2; page <= maxPage; page += 1) {
    const bodyFields = {
      ...hiddenFields,
      __EVENTTARGET: eventTarget,
      __EVENTARGUMENT: String(page),
    };
    const body = new URLSearchParams(bodyFields);
    html = await fetchText(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    pages.push(html);
    hiddenFields = extractHiddenFields(html);
    await sleep(80);
  }
  return pages;
};

const extractTableRows = (html) => {
  const rows = [];
  const rowRegex = /<tr class=liste_[^>]*>[\s\S]*?<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[0];
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length) {
      rows.push({ cells, rowHtml });
    }
  }
  return rows;
};

const extractPlayerId = (html) => {
  const match = html.match(/FicheJoueur\.aspx\?Id=(\d+)/i);
  return match ? match[1] : '';
};

const parseMemberRows = (html) => {
  const rows = extractTableRows(html);
  const results = [];
  rows.forEach(({ cells, rowHtml }) => {
    if (cells.length < 10) {
      return;
    }
    const values = cells.map(cleanText);
    const nrFfe = values[0] || '';
    const name = values[1] || '';
    if (!nrFfe || !name) {
      return;
    }
    const playerId = extractPlayerId(rowHtml);
    results.push({
      nrFfe,
      name,
      aff: values[2] || '',
      playerId: playerId || '',
      elo: values[4] || '',
      rapid: values[5] || '',
      blitz: values[6] || '',
      category: values[7] || '',
      gender: values[8] || '',
      club: values[9] || '',
    });
  });
  return results;
};

const parseQualificationRows = (html) => {
  const rows = extractTableRows(html);
  const results = [];
  rows.forEach(({ cells, rowHtml }) => {
    if (cells.length < 5) {
      return;
    }
    const values = cells.map(cleanText);
    const nrFfe = values[0] || '';
    const name = values[1] || '';
    if (!nrFfe || !name) {
      return;
    }
    const email = extractEmail(rowHtml);
    results.push({
      nrFfe,
      name,
      email: email || '',
      role: values[2] || '',
      validity: values[3] || '',
      club: values[4] || '',
      playerId: '',
    });
  });
  return results;
};

const dedupeRows = (rows, getKey) => {
  const seen = new Set();
  const output = [];
  rows.forEach((row) => {
    const key = getKey(row);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push(row);
  });
  return output;
};

const buildMemberIdLookup = (rows) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = (row.nrFfe || '').toString().trim();
    const playerId = (row.playerId || '').toString().trim();
    if (!key || !playerId || map.has(key)) {
      return;
    }
    map.set(key, playerId);
  });
  return map;
};

const applyPlayerIds = (rows, lookup) =>
  rows.map((row) => {
    if (row.playerId || !row.nrFfe || !lookup.has(row.nrFfe)) {
      return row;
    }
    return { ...row, playerId: lookup.get(row.nrFfe) };
  });

const fetchListRows = async (url, parser, dedupeKey) => {
  const pages = await fetchPagedHtml(url);
  let rows = [];
  pages.forEach((html) => {
    rows = rows.concat(parser(html));
  });
  if (dedupeKey) {
    rows = dedupeRows(rows, dedupeKey);
  }
  return rows;
};

const buildListPayload = (rows, error = '') => ({
  count: Array.isArray(rows) ? rows.length : 0,
  rows: Array.isArray(rows) ? rows : [],
  error: error || '',
});

const sanitiseClubRef = (value) => {
  const match = (value || '').toString().trim().match(/(\d{2,})$/);
  return match ? match[1] : '';
};

const fetchClubLists = async (ref, name, errors) => {
  const refId = sanitiseClubRef(ref);
  if (!refId) {
    return null;
  }

  const memberUrl = `${BASE_URL}/ListeJoueurs.aspx?Action=JOUEURCLUBREF&ClubRef=${encodeURIComponent(refId)}`;
  const memberEloUrl = `${BASE_URL}/ListeJoueurs.aspx?Action=JOUEURCLUBREF&JrTri=Elo&ClubRef=${encodeURIComponent(refId)}`;
  const arbitrageUrl = `${BASE_URL}/ListeArbitres.aspx?Action=DNACLUB&ClubRef=${encodeURIComponent(refId)}`;
  const animationUrl = `${BASE_URL}/ListeArbitres.aspx?Action=DAFFECLUB&ClubRef=${encodeURIComponent(refId)}`;
  const trainingUrl = `${BASE_URL}/ListeArbitres.aspx?Action=DEFFECLUB&ClubRef=${encodeURIComponent(refId)}`;
  const initiationUrl = `${BASE_URL}/ListeArbitres.aspx?Action=DIFFECLUB&ClubRef=${encodeURIComponent(refId)}`;

  const listErrors = [];

  const safeFetch = async (label, url, parser, dedupeKey) => {
    try {
      const rows = await fetchListRows(url, parser, dedupeKey);
      return { rows, error: '' };
    } catch (error) {
      const message = error && error.message ? error.message : 'Erreur inconnue';
      listErrors.push(`${label}: ${message}`);
      return { rows: [], error: message };
    }
  };

  const memberKey = (row) => `${row.nrFfe || ''}|${row.name || ''}|${row.playerId || ''}`;
  const staffKey = (row) => `${row.nrFfe || ''}|${row.name || ''}|${row.role || ''}`;

  const members = await safeFetch('membres', memberUrl, parseMemberRows, memberKey);
  const memberLookup = buildMemberIdLookup(members.rows);
  members.rows = applyPlayerIds(members.rows, memberLookup);

  const membersByElo = await safeFetch(
    'membres_par_elo',
    memberEloUrl,
    parseMemberRows,
    memberKey
  );
  membersByElo.rows = applyPlayerIds(membersByElo.rows, memberLookup);

  const arbitrage = await safeFetch('arbitrage', arbitrageUrl, parseQualificationRows, staffKey);
  arbitrage.rows = applyPlayerIds(arbitrage.rows, memberLookup);

  const animation = await safeFetch('animation', animationUrl, parseQualificationRows, staffKey);
  animation.rows = applyPlayerIds(animation.rows, memberLookup);

  const entrainement = await safeFetch(
    'entrainement',
    trainingUrl,
    parseQualificationRows,
    staffKey
  );
  entrainement.rows = applyPlayerIds(entrainement.rows, memberLookup);

  const initiation = await safeFetch('initiation', initiationUrl, parseQualificationRows, staffKey);
  initiation.rows = applyPlayerIds(initiation.rows, memberLookup);

  if (listErrors.length && Array.isArray(errors)) {
    errors.push({
      ref: refId,
      name: name || '',
      details: listErrors,
    });
  }

  return {
    ref: refId,
    updated: new Date().toISOString(),
    members: buildListPayload(members.rows, members.error),
    members_by_elo: buildListPayload(membersByElo.rows, membersByElo.error),
    arbitrage: buildListPayload(arbitrage.rows, arbitrage.error),
    animation: buildListPayload(animation.rows, animation.error),
    entrainement: buildListPayload(entrainement.rows, entrainement.error),
    initiation: buildListPayload(initiation.rows, initiation.error),
  };
};

module.exports = {
  fetchClubLists,
};

