<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

function cdje92_contact_form_get_recaptcha_keys() {
    $site_key = defined('CDJE92_RECAPTCHA_SITE_KEY') ? trim(CDJE92_RECAPTCHA_SITE_KEY) : '';
    $secret_key = defined('CDJE92_RECAPTCHA_SECRET_KEY') ? trim(CDJE92_RECAPTCHA_SECRET_KEY) : '';

    if (empty($site_key)) {
        $site_key = trim((string) getenv('CDJE92_RECAPTCHA_SITE_KEY'));
    }
    if (empty($secret_key)) {
        $secret_key = trim((string) getenv('CDJE92_RECAPTCHA_SECRET_KEY'));
    }

    if (empty($site_key) || empty($secret_key)) {
        $secrets_path = WP_CONTENT_DIR . '/.secrets/recaptcha.php';
        if (file_exists($secrets_path)) {
            $secrets = include $secrets_path;
            if (is_array($secrets)) {
                if (empty($site_key) && ! empty($secrets['site_key'])) {
                    $site_key = trim((string) $secrets['site_key']);
                }
                if (empty($secret_key) && ! empty($secrets['secret_key'])) {
                    $secret_key = trim((string) $secrets['secret_key']);
                }
            }
        }
    }
    if (empty($site_key) || empty($secret_key)) {
        $theme_secrets_path = get_stylesheet_directory() . '/config/recaptcha.php';
        if (file_exists($theme_secrets_path)) {
            $secrets = include $theme_secrets_path;
            if (is_array($secrets)) {
                if (empty($site_key) && ! empty($secrets['site_key'])) {
                    $site_key = trim((string) $secrets['site_key']);
                }
                if (empty($secret_key) && ! empty($secrets['secret_key'])) {
                    $secret_key = trim((string) $secrets['secret_key']);
                }
            }
        }
    }

    if (empty($site_key)) {
        $site_key = trim((string) get_option('cdje92_recaptcha_site_key', ''));
    }
    if (empty($secret_key)) {
        $secret_key = trim((string) get_option('cdje92_recaptcha_secret_key', ''));
    }

    $keys = [
        'site_key' => $site_key,
        'secret_key' => $secret_key,
    ];

    return apply_filters('cdje92_contact_form_recaptcha_keys', $keys);
}

function cdje92_contact_form_use_recaptcha() {
    $keys = cdje92_contact_form_get_recaptcha_keys();
    return ! empty($keys['site_key']) && ! empty($keys['secret_key']);
}

function cdje92_contact_form_should_enqueue_recaptcha() {
    if (! cdje92_contact_form_use_recaptcha()) {
        return false;
    }
    return cdje92_contact_form_should_enqueue_assets();
}

function cdje92_contact_form_should_enqueue_assets() {
    if (is_page('contact') || is_page_template('page-contact.html')) {
        return true;
    }

    if (is_singular()) {
        $post = get_post();
        if ($post && has_shortcode($post->post_content, 'cdje92_contact_form')) {
            return true;
        }
    }

    return false;
}

add_action('admin_init', function () {
    register_setting('cdje92_contact_settings', 'cdje92_recaptcha_site_key', [
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => '',
    ]);
    register_setting('cdje92_contact_settings', 'cdje92_recaptcha_secret_key', [
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => '',
    ]);
});

add_action('admin_menu', function () {
    add_options_page(
        __('Contact CDJE 92', 'echecs92-child'),
        __('Contact CDJE 92', 'echecs92-child'),
        'manage_options',
        'cdje92-contact-settings',
        'cdje92_contact_form_render_settings_page'
    );
});

function cdje92_contact_form_render_settings_page() {
    if (! current_user_can('manage_options')) {
        return;
    }

    $site_key = get_option('cdje92_recaptcha_site_key', '');
    $secret_key = get_option('cdje92_recaptcha_secret_key', '');
    $has_constants = (defined('CDJE92_RECAPTCHA_SITE_KEY') && CDJE92_RECAPTCHA_SITE_KEY) ||
        (defined('CDJE92_RECAPTCHA_SECRET_KEY') && CDJE92_RECAPTCHA_SECRET_KEY);
    $has_env = getenv('CDJE92_RECAPTCHA_SITE_KEY') || getenv('CDJE92_RECAPTCHA_SECRET_KEY');
    ?>
    <div class="wrap">
        <h1><?php esc_html_e('Contact CDJE 92', 'echecs92-child'); ?></h1>
        <p><?php esc_html_e('Configurez les cles reCAPTCHA utilisees par le formulaire de contact.', 'echecs92-child'); ?></p>
        <?php if ($has_constants || $has_env) : ?>
            <div class="notice notice-info">
                <p><?php esc_html_e('Des cles reCAPTCHA sont deja definies dans la configuration serveur. Les champs ci-dessous sont utilises seulement si aucune cle n\'est fournie via la configuration.', 'echecs92-child'); ?></p>
            </div>
        <?php endif; ?>
        <form method="post" action="options.php">
            <?php settings_fields('cdje92_contact_settings'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row">
                        <label for="cdje92_recaptcha_site_key"><?php esc_html_e('Cle du site', 'echecs92-child'); ?></label>
                    </th>
                    <td>
                        <input type="text" id="cdje92_recaptcha_site_key" name="cdje92_recaptcha_site_key" value="<?php echo esc_attr($site_key); ?>" class="regular-text" autocomplete="off">
                    </td>
                </tr>
                <tr>
                    <th scope="row">
                        <label for="cdje92_recaptcha_secret_key"><?php esc_html_e('Cle secrete', 'echecs92-child'); ?></label>
                    </th>
                    <td>
                        <input type="password" id="cdje92_recaptcha_secret_key" name="cdje92_recaptcha_secret_key" value="<?php echo esc_attr($secret_key); ?>" class="regular-text" autocomplete="off">
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

add_action('wp_enqueue_scripts', function () {
    $theme_version = wp_get_theme()->get('Version');
    $child_style_path = get_stylesheet_directory() . '/style.css';
    $header_script_path = get_stylesheet_directory() . '/header.js';
    $contact_form_script_path = get_stylesheet_directory() . '/assets/js/contact-form.js';
    $child_style_version = file_exists($child_style_path) ? filemtime($child_style_path) : $theme_version;
    $header_script_version = file_exists($header_script_path) ? filemtime($header_script_path) : $theme_version;
    $contact_form_script_version = file_exists($contact_form_script_path) ? filemtime($contact_form_script_path) : $theme_version;
    $child_style_deps = [
        'twentytwentyfive-style',
        'wp-block-library',
        'wp-block-library-theme',
        'global-styles',
    ];

    // charge le CSS du child
    wp_enqueue_style(
        'echecs92-child',
        get_stylesheet_uri(),
        $child_style_deps,
        $child_style_version
    );

    // charge le JS du header
    wp_enqueue_script(
        'echecs92-header',
        get_stylesheet_directory_uri() . '/header.js',
        [],
        $header_script_version,
        true // charge le script en footer
    );

    if (isset($_GET['cdje-debug'])) {
        $debug_css = 'html{outline:6px solid #0ea5e9 !important;}'
            . 'body::before{content:"CDJE92 THEME DEBUG ACTIVE";position:fixed;top:0;left:0;right:0;'
            . 'z-index:99999;background:#0ea5e9;color:#fff;font:700 12px/1.2 system-ui;'
            . 'text-align:center;padding:6px 8px;}'
            . '.news-simple{outline:2px dashed #22c55e !important;}'
            . '.news-simple-card{outline:2px dashed #f97316 !important;}'
            . '.article-simple,.wp-block-post-content{outline:2px dashed #a855f7 !important;}';
        wp_add_inline_style('echecs92-child', $debug_css);

        $debug_js = <<<'JS'
(() => {
  const run = () => {
    const panel = document.getElementById('cdje92-debug-panel');
    const pre = panel ? panel.querySelector('pre') : null;
    const lines = [];
    const add = (label, value) => lines.push(`${label}: ${value}`);
    const styleOf = (el, prop) => window.getComputedStyle(el).getPropertyValue(prop);

    const newsRoot = document.querySelector('.news-simple');
    add('news-simple found', Boolean(newsRoot));
    const cards = document.querySelectorAll('.news-simple-card');
    add('news-simple-card count', cards.length);

    if (cards.length) {
      const card = cards[0];
      const content = card.querySelector('.news-simple-card__content');
      const title = card.querySelector('.news-simple-card__title');
      const excerpt = card.querySelector('.news-simple-card__excerpt');
      const excerptText = card.querySelector('.news-simple-card__excerpt .wp-block-post-excerpt__excerpt') || excerpt;
      const more = card.querySelector('.news-simple-card__more, .wp-block-read-more, .wp-block-post-excerpt__more-link');

      add('card content found', Boolean(content));
      if (content) {
        add('content display', styleOf(content, 'display'));
        add('content height', styleOf(content, 'height'));
        add('content minHeight', styleOf(content, 'min-height'));
        add('content maxHeight', styleOf(content, 'max-height'));
        add('content overflow', styleOf(content, 'overflow'));
        add('content gap', styleOf(content, 'gap'));
        add('content offsetHeight', content.offsetHeight);
        add('content scrollHeight', content.scrollHeight);
      }

      add('title found', Boolean(title));
      if (title) {
        add('title height', styleOf(title, 'height'));
        add('title lineClamp', styleOf(title, '-webkit-line-clamp'));
      }

      add('excerpt found', Boolean(excerpt));
      if (excerptText) {
        add('excerpt tag', excerptText.tagName);
        add('excerpt height', styleOf(excerptText, 'height'));
        add('excerpt lineClamp', styleOf(excerptText, '-webkit-line-clamp'));
      }

      add('more link found', Boolean(more));
      if (more) {
        add('more tag', more.tagName);
        add('more classes', more.className || '(none)');
      }
    }

    const articleRoot = document.querySelector('.article-simple');
    add('article-simple found', Boolean(articleRoot));
    const postTitle = document.querySelector('.wp-block-post-title');
    add('wp-block-post-title found', Boolean(postTitle));
    const main = document.querySelector('main');
    add('main found', Boolean(main));
    const siteBlocks = document.querySelector('.wp-site-blocks');
    if (siteBlocks) {
      const children = Array.from(siteBlocks.children);
      const childLabels = children.slice(0, 8).map((el) => {
        const tag = el.tagName.toLowerCase();
        const classes = (el.className || '').toString().trim();
        if (!classes) {
          return tag;
        }
        return `${tag}.${classes.split(/\s+/).join('.')}`;
      });
      add('wp-site-blocks child count', children.length);
      add('wp-site-blocks first children', childLabels.join(' | ') || '(none)');
    }
    if (main) {
      add('main classes', main.className || '(none)');
      add('main style attr', main.getAttribute('style') || '(none)');
      add('main maxWidth', styleOf(main, 'max-width'));
      add('main padding', styleOf(main, 'padding'));
      add('main display', styleOf(main, 'display'));
      add('main gap', styleOf(main, 'gap'));
    }
    if (postTitle) {
      add('post title style attr', postTitle.getAttribute('style') || '(none)');
      add('post title font-size', styleOf(postTitle, 'font-size'));
      add('post title margin', styleOf(postTitle, 'margin'));
    }
    const postDate = document.querySelector('.wp-block-post-date');
    if (postDate) {
      add('post date style attr', postDate.getAttribute('style') || '(none)');
      add('post date font-size', styleOf(postDate, 'font-size'));
      add('post date letter-spacing', styleOf(postDate, 'letter-spacing'));
    }
    const postContent = document.querySelector('.wp-block-post-content');
    if (postContent) {
      add('post content style attr', postContent.getAttribute('style') || '(none)');
      add('post content font-size', styleOf(postContent, 'font-size'));
      add('post content line-height', styleOf(postContent, 'line-height'));
      add('post content max-width', styleOf(postContent, 'max-width'));
    }
    const featured = document.querySelector('.wp-block-post-featured-image');
    if (featured) {
      add('featured image style attr', featured.getAttribute('style') || '(none)');
      add('featured image border-radius', styleOf(featured, 'border-radius'));
      add('featured image border', styleOf(featured, 'border'));
    }

    if (pre) {
      pre.textContent += `\n\nDOM debug:\n${lines.join('\n')}`;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
JS;
        wp_add_inline_script('echecs92-header', $debug_js);
    }

    $is_92_map = is_page('carte-des-clubs-92') || is_page_template('page-carte-des-clubs-92.html');
    $is_92_detail = is_page('club-92') || is_page_template('page-club-92.html');
    $is_92_listing = is_page('clubs-92') || is_page_template('page-clubs-92.html');
    $is_fr_map = is_page('carte-des-clubs') || is_page_template('page-carte-des-clubs.html');
    $is_fr_detail = is_page('club') || is_page_template('page-club.html');
    $is_fr_listing = is_page('clubs') || is_page_template('page-clubs.html');

    $needs_leaflet = $is_92_map || $is_fr_map || $is_92_detail || $is_fr_detail || $is_fr_listing || $is_92_listing;
    $needs_markercluster = $is_fr_map || $is_fr_listing || $is_92_map || $is_92_listing;

    if ($needs_leaflet) {
        wp_enqueue_style(
            'leaflet',
            'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
            [],
            '1.9.4'
        );
        wp_enqueue_script(
            'leaflet',
            'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
            [],
            '1.9.4',
            true
        );
    }

    if ($needs_markercluster) {
        wp_enqueue_style(
            'leaflet-markercluster',
            'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
            ['leaflet'],
            '1.5.3'
        );
        wp_enqueue_style(
            'leaflet-markercluster-default',
            'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
            ['leaflet-markercluster'],
            '1.5.3'
        );
        wp_enqueue_script(
            'leaflet-markercluster',
            'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
            ['leaflet'],
            '1.5.3',
            true
        );
    }

    $fr_map_deps = ['leaflet'];
    if ($needs_markercluster) {
        $fr_map_deps[] = 'leaflet-markercluster';
    }

    if ($is_fr_map || $is_fr_listing || $is_92_map || $is_92_listing) {
        wp_enqueue_script(
            'echecs92-clubs-map-france',
            get_stylesheet_directory_uri() . '/assets/js/clubs-map-france.js',
            $fr_map_deps,
            wp_get_theme()->get('Version'),
            true
        );
    }

    if (cdje92_contact_form_should_enqueue_assets()) {
        wp_enqueue_script(
            'echecs92-contact-form',
            get_stylesheet_directory_uri() . '/assets/js/contact-form.js',
            [],
            $contact_form_script_version,
            true
        );
    }
}, 20);

add_filter('template_include', function ($template) {
    $GLOBALS['cdje92_template_include_path'] = $template;
    return $template;
}, 99);

add_action('wp_footer', function () {
    if (!isset($_GET['cdje-debug'])) {
        return;
    }

    global $wp_styles;

    $theme = wp_get_theme();
    $stylesheet = $theme->get_stylesheet();
    $template = $theme->get_template();
    $theme_version = $theme->get('Version');
    $current_template_id = $GLOBALS['_wp_current_template_id'] ?? 'n/a';
    $current_template_slug = $GLOBALS['_wp_current_template_slug'] ?? 'n/a';

    $template_source = 'n/a';
    $template_title = 'n/a';
    $template_theme = 'n/a';
    $template_has_theme_file = 'n/a';
    $template_is_custom = 'n/a';
    if (function_exists('get_block_template') && $current_template_id !== 'n/a') {
        $template_obj = get_block_template($current_template_id, 'wp_template');
        if ($template_obj && ! is_wp_error($template_obj)) {
            $template_source = $template_obj->source ?? ($template_obj->origin ?? 'n/a');
            $template_title = $template_obj->title ?? 'n/a';
            $template_theme = $template_obj->theme ?? 'n/a';
            if (property_exists($template_obj, 'has_theme_file')) {
                $template_has_theme_file = $template_obj->has_theme_file ? 'yes' : 'no';
            }
            if (property_exists($template_obj, 'is_custom')) {
                $template_is_custom = $template_obj->is_custom ? 'yes' : 'no';
            }
        }
    }

    $handles = $wp_styles ? $wp_styles->queue : [];
    $style_lines = [];
    foreach ($handles as $handle) {
        $registered = $wp_styles->registered[$handle] ?? null;
        if (!$registered) {
            $style_lines[] = $handle . ' | (not registered)';
            continue;
        }
        $deps = $registered->deps ? implode(',', $registered->deps) : '-';
        $src = $registered->src ?: '(inline)';
        $ver = $registered->ver ?? '';
        $style_lines[] = $handle . ' | ' . $src . ' | ver=' . $ver . ' | deps=' . $deps;
    }

    $body_classes = implode(' ', get_body_class());
    $post_type = get_post_type() ?: 'n/a';
    $queried_id = (string) get_queried_object_id();
    $is_singular = is_singular() ? 'yes' : 'no';
    $is_actualite = is_singular('actualite') ? 'yes' : 'no';
    $child_style_enqueued = wp_style_is('echecs92-child', 'enqueued') ? 'yes' : 'no';
    $child_style_done = wp_style_is('echecs92-child', 'done') ? 'yes' : 'no';

    $output = [];
    $output[] = 'Theme stylesheet: ' . $stylesheet;
    $output[] = 'Theme template: ' . $template;
    $output[] = 'Theme version: ' . $theme_version;
    $output[] = 'Template include path: ' . ($GLOBALS['cdje92_template_include_path'] ?? 'n/a');
    $output[] = 'Current block template id: ' . $current_template_id;
    $output[] = 'Current block template slug: ' . $current_template_slug;
    $output[] = 'Block template source: ' . $template_source;
    $output[] = 'Block template title: ' . $template_title;
    $output[] = 'Block template theme: ' . $template_theme;
    $output[] = 'Block template has_theme_file: ' . $template_has_theme_file;
    $output[] = 'Block template is_custom: ' . $template_is_custom;
    $output[] = 'Post type: ' . $post_type;
    $output[] = 'Queried id: ' . $queried_id;
    $output[] = 'is_singular: ' . $is_singular;
    $output[] = 'is_singular(actualite): ' . $is_actualite;
    $output[] = 'Child style enqueued: ' . $child_style_enqueued;
    $output[] = 'Child style printed: ' . $child_style_done;
    $output[] = 'Body classes: ' . $body_classes;
    $output[] = '';
    $output[] = 'Styles in queue:';
    $output = array_merge($output, $style_lines);

    $panel = '<div id="cdje92-debug-panel" style="'
        . 'position:fixed;right:12px;bottom:12px;max-width:640px;'
        . 'max-height:70vh;overflow:auto;background:#0b1120;color:#e2e8f0;'
        . 'border:1px solid #334155;border-radius:8px;padding:12px;z-index:99999;';
    $panel .= 'font:12px/1.45 Menlo,Monaco,Consolas,monospace;';
    $panel .= 'box-shadow:0 12px 30px rgba(15,23,42,.35);">';
    $panel .= '<pre style="margin:0;white-space:pre-wrap;">' . esc_html(implode("\n", $output)) . '</pre></div>';

    echo $panel; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}, 100);

add_action('wp_head', function () {
    $uploads_base = content_url('uploads');

    $favicon_svg  = $uploads_base . '/favicon.svg';
    $favicon_ico  = $uploads_base . '/favicon.ico';

    echo "\n";
    printf('<link rel="icon" href="%s" type="image/svg+xml">' . "\n", esc_url($favicon_svg));
    printf('<link rel="icon" href="%s" sizes="any">' . "\n", esc_url($favicon_ico));
    printf('<link rel="alternate icon" href="%s" sizes="48x48" type="image/png">' . "\n", esc_url($uploads_base . '/favicon-48.png'));
    printf('<link rel="apple-touch-icon" href="%s" sizes="180x180">' . "\n", esc_url($uploads_base . '/favicon-180.png'));
    printf('<link rel="icon" href="%s" sizes="192x192" type="image/png">' . "\n", esc_url($uploads_base . '/favicon-192.png'));
    printf('<link rel="icon" href="%s" sizes="512x512" type="image/png">' . "\n", esc_url($uploads_base . '/favicon-512.png'));
});

add_action('init', function () {
    // nouvelles URL pour la France (par défaut) et le 92
    add_rewrite_rule('^clubs-92/?$', 'index.php?pagename=clubs-92', 'top');
    add_rewrite_rule('^clubs/?$', 'index.php?pagename=clubs', 'top');
    add_rewrite_rule('^clubs-france/?$', 'index.php?pagename=clubs', 'top');

    add_rewrite_rule('^carte-des-clubs-92/?$', 'index.php?pagename=carte-des-clubs-92', 'top');
    add_rewrite_rule('^carte-des-clubs/?$', 'index.php?pagename=carte-des-clubs', 'top');
    add_rewrite_rule('^carte-des-clubs-france/?$', 'index.php?pagename=carte-des-clubs', 'top');

    add_rewrite_rule('^club-92/([^/]+)/?$', 'index.php?pagename=club-92&club_commune=$matches[1]', 'top');
    add_rewrite_rule('^club/([^/]+)/?$', 'index.php?pagename=club&club_commune=$matches[1]', 'top');
    add_rewrite_rule('^club-france/([^/]+)/?$', 'index.php?pagename=club&club_commune=$matches[1]', 'top');
});

add_action('template_redirect', function () {
    $request_path = isset($_SERVER['REQUEST_URI']) ? wp_parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) : '';
    $query_string = isset($_SERVER['QUERY_STRING']) && $_SERVER['QUERY_STRING'] ? '?' . $_SERVER['QUERY_STRING'] : '';
    $normalized = '/' . ltrim((string) $request_path, '/');

    if (preg_match('#^/clubs-france/?$#i', $normalized)) {
        wp_redirect(home_url('/clubs/') . $query_string, 301);
        exit;
    }

    if (preg_match('#^/carte-des-clubs-france/?$#i', $normalized)) {
        wp_redirect(home_url('/carte-des-clubs/') . $query_string, 301);
        exit;
    }

    if (preg_match('#^/club-france/([^/]+)/?$#i', $normalized, $matches)) {
        $slug = $matches[1];
        wp_redirect(trailingslashit(home_url('/club/' . $slug)) . $query_string, 301);
        exit;
    }

    if (preg_match('#^/gouvernance/?$#i', $normalized)) {
        wp_redirect(home_url('/comite/gouvernance/') . $query_string, 301);
        exit;
    }
});

add_filter('redirect_canonical', function ($redirect_url, $requested_url) {
    $path = $requested_url ? wp_parse_url($requested_url, PHP_URL_PATH) : '';
    $normalized = '/' . ltrim((string) $path, '/');
    $normalized = preg_replace('#/+#', '/', $normalized);
    $normalized_slash = trailingslashit($normalized);

    $alias_bases = [
        '/clubs/' => true,
        '/clubs-france/' => true,
        '/clubs-92/' => true,
        '/carte-des-clubs/' => true,
        '/carte-des-clubs-france/' => true,
        '/carte-des-clubs-92/' => true,
    ];

    if (isset($alias_bases[$normalized_slash])) {
        return false;
    }

    if (
        preg_match('#^/club-92/[^/]+/?$#i', $normalized) ||
        preg_match('#^/club/[^/]+/?$#i', $normalized) ||
        preg_match('#^/club-france/[^/]+/?$#i', $normalized)
    ) {
        return false;
    }

    return $redirect_url;
}, 10, 2);

if (! function_exists('cdje92_register_actualites_cpt')) {
    function cdje92_register_actualites_cpt() {
        $labels = [
            'name'                  => __('Actualités', 'echecs92-child'),
            'singular_name'         => __('Actualité', 'echecs92-child'),
            'add_new'               => __('Ajouter', 'echecs92-child'),
            'add_new_item'          => __('Ajouter une actualité', 'echecs92-child'),
            'edit_item'             => __('Modifier l’actualité', 'echecs92-child'),
            'new_item'              => __('Nouvelle actualité', 'echecs92-child'),
            'view_item'             => __('Voir l’actualité', 'echecs92-child'),
            'view_items'            => __('Voir les actualités', 'echecs92-child'),
            'search_items'          => __('Rechercher une actualité', 'echecs92-child'),
            'not_found'             => __('Aucune actualité trouvée', 'echecs92-child'),
            'not_found_in_trash'    => __('Aucune actualité dans la corbeille', 'echecs92-child'),
            'all_items'             => __('Toutes les actualités', 'echecs92-child'),
            'archives'              => __('Archives des actualités', 'echecs92-child'),
            'insert_into_item'      => __('Insérer dans l’actualité', 'echecs92-child'),
            'featured_image'        => __('Image mise en avant', 'echecs92-child'),
            'set_featured_image'    => __('Définir l’image mise en avant', 'echecs92-child'),
            'remove_featured_image' => __('Retirer l’image mise en avant', 'echecs92-child'),
            'use_featured_image'    => __('Utiliser comme image mise en avant', 'echecs92-child'),
            'item_updated'          => __('Actualité mise à jour', 'echecs92-child'),
        ];

        $supports = ['title', 'editor', 'excerpt', 'thumbnail', 'author', 'revisions'];

        register_post_type('actualite', [
            'labels'             => $labels,
            'public'             => true,
            'has_archive'        => false,
            'show_in_rest'       => true,
            'rest_base'          => 'actualites',
            'supports'           => $supports,
            'rewrite'            => [
                'slug'       => 'actualite',
                'with_front' => false,
            ],
            'menu_icon'          => 'dashicons-megaphone',
            'menu_position'      => 5,
            'show_in_nav_menus'  => true,
            'capability_type'    => 'post',
            'map_meta_cap'       => true,
            'template'           => [
                ['core/paragraph', ['placeholder' => __('Contenu de votre actualité…', 'echecs92-child')]],
            ],
        ]);
    }
}

add_action('init', 'cdje92_register_actualites_cpt');

if (! function_exists('cdje92_seed_actualites_demo_posts')) {
    function cdje92_seed_actualites_demo_posts() {
        $force_seed = isset($_GET['cdje-seed-actualites']) && current_user_can('manage_options');
        if (! $force_seed && get_option('cdje92_demo_actualites_seeded')) {
            return;
        }

        if (! $force_seed) {
            $existing = get_posts([
                'post_type'              => 'actualite',
                'posts_per_page'         => 1,
                'post_status'            => 'any',
                'fields'                 => 'ids',
                'no_found_rows'          => true,
                'update_post_meta_cache' => false,
                'update_post_term_cache' => false,
            ]);

            if (! empty($existing)) {
                update_option('cdje92_demo_actualites_seeded', 1);
                return;
            }
        }

        $author_id = get_current_user_id();
        if (! $author_id) {
            $admins = get_users([
                'role'   => 'administrator',
                'number' => 1,
                'fields' => 'ids',
            ]);
            if (! empty($admins)) {
                $author_id = (int) $admins[0];
            }
        }

        $placeholder_img = '/wp-content/themes/echecs92-child/assets/img/gouvernance/placeholder.svg';

        $samples = [
            [
                'title'   => 'Rentrée des clubs du 92',
                'slug'    => 'rentree-des-clubs-du-92',
                'date'    => '2024-09-12 09:00:00',
                'excerpt' => 'Inscriptions ouvertes, créneaux débutants et animations locales.',
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>La saison 2024-2025 démarre dans tout le departement. Les clubs du 92 ouvrent leurs portes avec des creneaux debutants, des ateliers de jeu libre et des cours encadres pour tous les ages.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>Pour trouver un club proche de chez vous, consultez la page <a href="/clubs">Clubs</a> et contactez directement l equipe locale. Vous pouvez aussi nous ecrire via la page <a href="/contact">Contact</a>.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Ce qui change cette annee</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul>
  <li>Des creneaux d initiation pour les 6-10 ans.</li>
  <li>Un parcours debutant sur 6 semaines dans 5 clubs.</li>
  <li>Des tournois amicaux un samedi par mois.</li>
</ul>
<!-- /wp:list -->

<!-- wp:paragraph -->
<p><strong>Conseil :</strong> venez avec votre licence si vous en avez deja une, sinon les clubs peuvent vous aider a la creer.</p>
<!-- /wp:paragraph -->
HTML
            ],
            [
                'title'   => 'Stage départemental U12',
                'slug'    => 'stage-departemental-u12',
                'date'    => '2024-09-28 09:00:00',
                'excerpt' => "Journée de jeu et d'analyse encadrée.",
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>Une journee entiere pour progresser en strategie et en fin de partie. Le stage est encadre par des intervenants diplomes, avec des ateliers pratiques et des parties commentees.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Programme de la journee</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul>
  <li>09h30 - 10h30 : themes tactiques simples.</li>
  <li>10h45 - 12h00 : parties commentees.</li>
  <li>14h00 - 15h30 : finales essentielles.</li>
  <li>15h45 - 17h00 : mini tournoi par niveau.</li>
</ul>
<!-- /wp:list -->

<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="{$placeholder_img}" alt="Illustration du stage" /></figure>
<!-- /wp:image -->

<!-- wp:paragraph -->
<p>Places limitees. Inscription par mail via <a href="/contact">Contact</a> avant le 20/09.</p>
<!-- /wp:paragraph -->
HTML
            ],
            [
                'title'   => 'Tournois rapides du week-end',
                'slug'    => 'tournois-rapides-du-week-end',
                'date'    => '2024-10-05 09:00:00',
                'excerpt' => 'Rendez-vous ouverts à tous les niveaux.',
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>Trois tournois rapides sont proposes ce week-end dans le 92. Les evenements sont ouverts a tous les niveaux, avec une ambiance conviviale.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>Retrouvez les lieux et horaires sur la page <a href="/competitions">Competitions</a> ou contactez votre club.</p>
<!-- /wp:paragraph -->
HTML
            ],
            [
                'title'   => 'Championnat par équipes',
                'slug'    => 'championnat-par-equipes',
                'date'    => '2024-10-12 09:00:00',
                'excerpt' => 'Calendrier et groupes publiés.',
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>Le championnat par equipes reprend avec une formule stable et des groupes equilibres. Merci aux clubs d avoir confirme leurs inscriptions dans les delais.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Repartition des groupes</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul>
  <li>Division 1 : 8 equipes.</li>
  <li>Division 2 : 12 equipes en deux poules.</li>
  <li>Division 3 : 16 equipes en quatre poules.</li>
</ul>
<!-- /wp:list -->

<!-- wp:heading {"level":2} -->
<h2>Feuilles de match et resultats</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Les feuilles de match sont disponibles dans l espace <a href="/documents">Documents</a>. Les resultats seront mis a jour chaque lundi matin.</p>
<!-- /wp:paragraph -->
HTML
            ],
            [
                'title'   => 'Formation animateurs',
                'slug'    => 'formation-animateurs',
                'date'    => '2024-10-19 09:00:00',
                'excerpt' => "Session d'automne pour bénévoles.",
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>Session d automne dediee aux benevoles qui souhaitent animer des ateliers en club ou en milieu scolaire. La formation alterne apports theoriques et exercices pratiques.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Objectifs</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul>
  <li>Structurer une seance de 60 minutes.</li>
  <li>Donner des consignes simples et efficaces.</li>
  <li>Adapter le contenu a l age des participants.</li>
</ul>
<!-- /wp:list -->

<!-- wp:paragraph -->
<p>Infos et inscriptions via <a href="/contact">Contact</a>. Places limitees a 20 participants.</p>
<!-- /wp:paragraph -->
HTML
            ],
            [
                'title'   => 'Coupe Loubatière',
                'slug'    => 'coupe-loubatiere',
                'date'    => '2024-11-02 09:00:00',
                'excerpt' => 'Inscriptions avant le 25/10.',
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>Les inscriptions pour la Coupe Loubatiere sont ouvertes jusqu au 25/10. Chaque club peut engager une equipe de 4 joueurs.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>Le reglement est disponible dans la rubrique <a href="/documents">Documents</a>. Merci de verifier l eligibility des joueurs.</p>
<!-- /wp:paragraph -->
HTML
            ],
            [
                'title'   => 'Open du comité',
                'slug'    => 'open-du-comite',
                'date'    => '2024-11-15 09:00:00',
                'excerpt' => 'Infos pratiques et règlement mis à jour.',
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>L Open du Comite revient pour un week-end complet. Tournoi ouvert a tous, avec un classement par categorie et des prix pour les jeunes.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Format et cadence</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>9 rondes, cadence 15+3. Pointage obligatoire 30 minutes avant la premiere ronde.</p>
<!-- /wp:paragraph -->

<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="{$placeholder_img}" alt="Illustration tournoi" /></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":2} -->
<h2>Inscriptions</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul>
  <li>Inscription en ligne via <a href="/contact">Contact</a>.</li>
  <li>Tarif adulte : 15 euros. Tarif jeune : 8 euros.</li>
  <li>Cloture des inscriptions le mercredi precedent.</li>
</ul>
<!-- /wp:list -->
HTML
            ],
            [
                'title'   => 'Arbitrage rapide',
                'slug'    => 'arbitrage-rapide',
                'date'    => '2024-11-23 09:00:00',
                'excerpt' => 'Atelier de mise à niveau pour arbitres.',
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>Atelier de mise a niveau pour arbitres et responsables de tournoi. Une demi-journee pour revoir les points essentiels et les cas particuliers.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Au programme</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul>
  <li>Regles rapides et nouvelles recommandations.</li>
  <li>Gestion des retards et des forfaits.</li>
  <li>Outils numeriques pour l appariement.</li>
</ul>
<!-- /wp:list -->

<!-- wp:paragraph -->
<p>Inscription gratuite, confirmez votre presence via <a href="/contact">Contact</a>.</p>
<!-- /wp:paragraph -->
HTML
            ],
            [
                'title'   => 'Noël des jeunes',
                'slug'    => 'noel-des-jeunes',
                'date'    => '2024-12-07 09:00:00',
                'excerpt' => 'Blitz et animations pour les U14.',
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>Apres-midi festif pour les U14 avec blitz, ateliers tactiques et remise de recompenses. Une collation est prevue sur place.</p>
<!-- /wp:paragraph -->

<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="{$placeholder_img}" alt="Animation jeunes" /></figure>
<!-- /wp:image -->

<!-- wp:list -->
<ul>
  <li>Accueil a 13h30.</li>
  <li>Blitz par groupes de niveau.</li>
  <li>Remise des prix a 17h15.</li>
</ul>
<!-- /wp:list -->
HTML
            ],
            [
                'title'   => 'Assemblée générale',
                'slug'    => 'assemblee-generale',
                'date'    => '2024-12-14 09:00:00',
                'excerpt' => 'Ordre du jour et documents disponibles.',
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>L Assemblee generale annuelle se tiendra le 14/12 a 18h00. Chaque club est invite a etre represente.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Documents</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul>
  <li>Rapport moral.</li>
  <li>Rapport financier.</li>
  <li>Perspectives 2025.</li>
</ul>
<!-- /wp:list -->

<!-- wp:paragraph -->
<p>Les documents preparatoires sont disponibles dans <a href="/documents">Documents</a>.</p>
<!-- /wp:paragraph -->
HTML
            ],
            [
                'title'   => 'Calendrier 2025',
                'slug'    => 'calendrier-2025',
                'date'    => '2025-01-04 09:00:00',
                'excerpt' => 'Dates clés des compétitions.',
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>Le calendrier previsionnel 2025 est en ligne. Il sera mis a jour au fil des inscriptions des clubs.</p>
<!-- /wp:paragraph -->

<!-- wp:list -->
<ul>
  <li>Janvier : stages et arbitrage.</li>
  <li>Fevrier : Coupe 92.</li>
  <li>Mai : finale departementale.</li>
</ul>
<!-- /wp:list -->

<!-- wp:paragraph -->
<p>Version PDF dans <a href="/documents">Documents</a>.</p>
<!-- /wp:paragraph -->
HTML
            ],
            [
                'title'   => "Stages d'hiver",
                'slug'    => 'stages-d-hiver',
                'date'    => '2025-01-18 09:00:00',
                'excerpt' => 'Sessions ouvertes à tous.',
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>Les stages d hiver sont ouverts a tous les niveaux. Chaque session alterne cours theoriques, exercices et parties commentees.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Planning</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul>
  <li>Session 1 : 20 au 22/01 (debutants).</li>
  <li>Session 2 : 27 au 29/01 (intermediaires).</li>
  <li>Session 3 : 03 au 05/02 (perfectionnement).</li>
</ul>
<!-- /wp:list -->

<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="{$placeholder_img}" alt="Stage d'hiver" /></figure>
<!-- /wp:image -->

<!-- wp:paragraph -->
<p>Inscription a la journee possible. Tarifs et horaires disponibles sur demande.</p>
<!-- /wp:paragraph -->
HTML
            ],
            [
                'title'   => 'Coupe 92',
                'slug'    => 'coupe-92',
                'date'    => '2025-02-01 09:00:00',
                'excerpt' => 'Tirage et lieux annoncés.',
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>Le tirage de la Coupe 92 est disponible. Les rencontres se jouent entre le 10 et le 25 fevrier.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Categories</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul>
  <li>Open.</li>
  <li>Jeunes.</li>
  <li>Mixte.</li>
</ul>
<!-- /wp:list -->

<!-- wp:paragraph -->
<p>Les clubs peuvent proposer un regroupement de deplacements. Contactez le comite pour faciliter l organisation.</p>
<!-- /wp:paragraph -->
HTML
            ],
            [
                'title'   => 'Initiation écoles',
                'slug'    => 'initiation-ecoles',
                'date'    => '2025-02-15 09:00:00',
                'excerpt' => 'Nouvelles interventions prévues.',
                'content' => <<<HTML
<!-- wp:paragraph -->
<p>Le CDJE 92 relance les interventions en milieu scolaire avec des formats courts et progressifs. L objectif est de faire decouvrir le jeu d echecs et ses valeurs.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Pour les ecoles</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul>
  <li>Seances de 45 minutes.</li>
  <li>Materiel fourni.</li>
  <li>Suivi pedagogique sur 6 semaines.</li>
</ul>
<!-- /wp:list -->

<!-- wp:paragraph -->
<p>Les etablissements interesses peuvent nous contacter via <a href="/contact">Contact</a>.</p>
<!-- /wp:paragraph -->
HTML
            ],
        ];

        foreach ($samples as $sample) {
            $post_data = [
                'post_type'      => 'actualite',
                'post_status'    => 'publish',
                'post_title'     => $sample['title'],
                'post_name'      => $sample['slug'],
                'post_excerpt'   => $sample['excerpt'],
                'post_content'   => $sample['content'],
                'post_date'      => $sample['date'],
                'post_date_gmt'  => get_gmt_from_date($sample['date']),
                'comment_status' => 'closed',
            ];
            if ($author_id) {
                $post_data['post_author'] = $author_id;
            }
            $existing_post = get_page_by_path($sample['slug'], OBJECT, 'actualite');
            if ($existing_post) {
                $post_data['ID'] = $existing_post->ID;
                $post_id = wp_update_post($post_data);
            } else {
                $post_id = wp_insert_post($post_data);
            }

            if (! is_wp_error($post_id) && $post_id) {
                update_post_meta($post_id, '_cdje92_demo', 1);
            }
        }

        update_option('cdje92_demo_actualites_seeded', 1);
    }
}

add_action('init', 'cdje92_seed_actualites_demo_posts', 11);

add_action('after_switch_theme', function () {
    cdje92_register_actualites_cpt();
    flush_rewrite_rules();
});

add_filter('query_vars', function ($vars) {
    $vars[] = 'club_commune';
    return $vars;
});

add_filter('document_title_parts', function ($title) {
    if (is_page('mathis-boche')) {
        $title['title'] = "Mathis Boche CDJE 92";
    }

    return $title;
});

function cdje92_contact_form_truncate( $value, $length = 200 ) {
    $value = (string) $value;
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $length);
    }
    return substr($value, 0, $length);
}

function cdje92_contact_form_get_request_ip() {
    $keys = ['HTTP_CLIENT_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'];

    foreach ($keys as $key) {
        if (! empty($_SERVER[ $key ])) {
            $ip_list = explode(',', wp_unslash($_SERVER[ $key ]));
            return trim($ip_list[0]);
        }
    }

    return '';
}

function cdje92_contact_form_verify_recaptcha_token( $token ) {
    if (! cdje92_contact_form_use_recaptcha()) {
        return true;
    }

    if (empty($token)) {
        return false;
    }

    $keys     = cdje92_contact_form_get_recaptcha_keys();
    $response = wp_remote_post('https://www.google.com/recaptcha/api/siteverify', [
        'body' => [
            'secret'   => $keys['secret_key'],
            'response' => $token,
            'remoteip' => cdje92_contact_form_get_request_ip(),
        ],
        'timeout' => 10,
    ]);

    if (is_wp_error($response)) {
        return false;
    }

    $body = json_decode(wp_remote_retrieve_body($response), true);

    return (is_array($body) && ! empty($body['success']));
}

function cdje92_render_contact_form() {
    $status      = isset($_GET['contact_status']) ? sanitize_key(wp_unslash($_GET['contact_status'])) : '';
    $error_code  = isset($_GET['contact_error']) ? sanitize_key(wp_unslash($_GET['contact_error'])) : '';
    $prefill_map = [
        'email'   => isset($_GET['contact_email']) ? sanitize_text_field(wp_unslash($_GET['contact_email'])) : '',
        'club'    => isset($_GET['contact_club']) ? sanitize_text_field(wp_unslash($_GET['contact_club'])) : '',
        'message' => isset($_GET['contact_message']) ? sanitize_textarea_field(wp_unslash($_GET['contact_message'])) : '',
    ];
    $success_email = isset($_GET['contact_email']) ? sanitize_email(wp_unslash($_GET['contact_email'])) : '';

    $messages = [
        'error'   => [
            'invalid_nonce' => __('Une erreur est survenue. Merci de réessayer.', 'echecs92-child'),
            'incomplete'    => __('Merci de renseigner les champs obligatoires.', 'echecs92-child'),
            'invalid_email' => __('L’adresse e-mail semble invalide.', 'echecs92-child'),
            'recaptcha_failed' => __('Merci de confirmer que vous n’êtes pas un robot pour envoyer le message.', 'echecs92-child'),
            'recaptcha_unavailable' => __('La vérification anti-robot est indisponible pour le moment. Merci de réessayer plus tard.', 'echecs92-child'),
            'send_failed'   => __('L’envoi a échoué. Merci de réessayer ou d’utiliser les coordonnées directes.', 'echecs92-child'),
        ],
    ];

    $notice       = '';
    $notice_class = '';
    $recaptcha    = cdje92_contact_form_get_recaptcha_keys();
    $success      = ($status === 'success');

    if ($success) {
        $prefill_map  = array_fill_keys(array_keys($prefill_map), '');
    } elseif ($status === 'error') {
        $notice       = isset($messages['error'][ $error_code ]) ? $messages['error'][ $error_code ] : __('Votre message n’a pas pu être envoyé. Merci de réessayer.', 'echecs92-child');
        $notice_class = 'error';
    }

    ob_start();
    ?>
    <div class="cdje92-contact-form-wrapper<?php echo $success ? ' cdje92-contact-form-wrapper--success' : ''; ?>" id="contact-form">
        <?php if ($success) : ?>
            <div class="contact-form__success" role="status" aria-live="polite">
                <h1 class="contact-form__success-title">
                    <?php esc_html_e('Votre message a bien été transmis', 'echecs92-child'); ?>
                    <svg class="contact-form__success-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M5.5 12.5l4 4 9-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    </svg>
                </h1>
                <?php if (! empty($success_email)) : ?>
                    <p class="contact-form__success-note">
                        <?php esc_html_e('Un e-mail de confirmation a été envoyé à', 'echecs92-child'); ?>
                        <strong><?php echo esc_html($success_email); ?></strong>.
                    </p>
                <?php else : ?>
                    <p class="contact-form__success-note"><?php esc_html_e('Un e-mail de confirmation a été envoyé.', 'echecs92-child'); ?></p>
                <?php endif; ?>
                <div class="contact-form__success-actions">
                    <a class="contact-form__success-link" href="<?php echo esc_url(home_url('/')); ?>">
                        <svg class="contact-form__success-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M3.5 11.5L12 4l8.5 7.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
                            <path d="M6.5 10.5V19a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-8.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
                        </svg>
                        <?php esc_html_e('Retour à l’accueil', 'echecs92-child'); ?>
                    </a>
                </div>
            </div>
        <?php else : ?>
            <?php if (! empty($notice)) : ?>
                <div class="contact-form__notice contact-form__notice--<?php echo esc_attr($notice_class); ?>">
                    <?php echo esc_html($notice); ?>
                </div>
            <?php endif; ?>

            <form id="cdje92-contact-form" class="cdje92-contact-form" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post" novalidate>
                <?php wp_nonce_field('cdje92_contact_form', 'cdje92_contact_nonce'); ?>
                <input type="hidden" name="action" value="cdje92_contact">
                <label class="contact-form__hidden" for="cdje92-contact-reference" aria-hidden="true"><?php esc_html_e('Ne pas remplir ce champ', 'echecs92-child'); ?></label>
                <input class="contact-form__hidden" type="text" name="cdje92_reference" id="cdje92-contact-reference" tabindex="-1" autocomplete="off" aria-hidden="true">

                <div class="contact-form__grid">
                    <div class="contact-form__field">
                        <label class="contact-form__label" for="cdje92-contact-email"><?php esc_html_e('Adresse e-mail', 'echecs92-child'); ?><span>*</span></label>
                        <input class="contact-form__input" type="email" id="cdje92-contact-email" name="cdje92_email" required value="<?php echo esc_attr($prefill_map['email']); ?>">
                    </div>
                    <div class="contact-form__field">
                        <label class="contact-form__label" for="cdje92-contact-club"><?php esc_html_e('Club / structure (optionnel)', 'echecs92-child'); ?></label>
                        <input class="contact-form__input" type="text" id="cdje92-contact-club" name="cdje92_club" value="<?php echo esc_attr($prefill_map['club']); ?>">
                    </div>

                    <div class="contact-form__field contact-form__field--full">
                        <label class="contact-form__label" for="cdje92-contact-message"><?php esc_html_e('Message', 'echecs92-child'); ?><span>*</span></label>
                        <textarea class="contact-form__textarea" id="cdje92-contact-message" name="cdje92_message" required><?php echo esc_textarea($prefill_map['message']); ?></textarea>
                    </div>

                    <?php if (cdje92_contact_form_use_recaptcha()) : ?>
                        <div class="contact-form__field contact-form__field--full contact-form__captcha" data-recaptcha-field hidden aria-hidden="true">
                            <p id="cdje92-contact-captcha-label" class="contact-form__label"><?php esc_html_e('Vérification anti-robot', 'echecs92-child'); ?></p>
                            <div class="g-recaptcha" data-sitekey="<?php echo esc_attr($recaptcha['site_key']); ?>" aria-labelledby="cdje92-contact-captcha-label"></div>
                            <p class="contact-form__hint contact-form__captcha-message" data-recaptcha-message aria-live="polite"></p>
                        </div>
                    <?php endif; ?>
                </div>
                <button type="submit" class="contact-form__submit"><?php esc_html_e('Envoyer', 'echecs92-child'); ?></button>
            </form>
        <?php endif; ?>
    </div>
    <?php

    return ob_get_clean();
}
add_shortcode('cdje92_contact_form', 'cdje92_render_contact_form');

add_filter('body_class', function ( $classes ) {
    $status = isset($_GET['contact_status']) ? sanitize_key(wp_unslash($_GET['contact_status'])) : '';
    if ($status === 'success' && (is_page('contact') || is_page_template('page-contact.html'))) {
        $classes[] = 'cdje92-contact-success';
    }
    return $classes;
});

add_filter('render_block', function ( $block_content, $block ) {
    if (
        isset($block['blockName']) &&
        $block['blockName'] === 'core/html' &&
        strpos($block_content, '[cdje92_contact_form') !== false
    ) {
        return do_shortcode($block_content);
    }

    return $block_content;
}, 10, 2);

function cdje92_contact_form_get_redirect_url() {
    $referer = wp_get_referer();
    if ($referer && strpos($referer, '/contact') !== false) {
        return $referer;
    }

    return home_url('/contact/');
}

function cdje92_contact_form_safe_redirect( $args = [] ) {
    $url = add_query_arg($args, cdje92_contact_form_get_redirect_url());
    $anchor = '#contact-form';
    if (isset($args['contact_status']) && $args['contact_status'] === 'success') {
        $anchor = '';
    }
    if ($anchor) {
        $url .= $anchor;
    }
    wp_safe_redirect($url);
    exit;
}

function cdje92_contact_form_embed_logo( $phpmailer ) {
    if (empty($GLOBALS['cdje92_contact_mail_embed_logo']) || ! is_array($GLOBALS['cdje92_contact_mail_embed_logo'])) {
        return;
    }
    $payload = $GLOBALS['cdje92_contact_mail_embed_logo'];
    if (empty($payload['path']) || ! file_exists($payload['path'])) {
        return;
    }

    $cid  = isset($payload['cid']) && $payload['cid'] ? $payload['cid'] : 'cdje92-logo';
    $name = isset($payload['name']) && $payload['name'] ? $payload['name'] : basename($payload['path']);
    $phpmailer->addEmbeddedImage($payload['path'], $cid, $name);
}
add_action('phpmailer_init', 'cdje92_contact_form_embed_logo');

function cdje92_handle_contact_form() {
    if (! isset($_POST['cdje92_contact_nonce']) || ! wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['cdje92_contact_nonce'])), 'cdje92_contact_form')) {
        cdje92_contact_form_safe_redirect([
            'contact_status' => 'error',
            'contact_error'  => 'invalid_nonce',
        ]);
    }

    $honeypot = isset($_POST['cdje92_reference']) ? trim(wp_unslash($_POST['cdje92_reference'])) : '';
    if (! empty($honeypot)) {
        cdje92_contact_form_safe_redirect([
            'contact_status' => 'error',
            'contact_error'  => 'recaptcha_failed',
        ]);
    }

    $email   = isset($_POST['cdje92_email']) ? sanitize_email(wp_unslash($_POST['cdje92_email'])) : '';
    $club    = isset($_POST['cdje92_club']) ? cdje92_contact_form_truncate(sanitize_text_field(wp_unslash($_POST['cdje92_club'])), 160) : '';
    $message = isset($_POST['cdje92_message']) ? cdje92_contact_form_truncate(sanitize_textarea_field(wp_unslash($_POST['cdje92_message'])), 1200) : '';

    if (empty($email) || empty($message)) {
        cdje92_contact_form_safe_redirect([
            'contact_status' => 'error',
            'contact_error'  => 'incomplete',
            'contact_email'  => $email,
            'contact_club'   => $club,
            'contact_message'=> $message,
        ]);
    }

    if (! is_email($email)) {
        cdje92_contact_form_safe_redirect([
            'contact_status' => 'error',
            'contact_error'  => 'invalid_email',
            'contact_email'  => $email,
            'contact_club'   => $club,
            'contact_message'=> $message,
        ]);
    }

    if (! cdje92_contact_form_use_recaptcha()) {
        cdje92_contact_form_safe_redirect([
            'contact_status' => 'error',
            'contact_error'  => 'recaptcha_unavailable',
            'contact_email'  => $email,
            'contact_club'   => $club,
            'contact_message'=> $message,
        ]);
    }

    $token = isset($_POST['g-recaptcha-response']) ? sanitize_text_field(wp_unslash($_POST['g-recaptcha-response'])) : '';
    if (! cdje92_contact_form_verify_recaptcha_token($token)) {
        cdje92_contact_form_safe_redirect([
            'contact_status' => 'error',
            'contact_error'  => 'recaptcha_failed',
            'contact_email'  => $email,
            'contact_club'   => $club,
            'contact_message'=> $message,
        ]);
    }

    $default_recipients = ['contact@echecs92.com'];
    $admin_email        = sanitize_email(get_option('admin_email'));
    if ($admin_email && ! in_array($admin_email, $default_recipients, true)) {
        $default_recipients[] = $admin_email;
    }

    $recipients = apply_filters('cdje92_contact_form_recipients', $default_recipients);
    if (! is_array($recipients)) {
        $recipients = [$recipients];
    }

    $from_email = 'contact@echecs92.com';
    $from_name  = 'CDJE 92';
    $from_header = sprintf('From: %s <%s>', $from_name, $from_email);
    $logo_path = get_stylesheet_directory() . '/assets/cdje92.png';
    $logo_src = esc_url(get_stylesheet_directory_uri() . '/assets/cdje92.png');
    $logo_src_email = $logo_src;
    $logo_cid = 'cdje92-logo';
    $logo_embed = null;
    if (file_exists($logo_path)) {
        $logo_src_email = 'cid:' . $logo_cid;
        $logo_embed = [
            'path' => $logo_path,
            'cid'  => $logo_cid,
            'name' => 'cdje92.png',
        ];
    }
    $message_html = nl2br(esc_html($message));
    $email_attr = esc_attr($email);
    $email_html = esc_html($email);
    $club_value = trim($club);
    $club_row_html = '';
    if ($club_value !== '') {
        $club_row_html = '<p style="margin:0;"><strong>Club / structure :</strong> ' . esc_html($club_value) . '</p>';
    }

    $subject = sprintf('Message du formulaire – %s', $email);
    $body = <<<HTML
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Message reçu - CDJE 92</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f6fb;color:#0f172a;font-family:'Helvetica Neue', Arial, sans-serif;">
    <div style="width:100%;background-color:#f3f6fb;padding:24px 12px;">
      <div style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:14px;padding:28px 28px;border:1px solid #e2e8f0;border-top:4px solid #0b2e4c;">
        <div style="margin:0 0 12px 0;">
          <img src="{$logo_src_email}" alt="CDJE 92 Échecs Hauts-de-Seine" style="height:36px;width:auto;display:block;border:0;outline:none;text-decoration:none;padding:2px 0;">
        </div>
        <h1 style="margin:0 0 14px 0;font-size:20px;line-height:1.3;color:#0f172a;">Nouveau message reçu</h1>
        <div style="margin:0 0 16px 0;padding:16px 18px;border-radius:10px;background-color:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 6px 0;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Message</p>
          <div style="font-size:16px;line-height:1.6;color:#0f172a;">{$message_html}</div>
        </div>
        <div style="font-size:13px;line-height:1.6;color:#475569;">
          <p style="margin:0 0 4px 0;"><strong>Expéditeur :</strong> <a href="mailto:{$email_attr}" style="color:#0b2e4c;text-decoration:none;">{$email_html}</a></p>
          {$club_row_html}
        </div>
      </div>
    </div>
  </body>
</html>
HTML;

    $headers = [
        'Content-Type: text/html; charset=UTF-8',
        sprintf('Reply-To: %s', $email),
        $from_header,
    ];

    if ($logo_embed) {
        $GLOBALS['cdje92_contact_mail_embed_logo'] = $logo_embed;
    }
    $sent = wp_mail($recipients, $subject, $body, $headers);
    if ($logo_embed) {
        unset($GLOBALS['cdje92_contact_mail_embed_logo']);
    }

    if (! $sent) {
        cdje92_contact_form_safe_redirect([
            'contact_status' => 'error',
            'contact_error'  => 'send_failed',
            'contact_email'  => $email,
            'contact_club'   => $club,
            'contact_message'=> $message,
        ]);
    }

    $confirmation_subject = __('Message bien reçu', 'echecs92-child');
    $confirmation_body = <<<HTML
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Message bien reçu - CDJE 92</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f6fb;color:#0f172a;font-family:'Helvetica Neue', Arial, sans-serif;">
    <div style="width:100%;background-color:#f3f6fb;padding:24px 12px;">
      <div style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f0;border-top:4px solid #0b2e4c;">
        <div style="margin:0 0 12px 0;">
          <img src="{$logo_src_email}" alt="CDJE 92 Échecs Hauts-de-Seine" style="height:36px;width:auto;display:block;border:0;outline:none;text-decoration:none;padding:2px 0;">
        </div>
        <h1 style="margin:0 0 12px 0;font-size:24px;line-height:1.25;color:#0f172a;">Votre message a bien été reçu</h1>
        <p style="margin:0 0 20px 0;font-size:16px;line-height:1.6;color:#334155;">
          Merci pour votre confiance. Nous avons bien reçu votre demande et nous reviendrons vers vous dès que possible.
        </p>
        <div style="margin:20px 0 0 0;padding:14px 16px;background-color:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;font-size:13px;line-height:1.6;color:#475569;">
          <p style="margin:0 0 6px 0;font-weight:600;color:#64748b;">Rappel de votre message</p>
          <div>{$message_html}</div>
        </div>
        <p style="margin:18px 0 0 0;font-size:13px;line-height:1.6;color:#64748b;">
          Comité Départemental des Échecs des Hauts-de-Seine<br>
          <a href="mailto:contact@echecs92.com" style="color:#0b2e4c;text-decoration:none;">contact@echecs92.com</a>
        </p>
      </div>
    </div>
  </body>
</html>
HTML;
    $confirmation_headers = [
        'Content-Type: text/html; charset=UTF-8',
        $from_header,
        sprintf('Reply-To: %s', $from_email),
    ];
    if ($logo_embed) {
        $GLOBALS['cdje92_contact_mail_embed_logo'] = $logo_embed;
    }
    wp_mail($email, $confirmation_subject, $confirmation_body, $confirmation_headers);
    if ($logo_embed) {
        unset($GLOBALS['cdje92_contact_mail_embed_logo']);
    }

    cdje92_contact_form_safe_redirect([
        'contact_status' => 'success',
        'contact_email'  => $email,
    ]);
}
add_action('admin_post_cdje92_contact', 'cdje92_handle_contact_form');
add_action('admin_post_nopriv_cdje92_contact', 'cdje92_handle_contact_form');
