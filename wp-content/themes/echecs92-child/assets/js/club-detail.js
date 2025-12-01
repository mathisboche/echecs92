/**
 * Club detail view renderer.
 * Loads the clubs dataset and displays the selected club based on ?id= query param.
 */
(function () {
  const DATA_URL = '/wp-content/themes/echecs92-child/assets/data/clubs.json';
  const CLUBS_NAV_STORAGE_KEY = 'echecs92:clubs:last-listing';
  const detailContainer = document.getElementById('club-detail');
  const backLink = document.querySelector('[data-club-back]');
  const backLinkMap = document.querySelector('[data-club-back-map]');
  let generatedIdCounter = 0;

  if (!detailContainer) {
    return;
  }

  const consumeStoredClubsNavigation = () => {
    try {
      const storage = window.localStorage;
      if (!storage) {
        return null;
      }
      const raw = storage.getItem(CLUBS_NAV_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      storage.removeItem(CLUBS_NAV_STORAGE_KEY);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        payload = null;
      }
      const timestamp = payload && typeof payload.ts === 'number' ? payload.ts : null;
      if (!timestamp) {
        return null;
      }
      if (Date.now() - timestamp > 10 * 60 * 1000) {
        return null;
      }
      return payload;
    } catch (error) {
      return null;
    }
  };

  const storedNavigation = consumeStoredClubsNavigation();

  const cameFromClubsSearch = () => {
    if (storedNavigation && storedNavigation.context === 'detail:list') {
      return true;
    }
    const referrer = document.referrer;
    if (!referrer) {
      return false;
    }
    try {
      const refUrl = new URL(referrer, window.location.origin);
      if (refUrl.origin !== window.location.origin) {
        return false;
      }
      const normalized = refUrl.pathname.replace(/\/+$/u, '') || '/';
      return normalized === '/clubs-92';
    } catch (error) {
      return false;
    }
  };

  const cameFromClubsMap = () => {
    if (storedNavigation && storedNavigation.context === 'detail:map') {
      return true;
    }
    const referrer = document.referrer;
    if (!referrer) {
      return false;
    }
    try {
      const refUrl = new URL(referrer, window.location.origin);
      if (refUrl.origin !== window.location.origin) {
        return false;
      }
      const normalized = refUrl.pathname.replace(/\/+$/u, '') || '/';
      return normalized === '/carte-des-clubs-92';
    } catch (error) {
      return false;
    }
  };

  const updateBackLinkVisibility = () => {
    if (backLink) {
      if (cameFromClubsSearch()) {
        backLink.removeAttribute('hidden');
      } else {
        backLink.setAttribute('hidden', '');
      }
    }
    if (backLinkMap) {
      if (cameFromClubsMap()) {
        backLinkMap.removeAttribute('hidden');
      } else {
        backLinkMap.setAttribute('hidden', '');
      }
    }
  };

  updateBackLinkVisibility();

  const deriveClubSlugFromPath = () => {
    const pathMatch = window.location.pathname.match(/\/club-92\/([^\/?#]+)/i);
    if (pathMatch && pathMatch[1]) {
      try {
        return decodeURIComponent(pathMatch[1]);
      } catch (err) {
        return pathMatch[1];
      }
    }
    return '';
  };

  const clubSlug = deriveClubSlugFromPath();

  const renderMessage = (message, tone = 'error') => {
    detailContainer.innerHTML = `<p class="clubs-empty" data-tone="${tone}">${message}</p>`;
  };

  const formatPhone = (value) => {
    if (!value) {
      return null;
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 10) {
      return value;
    }
    return digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
  };

  const normalise = (value) =>
    (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const slugify = (value) => {
    const base = normalise(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (base) {
      return base;
    }
    generatedIdCounter += 1;
    return `club-${generatedIdCounter}`;
  };

  const extractAddressParts = (value) => {
    const result = {
      full: value ? String(value).trim() : '',
      postalCode: '',
      city: '',
    };
    if (!result.full) {
      return result;
    }
    const postalMatch = result.full.match(/\b(\d{5})\b/);
    if (postalMatch) {
      result.postalCode = postalMatch[1];
      const after = result.full.slice(postalMatch.index + postalMatch[0].length).trim();
      if (after) {
        result.city = after.replace(/^[,;\-–—]+/, '').trim();
      }
    }
    if (!result.city) {
      const parts = result.full.split(',').map((part) => part.trim()).filter(Boolean);
      if (parts.length) {
        const last = parts[parts.length - 1];
        const cleaned = last.replace(/\b\d{5}\b/g, '').trim();
        if (cleaned) {
          result.city = cleaned;
        }
      }
    }
    result.city = result.city.replace(/\s+/g, ' ').trim();
    return result;
  };

  const STREET_KEYWORDS =
    /\b(rue|avenue|av\.?|boulevard|bd|place|route|chemin|impasse|all[ée]e|voie|quai|cours|passage|square|sentier|mail|esplanade|terrasse|pont|faubourg|clos|cité|cite|hameau|lotissement|residence|résidence|allee)\b/i;

  const simplifyStreetSegment = (value) => {
    if (!value) {
      return '';
    }
    const cleaned = value.replace(/\([^)]*\)/g, ' ');
    const parts = cleaned
      .split(/[,;/]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) {
      return cleaned.replace(/\s+/g, ' ').trim();
    }
    const tests = [
      (part) => /\b\d+[\p{L}]?\b/iu.test(part) && STREET_KEYWORDS.test(part),
      (part) => STREET_KEYWORDS.test(part),
      (part) => /\b\d+[\p{L}]?\b/iu.test(part),
    ];
    for (const test of tests) {
      const match = parts.find((part) => test(part));
      if (match) {
        return match.replace(/\s+/g, ' ').trim();
      }
    }
    return parts[0];
  };

  const buildStandardAddress = (primaryAddress, secondaryAddress, postalCode, city) => {
    const street =
      simplifyStreetSegment(primaryAddress) || simplifyStreetSegment(secondaryAddress) || '';
    const formattedCity = formatCommune(city);
    const components = [];
    if (street) {
      components.push(street);
    }
    const localityParts = [];
    if (postalCode) {
      localityParts.push(postalCode);
    }
    if (formattedCity) {
      localityParts.push(formattedCity);
    }
    if (localityParts.length) {
      components.push(localityParts.join(' ').trim());
    }
    return components.join(', ').trim();
  };

  const formatCommune = (value) => {
    if (!value) {
      return '';
    }
    const lower = value
      .toString()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\s+-\s+/g, '-');

    let formatted = lower.replace(/(^|[\s\-’'])(\p{L})/gu, (match, boundary, letter) => `${boundary}${letter.toUpperCase()}`);
    formatted = formatted.replace(/\b(De|Du|Des|La|Le|Les|Sur|Sous|Et|Aux|Au)\b/gu, (match) => match.toLowerCase());
    formatted = formatted.replace(/\bD'([A-Z])/g, (match, letter) => `d'${letter}`);
    formatted = formatted.replace(/\bL'([A-Z])/g, (match, letter) => `l'${letter}`);
    return formatted.replace(/\s+/g, ' ').trim();
  };

  const normaliseCommuneKey = (value) => normalise(value).replace(/[^a-z0-9]/g, '');

  const POSTAL_COORDINATES = {
    '92000': { label: 'Nanterre', lat: 48.8927825, lng: 2.2073652 },
    '92100': { label: 'Boulogne-Billancourt', lat: 48.837494, lng: 2.2378546 },
    '92110': { label: 'Clichy', lat: 48.9027893, lng: 2.3093052 },
    '92120': { label: 'Montrouge', lat: 48.8150655, lng: 2.3163712 },
    '92130': { label: 'Issy-les-Moulineaux', lat: 48.8233607, lng: 2.2653052 },
    '92140': { label: 'Clamart', lat: 48.7959696, lng: 2.2549138 },
    '92150': { label: 'Suresnes', lat: 48.8711349, lng: 2.2217833 },
    '92160': { label: 'Antony', lat: 48.750728, lng: 2.2987872 },
    '92170': { label: 'Vanves', lat: 48.8219675, lng: 2.2901321 },
    '92190': { label: 'Meudon', lat: 48.8097395, lng: 2.229958 },
    '92200': { label: 'Neuilly-sur-Seine', lat: 48.8800801, lng: 2.257544 },
    '92210': { label: 'Saint-Cloud', lat: 48.8439913, lng: 2.2117806 },
    '92220': { label: 'Bagneux', lat: 48.7981949, lng: 2.3110192 },
    '92230': { label: 'Gennevilliers', lat: 48.9287242, lng: 2.2963202 },
    '92240': { label: 'Malakoff', lat: 48.8187167, lng: 2.3008083 },
    '92250': { label: 'La Garenne-Colombes', lat: 48.9070703, lng: 2.2445272 },
    '92260': { label: 'Fontenay-aux-Roses', lat: 48.7908946, lng: 2.2867846 },
    '92270': { label: 'Bois-Colombes', lat: 48.9165336, lng: 2.2690732 },
    '92290': { label: 'Châtenay-Malabry', lat: 48.7697842, lng: 2.2650969 },
    '92300': { label: 'Levallois-Perret', lat: 48.8935077, lng: 2.2886109 },
    '92310': { label: 'Sèvres', lat: 48.822245, lng: 2.2117665 },
    '92320': { label: 'Châtillon', lat: 48.8044684, lng: 2.2893633 },
    '92330': { label: 'Sceaux', lat: 48.7784655, lng: 2.2893399 },
    '92340': { label: 'Bourg-la-Reine', lat: 48.7794333, lng: 2.316237 },
    '92350': { label: 'Le Plessis-Robinson', lat: 48.7797706, lng: 2.2581995 },
    '92370': { label: 'Chaville', lat: 48.8090026, lng: 2.1924797 },
    '92380': { label: 'Garches', lat: 48.8469069, lng: 2.1893546 },
    '92400': { label: 'Courbevoie', lat: 48.9010419, lng: 2.266358 },
    '92410': { label: "Ville-d'Avray", lat: 48.8214672, lng: 2.1763211 },
    '92420': { label: 'Vaucresson', lat: 48.8364225, lng: 2.1506469 },
    '92430': { label: 'Marnes-la-Coquette', lat: 48.8287849, lng: 2.1646468 },
    '92500': { label: 'Rueil-Malmaison', lat: 48.8718031, lng: 2.1801931 },
    '92600': { label: 'Asnières-sur-Seine', lat: 48.9137552, lng: 2.288062 },
    '92700': { label: 'Colombes', lat: 48.9223905, lng: 2.2521192 },
    '92800': { label: 'Puteaux', lat: 48.8826865, lng: 2.2410641 },
  };

  const COMMUNE_COORDINATES_BY_NAME = Object.entries(POSTAL_COORDINATES).reduce(
    (acc, [postalCode, info]) => {
      const key = normaliseCommuneKey(info.label);
      if (key && !acc[key]) {
        acc[key] = { postalCode, lat: info.lat, lng: info.lng, label: info.label };
      }
      return acc;
    },
    {}
  );

  const getPostalCoordinates = (postalCode) => {
    if (!postalCode) {
      return null;
    }
    const key = postalCode.toString().trim();
    if (!key) {
      return null;
    }
    const entry = POSTAL_COORDINATES[key];
    if (!entry) {
      return null;
    }
    return { postalCode: key, lat: entry.lat, lng: entry.lng, label: entry.label };
  };

  const getCommuneCoordinatesByName = (value) => {
    if (!value) {
      return null;
    }
    const key = normaliseCommuneKey(value);
    if (!key) {
      return null;
    }
    const entry = COMMUNE_COORDINATES_BY_NAME[key];
    if (!entry) {
      return null;
    }
    return { postalCode: entry.postalCode, lat: entry.lat, lng: entry.lng, label: entry.label };
  };

  const lookupLocalCoordinates = (query) => {
    const raw = (query || '').toString().trim();
    if (!raw) {
      return null;
    }

    const postalMatches = raw.match(/\b(\d{5})\b/g);
    if (postalMatches) {
      for (let i = 0; i < postalMatches.length; i += 1) {
        const coords = getPostalCoordinates(postalMatches[i]);
        if (coords) {
          return { latitude: coords.lat, longitude: coords.lng, label: coords.label, postalCode: coords.postalCode };
        }
      }
    }

    const candidates = new Set();
    candidates.add(raw);
    const formatted = formatCommune(raw);
    if (formatted) {
      candidates.add(formatted);
    }
    raw
      .split(/[;,\/\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        candidates.add(part);
        const formattedPart = formatCommune(part);
        if (formattedPart) {
          candidates.add(formattedPart);
        }
      });

    for (const candidate of candidates) {
      const coords = getCommuneCoordinatesByName(candidate);
      if (coords) {
        return { latitude: coords.lat, longitude: coords.lng, label: coords.label, postalCode: coords.postalCode };
      }
    }

    return null;
  };

  const collectPostalCodes = (club) => {
    const codes = new Set();
    if (club.postalCode) {
      codes.add(club.postalCode);
    }
    [club.address, club.siege, club.addressStandard].forEach((value) => {
      const matches = (value || '').match(/\b\d{5}\b/g);
      if (matches) {
        matches.forEach((code) => codes.add(code));
      }
    });
    return Array.from(codes);
  };

  const resolveClubCoordinates = (club) => {
    if (!club || typeof club !== 'object') {
      return null;
    }

    const lat = Number.parseFloat(club.latitude ?? club.lat);
    const lng = Number.parseFloat(club.longitude ?? club.lng ?? club.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        lat,
        lng,
        label: club.commune || club.name || '',
        postalCode: club.postalCode || '',
      };
    }

    if (club.addressStandard) {
      const addressFallback = lookupLocalCoordinates(club.addressStandard);
      if (addressFallback) {
        return {
          lat: addressFallback.latitude,
          lng: addressFallback.longitude,
          label: addressFallback.label || club.addressStandard,
          postalCode: addressFallback.postalCode || '',
        };
      }
    }

    if (club.commune) {
      const coords = getCommuneCoordinatesByName(club.commune);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode };
      }
    }

    const postalCandidates = collectPostalCodes(club);
    for (let i = 0; i < postalCandidates.length; i += 1) {
      const coords = getPostalCoordinates(postalCandidates[i]);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode };
      }
    }

    if (club.commune) {
      const fallback = lookupLocalCoordinates(club.commune);
      if (fallback) {
        return {
          lat: fallback.latitude,
          lng: fallback.longitude,
          label: fallback.label || club.commune,
          postalCode: fallback.postalCode || '',
        };
      }
    }

    return null;
  };

  const buildDirectionsUrl = (coords, club) => {
    const addressCandidate = (
      club?.addressStandard ||
      club?.address ||
      club?.siege ||
      coords?.label ||
      club?.commune ||
      ''
    ).trim();
    let destinationValue = '';
    if (addressCandidate) {
      destinationValue = addressCandidate;
    } else {
      const lat = Number.parseFloat(coords?.lat);
      const lng = Number.parseFloat(coords?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return '';
      }
      destinationValue = `${lat},${lng}`;
    }
    const destination = encodeURIComponent(destinationValue);
    const label = encodeURIComponent(club?.name || coords?.label || 'Club');
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const isAppleMobile =
      /iP(hone|od|ad)/i.test(ua) ||
      (/Mac/i.test(platform) && 'ontouchend' in window);
    if (isAppleMobile) {
      return `http://maps.apple.com/?daddr=${destination}&q=${label}`;
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${destination}&destination_place_id=&travelmode=driving`;
  };

  const renderClubMap = (club, container, statusElement, directionsButton) => {
    if (!container) {
      return;
    }

    const updateStatus = (message, tone = 'info') => {
      if (!statusElement) {
        return;
      }
      statusElement.textContent = message || '';
      if (message) {
        statusElement.dataset.tone = tone;
      } else {
        delete statusElement.dataset.tone;
      }
    };

    const coords = resolveClubCoordinates(club);
    if (!coords) {
      updateStatus('Localisation indisponible pour ce club.', 'error');
      if (directionsButton) {
        directionsButton.hidden = true;
      }
      return;
    }

    const activateDirections = () => {
      if (!directionsButton) {
        return;
      }
      const url = buildDirectionsUrl(coords, club);
      if (!url) {
        directionsButton.hidden = true;
        return;
      }
      directionsButton.href = url;
      directionsButton.hidden = false;
    };

    const initialiseMap = (attempt = 0) => {
      if (typeof L === 'undefined') {
        if (attempt > 30) {
          updateStatus('Carte indisponible pour le moment.', 'error');
          activateDirections();
          return;
        }
        window.setTimeout(() => initialiseMap(attempt + 1), 150);
        return;
      }
      try {
        const map = L.map(container, {
          zoomControl: true,
          scrollWheelZoom: true,
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 18,
        }).addTo(map);
        const popupLines = [`<strong>${club.name}</strong>`];
        if (club.addressDisplay) {
          popupLines.push(club.addressDisplay);
        } else if (coords.label) {
          popupLines.push(coords.label);
        }
        const marker = L.marker([coords.lat, coords.lng], {
          title: club.name,
        });
        marker.addTo(map).bindPopup(popupLines.join('<br>'));
        map.setView([coords.lat, coords.lng], 14);
        window.setTimeout(() => {
          map.invalidateSize();
        }, 150);
        updateStatus('Localisation du club affichée.', 'success');
        activateDirections();
      } catch (error) {
        updateStatus('Carte indisponible pour le moment.', 'error');
        activateDirections();
      }
    };

    updateStatus('Chargement de la carte…', 'info');
    initialiseMap();
  };

  const adaptClubRecord = (raw) => {
    if (!raw || typeof raw !== 'object') {
      return raw;
    }
    if (raw.id && raw.name) {
      return raw;
    }
    const name = raw.nom || raw.name || '';
    const primaryAddress = raw.adresse || raw.address || '';
    const addressParts = extractAddressParts(primaryAddress);
    const secondaryAddress = raw.siege || raw.siege_social || raw.address2 || '';
    const secondaryParts = extractAddressParts(secondaryAddress);
    const communeRaw = raw.commune || raw.ville || addressParts.city || secondaryParts.city || '';
    const commune = formatCommune(communeRaw);
    const postalCode = raw.code_postal || raw.postal_code || addressParts.postalCode || secondaryParts.postalCode || '';
    const slugSource = commune || name || postalCode || primaryAddress || secondaryAddress;
    const standardAddress = buildStandardAddress(
      primaryAddress,
      secondaryAddress,
      postalCode,
      commune || addressParts.city || secondaryParts.city || ''
    );
    const id = raw.id || slugify(name || slugSource || `club-${generatedIdCounter + 1}`);

    const rawSite = raw.site || raw.website || '';
    let site = rawSite;
    if (site && !/^https?:/i.test(site)) {
      site = `https://${site.replace(/^\/+/g, '')}`;
    }

    const toNumber = (value) => {
      if (value == null || value === '') {
        return null;
      }
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const toFloat = (value) => {
      if (value == null || value === '') {
        return null;
      }
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const latitude =
      toFloat(raw.latitude ?? raw.lat ?? raw.location?.latitude ?? raw.location?.lat) ?? null;
    const longitude =
      toFloat(raw.longitude ?? raw.lng ?? raw.lon ?? raw.location?.longitude ?? raw.location?.lng) ??
      null;

    return {
      id,
      name: name || commune || 'Club sans nom',
      commune,
      address: primaryAddress || secondaryAddress || '',
      siege: secondaryAddress || '',
      addressStandard: standardAddress,
      phone: raw.telephone || raw.phone || '',
      email: raw.email || '',
      site,
      president: raw.president || '',
      hours: raw.horaires || raw.hours || '',
      publics: raw.publics || '',
      tarifs: raw.tarifs || '',
      notes: raw.notes || '',
      fiche_ffe: raw.fiche_ffe || '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      addressStandard: standardAddress,
      addressDisplay: standardAddress || primaryAddress || secondaryAddress || '',
      latitude,
      longitude,
      licenses: {
        A: toNumber(raw.licences_a ?? raw.licenses_a ?? raw.license_a),
        B: toNumber(raw.licences_b ?? raw.licenses_b ?? raw.license_b),
      },
      postalCode,
      slug: slugify(slugSource || id || name || 'club'),
    };
  };

  const createChip = (text, variant) => {
    const span = document.createElement('span');
    span.className = `club-chip${variant ? ` club-chip--${variant}` : ''}`;
    span.textContent = text;
    return span;
  };

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
    if (!value) {
      return false;
    }
    const item = document.createElement('li');
    item.className = 'club-section__item';

    const labelNode = document.createElement('span');
    labelNode.className = 'club-section__label';
    if (options.icon) {
      labelNode.dataset.icon = options.icon;
    }
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
    } else if (options.type === 'mail') {
      const link = document.createElement('a');
      link.href = `mailto:${value}`;
      link.textContent = value;
      valueContainer.appendChild(link);
    } else if (options.type === 'phone') {
      const formatted = formatPhone(value) || value;
      const cleaned = value.replace(/[^\d+]/g, '');
      const link = document.createElement('a');
      link.href = `tel:${cleaned || value}`;
      link.textContent = formatted;
      valueContainer.appendChild(link);
    } else {
      valueContainer.textContent = value;
    }

    item.appendChild(valueContainer);
    list.appendChild(item);
    return true;
  };

  const renderClub = (club) => {
    detailContainer.innerHTML = '';

    const sheet = document.createElement('div');
    sheet.className = 'club-sheet';

    const header = document.createElement('header');
    header.className = 'club-sheet__header';

    const titleRow = document.createElement('div');
    titleRow.className = 'club-sheet__title-row';

    const title = document.createElement('h1');
    title.className = 'club-sheet__title';
    title.textContent = club.name;
    titleRow.appendChild(title);

    const shareUrl = `${window.location.origin}/club-92/${encodeURIComponent(club.slug || club.id || '')}/`;
    const shareBlock = document.createElement('div');
    shareBlock.className = 'club-sheet__share';

    const copyToClipboard = async (value) => {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        return true;
      }
      try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
      } catch (err) {
        return false;
      }
    };

    const shareButton = document.createElement('button');
    shareButton.type = 'button';
    shareButton.className = 'club-share-button';
    shareButton.setAttribute('aria-label', 'Partager ce club');
    shareButton.title = 'Partager';
    shareButton.addEventListener('click', async () => {
      try {
        if (navigator.share && typeof navigator.share === 'function') {
          await navigator.share({
            title: club.name,
            text: `Découvrez ${club.name} sur le site du Comité d'Échecs des Hauts-de-Seine`,
            url: shareUrl,
          });
          return;
        }
        const ok = await copyToClipboard(shareUrl);
        if (!ok) {
          console.warn('Partage indisponible');
        }
      } catch (error) {
        if (error && error.name === 'AbortError') {
          return;
        }
        const ok = await copyToClipboard(shareUrl);
        if (!ok) {
          console.warn('Partage indisponible');
        }
      }
    });

    shareBlock.appendChild(shareButton);
    titleRow.appendChild(shareBlock);
    header.appendChild(titleRow);

    const summaryText = club.publics || club.notes;
    if (summaryText) {
      const summary = document.createElement('p');
      summary.className = 'club-sheet__summary';
      summary.textContent = summaryText;
      header.appendChild(summary);
    }

    sheet.appendChild(header);

    const sections = [];

    const coords = createSection('Coordonnées');
    appendDetail(coords.list, 'Adresse', club.address, { icon: 'address' });
    appendDetail(coords.list, 'Ville', club.commune && !club.address ? club.commune : '');
    appendDetail(coords.list, 'Email', club.email, { type: 'mail', icon: 'mail' });
    appendDetail(coords.list, 'Téléphone', club.phone, { type: 'phone', icon: 'phone' });
    appendDetail(coords.list, 'Site internet', club.site, {
      type: 'link',
      label: 'Accéder au site du club',
      icon: 'website',
    });
    if (coords.list.childElementCount) {
      sections.push(coords.section);
    }

    const activities = createSection('Activités');
    appendDetail(activities.list, 'Publics accueillis', club.publics);
    appendDetail(activities.list, 'Horaires', club.hours, { icon: 'hours' });
    appendDetail(activities.list, 'Tarifs', club.tarifs);
    appendDetail(activities.list, 'Informations complémentaires', club.notes && club.publics ? club.notes : '');
    if (activities.list.childElementCount) {
      sections.push(activities.section);
    }

    const organisation = createSection('Organisation');
    appendDetail(organisation.list, 'Président·e', club.president);
    if (club.licenses && (club.licenses.A || club.licenses.B)) {
      const licenseParts = [];
      if (club.licenses.A) {
        licenseParts.push(`Licence A : ${club.licenses.A}`);
      }
      if (club.licenses.B) {
        licenseParts.push(`Licence B : ${club.licenses.B}`);
      }
      appendDetail(organisation.list, 'Répartition licences', licenseParts.join(' · '));
    }
    if (club.totalLicenses) {
      const label = `${club.totalLicenses} licencié${club.totalLicenses > 1 ? 's' : ''}`;
      appendDetail(organisation.list, 'Total licenciés', label);
    }
    if (organisation.list.childElementCount) {
      sections.push(organisation.section);
    }

    const resources = createSection('Ressources');
    appendDetail(resources.list, 'Fiche FFE', club.fiche_ffe, {
      type: 'link',
      label: 'Consulter la fiche FFE',
    });
    if (resources.list.childElementCount) {
      sections.push(resources.section);
    }

    sections.forEach((section) => sheet.appendChild(section));

    detailContainer.appendChild(sheet);

    const mapSection = document.createElement('section');
    mapSection.className = 'club-map-section';
    mapSection.setAttribute('aria-label', `Carte de localisation pour ${club.name}`);

    const mapHeading = document.createElement('h2');
    mapHeading.className = 'club-map__heading';
    mapHeading.textContent = 'Localisation sur la carte';
    mapSection.appendChild(mapHeading);

    const mapContainerWrapper = document.createElement('div');
    mapContainerWrapper.className = 'club-map__container';

    const mapContainer = document.createElement('div');
    mapContainer.className = 'club-map';
    mapContainer.id = 'club-map';
    mapContainerWrapper.appendChild(mapContainer);

    const mapStatus = document.createElement('p');
    mapStatus.id = 'club-map-status';
    mapStatus.className = 'club-map__status';
    mapStatus.setAttribute('role', 'status');
    mapStatus.setAttribute('aria-live', 'polite');
    mapStatus.textContent = 'Chargement de la carte…';
    mapContainerWrapper.appendChild(mapStatus);

    mapSection.appendChild(mapContainerWrapper);

    const directionsButton = document.createElement('a');
    directionsButton.className = 'btn btn-secondary club-map__directions';
    directionsButton.target = '_blank';
    directionsButton.rel = 'noopener';
    directionsButton.textContent = 'Ouvrir dans mon app de navigation';
    directionsButton.hidden = true;
    mapSection.appendChild(directionsButton);

    detailContainer.appendChild(mapSection);

    renderClubMap(club, mapContainer, mapStatus, directionsButton);

    if (club.name) {
      document.title = `${club.name} – Clubs du 92`;
    }
  };

  const hydrateClub = (raw) => {
    const club = { ...adaptClubRecord(raw) };
    const licenseA = Number.parseInt(club.licenses?.A, 10);
    const licenseB = Number.parseInt(club.licenses?.B, 10);
    const totalLicenses =
      (Number.isFinite(licenseA) ? licenseA : 0) + (Number.isFinite(licenseB) ? licenseB : 0);
    club.totalLicenses = totalLicenses > 0 ? totalLicenses : null;
    club.slug = club.slug || slugify(club.commune || club.name || club.id || 'club');
    return club;
  };

  const init = () => {
    if (!clubSlug) {
      renderMessage(detailContainer.dataset.emptyMessage || 'Club introuvable.');
      return;
    }
    const releaseSpinner =
      typeof window !== 'undefined' && window.cdjeSpinner && typeof window.cdjeSpinner.show === 'function'
        ? window.cdjeSpinner.show('Chargement du club…')
        : () => {};
    fetch(DATA_URL, { headers: { Accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        const clubs = (Array.isArray(data) ? data : []).map(hydrateClub);
        const club = clubs.find((entry) => entry.slug === clubSlug || entry.id === clubSlug);
        if (!club) {
          renderMessage(detailContainer.dataset.emptyMessage || 'Club introuvable.');
          return;
        }
        renderClub(club);
      })
      .catch(() => {
        renderMessage('Impossible de charger la fiche du club pour le moment.');
      })
      .finally(() => {
        releaseSpinner();
      });
  };

  if (backLink && document.referrer) {
    try {
      const ref = new URL(document.referrer);
      if (ref.origin === window.location.origin) {
        backLink.href = ref.pathname + ref.search;
      }
    } catch (err) {
      // Ignore malformed referrer
    }
  }

  init();
})();
