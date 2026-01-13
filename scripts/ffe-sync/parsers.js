const { extractCityFromAddress, extractPostalCode, tidyAddress } = require('./address');
const { cleanText, decodeHtml, slugify } = require('./text');

const parseDepartments = (html) => {
  const entries = [];
  const regex = /<area[^>]*href=FicheComite\.aspx\?Ref=([^ >"']+)[^>]*alt=([^>]+)>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const code = match[1].trim();
    const name = cleanText(match[2]);
    if (!code || !name) {
      continue;
    }
    entries.push({
      code,
      name,
      slug: slugify(name),
      file: `${code}.json`,
    });
  }
  const seen = new Set();
  const deduped = entries.filter((entry) => {
    const key = `${entry.code}|${entry.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) =>
    a.code.localeCompare(b.code, 'fr', { numeric: true, sensitivity: 'base' })
  );
  return deduped;
};

const parseClubList = (html) => {
  const clubs = [];
  const regex =
    /<td[^>]*align=center[^>]*>\s*([\dA-Z]{2,3})\s*<\/td>\s*<td[^>]*align=left[^>]*>([^<]*)<\/td>\s*<td[^>]*align=left[^>]*><a[^>]*href="FicheClub\.aspx\?Ref=(\d{2,})"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const dept = cleanText(match[1]);
    const commune = cleanText(match[2]);
    const ref = (match[3] || '').trim();
    const name = cleanText(match[4]);
    if (!ref || !name) {
      continue;
    }
    clubs.push({ ref, name, commune, dept });
  }
  return clubs;
};

const extractSpan = (html, id) => {
  const regex = new RegExp(`<span[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/span>`, 'i');
  const match = html.match(regex);
  return match ? match[1] : '';
};

const extractLinkHref = (value) => {
  if (!value) {
    return '';
  }
  const hrefMatch = value.match(/href\s*=\s*"?([^"\s>]+)"?/i);
  return hrefMatch ? hrefMatch[1] : '';
};

const extractEmail = (value) => {
  const raw = value || '';
  const mailMatch = raw.match(/mailto:([^"\s>]+)/i);
  if (mailMatch) {
    return mailMatch[1];
  }
  const text = cleanText(raw);
  const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return emailMatch ? emailMatch[0] : '';
};

const parseLicences = (value) => {
  const result = { a: null, b: null };
  if (!value) {
    return result;
  }
  const aMatch = value.match(/Licences\s*A\s*:\s*<b>(\d+)/i);
  const bMatch = value.match(/Licences\s*B\s*:\s*<b>(\d+)/i);
  result.a = aMatch ? Number.parseInt(aMatch[1], 10) : null;
  result.b = bMatch ? Number.parseInt(bMatch[1], 10) : null;
  return result;
};

const parseClubDetails = (html, ref) => {
  const name = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelNom'));
  const siege = tidyAddress(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelAdresse'));
  const salle = tidyAddress(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelSalle'));
  const telephone = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelTel'));
  const fax = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelFax'));
  const email = extractEmail(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelEMail'));
  const siteRaw = extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelURL');
  const siteHref = extractLinkHref(siteRaw);
  const site =
    siteHref && /^https?:/i.test(siteHref) ? siteHref : cleanText(siteRaw).replace(/\s+/g, '');
  const presidentRaw = extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelPresident');
  const president = cleanText(presidentRaw);
  const presidentEmail = extractEmail(presidentRaw);
  const contactRaw = extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelCorrespondant');
  const contact = cleanText(contactRaw);
  const contactEmail = extractEmail(contactRaw);
  const horaires = cleanText(
    extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelOuverture').replace(
      /<br\s*\/?\s*>/gi,
      '; '
    )
  );
  const accesPmr = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelHandicape'));
  const licencesRaw = extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelAffilies');
  const licences = parseLicences(licencesRaw);
  const interclubs = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelDivisionAdulte'));
  const interclubsJeunes = cleanText(
    extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelDivisionJeune')
  );
  const interclubsFeminins = cleanText(
    extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelDivisionFeminines')
  );
  const labelFederal = cleanText(extractSpan(html, 'ctl00_ContentPlaceHolderMain_LabelLabel'));

  const primaryAddress = salle || siege;
  const postalCode = extractPostalCode(primaryAddress, siege);
  const city = extractCityFromAddress(primaryAddress) || extractCityFromAddress(siege);

  return {
    ref,
    name,
    adresse: primaryAddress,
    siege,
    salle_jeu: salle,
    telephone,
    fax,
    email,
    site,
    president,
    president_email: presidentEmail,
    contact,
    contact_email: contactEmail,
    horaires,
    acces_pmr: accesPmr,
    licences_a: licences.a,
    licences_b: licences.b,
    interclubs,
    interclubs_jeunes: interclubsJeunes,
    interclubs_feminins: interclubsFeminins,
    label_federal: labelFederal,
    postalCode,
    commune: city,
  };
};

const extractHiddenFields = (html) => {
  const fields = {};
  const regex = /<input[^>]+type=["']?hidden["']?[^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const input = match[0];
    const nameMatch = input.match(/name=["']?([^"' >]+)/i);
    if (!nameMatch) {
      continue;
    }
    const valueMatch = input.match(/value=["']?([^"']*)/i);
    fields[nameMatch[1]] = decodeHtml(valueMatch ? valueMatch[1] : '');
  }
  return fields;
};

const extractPagerInfo = (html) => {
  const regex = /__doPostBack\('([^']+)',\s*'([^']+)'\)/g;
  let eventTarget = '';
  const pages = new Set();
  let match;
  while ((match = regex.exec(html)) !== null) {
    const target = match[1];
    const arg = match[2];
    if (!/Pager/i.test(target)) {
      continue;
    }
    if (!eventTarget) {
      eventTarget = target;
    }
    if (/^\d+$/.test(arg)) {
      pages.add(Number.parseInt(arg, 10));
    }
  }
  const maxPage = pages.size ? Math.max(...pages) : 1;
  return { eventTarget, maxPage };
};

module.exports = {
  extractHiddenFields,
  extractPagerInfo,
  extractEmail,
  parseClubDetails,
  parseClubList,
  parseDepartments,
};

