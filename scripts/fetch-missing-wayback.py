#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
import time
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse, urlsplit, urlunsplit
from urllib.request import Request, urlopen


WAYBACK_RE = re.compile(r"https://web\.archive\.org/web/\d+(?:[a-z_]+)?/(.+)")

ALLOWED_HOSTS = {
    "www.echecs92.fr",
    "assets.jimstatic.com",
    "u.jimcdn.com",
    "image.jimcdn.com",
    "api.dmp.jimdo-server.com",
    "fonts.jimstatic.com",
    "www.billetweb.fr",
}


def usage() -> None:
    print("Usage: fetch-missing-wayback.py <archive_root> [missing_file] [delay_seconds]", file=sys.stderr)


def normalize_path(path: str) -> str:
    if not path.startswith("/"):
        path = "/" + path
    return path.replace(":", "%3A")


def build_target_path(root: Path, host: str, path: str, query: str) -> Path:
    base = Path(normalize_path(path).lstrip("/"))

    if host != "www.echecs92.fr":
        base = Path(host) / base

    if query:
        suffix = "@" + query.replace("&", "%26")
        if base.suffix:
            return root / base.parent / (base.name + suffix + base.suffix)
        return root / base.parent / (base.name + suffix)

    if path.endswith("/") or not base.suffix:
        return root / base / "index.html"

    return root / base


def load_missing(path: Path) -> Iterable[str]:
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def download(url: str, target: Path, delay: float, retries: int = 3) -> bool:
    normalized_url = normalize_url(url)
    for attempt in range(1, retries + 1):
        try:
            req = Request(normalized_url, headers={"User-Agent": "echecs92-archive/1.0"})
            with urlopen(req, timeout=30) as resp:
                if resp.status >= 400:
                    return False
                target.parent.mkdir(parents=True, exist_ok=True)
                with open(target, "wb") as f:
                    while True:
                        chunk = resp.read(8192)
                        if not chunk:
                            break
                        f.write(chunk)
            if delay:
                time.sleep(delay)
            return True
        except HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(delay + attempt)
                continue
            return False
        except URLError:
            if attempt < retries:
                time.sleep(delay + attempt)
                continue
            return False
    return False


def normalize_url(url: str) -> str:
    parts = urlsplit(url)
    path = quote(parts.path, safe="/:%")
    query = quote(parts.query, safe="=&")
    return urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))


def main() -> int:
    if len(sys.argv) < 2:
        usage()
        return 1

    root = Path(sys.argv[1]).resolve()
    missing_path = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else root / "missing-wayback-urls.txt"
    delay = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5

    if not root.is_dir():
        print(f"Archive root not found: {root}", file=sys.stderr)
        return 1
    if not missing_path.is_file():
        print(f"Missing list not found: {missing_path}", file=sys.stderr)
        return 1

    missing = load_missing(missing_path)
    ok = 0
    skipped = 0
    failed = 0

    for line in missing:
        match = WAYBACK_RE.match(line)
        if not match:
            skipped += 1
            continue

        original = match.group(1)
        parsed = urlparse(original)
        host = parsed.netloc
        if host not in ALLOWED_HOSTS:
            skipped += 1
            continue

        target = build_target_path(root, host, parsed.path or "/", parsed.query)
        if target.exists():
            skipped += 1
            continue

        if download(line, target, delay):
            ok += 1
        else:
            failed += 1

    print(f"Downloaded: {ok}, skipped: {skipped}, failed: {failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
