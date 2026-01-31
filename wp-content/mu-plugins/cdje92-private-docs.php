<?php
/**
 * Secure access to uploads/documents with signed URLs.
 */
if (!defined('ABSPATH')) {
    exit;
}

const CDJE92_DOCS_SUBDIR = 'documents';
const CDJE92_DOCS_FLUSH_OPTION = 'cdje92_docs_rewrite_flushed';
const CDJE92_DOCS_URL_PREFIX = 'secure-docs';
const CDJE92_DOCS_DEFAULT_TTL = 604800; // 7 days

function cdje92_docs_get_secret() {
    $secret = '';
    if (defined('CDJE92_DOCS_SIGNING_KEY')) {
        $secret = trim((string) CDJE92_DOCS_SIGNING_KEY);
    }
    if (!$secret) {
        $env = getenv('CDJE92_DOCS_SIGNING_KEY');
        $secret = $env ? trim((string) $env) : '';
    }
    if (!$secret) {
        $secrets_path = WP_CONTENT_DIR . '/.secrets/documents.php';
        if (is_readable($secrets_path)) {
            $loaded = include $secrets_path;
            if (is_string($loaded)) {
                $secret = trim($loaded);
            } elseif (is_array($loaded) && isset($loaded['secret'])) {
                $secret = trim((string) $loaded['secret']);
            }
        }
    }
    if (!$secret) {
        foreach (['AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT'] as $salt) {
            if (defined($salt) && constant($salt)) {
                $secret = (string) constant($salt);
                break;
            }
        }
    }
    return $secret;
}

function cdje92_docs_sign($path, $expires) {
    $secret = cdje92_docs_get_secret();
    if (!$secret) {
        return '';
    }
    $payload = $path . '|' . $expires;
    $raw = hash_hmac('sha256', $payload, $secret, true);
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function cdje92_docs_build_url($relative_path, $ttl = CDJE92_DOCS_DEFAULT_TTL) {
    $relative_path = ltrim((string) $relative_path, '/');
    if ($relative_path === '') {
        return '';
    }
    $expires = time() + (int) $ttl;
    $signature = cdje92_docs_sign($relative_path, $expires);
    if (!$signature) {
        return '';
    }
    $encoded = implode('/', array_map('rawurlencode', explode('/', $relative_path)));
    $url = home_url('/' . CDJE92_DOCS_URL_PREFIX . '/' . $encoded);
    return add_query_arg(
        [
            'e' => $expires,
            's' => $signature,
        ],
        $url
    );
}

function cdje92_docs_build_secure_url_from_public($url) {
    $url = (string) $url;
    if ($url === '' || strpos($url, CDJE92_DOCS_URL_PREFIX . '/') !== false) {
        return $url;
    }
    $uploads = wp_upload_dir();
    $base_url = trailingslashit($uploads['baseurl']) . CDJE92_DOCS_SUBDIR . '/';
    if (strpos($url, $base_url) === 0) {
        $relative = substr($url, strlen($base_url));
        $relative = rawurldecode($relative);
        $signed = cdje92_docs_build_url($relative);
        return $signed ?: $url;
    }
    $local_prefix = '/wp-content/uploads/' . CDJE92_DOCS_SUBDIR . '/';
    $pos = strpos($url, $local_prefix);
    if ($pos !== false) {
        $relative = substr($url, $pos + strlen($local_prefix));
        $relative = rawurldecode($relative);
        $signed = cdje92_docs_build_url($relative);
        return $signed ?: $url;
    }
    return $url;
}

function cdje92_docs_filter_content($content) {
    if (is_admin() || !is_string($content) || $content === '') {
        return $content;
    }
    if (!cdje92_docs_get_secret()) {
        return $content;
    }
    $uploads = wp_upload_dir();
    $base_url = trailingslashit($uploads['baseurl']) . CDJE92_DOCS_SUBDIR . '/';
    $patterns = [
        '#(?P<url>' . preg_quote($base_url, '#') . '[^"\'\s>]+)#i',
        '#(?P<url>/wp-content/uploads/' . preg_quote(CDJE92_DOCS_SUBDIR, '#') . '/[^"\'\s>]+)#i',
    ];
    foreach ($patterns as $pattern) {
        $content = preg_replace_callback($pattern, function ($matches) {
            $original = $matches['url'] ?? '';
            return cdje92_docs_build_secure_url_from_public($original);
        }, $content);
    }
    return $content;
}
add_filter('the_content', 'cdje92_docs_filter_content', 20);
add_filter('widget_text', 'cdje92_docs_filter_content', 20);
add_filter('widget_text_content', 'cdje92_docs_filter_content', 20);

function cdje92_docs_register_rewrite() {
    add_rewrite_rule(
        '^' . CDJE92_DOCS_URL_PREFIX . '/(.+)$',
        'index.php?cdje92_doc=$matches[1]',
        'top'
    );
    $flushed = get_option(CDJE92_DOCS_FLUSH_OPTION);
    if (!$flushed) {
        flush_rewrite_rules(false);
        update_option(CDJE92_DOCS_FLUSH_OPTION, 1, true);
    }
}
add_action('init', 'cdje92_docs_register_rewrite');

function cdje92_docs_register_query_vars($vars) {
    $vars[] = 'cdje92_doc';
    return $vars;
}
add_filter('query_vars', 'cdje92_docs_register_query_vars');

function cdje92_docs_handle_download() {
    $doc = get_query_var('cdje92_doc');
    if (!$doc) {
        return;
    }
    $doc = rawurldecode((string) $doc);
    $doc = ltrim($doc, '/');
    if ($doc === '' || strpos($doc, "\0") !== false || preg_match('#(^|/)\.\.(/|$)#', $doc)) {
        status_header(400);
        exit;
    }

    $expires = isset($_GET['e']) ? (int) $_GET['e'] : 0;
    $signature = isset($_GET['s']) ? (string) $_GET['s'] : '';
    if (!$expires || !$signature) {
        status_header(403);
        exit;
    }
    if ($expires + 60 < time()) {
        status_header(403);
        exit;
    }
    $expected = cdje92_docs_sign($doc, $expires);
    if (!$expected || !hash_equals($expected, $signature)) {
        status_header(403);
        exit;
    }

    $uploads = wp_upload_dir();
    $base_dir = trailingslashit($uploads['basedir']) . CDJE92_DOCS_SUBDIR;
    $base_real = realpath($base_dir);
    $file_path = $base_dir . '/' . $doc;
    $file_real = realpath($file_path);
    if (!$file_real || !$base_real || strpos($file_real, $base_real) !== 0) {
        status_header(404);
        exit;
    }
    if (!is_file($file_real) || !is_readable($file_real)) {
        status_header(404);
        exit;
    }

    $filetype = wp_check_filetype($file_real);
    $mime = $filetype['type'] ?: 'application/octet-stream';
    $filename = basename($file_real);

    nocache_headers();
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($file_real));
    header('Content-Disposition: inline; filename="' . $filename . '"');
    header('X-Content-Type-Options: nosniff');
    @set_time_limit(0);
    readfile($file_real);
    exit;
}
add_action('template_redirect', 'cdje92_docs_handle_download');
