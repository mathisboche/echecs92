/**
 * Tournaments pages wrapper.
 * Mirrors official FFE pages inside a dedicated tab with 92 and France scopes.
 */
(function () {
  const FFE_LIST_92_URL = 'https://www.echecs.asso.fr/ListeTournois.aspx?Action=TOURNOICOMITE&ComiteRef=92';
  const FFE_SEARCH_FR_URL = 'https://www.echecs.asso.fr/Tournois.aspx';
  const FFE_DETAIL_BASE_URL = 'https://www.echecs.asso.fr/FicheTournoi.aspx?Ref=';

  const page = document.querySelector('.tournaments-page');
  if (!page) {
    return;
  }

  const mode = (page.dataset.tournamentsMode || '').trim();
  const frame = page.querySelector('[data-tournaments-embed]');
  const statusNode = page.querySelector('[data-tournaments-status]');
  const directLink = page.querySelector('[data-tournaments-direct]');
  const backLink = page.querySelector('[data-tournament-back]');

  if (!frame) {
    return;
  }

  const setStatus = (message, tone) => {
    if (!statusNode) {
      return;
    }
    const text = (message || '').toString().trim();
    statusNode.textContent = text;
    statusNode.hidden = !text;
    if (tone) {
      statusNode.dataset.tone = tone;
    } else {
      delete statusNode.dataset.tone;
    }
  };

  const toInternalPath = (value) => {
    const raw = (value || '').toString().trim();
    if (!raw || !raw.startsWith('/')) {
      return '';
    }
    try {
      const url = new URL(raw, window.location.origin);
      if (url.origin !== window.location.origin) {
        return '';
      }
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (error) {
      return '';
    }
  };

  const getBackPath = () => {
    if (!backLink) {
      return '';
    }
    const fallback = backLink.getAttribute('href') || '/tournois-92';
    const params = new URLSearchParams(window.location.search || '');
    const from = toInternalPath(params.get('from') || '');
    if (!from) {
      return fallback;
    }
    const normalized = from.split('?')[0].split('#')[0] || '/';
    if (
      normalized === '/tournois' ||
      normalized === '/tournois-france' ||
      normalized === '/tournois-92' ||
      normalized.startsWith('/tournoi/')
    ) {
      return from;
    }
    return fallback;
  };

  const getTournamentRef = () => {
    const fromData = (page.dataset.tournamentRef || '').toString().trim();
    if (/^\d{1,10}$/u.test(fromData)) {
      return fromData;
    }

    const params = new URLSearchParams(window.location.search || '');
    const fromQuery = (params.get('ref') || '').toString().trim();
    if (/^\d{1,10}$/u.test(fromQuery)) {
      return fromQuery;
    }

    const path = (window.location.pathname || '').replace(/\/+$/u, '');
    const match = path.match(/\/tournoi\/(\d{1,10})$/u);
    if (match && match[1]) {
      return match[1];
    }

    return '';
  };

  if (backLink) {
    const backPath = getBackPath();
    backLink.href = backPath;
    const cleaned = backPath.split('?')[0].split('#')[0] || '/';
    backLink.textContent =
      cleaned === '/tournois' || cleaned === '/tournois-france'
        ? 'Retour aux tournois France'
        : 'Retour aux tournois du 92';
  }

  let frameUrl = '';
  if (mode === 'list-92') {
    frameUrl = FFE_LIST_92_URL;
  } else if (mode === 'list-fr') {
    frameUrl = FFE_SEARCH_FR_URL;
  } else if (mode === 'detail') {
    const ref = getTournamentRef();
    if (!ref) {
      setStatus('Reference de tournoi manquante. Utilisez une URL du type /tournoi/69201', 'error');
      return;
    }
    frameUrl = `${FFE_DETAIL_BASE_URL}${encodeURIComponent(ref)}`;
  }

  if (!frameUrl) {
    setStatus('Configuration de page invalide.', 'error');
    return;
  }

  if (directLink) {
    directLink.href = frameUrl;
  }

  frame.addEventListener('load', () => {
    setStatus('');
  });

  frame.addEventListener('error', () => {
    setStatus('Impossible de charger le contenu FFE. Ouvrez le lien direct ci-dessus.', 'error');
  });

  frame.src = frameUrl;
})();
