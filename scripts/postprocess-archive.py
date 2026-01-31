#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse


WAYBACK_BLOCK_RE = re.compile(
    r"<script[^>]+bundle-playback\.js[^>]*></script>.*?<!-- End Wayback Rewrite JS Include -->",
    re.IGNORECASE | re.DOTALL,
)

WAYBACK_URL_RE = re.compile(
    r"https://web\.archive\.org/web/\d+(?:[a-z_]+)?/(https?://[^\"'\s<>]+)",
    re.IGNORECASE,
)
WAYBACK_MAILTO_RE = re.compile(
    r"https://web\.archive\.org/web/\d+(?:[a-z_]+)?/(mailto:[^\"'\s<>]+)",
    re.IGNORECASE,
)
WAYBACK_TEL_RE = re.compile(
    r"https://web\.archive\.org/web/\d+(?:[a-z_]+)?/(tel:[^\"'\s<>]+)",
    re.IGNORECASE,
)

ROBOTS_META_RE = re.compile(
    r"<meta\s+name=[\"']robots[\"'][^>]*>",
    re.IGNORECASE,
)
GOOGLEBOT_META_RE = re.compile(
    r"<meta\s+name=[\"']googlebot[\"'][^>]*>",
    re.IGNORECASE,
)
CANONICAL_RE = re.compile(
    r"<link\s+rel=[\"']canonical[\"'][^>]*>",
    re.IGNORECASE,
)
OG_URL_RE = re.compile(
    r"<meta\s+property=[\"']og:url[\"'][^>]*>",
    re.IGNORECASE,
)


def usage() -> None:
    print("Usage: postprocess-archive.py <archive_root> <archive_domain>", file=sys.stderr)


def promote_site_root(root: Path) -> Path:
    site_dir = root / "www.echecs92.fr"
    if not site_dir.is_dir():
        return root

    for entry in site_dir.iterdir():
        target = root / entry.name
        if target.exists():
            if entry.is_dir() and target.is_dir():
                for sub in entry.iterdir():
                    sub_target = target / sub.name
                    if sub_target.exists():
                        continue
                    sub.rename(sub_target)
            continue
        entry.rename(target)

    try:
        site_dir.rmdir()
    except OSError:
        pass

    return root


def canonical_url(domain: str, html_path: Path, root: Path) -> str:
    rel = html_path.relative_to(root).as_posix()
    if rel.endswith("index.html"):
        rel_dir = rel[: -len("index.html")].rstrip("/")
        if rel_dir:
            return f"https://{domain}/{rel_dir}/"
        return f"https://{domain}/"
    return f"https://{domain}/{rel}"


def inject_meta(html: str, domain: str, html_path: Path, root: Path) -> str:
    html = ROBOTS_META_RE.sub("", html)
    html = GOOGLEBOT_META_RE.sub("", html)
    html = CANONICAL_RE.sub("", html)
    html = OG_URL_RE.sub("", html)

    canonical = canonical_url(domain, html_path, root)
    injection = (
        '<meta name="robots" content="noindex, nofollow">\n'
        '<meta name="googlebot" content="noindex, nofollow">\n'
        f'<link rel="canonical" href="{canonical}">\n'
        f'<meta property="og:url" content="{canonical}">\n'
    )

    return re.sub(r"(<head[^>]*>)", r"\1\n" + injection, html, count=1, flags=re.IGNORECASE)


def normalize_path(path: str) -> str:
    if not path.startswith("/"):
        path = "/" + path
    path = unquote(path)
    return path.replace(":", "%3A")


def resolve_local_url(root: Path, host: str, path: str, query: str) -> str | None:
    if host == "www.echecs92.fr":
        base = Path(normalize_path(path).lstrip("/"))
        base_root = root
    else:
        host_dir = root / host
        if not host_dir.is_dir():
            return None
        base = Path(host) / normalize_path(path).lstrip("/")
        base_root = root

    candidates: list[Path] = []
    query_suffix = ""
    if query:
        query_suffix = "@" + query.replace("&", "%26")
        candidates.append(base.parent / (base.name + query_suffix))
        if base.suffix:
            candidates.append(base.parent / (base.name + query_suffix + base.suffix))

    candidates.append(base)

    if path.endswith("/"):
        candidates.append(base / "index.html")
    elif not base.suffix:
        candidates.append(base / "index.html")

    for candidate in candidates:
        if (base_root / candidate).is_file():
            return "/" + candidate.as_posix()

    return None


def replace_wayback_urls(
    html: str,
    root: Path,
    missing_urls: set[str],
) -> str:
    def repl(match: re.Match) -> str:
        original = match.group(1)
        parsed = urlparse(original)
        host = parsed.netloc
        path = parsed.path or "/"
        local_url = resolve_local_url(root, host, path, parsed.query)
        if local_url:
            return local_url
        missing_urls.add(match.group(0))
        return match.group(0)

    html = WAYBACK_URL_RE.sub(repl, html)
    html = WAYBACK_MAILTO_RE.sub(lambda m: m.group(1), html)
    html = WAYBACK_TEL_RE.sub(lambda m: m.group(1), html)
    return html


def process_html(html_path: Path, root: Path, domain: str, missing_urls: set[str]) -> None:
    text = html_path.read_text(encoding="utf-8", errors="ignore")
    text = WAYBACK_BLOCK_RE.sub("", text)
    text = replace_wayback_urls(text, root, missing_urls)
    text = inject_meta(text, domain, html_path, root)
    html_path.write_text(text, encoding="utf-8")


def write_robots(root: Path) -> None:
    robots_path = root / "robots.txt"
    robots_path.write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")


def main() -> int:
    if len(sys.argv) != 3:
        usage()
        return 1

    root = Path(sys.argv[1]).resolve()
    domain = sys.argv[2].strip()
    if not domain:
        print("Archive domain must not be empty.", file=sys.stderr)
        return 1

    target_root = promote_site_root(root)
    if not target_root.exists():
        print(f"Archive root not found: {target_root}", file=sys.stderr)
        return 1

    missing_urls: set[str] = set()
    for html_path in target_root.rglob("*.html"):
        process_html(html_path, target_root, domain, missing_urls)

    write_robots(target_root)

    if missing_urls:
        report_path = target_root / "missing-wayback-urls.txt"
        report_path.write_text("\n".join(sorted(missing_urls)) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
