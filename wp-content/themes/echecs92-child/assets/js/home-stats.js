/**
 * Home figures (92) renderer.
 * - Shows last known values immediately from localStorage.
 * - Revalidates with REST + ETag.
 * - Animates only when values change across runs.
 */
(function () {
  const ENDPOINT = '/wp-json/cdje92/v1/home-stats-92';
  const STORAGE_KEY = 'cdje92_home_stats_92_cache_v1';
  const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
  const LIVE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
  const ANIMATION_MS = 650;

  const nodes = {
    clubs: document.querySelector('[data-home-figure="clubs"]'),
    licenses: document.querySelector('[data-home-figure="licenses"]'),
    staff: document.querySelector('[data-home-figure="staff"]'),
  };

  if (!nodes.clubs && !nodes.licenses && !nodes.staff) {
    return;
  }

  const format = new Intl.NumberFormat('fr-FR');
  const figureKeys = Object.keys(nodes);

  const toInt = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.round(value);
    }
    const parsed = Number.parseInt((value ?? '').toString().replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const normalizePayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const clubs = toInt(payload.clubs_affilies);
    const licenses = toInt(payload.licencies);
    const staff = toInt(payload.arbitres_formateurs);

    if (!Number.isFinite(clubs) || !Number.isFinite(licenses) || !Number.isFinite(staff)) {
      return null;
    }

    return {
      clubs,
      licenses,
      staff,
      sourceVersion: typeof payload.source_version === 'string' ? payload.source_version : '',
    };
  };

  const setValue = (el, value) => {
    if (!el || !Number.isFinite(value)) {
      return;
    }
    el.textContent = format.format(value);
  };

  const silenceAriaLive = (el) => {
    if (!el) {
      return;
    }
    if (typeof el.__homeStatsAriaLive === 'undefined') {
      el.__homeStatsAriaLive = el.getAttribute('aria-live');
    }
    if (el.__homeStatsAriaLive !== null) {
      el.setAttribute('aria-live', 'off');
    }
  };

  const restoreAriaLive = (el) => {
    if (!el || typeof el.__homeStatsAriaLive === 'undefined') {
      return;
    }
    if (el.__homeStatsAriaLive === null) {
      el.removeAttribute('aria-live');
    } else {
      el.setAttribute('aria-live', el.__homeStatsAriaLive);
    }
    delete el.__homeStatsAriaLive;
  };

  const animateValue = (el, from, to) => {
    if (!el) {
      return;
    }

    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
      setValue(el, to);
      return;
    }

    if (el.__homeStatsRafId) {
      window.cancelAnimationFrame(el.__homeStatsRafId);
      restoreAriaLive(el);
    }

    silenceAriaLive(el);

    const start = performance.now();
    const delta = to - from;

    const tick = (now) => {
      const progress = Math.min(1, (now - start) / ANIMATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(el, Math.round(from + delta * eased));

      if (progress < 1) {
        el.__homeStatsRafId = window.requestAnimationFrame(tick);
      } else {
        el.__homeStatsRafId = 0;
        setValue(el, to);
        restoreAriaLive(el);
      }
    };

    el.__homeStatsRafId = window.requestAnimationFrame(tick);
  };

  const triggerUpdateEffect = (el, isIncrease) => {
    if (!el) {
      return;
    }

    el.classList.remove('is-updating', 'is-update-up', 'is-update-down');
    void el.offsetWidth;
    el.classList.add('is-updating', isIncrease ? 'is-update-up' : 'is-update-down');

    window.setTimeout(() => {
      el.classList.remove('is-updating', 'is-update-up', 'is-update-down');
    }, ANIMATION_MS + 80);
  };

  const applyLoadingPlaceholder = () => {
    figureKeys.forEach((key) => {
      const el = nodes[key];
      if (!el) {
        return;
      }
      const hasDigits = /\d/.test(el.textContent || '');
      if (!hasDigits) {
        el.textContent = '...';
      }
      el.classList.add('is-loading');
    });
  };

  const clearLoadingState = () => {
    figureKeys.forEach((key) => {
      const el = nodes[key];
      if (!el) {
        return;
      }
      el.classList.remove('is-loading');
    });
  };

  const readCache = () => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      const values = normalizePayload({
        clubs_affilies: parsed.clubs,
        licencies: parsed.licenses,
        arbitres_formateurs: parsed.staff,
        source_version: parsed.sourceVersion,
      });

      if (!values) {
        return null;
      }

      const checkedAt = toInt(parsed.checkedAt);
      const etag = typeof parsed.etag === 'string' ? parsed.etag : '';

      return {
        ...values,
        checkedAt: Number.isFinite(checkedAt) ? checkedAt : 0,
        etag,
      };
    } catch (error) {
      return null;
    }
  };

  const writeCache = (snapshot) => {
    if (!snapshot) {
      return;
    }

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          clubs: snapshot.clubs,
          licenses: snapshot.licenses,
          staff: snapshot.staff,
          sourceVersion: snapshot.sourceVersion || '',
          checkedAt: snapshot.checkedAt || Date.now(),
          etag: snapshot.etag || '',
        })
      );
    } catch (error) {
      // Ignore storage issues (private mode, quota, disabled storage, ...).
    }
  };

  const currentValues = {
    clubs: null,
    licenses: null,
    staff: null,
  };

  let cacheSnapshot = readCache();
  let lastCheckedAt = cacheSnapshot ? cacheSnapshot.checkedAt : 0;
  let etag = cacheSnapshot ? cacheSnapshot.etag : '';
  let inFlight = null;

  const applyValues = (values, options = {}) => {
    const shouldAnimate = Boolean(options.animate);

    figureKeys.forEach((key) => {
      const el = nodes[key];
      const nextValue = values[key];
      if (!el || !Number.isFinite(nextValue)) {
        return;
      }

      const previous = currentValues[key];
      const changed = Number.isFinite(previous) && previous !== nextValue;

      if (shouldAnimate && changed) {
        animateValue(el, previous, nextValue);
        triggerUpdateEffect(el, nextValue > previous);
      } else {
        setValue(el, nextValue);
      }

      currentValues[key] = nextValue;
    });

    clearLoadingState();
  };

  const shouldFetchNow = () => {
    if (!cacheSnapshot) {
      return true;
    }
    return Date.now() - lastCheckedAt > STALE_AFTER_MS;
  };

  const markChecked = (nextEtag) => {
    if (!cacheSnapshot) {
      return;
    }

    lastCheckedAt = Date.now();
    cacheSnapshot.checkedAt = lastCheckedAt;
    if (typeof nextEtag === 'string' && nextEtag) {
      cacheSnapshot.etag = nextEtag;
      etag = nextEtag;
    }
    writeCache(cacheSnapshot);
  };

  const fetchLatest = (force) => {
    if (inFlight) {
      return inFlight;
    }

    if (!force && !shouldFetchNow()) {
      return Promise.resolve();
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return Promise.resolve();
    }

    const headers = { Accept: 'application/json' };
    if (etag) {
      headers['If-None-Match'] = etag;
    }

    inFlight = fetch(ENDPOINT, { headers })
      .then((response) => {
        const responseEtag = (response.headers.get('ETag') || '').trim();

        if (response.status === 304) {
          markChecked(responseEtag || etag);
          return null;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json().then((payload) => ({ payload, responseEtag }));
      })
      .then((result) => {
        if (!result) {
          return;
        }

        const values = normalizePayload(result.payload);
        if (!values) {
          return;
        }

        const previousVersion = cacheSnapshot ? cacheSnapshot.sourceVersion || '' : '';
        const nextVersion = values.sourceVersion || '';
        const isRunUpdate = Boolean(cacheSnapshot) && (previousVersion === '' || nextVersion === '' || previousVersion !== nextVersion);

        applyValues(values, { animate: isRunUpdate });

        cacheSnapshot = {
          ...values,
          checkedAt: Date.now(),
          etag: result.responseEtag || etag,
        };

        lastCheckedAt = cacheSnapshot.checkedAt;
        etag = cacheSnapshot.etag;

        writeCache(cacheSnapshot);
      })
      .catch(() => {
        // Keep current values if network/api fails.
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };

  if (cacheSnapshot) {
    applyValues(cacheSnapshot, { animate: false });
  } else {
    applyLoadingPlaceholder();
  }

  fetchLatest(false);

  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      fetchLatest(true);
    }
  }, LIVE_CHECK_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      fetchLatest(false);
    }
  });

  window.addEventListener('online', () => {
    fetchLatest(true);
  });
})();
