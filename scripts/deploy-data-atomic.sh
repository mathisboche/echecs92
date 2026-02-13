#!/usr/bin/env bash
set -euo pipefail

: "${FTP_SERVER:?Missing FTP_SERVER}"
: "${FTP_USERNAME:?Missing FTP_USERNAME}"
: "${FTP_PASSWORD:?Missing FTP_PASSWORD}"

LOCAL_DIR="${1:-wp-content/themes/echecs92-child/assets/data}"
REMOTE_ASSETS_DIR="${2:-/www/wp-content/themes/echecs92-child/assets}"
LIVE_DIR_NAME="${3:-data}"
STAGING_DIR_NAME="${LIVE_DIR_NAME}.__staging"
BACKUP_DIR_NAME="${LIVE_DIR_NAME}.__backup_${GITHUB_RUN_ID:-manual}_${GITHUB_RUN_ATTEMPT:-1}_$(date +%s)"

if [[ ! -d "${LOCAL_DIR}" ]]; then
  echo "Local directory not found: ${LOCAL_DIR}" >&2
  exit 1
fi

if [[ -z "$(find "${LOCAL_DIR}" -mindepth 1 -print -quit)" ]]; then
  echo "Local directory is empty: ${LOCAL_DIR}" >&2
  exit 1
fi

if [[ ! -f "${LOCAL_DIR}/clubs-france.json" ]]; then
  echo "Missing expected file: ${LOCAL_DIR}/clubs-france.json" >&2
  exit 1
fi

echo "→ Uploading generated data to remote staging (${STAGING_DIR_NAME})..."
lftp -u "${FTP_USERNAME}","${FTP_PASSWORD}" "ftp://${FTP_SERVER}:21" <<EOF
set ftp:passive-mode true
set net:max-retries 3
set net:reconnect-interval-base 5
set net:reconnect-interval-max 20
set net:timeout 30
set xfer:use-temp-file true
set cmd:fail-exit true
set cmd:fail-exit false
mkdir "${REMOTE_ASSETS_DIR}"
set cmd:fail-exit true
cd "${REMOTE_ASSETS_DIR}"
set cmd:fail-exit false
rm -rf "${STAGING_DIR_NAME}"
mkdir "${STAGING_DIR_NAME}"
set cmd:fail-exit true
mirror --reverse --verbose --only-newer --parallel=4 "${LOCAL_DIR}/" "${STAGING_DIR_NAME}/"
cls "${STAGING_DIR_NAME}/clubs-france.json"
cls "${LIVE_DIR_NAME}"
mv "${LIVE_DIR_NAME}" "${BACKUP_DIR_NAME}"
mv "${STAGING_DIR_NAME}" "${LIVE_DIR_NAME}"
mv "${BACKUP_DIR_NAME}" "${STAGING_DIR_NAME}"
bye
EOF
echo "→ Atomic swap completed."
