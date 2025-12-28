#!/bin/sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$ROOT"
node scripts/sync-ffe-clubs.js
