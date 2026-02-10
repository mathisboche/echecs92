/**
 * Home figures (92) renderer.
 * Keeps the "clubs affiliés / licenciés / arbitres / formateurs" numbers in sync with generated data.
 */
(function () {
  const ENDPOINT = '/wp-json/cdje92/v1/home-stats-92';

  const nodes = {
    clubs: document.querySelector('[data-home-figure="clubs"]'),
    licenses: document.querySelector('[data-home-figure="licenses"]'),
    staff: document.querySelector('[data-home-figure="staff"]'),
  };

  if (!nodes.clubs && !nodes.licenses && !nodes.staff) {
    return;
  }

  const format = new Intl.NumberFormat('fr-FR');
  const toInt = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    const parsed = Number.parseInt((value ?? '').toString().replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const setValue = (el, value) => {
    if (!el) {
      return;
    }
    if (!Number.isFinite(value)) {
      return;
    }
    el.textContent = format.format(value);
  };

  fetch(ENDPOINT, { headers: { Accept: 'application/json' } })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((payload) => {
      setValue(nodes.clubs, toInt(payload?.clubs_affilies));
      setValue(nodes.licenses, toInt(payload?.licencies));
      setValue(nodes.staff, toInt(payload?.arbitres_formateurs));
    })
    .catch(() => {
      // Keep fallback values (em dash) if anything goes wrong.
    });
})();

