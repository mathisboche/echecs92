/**
 * Club detail view renderer.
 * Loads the clubs dataset and displays the selected club based on ?id= query param.
 */
(function () {
  const DATA_URL = '/wp-content/themes/echecs92-child/assets/data/clubs.json';
  const detailContainer = document.getElementById('club-detail');
  const backLink = document.querySelector('[data-club-back]');

  if (!detailContainer) {
    return;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const clubId = searchParams.get('id') || searchParams.get('club');

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
    const club = { ...raw };
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
