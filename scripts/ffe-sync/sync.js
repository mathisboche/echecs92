const fs = require('node:fs');
const path = require('node:path');

const {
  BASE_URL,
  CLUBS_92_PATH,
  CLUBS_DIR,
  DETAIL_CONCURRENCY,
  EXCLUDED_CLUB_NAME_PATTERNS,
  EXCLUDED_CLUB_REFS,
  FFE_DETAILS_DIR,
  FFE_DIR,
  FFE_MANIFEST_PATH,
  LIST_CONCURRENCY,
  MANIFEST_PATH,
} = require('./config');
const { extractPostalCode, formatCommune, formatCommuneWithPostal } = require('./address');
const { fetchText } = require('./http');
const { buildLicenseLookup, updateLicenseCountsInFile } = require('./licenses');
const { fetchClubLists } = require('./lists');
const { parseClubDetails, parseClubList, parseDepartments } = require('./parsers');
const { ensureUniqueSlugs } = require('./slugs');
const { slugify } = require('./text');
const { limitConcurrency, sleep, writeJson } = require('./util');

const buildClubEntries = (detail, listEntry, dept) => {
  const postalCode = detail.postalCode || extractPostalCode(detail.adresse, detail.siege);
  const commune =
    formatCommuneWithPostal(detail.commune || listEntry.commune || '', postalCode) ||
    formatCommune(listEntry.commune);
  const id = slugify(detail.name || listEntry.name || `${dept.code}-${detail.ref}`);

  const baseEntry = {
    ffe_ref: detail.ref || listEntry.ref,
    nom: detail.name || listEntry.name,
    adresse: detail.adresse || '',
    siege: detail.siege || '',
    salle_jeu: detail.salle_jeu || '',
    telephone: detail.telephone || '',
    fax: detail.fax || '',
    email: detail.email || '',
    site: detail.site || '',
    president: detail.president || '',
    president_email: detail.president_email || '',
    contact: detail.contact || '',
    contact_email: detail.contact_email || '',
    horaires: detail.horaires || '',
    acces_pmr: detail.acces_pmr || '',
    interclubs: detail.interclubs || '',
    interclubs_jeunes: detail.interclubs_jeunes || '',
    interclubs_feminins: detail.interclubs_feminins || '',
    label_federal: detail.label_federal || '',
    licences_a: detail.licences_a,
    licences_b: detail.licences_b,
  };

  const ffeEntry = {
    id,
    name: detail.name || listEntry.name,
    commune: commune || '',
    postalCode: postalCode || '',
    departmentCode: dept.code,
    departmentName: dept.name,
    departmentSlug: dept.slug,
    ref: detail.ref || listEntry.ref,
  };

  return { baseEntry, ffeEntry };
};

const shouldExcludeClub = (detail, listEntry) => {
  const ref = (detail?.ref || listEntry?.ref || '').toString().trim();
  if (ref && EXCLUDED_CLUB_REFS.has(ref)) {
    return true;
  }
  const name = (detail?.name || listEntry?.name || '').toString().trim();
  if (name && EXCLUDED_CLUB_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return true;
  }
  return false;
};

const emptyClubDetails = (ref) => ({
  ref,
  name: '',
  adresse: '',
  siege: '',
  salle_jeu: '',
  telephone: '',
  fax: '',
  email: '',
  site: '',
  president: '',
  president_email: '',
  contact: '',
  contact_email: '',
  horaires: '',
  acces_pmr: '',
  licences_a: null,
  licences_b: null,
  interclubs: '',
  interclubs_jeunes: '',
  interclubs_feminins: '',
  label_federal: '',
  postalCode: '',
  commune: '',
});

const syncFfeClubs = async ({ licensesOnly = false } = {}) => {
  console.log('→ Récupération de la liste des comités...');
  const comitesHtml = await fetchText(`${BASE_URL}/Comites.aspx`);
  const departments = parseDepartments(comitesHtml);
  if (!departments.length) {
    throw new Error('Aucun comité trouvé sur Comites.aspx');
  }
  console.log(`→ ${departments.length} comités trouvés.`);

  fs.mkdirSync(CLUBS_DIR, { recursive: true });
  fs.mkdirSync(FFE_DIR, { recursive: true });

  const deptClubLists = new Map();
  const allRefs = new Map();

  for (const dept of departments) {
    process.stdout.write(`→ Clubs du ${dept.code} ${dept.name}... `);
    try {
      const listHtml = await fetchText(
        `${BASE_URL}/ListeClubs.aspx?Action=CLUBCOMITE&ComiteRef=${encodeURIComponent(dept.code)}`
      );
      const clubs = parseClubList(listHtml);
      deptClubLists.set(dept.code, clubs);
      clubs.forEach((club) => {
        if (!allRefs.has(club.ref)) {
          allRefs.set(club.ref, null);
        }
      });
      console.log(`${clubs.length} club(s)`);
    } catch (error) {
      console.log('erreur', error.message);
      deptClubLists.set(dept.code, []);
    }
    await sleep(120);
  }

  const refs = Array.from(allRefs.keys());
  console.log(`→ Téléchargement des fiches clubs (${refs.length})...`);
  const limiter = limitConcurrency(DETAIL_CONCURRENCY);
  let done = 0;
  await Promise.all(
    refs.map((ref) =>
      limiter(async () => {
        try {
          const html = await fetchText(`${BASE_URL}/FicheClub.aspx?Ref=${encodeURIComponent(ref)}`);
          const detail = parseClubDetails(html, ref);
          allRefs.set(ref, detail);
        } catch (error) {
          allRefs.set(ref, emptyClubDetails(ref));
        } finally {
          done += 1;
          if (done % 50 === 0 || done === refs.length) {
            process.stdout.write(`  ${done}/${refs.length} fiches\r`);
          }
        }
      })
    )
  );
  process.stdout.write('\n');

  const perDeptBase = new Map();
  const perDeptFfe = new Map();
  const allFfeEntries = [];
  const includedRefs = new Map();

  departments.forEach((dept) => {
    const list = deptClubLists.get(dept.code) || [];
    const baseEntries = [];
    const ffeEntries = [];

    list.forEach((entry) => {
      const detail = allRefs.get(entry.ref) || { ref: entry.ref };
      if (shouldExcludeClub(detail, entry)) {
        console.log(`→ Club exclu (${entry.ref}) ${entry.name || detail.name || ''}`.trim());
        return;
      }
      const refKey = detail.ref || entry.ref;
      if (refKey && !includedRefs.has(refKey)) {
        includedRefs.set(refKey, { name: detail.name || entry.name || '' });
      }
      const combined = buildClubEntries(detail, entry, dept);
      baseEntries.push(combined.baseEntry);
      ffeEntries.push(combined.ffeEntry);
      allFfeEntries.push(combined.ffeEntry);
    });

    baseEntries.sort(
      (a, b) =>
        (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }) ||
        (a.adresse || '').localeCompare(b.adresse || '', 'fr', { sensitivity: 'base' })
    );
    ffeEntries.sort(
      (a, b) =>
        (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' }) ||
        (a.commune || '').localeCompare(b.commune || '', 'fr', { sensitivity: 'base' })
    );

    perDeptBase.set(dept.code, baseEntries);
    perDeptFfe.set(dept.code, ffeEntries);
  });

  if (licensesOnly) {
    departments.forEach((dept) => {
      const freshEntries = perDeptBase.get(dept.code) || [];
      const lookup = buildLicenseLookup(freshEntries);
      updateLicenseCountsInFile(path.join(CLUBS_DIR, dept.file), lookup);
    });
    if (perDeptBase.has('92')) {
      const lookup92 = buildLicenseLookup(perDeptBase.get('92') || []);
      updateLicenseCountsInFile(CLUBS_92_PATH, lookup92);
    }
    console.log('→ Mise à jour des licences terminée.');
    return;
  }

  ensureUniqueSlugs(allFfeEntries);

  if (includedRefs.size) {
    console.log(
      '→ Téléchargement des listes FFE (membres, arbitrage, animation, entrainement, initiation)...'
    );
    fs.mkdirSync(FFE_DETAILS_DIR, { recursive: true });
    const clubsToFetch = Array.from(includedRefs.entries()).map(([ref, meta]) => ({
      ref,
      name: meta?.name || '',
    }));
    const limiterLists = limitConcurrency(LIST_CONCURRENCY);
    const errors = [];
    let doneLists = 0;

    await Promise.all(
      clubsToFetch.map((entry) =>
        limiterLists(async () => {
          const payload = await fetchClubLists(entry.ref, entry.name, errors);
          if (payload) {
            const filePath = path.join(FFE_DETAILS_DIR, `${payload.ref}.json`);
            writeJson(filePath, payload);
          }
          doneLists += 1;
          if (doneLists % 25 === 0 || doneLists === clubsToFetch.length) {
            process.stdout.write(`  ${doneLists}/${clubsToFetch.length} clubs traités\r`);
          }
        })
      )
    );
    process.stdout.write('\n');
    if (errors.length) {
      console.log('--- FFE lists issues summary ---');
      errors.slice(0, 20).forEach((item) => {
        const label = item.name ? `${item.name} (${item.ref})` : item.ref;
        console.log(`- ${label} | ${item.details.join('; ')}`);
      });
      if (errors.length > 20) {
        console.log(`… ${errors.length - 20} autres erreurs`);
      }
      console.log('--- End FFE lists issues summary ---');
    }
  }

  departments.forEach((dept) => {
    const baseEntries = perDeptBase.get(dept.code) || [];
    const ffeEntries = perDeptFfe.get(dept.code) || [];
    writeJson(path.join(CLUBS_DIR, dept.file), baseEntries);
    writeJson(
      path.join(FFE_DIR, dept.file),
      ffeEntries.map((entry) => ({
        slug: entry.slug,
        name: entry.name,
        commune: entry.commune,
        postalCode: entry.postalCode,
        ref: entry.ref,
      }))
    );
  });

  const manifestPayload = {
    version: 1,
    updated: new Date().toISOString(),
    basePath: '/wp-content/themes/echecs92-child/assets/data/clubs-france/',
    departments: departments.map((dept) => ({
      code: dept.code,
      name: dept.name,
      slug: dept.slug,
      file: dept.file,
      count: (perDeptBase.get(dept.code) || []).length,
    })),
  };
  writeJson(MANIFEST_PATH, manifestPayload);

  const ffeManifestPayload = {
    version: 1,
    updated: new Date().toISOString(),
    basePath: '/wp-content/themes/echecs92-child/assets/data/clubs-france-ffe/',
    departments: departments.map((dept) => ({
      code: dept.code,
      name: dept.name,
      slug: dept.slug,
      file: dept.file,
      count: (perDeptFfe.get(dept.code) || []).length,
    })),
  };
  writeJson(FFE_MANIFEST_PATH, ffeManifestPayload);

  console.log('→ Synchronisation terminée.');
};

module.exports = {
  syncFfeClubs,
};

