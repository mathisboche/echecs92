(() => {
  const MENU_CONTAINER_SELECTOR = '[data-clubs-majors]';
  const MENU_ITEM_SELECTOR = '[data-club-major]';
  const DATA_URL = '/wp-content/themes/echecs92-child/assets/data/clubs.json';
  const STORAGE_KEY = 'echecs92:clubs:majors';

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
    return base || 'club';
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
        result.city = after.replace(/^[,;\\-]+/, '').trim();
      }
    }
    if (!result.city) {
      const parts = result.full
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
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

  const toNumber = (value) => {
    if (value == null || value === '') {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const buildClubSlug = (raw) => {
    const name = raw.nom || raw.name || '';
    const primaryAddress = raw.adresse || raw.address || raw.salle_jeu || raw.salle || '';
    const secondaryAddress = raw.siege || raw.siege_social || raw.address2 || '';
    const addressParts = extractAddressParts(primaryAddress);
    const secondaryParts = extractAddressParts(secondaryAddress);
    const commune = raw.commune || raw.ville || addressParts.city || secondaryParts.city || '';
    const slugSource = commune || name || addressParts.postalCode || secondaryParts.postalCode || primaryAddress || secondaryAddress;
    return slugify(slugSource || name || 'club');
  };

  const pickTopClubs = (payload, limit) => {
    if (!Array.isArray(payload)) {
      return [];
    }
    const withTotals = payload
      .map((raw) => {
        const name = raw && (raw.nom || raw.name);
        if (!name) {
          return null;
        }
        const licenseA = toNumber(raw.licences_a ?? raw.licenses_a ?? raw.license_a) || 0;
        const licenseB = toNumber(raw.licences_b ?? raw.licenses_b ?? raw.license_b) || 0;
        const total = licenseA + licenseB;
        if (!total) {
          return null;
        }
        return {
          name: String(name).trim(),
          slug: buildClubSlug(raw || {}),
          total,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.total - a.total);

    const seen = new Set();
    const deduped = [];
    for (const entry of withTotals) {
      const key = `${entry.slug}|${entry.name}`.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(entry);
      if (deduped.length >= limit) {
        break;
      }
    }
    return deduped;
  };

  const applyMajors = (entries, links) => {
    if (!Array.isArray(entries) || !entries.length || !links.length) {
      return;
    }
    const max = Math.min(entries.length, links.length);
    for (let i = 0; i < max; i += 1) {
      const link = links[i];
      const entry = entries[i];
      if (!link || !entry) {
        continue;
      }
      link.textContent = entry.name;
      link.href = `/club-92/${encodeURIComponent(entry.slug)}/`;
    }
  };

  const readCache = () => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object') {
        return null;
      }
      if (!Array.isArray(payload.items) || typeof payload.ts !== 'number') {
        return null;
      }
      return payload;
    } catch (error) {
      return null;
    }
  };

  const writeCache = (items) => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ts: Date.now(), items: Array.isArray(items) ? items : [] })
      );
    } catch (error) {
      // ignore storage errors
    }
  };

  const initMajorsMenu = () => {
    const container = document.querySelector(MENU_CONTAINER_SELECTOR);
    if (!container) {
      return;
    }
    const links = Array.from(container.querySelectorAll(MENU_ITEM_SELECTOR));
    if (!links.length) {
      return;
    }

    const cached = readCache();
    if (cached && Array.isArray(cached.items)) {
      applyMajors(cached.items, links);
    }

    fetch(DATA_URL, { headers: { Accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        const entries = pickTopClubs(payload, links.length);
        applyMajors(entries, links);
        writeCache(entries);
      })
      .catch(() => {
        // keep static links on failure
      });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMajorsMenu);
  } else {
    initMajorsMenu();
  }
})();
