#!/usr/bin/env bash
set -euo pipefail

snapshot="${1:-20251009182304}"
out_dir="${2:-archive-wayback}"
archive_domain="${3:-archive.echecs92.com}"

base_url="https://web.archive.org/web/${snapshot}/https://www.echecs92.fr/"

mkdir -p "$out_dir"
if [[ -n "$(ls -A "$out_dir" 2>/dev/null)" ]]; then
  echo "Using existing output directory (resume): $out_dir" >&2
fi

set +e
wget \
  --mirror \
  --page-requisites \
  --adjust-extension \
  --convert-links \
  --continue \
  --restrict-file-names=windows \
  --span-hosts \
  --domains web.archive.org,web-static.archive.org \
  --no-host-directories \
  --cut-dirs=3 \
  --no-parent \
  --wait=1 \
  --random-wait \
  --waitretry=10 \
  --tries=3 \
  --retry-connrefused \
  --retry-on-host-error \
  --retry-on-http-error=429,500,502,503,504 \
  --reject-regex '/save/_embed/' \
  --directory-prefix "$out_dir" \
  "$base_url"
status=$?
set -e

if [[ $status -ne 0 ]]; then
  echo "Warning: wget exited with status $status; continuing with post-processing." >&2
fi

python3 scripts/postprocess-archive.py "$out_dir" "$archive_domain"
