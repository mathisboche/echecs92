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

  const fetchJson = (url) =>
    fetch(url, { headers: { Accept: 'application/json' } }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    });

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
    const url = `${FFE_EXTRAS_ENDPOINT}?id=${encodeURIComponent(raw)}`;
    return fetchJson(url).catch(() => null);
  };

  const formatTitleLabel = (value) => {
    const raw = (value || '').toString().replace(/\s+/g, ' ').trim();
    if (!raw) {
      return '';
    }
    return raw;
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

    const chip = document.createElement('span');
    chip.className = 'player-chip';

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

    if (tag) {
      const tagNode = document.createElement('span');
      tagNode.className = 'player-rating-tag';
      tagNode.textContent = tag;
      if (shouldShowRatingTagTooltip(tag, options)) {
        const hint = getRatingTagHint(tag);
        tagNode.dataset.tooltip = hint;
        tagNode.setAttribute('tabindex', '0');
        tagNode.setAttribute('role', 'note');
        tagNode.setAttribute('aria-label', `${tag}: ${hint}`);
      }
      valueRow.appendChild(tagNode);
    }

    card.appendChild(valueRow);
    return card;
  };

  const renderPlayer = (player) => {
    detailContainer.classList.remove('is-loading');
    detailContainer.innerHTML = '';

    const sheet = document.createElement('div');
    sheet.className = 'club-sheet player-sheet';

    const hero = document.createElement('header');
    hero.className = 'player-hero';

    const title = document.createElement('h1');
    title.className = 'player-hero__name';

    const titlePrefix = document.createElement('span');
    titlePrefix.className = 'player-hero__title-prefix';
    titlePrefix.hidden = true;
    title.appendChild(titlePrefix);

    const nameNode = document.createElement('span');
    nameNode.className = 'player-hero__name-text';
    const playerName = normaliseDashes(player.name || '');
    nameNode.textContent = playerName || 'Fiche joueur';
    title.appendChild(nameNode);

    hero.appendChild(title);

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
    appendMetaChip(meta, 'Club', player.club || '');

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

    if (extraList.childElementCount) {
      sheet.appendChild(extra);
    }

    detailContainer.appendChild(sheet);

    if (playerName) {
      document.title = `${playerName} - Joueur`;
    }

    fetchFfeExtras(player.id || '').then((extras) => {
      if (!extras || typeof extras !== 'object') {
        return;
      }

      const titleLabel = formatTitleLabel(extras.title || '');
      if (titleLabel) {
        titlePrefix.hidden = false;
        titlePrefix.textContent = titleLabel;
        titlePrefix.setAttribute('aria-label', titleLabel);

        const formatted = formatNameGivenFirst(playerName);
        if (formatted) {
          nameNode.textContent = formatted;
        }
      }

      const roles = Array.isArray(extras.roles) ? extras.roles.filter(Boolean) : [];
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

      if (playerName) {
        const docPrefix = titleLabel ? `${titleLabel} ` : '';
        const visibleName = titleLabel ? formatNameGivenFirst(playerName) || playerName : playerName;
        document.title = `${docPrefix}${visibleName} - Joueur`;
      }
    });
  };

  const init = () => {
    if (!playerId) {
      renderMessage(detailContainer.dataset.emptyMessage || 'Joueur introuvable.');
      return;
    }
    const prefix = buildShardPrefix(playerId);
    if (!prefix) {
      renderMessage(detailContainer.dataset.emptyMessage || 'Joueur introuvable.');
      return;
    }
    const url = `${PLAYER_SHARDS_BASE_PATH}${encodeURIComponent(prefix)}.json`;
    fetchJson(url)
      .then((payload) => {
        const players = payload && typeof payload === 'object' ? payload.players || null : null;
        const player = players && typeof players === 'object' ? players[playerId] : null;
        if (!player) {
          renderMessage(detailContainer.dataset.emptyMessage || 'Joueur introuvable.');
          return;
        }
        renderPlayer(player);
      })
      .catch(() => {
        renderMessage('Impossible de charger la fiche du joueur pour le moment.');
      });
  };

  init();
})();
