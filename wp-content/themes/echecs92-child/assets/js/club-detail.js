/**
 * Club detail view renderer.
 * Loads the clubs dataset and displays the selected club based on ?id= query param.
 */
(function () {
  const DATA_URL = '/wp-content/themes/echecs92-child/assets/data/clubs.json';
  const detailContainer = document.getElementById('club-detail');
  const backLink = document.querySelector('[data-club-back]');
  let generatedIdCounter = 0;

  if (!detailContainer) {
    return;
  }

  const deriveClubIdFromPath = () => {
    const pathMatch = window.location.pathname.match(/\/club\/([^\/?#]+)/i);
    if (pathMatch && pathMatch[1]) {
      try {
        return decodeURIComponent(pathMatch[1]);
      } catch (err) {
        return pathMatch[1];
      }
    }
    return '';
  };

  const searchParams = new URLSearchParams(window.location.search);
  let clubId = deriveClubIdFromPath() || searchParams.get('id') || searchParams.get('club') || '';

  if (!deriveClubIdFromPath() && clubId) {
    const prettyUrl = `/club/${encodeURIComponent(clubId)}/`;
    if (window.history && typeof window.history.replaceState === 'function') {
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (current !== prettyUrl) {
        window.history.replaceState({}, document.title, prettyUrl);
      }
    }
  }

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
    const slugSource = name || commune || postalCode || primaryAddress || secondaryAddress;
    const id = raw.id || slugify(slugSource || `club-${generatedIdCounter + 1}`);

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

    return {
      id,
      name: name || commune || 'Club sans nom',
      commune,
      address: primaryAddress || secondaryAddress || '',
      siege: secondaryAddress || '',
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
      lat: raw.lat != null ? Number.parseFloat(raw.lat) : null,
      lng: raw.lng != null ? Number.parseFloat(raw.lng) : null,
      licenses: {
        A: toNumber(raw.licences_a ?? raw.licenses_a ?? raw.license_a),
        B: toNumber(raw.licences_b ?? raw.licenses_b ?? raw.license_b),
      },
      postalCode,
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

    const title = document.createElement('h1');
    title.className = 'club-sheet__title';
    title.textContent = club.name;
    header.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'club-sheet__meta';
    if (club.commune) {
      meta.appendChild(createChip(club.commune));
    }
    if (club.totalLicenses) {
      const label = `${club.totalLicenses} licencié${club.totalLicenses > 1 ? 's' : ''}`;
      meta.appendChild(createChip(label));
    }
    if (meta.childElementCount) {
      header.appendChild(meta);
    }

    const summaryText = club.publics || club.notes;
    if (summaryText) {
      const summary = document.createElement('p');
      summary.className = 'club-sheet__summary';
      summary.textContent = summaryText;
      header.appendChild(summary);
    }

    sheet.appendChild(header);

    const shareUrl = `${window.location.origin}/club/${encodeURIComponent(club.id)}/`;
    const shareBlock = document.createElement('div');
    shareBlock.className = 'club-sheet__share';

    const shareLabel = document.createElement('span');
    shareLabel.className = 'club-sheet__share-label';
    shareLabel.textContent = 'Partager';
    shareBlock.appendChild(shareLabel);

    const shareActions = document.createElement('div');
    shareActions.className = 'club-sheet__share-actions';

    const feedback = document.createElement('p');
    feedback.className = 'club-sheet__share-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');

    const updateFeedback = (message, tone = 'success') => {
      feedback.textContent = message || '';
      if (message) {
        feedback.dataset.tone = tone;
      } else {
        delete feedback.dataset.tone;
      }
    };

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

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'club-share-button';
    copyButton.textContent = 'Copier le lien';
    copyButton.addEventListener('click', async () => {
      const ok = await copyToClipboard(shareUrl);
      if (ok) {
        updateFeedback('Lien copié dans le presse-papiers.');
      } else {
        updateFeedback('Impossible de copier le lien automatiquement.', 'error');
      }
    });
    shareActions.appendChild(copyButton);

    if (navigator.share && typeof navigator.share === 'function') {
      const shareButton = document.createElement('button');
      shareButton.type = 'button';
      shareButton.className = 'club-share-button club-share-button--primary';
      shareButton.textContent = 'Partager…';
      shareButton.addEventListener('click', async () => {
        try {
          await navigator.share({
            title: club.name,
            text: `Découvrez ${club.name} sur le site du Comité des Échecs des Hauts-de-Seine`,
            url: shareUrl,
          });
          updateFeedback('Lien partagé.', 'success');
        } catch (error) {
          if (error && error.name === 'AbortError') {
            return;
          }
          const ok = await copyToClipboard(shareUrl);
          if (ok) {
            updateFeedback('Lien copié dans le presse-papiers.', 'success');
          } else {
            updateFeedback('Partage impossible. Copiez le lien manuellement.', 'error');
          }
        }
      });
      shareActions.appendChild(shareButton);
    }

    shareBlock.appendChild(shareActions);
    shareBlock.appendChild(feedback);
    sheet.appendChild(shareBlock);

    const sections = [];

    const coords = createSection('Coordonnées');
    appendDetail(coords.list, 'Adresse', club.address);
    appendDetail(coords.list, 'Ville', club.commune && !club.address ? club.commune : '');
    appendDetail(coords.list, 'Email', club.email, { type: 'mail' });
    appendDetail(coords.list, 'Téléphone', club.phone, { type: 'phone' });
    appendDetail(coords.list, 'Site internet', club.site, {
      type: 'link',
      label: 'Accéder au site du club',
    });
    if (coords.list.childElementCount) {
      sections.push(coords.section);
    }

    const activities = createSection('Activités');
    appendDetail(activities.list, 'Publics accueillis', club.publics);
    appendDetail(activities.list, 'Horaires', club.hours);
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
    return club;
  };

  const init = () => {
    if (!clubId) {
      renderMessage(detailContainer.dataset.emptyMessage || 'Club introuvable.');
      return;
    }
    fetch(DATA_URL, { headers: { Accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        const clubs = (Array.isArray(data) ? data : []).map(hydrateClub);
        const club = clubs.find((entry) => entry.id === clubId);
        if (!club) {
          renderMessage(detailContainer.dataset.emptyMessage || 'Club introuvable.');
          return;
        }
        renderClub(club);
      })
      .catch(() => {
        renderMessage('Impossible de charger la fiche du club pour le moment.');
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
