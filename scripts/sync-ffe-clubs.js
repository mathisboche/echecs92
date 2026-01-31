#!/usr/bin/env node
/**
 * Synchronise tous les clubs France depuis le site FFE.
 * - Récupère la liste des comités (départements) depuis Comites.aspx
 * - Pour chaque comité, récupère la liste des clubs et les fiches individuelles
 * - Produit les fichiers `clubs-france` (données complètes) et `clubs-france-ffe` (refs FFE)
 *
 * Notes :
 * - Utilise uniquement les API HTTP publiques du site FFE.
 * - Les slugs sont générés avec la même logique que generate-ffe-templates.js.
 */
const { syncFfeClubs } = require('./ffe-sync/sync');

const LICENSES_ONLY = process.argv.includes('--licenses-only');

syncFfeClubs({ licensesOnly: LICENSES_ONLY }).catch((error) => {
  console.error(error);
  process.exit(1);
});
