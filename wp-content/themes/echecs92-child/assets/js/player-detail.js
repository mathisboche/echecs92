/**
 * Player detail view renderer.
 * Displays a local player profile based on /joueur/<id>/.
 */
(function () {
  const PLAYER_SHARDS_BASE_PATH = '/wp-content/themes/echecs92-child/assets/data/ffe-players/by-id/';
  const FFE_PLAYER_URL_BASE = 'https://www.echecs.asso.fr/FicheJoueur.aspx?Id=';

  const detailContainer = document.getElementById('player-detail');
  if (!detailContainer) {
    return;
  }

  const fetchJson = (url) =>
    fetch(url, { headers: { Accept: 'application/json' } }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    });

  const renderMessage = (message, tone = 'error') => {
    detailContainer.innerHTML = `<p class="clubs-empty" data-tone="${tone}">${message}</p>`;
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

  const createSection = (title) => {
    const section = document.createElement('section');
    section.className = 'club-section';

    const heading = document.createElement('h2');
    heading.textContent = title;
    section.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'club-section__list';
    section.appendChild(list);

    return { section, list };
  };

  const appendDetail = (list, label, value, options = {}) => {
    if (value == null || value === '') {
      return false;
    }
    const item = document.createElement('li');
    item.className = 'club-section__item';

    const labelNode = document.createElement('span');
    labelNode.className = 'club-section__label';
    labelNode.textContent = label;
    item.appendChild(labelNode);

    const valueContainer = document.createElement('div');
    valueContainer.className = 'club-section__value';

    if (options.type === 'link') {
      const link = document.createElement('a');
      link.href = value;
      link.rel = 'noopener';
      link.target = '_blank';
      link.textContent = options.label || value;
      valueContainer.appendChild(link);
    } else {
      valueContainer.textContent = value;
    }

    item.appendChild(valueContainer);
    list.appendChild(item);
    return true;
  };

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

  const formatUpdatedDate = (value) => {
    if (!value) {
      return '';
    }
    try {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) {
        return '';
      }
      return new Intl.DateTimeFormat('fr-FR', { year: 'numeric', month: 'short', day: '2-digit' }).format(date);
    } catch (error) {
      return '';
    }
  };

  const appendMetaChip = (host, label, value) => {
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

    host.appendChild(chip);
    return true;
  };

  const splitRating = (value) => {
    const str = (value || '').toString().trim();
    if (!str) {
      return { main: '—', tag: '' };
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

  const createRatingCard = (label, value, options = {}) => {
    const { main, tag } = splitRating(value);
    const card = document.createElement('div');
    card.className = options.primary ? 'player-stat player-stat--primary' : 'player-stat';

    const labelNode = document.createElement('div');
    labelNode.className = 'player-stat__label';
    labelNode.textContent = label;
    card.appendChild(labelNode);

    const valueRow = document.createElement('div');
    valueRow.className = 'player-stat__value-row';

    const valueNode = document.createElement('div');
    valueNode.className = 'player-stat__value';
    valueNode.textContent = main || '—';
    valueRow.appendChild(valueNode);

    if (tag) {
      const tagNode = document.createElement('span');
      tagNode.className = 'player-rating-tag';
      tagNode.textContent = tag;
      valueRow.appendChild(tagNode);
    }

    card.appendChild(valueRow);
    return card;
  };

  const renderPlayer = (player) => {
    detailContainer.innerHTML = '';

    const sheet = document.createElement('div');
    sheet.className = 'club-sheet player-sheet';

    const hero = document.createElement('header');
    hero.className = 'player-hero';

    const heroIdentity = document.createElement('div');
    heroIdentity.className = 'player-hero__identity';

    const title = document.createElement('h1');
    title.className = 'player-hero__name';
    title.textContent = player.name || 'Fiche joueur';
    heroIdentity.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'player-hero__meta';
    appendMetaChip(meta, 'Nr FFE', player.nrFfe || '');
    appendMetaChip(meta, 'Club', player.club || '');
    if (meta.childElementCount) {
      heroIdentity.appendChild(meta);
    }

    const officialUrl = buildOfficialPlayerUrl(player.id || '');
    if (officialUrl) {
      const actions = document.createElement('div');
      actions.className = 'player-hero__actions';
      const link = document.createElement('a');
      link.className = 'btn btn-secondary player-hero__action';
      link.href = officialUrl;
      link.rel = 'noopener';
      link.target = '_blank';
      link.textContent = 'Voir la fiche FFE';
      actions.appendChild(link);
      heroIdentity.appendChild(actions);
    }
    hero.appendChild(heroIdentity);

    const ratingsGrid = document.createElement('div');
    ratingsGrid.className = 'player-hero__ratings';
    ratingsGrid.appendChild(createRatingCard('Elo', player.elo || '', { primary: true }));
    ratingsGrid.appendChild(createRatingCard('Rapide', player.rapid || ''));
    ratingsGrid.appendChild(createRatingCard('Blitz', player.blitz || ''));
    hero.appendChild(ratingsGrid);

    sheet.appendChild(hero);

    const content = document.createElement('div');
    content.className = 'player-sheet__content';

    const identity = createSection('Identité');
    appendDetail(identity.list, 'Nr FFE', player.nrFfe || '');
    appendDetail(identity.list, 'Club', player.club || '');
    appendDetail(identity.list, 'Mis à jour', formatUpdatedDate(player.updated || ''));
    if (identity.list.childElementCount) {
      content.appendChild(identity.section);
    }

    const profile = createSection('Profil');
    appendDetail(profile.list, 'Catégorie', player.category || '');
    appendDetail(profile.list, 'Sexe', player.gender || '');
    appendDetail(profile.list, 'Affiliation', player.aff || '');
    if (profile.list.childElementCount) {
      content.appendChild(profile.section);
    }

    const resources = createSection('Ressources');
    appendDetail(resources.list, 'Fiche FFE', officialUrl, {
      type: 'link',
      label: 'Voir la fiche officielle FFE',
    });
    if (resources.list.childElementCount) {
      content.appendChild(resources.section);
    }

    if (content.childElementCount) {
      sheet.appendChild(content);
    }

    detailContainer.appendChild(sheet);

    if (player.name) {
      document.title = `${player.name} – Joueur`;
    }
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
