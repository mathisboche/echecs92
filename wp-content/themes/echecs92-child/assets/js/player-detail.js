/**
 * Player detail view renderer.
 * Displays a local player profile based on /joueur/<id>/.
 */
(function () {
  const PLAYER_SHARDS_BASE_PATH = '/wp-content/themes/echecs92-child/assets/data/ffe-players/by-id/';
  const FFE_PLAYER_URL_BASE = 'https://www.echecs.asso.fr/FicheJoueur.aspx?Id=';
  const FFE_EXTRAS_ENDPOINT = '/wp-json/cdje92/v1/ffe-player';
  const DASH_RX = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE63\uFF0D]/g;
  const normaliseDashes = (value) => (value == null ? '' : value.toString()).replace(DASH_RX, '-');
  const htmlEntityDecoder = typeof document !== 'undefined' ? document.createElement('textarea') : null;
  const decodeHtmlEntities = (value) => {
    const raw = (value || '').toString();
    if (!raw || raw.indexOf('&') === -1) {
      return raw;
    }
    if (htmlEntityDecoder) {
      htmlEntityDecoder.innerHTML = raw;
      return htmlEntityDecoder.value || raw;
    }
    return raw
      .replace(/&hellip;|&#8230;|&#x2026;/gi, '…')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;|&#39;/gi, "'");
  };
  const normaliseClubName = (value) =>
    normaliseDashes(decodeHtmlEntities(value || ''))
      .replace(/\s+/g, ' ')
      .trim();
  const buildClubNameVariants = (clubName) => {
    const base = normaliseClubName(clubName);
    if (!base) {
      return [];
    }
    const variants = [];
    const seen = new Set();
    const push = (value) => {
      const item = (value || '').toString().replace(/\s+/g, ' ').trim();
      if (!item || seen.has(item)) {
        return;
      }
      seen.add(item);
      variants.push(item);
    };
    push(base);
    const withoutEllipsis = base.replace(/\s*(?:\.{3}|…)\s*$/u, '').trim();
    push(withoutEllipsis);
    if (withoutEllipsis && withoutEllipsis !== base) {
      push(withoutEllipsis.replace(/\s+[^\s]+$/u, '').trim());
    }
    return variants;
  };
  const NAME_LETTER_RX = /[A-Za-zÀ-ÖØ-öø-ÿ]/;
  const formatNameGivenFirst = (value) => {
    const raw = normaliseDashes(value || '').toString().trim();
    if (!raw) {
      return '';
    }
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      return raw;
    }
    const isAllCapsToken = (token) => {
      if (!token || !NAME_LETTER_RX.test(token)) {
        return false;
      }
      return token === token.toUpperCase() && token !== token.toLowerCase();
    };
    let idx = 0;
    while (idx < parts.length && isAllCapsToken(parts[idx])) {
      idx += 1;
    }
    if (idx <= 0 || idx >= parts.length) {
      return raw;
    }
    const surname = parts.slice(0, idx).join(' ');
    const given = parts.slice(idx).join(' ');
    return `${given} ${surname}`.trim();
  };

  const detailContainer = document.getElementById('player-detail');
  if (!detailContainer) {
    return;
  }

  const backLink = document.querySelector('.player-detail__back, [data-player-back]');
  const actionsContainer = document.querySelector('.player-detail__actions');
  detailContainer.classList.add('is-loading');

  const getBackKindForPath = (value) => {
    const path = (value || '').toString().trim();
    if (!path) {
      return 'search';
    }
    const cleaned = path.split('?')[0].split('#')[0];
    if (/^\/joueurs\b/i.test(cleaned)) {
      return 'players';
    }
    if (
      /^\/club-92\/[^/]+\/ffe(?:\/|$)/i.test(cleaned) ||
      /^\/club\/[^/]+\/ffe(?:\/|$)/i.test(cleaned) ||
      /^\/club-france\/[^/]+\/ffe(?:\/|$)/i.test(cleaned)
    ) {
      return 'club_players';
    }
    if (/^\/club-92\/[^/]+/i.test(cleaned) || /^\/club\/[^/]+/i.test(cleaned) || /^\/club-france\/[^/]+/i.test(cleaned)) {
      return 'club';
    }
    if (
      /^\/clubs-92\b/i.test(cleaned) ||
      /^\/clubs\b/i.test(cleaned) ||
      /^\/clubs-france\b/i.test(cleaned) ||
      /^\/carte-des-clubs-92\b/i.test(cleaned) ||
      /^\/carte-des-clubs\b/i.test(cleaned) ||
      /^\/carte-des-clubs-france\b/i.test(cleaned)
    ) {
      return 'clubs';
    }
    return 'search';
  };

  const getBackLabel = (kind) => {
    if (kind === 'club_players') {
      return '← Retour à la liste des joueurs du club';
    }
    if (kind === 'club') {
      return '← Retour à la fiche du club';
    }
    if (kind === 'players') {
      return '← Retour à la recherche des joueurs';
    }
    if (kind === 'clubs') {
      return '← Retour à la recherche des clubs';
    }
    return '← Retour à la recherche';
  };

  const deriveBackHrefFromParam = () => {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const from = (params.get('from') || '').trim();
      if (!from || !from.startsWith('/')) {
        return '';
      }
      return from;
    } catch (error) {
      return '';
    }
  };

  const updateBackLink = () => {
    if (!backLink) {
      return;
    }
    const fallback = backLink.getAttribute('href') || '/clubs-92';
    const fallbackKind = getBackKindForPath(fallback);
    const referrer = document.referrer;

    const fromParam = deriveBackHrefFromParam();
    if (fromParam) {
      backLink.href = fromParam;
      backLink.textContent = getBackLabel(getBackKindForPath(fromParam));
      return;
    }

    if (!referrer) {
      backLink.href = fallback;
      backLink.textContent = getBackLabel(fallbackKind);
      return;
    }
    try {
      const refUrl = new URL(referrer, window.location.origin);
      if (refUrl.origin !== window.location.origin) {
        backLink.href = fallback;
        backLink.textContent = getBackLabel(fallbackKind);
        return;
      }
      const href = refUrl.pathname + refUrl.search + refUrl.hash;
      const current = window.location.pathname + window.location.search + window.location.hash;
      const resolved = href && href !== current ? href : fallback;
      backLink.href = resolved;
      backLink.textContent = getBackLabel(getBackKindForPath(resolved));
    } catch (error) {
      backLink.href = fallback;
      backLink.textContent = getBackLabel(fallbackKind);
    }
  };

  updateBackLink();

  const toInternalPath = (value) => {
    const raw = (value || '').toString().trim();
    if (!raw) {
      return '';
    }
    try {
      const url = new URL(raw, window.location.origin);
      if (url.origin !== window.location.origin) {
        return '';
      }
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (error) {
      return raw.startsWith('/') ? raw : '';
    }
  };

  const getClubSearchHrefFromPath = (value) => {
    const path = toInternalPath(value || '');
    if (!path) {
      return '/clubs';
    }
    const cleaned = path.split('?')[0].split('#')[0];
    if (/^\/club-92\//i.test(cleaned)) {
      return '/clubs-92';
    }
    return '/clubs';
  };

  const getClubBaseHrefFromPath = (value) => {
    const path = toInternalPath(value || '');
    if (!path) {
      return '';
    }
    try {
      const url = new URL(path, window.location.origin);
      const normalizedPath = (url.pathname || '').replace(/\/+$/u, '');
      if (!normalizedPath) {
        return '';
      }
      const basePath = normalizedPath.replace(/\/ffe$/iu, '') || normalizedPath;
      if (!/^\/club(?:-92|-france)?\/[^/]+/i.test(basePath)) {
        return '';
      }
      return `${basePath}/`;
    } catch (error) {
      return '';
    }
  };

  const getClubHrefFromBackLink = () => {
    if (!backLink) {
      return '';
    }
    const raw = backLink.getAttribute('href') || backLink.href || '';
    const path = toInternalPath(raw);
    const kind = getBackKindForPath(path);
    if (kind !== 'club' && kind !== 'club_players') {
      return '';
    }
    return getClubBaseHrefFromPath(path);
  };

  const appendFromToInternalHref = (value) => {
    const path = toInternalPath(value || '');
    if (!path) {
      return '';
    }
    try {
      const url = new URL(path, window.location.origin);
      const from = `${window.location.pathname || ''}${window.location.search || ''}${window.location.hash || ''}`;
      if (from && !url.searchParams.get('from')) {
        url.searchParams.set('from', from);
      }
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (error) {
      return path;
    }
  };

  const renderPlayerBreadcrumb = () => {
    if (!backLink) {
      return;
    }
    document.querySelectorAll('.club-breadcrumb--player').forEach((node) => node.remove());

    const backRaw = backLink.getAttribute('href') || backLink.href || '';
    const backPath = toInternalPath(backRaw);
    const backKind = getBackKindForPath(backPath);
    if (backKind !== 'club' && backKind !== 'club_players') {
      return;
    }

    const clubHref = getClubBaseHrefFromPath(backPath);
    if (!clubHref) {
      return;
    }

    const clubsSearchHref = getClubSearchHrefFromPath(clubHref);

    const nav = document.createElement('nav');
    nav.className = 'club-breadcrumb club-breadcrumb--player player-detail__breadcrumb';
    nav.setAttribute('aria-label', "Fil d'Ariane");

    const list = document.createElement('ol');
    list.className = 'club-breadcrumb__list';
    nav.appendChild(list);

    const appendItem = (label, href, isCurrent = false) => {
      const item = document.createElement('li');
      item.className = 'club-breadcrumb__item';
      if (isCurrent) {
        item.classList.add('is-current');
        item.setAttribute('aria-current', 'page');
      }
      if (href && !isCurrent) {
        const link = document.createElement('a');
        link.className = 'club-breadcrumb__link';
        link.href = href;
        link.textContent = label;
        item.appendChild(link);
      } else {
        const text = document.createElement('span');
        text.className = 'club-breadcrumb__label';
        text.textContent = label;
        item.appendChild(text);
      }
      list.appendChild(item);
    };

    appendItem('Recherche clubs', clubsSearchHref);
    appendItem('Fiche du club', appendFromToInternalHref(clubHref));
    if (backKind === 'club_players') {
      appendItem('Liste des joueurs du club', appendFromToInternalHref(backPath));
    }
    appendItem('Fiche joueur', '', true);

    const host = actionsContainer?.parentElement || detailContainer?.parentElement || null;
    if (host && detailContainer && detailContainer.parentElement === host) {
      host.insertBefore(nav, detailContainer);
      return;
    }
    if (host && actionsContainer && actionsContainer.parentElement === host) {
      host.insertBefore(nav, actionsContainer.nextSibling);
      return;
    }
    if (actionsContainer) {
      actionsContainer.appendChild(nav);
    }
  };

  renderPlayerBreadcrumb();

  const fetchJson = (url, options = {}) =>
    fetch(url, { headers: { Accept: 'application/json' }, ...options }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    });

  const wait = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, ms || 0));
    });

  const fetchJsonWithRetry = async (url, options = {}) => {
    const attempts = Number.isFinite(options.attempts) ? Math.max(1, Math.floor(options.attempts)) : 1;
    const baseDelayMs = Number.isFinite(options.baseDelayMs)
      ? Math.max(0, Math.floor(options.baseDelayMs))
      : 0;
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fetchJson(url);
      } catch (error) {
        lastError = error;
        if (attempt >= attempts) {
          break;
        }
        if (baseDelayMs > 0) {
          await wait(baseDelayMs * attempt);
        }
      }
    }

    throw lastError || new Error('Unable to fetch JSON');
  };

  const buildStagingDataUrl = (url) => {
    const raw = (url || '').toString().trim();
    if (!raw) {
      return '';
    }
    const stagingUrl = raw.replace('/assets/data/', '/assets/data.__staging/');
    return stagingUrl !== raw ? stagingUrl : '';
  };

  const fetchJsonWithStagingFallback = async (url, options = {}) => {
    try {
      return await fetchJsonWithRetry(url, options);
    } catch (liveError) {
      const stagingUrl = buildStagingDataUrl(url);
      if (!stagingUrl) {
        throw liveError;
      }
      try {
        return await fetchJsonWithRetry(stagingUrl, options);
      } catch (_stagingError) {
        throw liveError;
      }
    }
  };

  const renderMessage = (message, tone = 'error') => {
    detailContainer.classList.remove('is-loading');
    detailContainer.innerHTML = `<p class="clubs-empty" data-tone="${tone}">${message}</p>`;
  };

  const CATEGORY_MAP = {
    Ppo: { label: 'Petit poussin', hint: '6-7 ans (U8)' },
    Pou: { label: 'Poussin', hint: '8-9 ans (U10)' },
    Pup: { label: 'Pupille', hint: '10-11 ans (U12)' },
    Ben: { label: 'Benjamin', hint: '12-13 ans (U14)' },
    Min: { label: 'Minime', hint: '14-15 ans (U16)' },
    Cad: { label: 'Cadet', hint: '16-17 ans (U18)' },
    Jun: { label: 'Junior', hint: '18-19 ans (U20)' },
    Sen: { label: 'Senior', hint: '20 ans et +' },
    Vet: { label: 'Vétéran', hint: '50-64 ans' },
    Sep: { label: 'Super-vétéran', hint: '65 ans et +' },
  };

  const formatCategory = (value) => {
    const raw = (value || '').toString().trim();
    if (!raw) {
      return { label: '', hint: '' };
    }
    const prefixMatch = raw.match(/^([A-Za-z]{3})/);
    const prefix = prefixMatch ? prefixMatch[1] : raw;
    const entry = CATEGORY_MAP[prefix] || null;
    if (entry) {
      return { label: entry.label, hint: entry.hint };
    }
    return { label: raw, hint: '' };
  };

  const formatLicence = (value) => {
    const raw = (value || '').toString().trim();
    if (!raw) {
      return '';
    }
    return raw.toUpperCase();
  };

  const slugify = (value) => {
    const raw = normaliseDashes(value || '').toString().trim();
    if (!raw) {
      return '';
    }
    return raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const buildClubDetailHrefFromName = (clubName) => {
    const variants = buildClubNameVariants(clubName);
    for (let i = 0; i < variants.length; i += 1) {
      const slug = slugify(variants[i]);
      if (slug) {
        return `/club/${encodeURIComponent(slug)}/`;
      }
    }
    return '';
  };

  const derivePlayerIdFromPath = () => {
    const match = window.location.pathname.match(/\/joueur\/([^\/?#]+)/i);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch (err) {
        return match[1];
      }
    }
    const params = new URLSearchParams(window.location.search || '');
    return params.get('id') || params.get('player') || params.get('ffe_player') || '';
  };

  const playerId = derivePlayerIdFromPath();

  const buildShardPrefix = (id) => {
    const str = (id || '').toString().trim();
    if (!str) {
      return '';
    }
    const padded = str.padStart(2, '0');
    return padded.slice(0, 2);
  };

  const buildOfficialPlayerUrl = (id) => {
    if (!id) {
      return '';
    }
    return `${FFE_PLAYER_URL_BASE}${encodeURIComponent(id)}`;
  };

  const fetchFfeExtras = (id) => {
    const raw = (id || '').toString().trim();
    if (!raw) {
      return Promise.resolve(null);
    }
    const url = `${FFE_EXTRAS_ENDPOINT}?id=${encodeURIComponent(raw)}&full=1&include_opponents=1`;
    return fetchJsonWithRetry(url, { attempts: 3, baseDelayMs: 280 }).catch(() => null);
  };

  const formatTitlePrefix = (value) => {
    const raw = (value || '').toString().replace(/\s+/g, ' ').trim();
    if (!raw) {
      return { short: '', long: '' };
    }

    const key = raw.toLowerCase();
    const map = [
      { rx: /grand\s+ma[îi]tre\s+f[ée]minin/i, short: 'WGM', long: 'Grand Maître Féminin' },
      { rx: /grand\s+ma[îi]tre/i, short: 'GM', long: 'Grand Maître' },
      { rx: /ma[îi]tre\s+international\s+f[ée]minin/i, short: 'WIM', long: 'Maître International Féminin' },
      { rx: /ma[îi]tre\s+international/i, short: 'IM', long: 'Maître International' },
      { rx: /ma[îi]tre\s+fide\s+f[ée]minin/i, short: 'WFM', long: 'Maître FIDE Féminin' },
      { rx: /ma[îi]tre\s+fide/i, short: 'FM', long: 'Maître FIDE' },
      { rx: /candidat\s+ma[îi]tre\s+f[ée]minin/i, short: 'WCM', long: 'Candidat Maître Féminin' },
      { rx: /candidat\s+ma[îi]tre/i, short: 'CM', long: 'Candidat Maître' },
    ];
    const entry = map.find((item) => item.rx.test(key)) || null;
    if (entry) {
      return { short: entry.short, long: entry.long };
    }
    return { short: raw, long: raw };
  };

  const getRatingTagHint = (value) => {
    const tag = (value || '').toString().trim().toUpperCase();
    if (!tag) {
      return '';
    }
    const mapping = {
      F: 'Classement FIDE (international)',
      N: 'Classement national (FFE)',
      E: 'Classement estimé',
      R: 'Classement rapide (FFE)',
      S: 'Sans classement',
    };
    return mapping[tag] || '';
  };

  const appendMetaChip = (host, label, value, options = {}) => {
    if (!host || !label || value == null || value === '') {
      return false;
    }

    const href = (options.href || '').toString().trim();
    const chip = document.createElement(href ? 'a' : 'span');
    chip.className = href ? 'player-chip player-chip--link' : 'player-chip';
    if (href) {
      chip.href = href;
    }

    const labelNode = document.createElement('span');
    labelNode.className = 'player-chip__label';
    labelNode.textContent = label;
    chip.appendChild(labelNode);

    const valueNode = document.createElement('span');
    valueNode.className = 'player-chip__value';
    valueNode.textContent = value;
    chip.appendChild(valueNode);

    if (options.hint) {
      const hint = document.createElement('span');
      hint.className = 'player-chip__hint';
      hint.setAttribute('tabindex', '0');
      hint.setAttribute('role', 'note');
      hint.setAttribute('aria-label', `Tranche d'âge: ${options.hint}`);
      hint.dataset.tooltip = options.hint;
      chip.appendChild(hint);
    }

    host.appendChild(chip);
    return true;
  };

  const splitRating = (value) => {
    const str = (value || '').toString().trim();
    if (!str) {
      return { main: '-', tag: '' };
    }
    const match = str.match(/^(\d{1,4})(?:\s*([a-z]+))?$/i);
    if (match) {
      return { main: match[1], tag: (match[2] || '').trim() };
    }
    const digitMatch = str.match(/(\d{1,4})/);
    if (digitMatch) {
      const main = digitMatch[1];
      const tag = str.replace(main, '').trim();
      return { main, tag };
    }
    return { main: str, tag: '' };
  };

  const parsePositiveInt = (value) => {
    if (Number.isInteger(value)) {
      return value > 0 ? value : 0;
    }
    const raw = (value || '').toString().trim();
    if (!raw) {
      return 0;
    }
    const digits = raw.replace(/[^\d]+/g, '');
    if (!digits) {
      return 0;
    }
    const parsed = Number.parseInt(digits, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  const formatIntFr = (value) => {
    const n = parsePositiveInt(value);
    if (n <= 0) {
      return '';
    }
    return new Intl.NumberFormat('fr-FR').format(n);
  };

  const rankScopeMeta = (title) => {
    const clean = (title || '').toString().trim();
    if (!clean) {
      return { scope: 'other', region: '' };
    }
    if (/^World Rank\b/i.test(clean)) {
      return { scope: 'world', region: '' };
    }
    const national = clean.match(/^National Rank(?:\s+(.+))?$/i);
    if (national) {
      return { scope: 'national', region: (national[1] || '').trim() };
    }
    const continent = clean.match(/^Continent Rank(?:\s+(.+))?$/i);
    if (continent) {
      return { scope: 'continent', region: (continent[1] || '').trim() };
    }
    return { scope: 'other', region: '' };
  };

  const rankEntryKey = (label) => {
    const clean = (label || '').toString().trim().toLowerCase();
    if (clean === 'active players') {
      return 'activePlayers';
    }
    if (clean === 'all players') {
      return 'allPlayers';
    }
    return '';
  };

  const buildRankStatsFromLegacy = (ranks) => {
    if (!Array.isArray(ranks) || !ranks.length) {
      return null;
    }
    const items = [];
    for (const block of ranks) {
      if (!block || typeof block !== 'object') {
        continue;
      }
      const title = (block.title || '').toString().trim();
      const scopeMeta = rankScopeMeta(title);
      const item = {
        title,
        scope: scopeMeta.scope,
        region: scopeMeta.region,
        activePlayers: 0,
        allPlayers: 0,
      };
      const entries = Array.isArray(block.entries) ? block.entries : [];
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const key = rankEntryKey(entry.label || '');
        if (!key) {
          continue;
        }
        item[key] = parsePositiveInt(entry.value || '');
      }
      if (item.title || item.activePlayers > 0 || item.allPlayers > 0) {
        items.push(item);
      }
    }
    if (!items.length) {
      return null;
    }
    return {
      items,
      world: items.find((item) => item.scope === 'world') || null,
      national: items.find((item) => item.scope === 'national') || null,
      continent: items.find((item) => item.scope === 'continent') || null,
    };
  };

  const rankStatLabel = (item) => {
    if (!item || typeof item !== 'object') {
      return '';
    }
    const scope = (item.scope || '').toString().trim().toLowerCase();
    const region = (item.region || '').toString().trim();
    if (scope === 'world') {
      return 'Rang mondial FIDE';
    }
    if (scope === 'national') {
      return region ? `Rang national FIDE (${region})` : 'Rang national FIDE';
    }
    if (scope === 'continent') {
      return region ? `Rang continent FIDE (${region})` : 'Rang continent FIDE';
    }
    return (item.title || 'Rang FIDE').toString().trim();
  };

  const rankStatValue = (item) => {
    if (!item || typeof item !== 'object') {
      return '';
    }
    const active = formatIntFr(item.activePlayers);
    const all = formatIntFr(item.allPlayers);
    const parts = [];
    if (active) {
      parts.push(`Active players: ${active}`);
    }
    if (all) {
      parts.push(`All players: ${all}`);
    }
    return parts.join(' | ');
  };

  const collectRankItems = (rankStats) => {
    if (!rankStats || typeof rankStats !== 'object') {
      return [];
    }
    const itemKey = (item) => {
      const scope = (item?.scope || '').toString().trim().toLowerCase();
      const region = (item?.region || '').toString().trim().toLowerCase();
      const title = (item?.title || '').toString().trim().toLowerCase();
      return `${scope}|${region}|${title}`;
    };
    const preferred = ['world', 'national', 'continent']
      .map((key) => rankStats[key])
      .filter((item) => item && typeof item === 'object');
    const items = Array.isArray(rankStats.items) ? rankStats.items : [];
    const filteredItems = items.filter((item) => item && typeof item === 'object');
    if (!preferred.length) {
      return filteredItems;
    }
    const seen = new Set();
    const merged = [];
    for (const item of preferred) {
      const key = itemKey(item);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(item);
    }
    for (const item of filteredItems) {
      const key = itemKey(item);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(item);
    }
    return merged;
  };

  const shouldShowRatingTagTooltip = (tag, options = {}) => {
    const normalizedTag = (tag || '').toString().trim().toUpperCase();
    if (!normalizedTag) {
      return false;
    }
    const hint = getRatingTagHint(normalizedTag);
    if (!hint) {
      return false;
    }

    const policy = options.tagTooltip || 'differs';
    if (policy === 'always') {
      return true;
    }
    if (policy === 'never') {
      return false;
    }
    const ref = (options.tagTooltipRef || '').toString().trim().toUpperCase();
    if (!ref) {
      return true;
    }
    return normalizedTag !== ref;
  };

  const createRatingCard = (label, value, options = {}) => {
    const { main, tag } = splitRating(value);
    const normalizedTag = (tag || '').toString().trim().toUpperCase();
    const card = document.createElement('div');
    card.className = options.primary ? 'player-stat player-stat--primary' : 'player-stat';

    const head = document.createElement('div');
    head.className = 'player-stat__head';

    if (options.icon) {
      const icon = document.createElement('span');
      icon.className = 'player-stat__icon';
      icon.dataset.icon = options.icon;
      icon.setAttribute('aria-hidden', 'true');
      head.appendChild(icon);
    }

    const labelNode = document.createElement('div');
    labelNode.className = 'player-stat__label';
    labelNode.textContent = label;
    head.appendChild(labelNode);

    card.appendChild(head);

    const valueRow = document.createElement('div');
    valueRow.className = 'player-stat__value-row';

    const valueNode = document.createElement('div');
    valueNode.className = 'player-stat__value';
    valueNode.textContent = main || '-';
    valueRow.appendChild(valueNode);

    if (normalizedTag) {
      const tagNode = document.createElement('span');
      tagNode.className = 'player-rating-tag';
      tagNode.textContent = normalizedTag;
      if (shouldShowRatingTagTooltip(normalizedTag, options)) {
        const hint = getRatingTagHint(normalizedTag);
        tagNode.dataset.tooltip = hint;
        tagNode.setAttribute('tabindex', '0');
        tagNode.setAttribute('role', 'note');
        tagNode.setAttribute('aria-label', `${normalizedTag}: ${hint}`);
      }
      valueRow.appendChild(tagNode);
    }

    card.appendChild(valueRow);
    return card;
  };

  const renderPlayer = (player, extras = null) => {
    detailContainer.classList.remove('is-loading');
    detailContainer.innerHTML = '';

    const sheet = document.createElement('div');
    sheet.className = 'club-sheet player-sheet';

    const hero = document.createElement('header');
    hero.className = 'player-hero';

    const fideProfile =
      extras && extras.fide && typeof extras.fide === 'object' && extras.fide.profile && typeof extras.fide.profile === 'object'
        ? extras.fide.profile
        : null;
    const fideOfficial =
      extras &&
      extras.fide_official &&
      typeof extras.fide_official === 'object' &&
      extras.fide_official.player &&
      typeof extras.fide_official.player === 'object'
        ? extras.fide_official.player
        : null;
    const fideComparison =
      extras &&
      extras.fide_official &&
      typeof extras.fide_official === 'object' &&
      extras.fide_official.comparison &&
      typeof extras.fide_official.comparison === 'object'
        ? extras.fide_official.comparison
        : null;
    const fideSources =
      extras &&
      extras.fide_official &&
      typeof extras.fide_official === 'object' &&
      extras.fide_official.sources &&
      typeof extras.fide_official.sources === 'object'
        ? extras.fide_official.sources
        : null;
    const fidePhoto = (fideProfile?.photo || '').toString().trim();
    const fideUrl = (fideProfile?.url || extras?.fide_url || '').toString().trim();
    const fideRankStats =
      fideProfile && fideProfile.rankStats && typeof fideProfile.rankStats === 'object'
        ? fideProfile.rankStats
        : buildRankStatsFromLegacy(Array.isArray(fideProfile?.ranks) ? fideProfile.ranks : []);

    const title = document.createElement('h1');
    title.className = 'player-hero__name';

    const titlePrefix = document.createElement('span');
    titlePrefix.className = 'player-hero__title-prefix';
    titlePrefix.hidden = true;
    const titlePrefixText = document.createElement('span');
    titlePrefixText.className = 'player-hero__title-prefix-text';
    titlePrefix.appendChild(titlePrefixText);
    title.appendChild(titlePrefix);

    const nameNode = document.createElement('span');
    nameNode.className = 'player-hero__name-text';
    const playerName = normaliseDashes(player.name || '');
    nameNode.textContent = playerName || 'Fiche joueur';
    title.appendChild(nameNode);

    const identity = document.createElement('div');
    identity.className = 'player-hero__identity';
    const identityRow = document.createElement('div');
    identityRow.className = 'player-hero__identity-row';

    if (fidePhoto) {
      const avatar = document.createElement('img');
      avatar.className = 'player-hero__avatar';
      avatar.src = fidePhoto;
      avatar.alt = playerName ? `Photo de ${playerName}` : 'Photo joueur';
      avatar.loading = 'lazy';
      avatar.decoding = 'async';
      identityRow.appendChild(avatar);
    }

    identityRow.appendChild(title);
    identity.appendChild(identityRow);
    hero.appendChild(identity);

    const standardTag = (splitRating(player.elo || '').tag || '').toString().trim().toUpperCase();

    const ratingsGrid = document.createElement('div');
    ratingsGrid.className = 'player-hero__ratings';
    ratingsGrid.appendChild(createRatingCard('Elo standard', player.elo || '', { primary: true, icon: 'classic', tagTooltip: 'always' }));
    ratingsGrid.appendChild(createRatingCard('Rapide', player.rapid || '', { icon: 'rapid', tagTooltip: 'differs', tagTooltipRef: standardTag }));
    ratingsGrid.appendChild(createRatingCard('Blitz', player.blitz || '', { icon: 'blitz', tagTooltip: 'differs', tagTooltipRef: standardTag }));
    hero.appendChild(ratingsGrid);

    const meta = document.createElement('div');
    meta.className = 'player-hero__meta';

    const formattedCategory = formatCategory(player.category || '');
    if (formattedCategory.label) {
      appendMetaChip(meta, 'Catégorie', formattedCategory.label, { hint: formattedCategory.hint });
    }

    if (fideProfile?.federation || fideOfficial?.federation) {
      appendMetaChip(meta, 'Fédération', fideProfile?.federation || fideOfficial?.federation || '');
    }

    const clubName = normaliseClubName(player.club || '');
    appendMetaChip(meta, 'Club', clubName, {
      href: appendFromToInternalHref(getClubHrefFromBackLink() || buildClubDetailHrefFromName(clubName)),
    });

    if (meta.childElementCount) {
      hero.appendChild(meta);
    }

    sheet.appendChild(hero);

    const officialUrl = buildOfficialPlayerUrl(player.id || '');
    const extra = document.createElement('div');
    extra.className = 'player-extra';

    const extraList = document.createElement('ul');
    extraList.className = 'player-extra__list';
    extra.appendChild(extraList);

    const appendExtraItem = (label, value, options = {}) => {
      if (value == null || value === '') {
        return null;
      }

      const item = document.createElement('li');
      item.className = 'player-extra__item';

      const labelNode = document.createElement('span');
      labelNode.className = 'player-extra__label';
      labelNode.textContent = label;
      item.appendChild(labelNode);

      const valueNode = document.createElement('span');
      valueNode.className = 'player-extra__value';

      if (options.type === 'link') {
        const link = document.createElement('a');
        link.href = value;
        link.rel = 'noopener';
        link.target = '_blank';
        link.textContent = options.label || value;
        valueNode.appendChild(link);
      } else {
        valueNode.textContent = value;
      }

      item.appendChild(valueNode);
      extraList.appendChild(item);
      return item;
    };

    const licenceItem = appendExtraItem('Licence', formatLicence(player.aff || ''));
    const nrFfeItem = appendExtraItem('N° FFE', player.nrFfe || '');
    appendExtraItem('Fiche FFE', officialUrl, { type: 'link', label: 'Ouvrir sur echecs.asso.fr' });
    appendExtraItem('Fiche FIDE', fideUrl, { type: 'link', label: 'Ouvrir sur ratings.fide.com' });
    appendExtraItem('FIDE ID', fideProfile?.id || fideOfficial?.id || extras?.fide_official?.id || '');
    appendExtraItem('Naissance', fideOfficial?.birthYear || fideProfile?.birthYear || '');
    appendExtraItem('Genre', fideOfficial?.sex || fideProfile?.gender || '');

    const officialRatings = fideOfficial?.ratings || null;
    if (officialRatings) {
      const officialStd = Number(officialRatings?.standard?.value || 0);
      const officialRapid = Number(officialRatings?.rapid?.value || 0);
      const officialBlitz = Number(officialRatings?.blitz?.value || 0);
      const officialLabel = [officialStd > 0 ? officialStd : '-', officialRapid > 0 ? officialRapid : '-', officialBlitz > 0 ? officialBlitz : '-'].join(' / ');
      appendExtraItem('Classements officiels', officialLabel);
    }

    const rankItems = collectRankItems(fideRankStats);
    for (const rankItem of rankItems) {
      const label = rankStatLabel(rankItem);
      const value = rankStatValue(rankItem);
      if (!label || !value) {
        continue;
      }
      appendExtraItem(label, value);
    }

    const chartPoints = Number(extras?.fide?.chart?.pointCount || fideProfile?.historyTable?.rowCount || 0);
    const calcRows = Number(extras?.fide?.calculations?.rowCount || 0);
    const topRows = Number(extras?.fide?.topRecords?.rowCount || 0);
    const opponentsTotal = Number(extras?.fide?.opponents?.total || 0);

    if (chartPoints > 0) {
      appendExtraItem('Historique FIDE', `${chartPoints} périodes`);
    }
    if (calcRows > 0) {
      appendExtraItem('Calculs mensuels', `${calcRows} périodes`);
    }
    if (topRows > 0) {
      appendExtraItem('Top records', `${topRows} entrées`);
    }
    if (opponentsTotal > 0) {
      appendExtraItem('Opposants connus', `${opponentsTotal}`);
    }

    const comparisonChecks = fideComparison?.checks || null;
    if (comparisonChecks && typeof comparisonChecks === 'object') {
      const keys = ['name', 'federation', 'standardRating', 'rapidRating', 'blitzRating'];
      const checked = keys.filter((key) => comparisonChecks[key] !== null && comparisonChecks[key] !== undefined);
      const mismatches = checked.filter((key) => comparisonChecks[key] === false);
      if (checked.length) {
        appendExtraItem(
          'Contrôle officiel',
          mismatches.length ? `Écarts détectés (${mismatches.length})` : 'OK (sources concordantes)'
        );
      }
    }

    appendExtraItem('Source officielle FIDE', fideSources?.playersListTxt || '', {
      type: 'link',
      label: 'Liste mensuelle FIDE',
    });
    appendExtraItem('Archives FIDE', fideSources?.downloadPage || '', {
      type: 'link',
      label: 'Page de téléchargement',
    });

    const preferredTitle = (fideProfile?.title || fideOfficial?.title || extras?.title || '').toString().trim();
    const formattedTitle = formatTitlePrefix(preferredTitle);
    if (formattedTitle.short) {
      titlePrefix.hidden = false;
      titlePrefixText.textContent = formattedTitle.short;
      titlePrefix.dataset.tooltip = formattedTitle.long || formattedTitle.short;
      titlePrefix.setAttribute('tabindex', '0');
      titlePrefix.setAttribute('role', 'note');
      titlePrefix.setAttribute('aria-label', formattedTitle.long || formattedTitle.short);

      const formatted = formatNameGivenFirst(playerName);
      if (formatted) {
        nameNode.textContent = formatted;
      }
    }

    const roles = Array.isArray(extras?.roles) ? extras.roles.filter(Boolean) : [];
    if (roles.length) {
      const item = document.createElement('li');
      item.className = 'player-extra__item';

      const labelNode = document.createElement('span');
      labelNode.className = 'player-extra__label';
      labelNode.textContent = 'Fonctions';
      item.appendChild(labelNode);

      const valueNode = document.createElement('span');
      valueNode.className = 'player-extra__value';
      valueNode.textContent = roles.join(', ');
      item.appendChild(valueNode);

      if (nrFfeItem && nrFfeItem.parentNode === extraList) {
        extraList.insertBefore(item, nrFfeItem);
      } else if (licenceItem && licenceItem.parentNode === extraList) {
        if (licenceItem.nextSibling) {
          extraList.insertBefore(item, licenceItem.nextSibling);
        } else {
          extraList.appendChild(item);
        }
      } else {
        extraList.insertBefore(item, extraList.firstChild);
      }
    }

    if (extraList.childElementCount) {
      sheet.appendChild(extra);
    }

    detailContainer.appendChild(sheet);

    if (playerName) {
      const docPrefix = formattedTitle.short ? `${formattedTitle.short} ` : '';
      const visibleName = formattedTitle.short ? formatNameGivenFirst(playerName) || playerName : playerName;
      document.title = `${docPrefix}${visibleName} - Joueur`;
    }
  };

  const init = () => {
    if (!playerId) {
      renderMessage(detailContainer.dataset.emptyMessage || 'Joueur introuvable.');
      return;
    }
    const extrasPromise = fetchFfeExtras(playerId);
    const prefix = buildShardPrefix(playerId);
    if (!prefix) {
      renderMessage(detailContainer.dataset.emptyMessage || 'Joueur introuvable.');
      return;
    }
    const url = `${PLAYER_SHARDS_BASE_PATH}${encodeURIComponent(prefix)}.json`;

    let resolvedPlayer = null;
    fetchJsonWithStagingFallback(url, { attempts: 4, baseDelayMs: 350 })
      .then((payload) => {
        const players = payload && typeof payload === 'object' ? payload.players || null : null;
        const player = players && typeof players === 'object' ? players[playerId] : null;
        if (!player) {
          renderMessage(detailContainer.dataset.emptyMessage || 'Joueur introuvable.');
          return null;
        }

        resolvedPlayer = player;
        renderPlayer(player, null);
        return extrasPromise;
      })
      .then((extras) => {
        if (!resolvedPlayer || !extras) {
          return;
        }
        renderPlayer(resolvedPlayer, extras);
      })
      .catch(() => {
        renderMessage('Impossible de charger la fiche du joueur pour le moment.');
      });
  };

  init();
})();
