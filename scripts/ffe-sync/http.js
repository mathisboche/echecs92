const { FETCH_TIMEOUT_MS, HEADERS } = require('./config');
const { sleep } = require('./util');

const fetchText = async (url, options = {}, retries = 3) => {
  let requestOptions = options;
  let attempts = retries;
  if (typeof options === 'number') {
    requestOptions = {};
    attempts = options;
  }
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const headers = { ...HEADERS, ...(requestOptions.headers || {}) };
      const res = await fetch(url, { ...requestOptions, headers, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error(`Failed to fetch ${url}`);
};

module.exports = {
  fetchText,
};

