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

  const renderPlayer = (player) => {
    detailContainer.innerHTML = '';

    const sheet = document.createElement('div');
    sheet.className = 'club-sheet';

    const header = document.createElement('header');
    header.className = 'club-sheet__header';

    const titleRow = document.createElement('div');
    titleRow.className = 'club-sheet__title-row';

    const title = document.createElement('h1');
    title.className = 'club-sheet__title';
    title.textContent = player.name || 'Fiche joueur';
    titleRow.appendChild(title);
    header.appendChild(titleRow);
    sheet.appendChild(header);

    const identity = createSection('Identité');
    appendDetail(identity.list, 'Nr FFE', player.nrFfe || '');
    appendDetail(identity.list, 'Club', player.club || '');
    if (identity.list.childElementCount) {
      sheet.appendChild(identity.section);
    }

    const ratings = createSection('Classements');
    appendDetail(ratings.list, 'Elo', player.elo || '');
    appendDetail(ratings.list, 'Rapide', player.rapid || '');
    appendDetail(ratings.list, 'Blitz', player.blitz || '');
    appendDetail(ratings.list, 'Catégorie', player.category || '');
    appendDetail(ratings.list, 'Sexe', player.gender || '');
    appendDetail(ratings.list, 'Affiliation', player.aff || '');
    if (ratings.list.childElementCount) {
      sheet.appendChild(ratings.section);
    }

    const resources = createSection('Ressources');
    appendDetail(resources.list, 'Fiche FFE', buildOfficialPlayerUrl(player.id || ''), {
      type: 'link',
      label: 'Voir la fiche officielle FFE',
    });
    if (resources.list.childElementCount) {
      sheet.appendChild(resources.section);
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

