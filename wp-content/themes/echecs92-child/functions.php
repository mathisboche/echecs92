<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

function cdje92_contact_form_get_recaptcha_keys() {
    $keys = [
        'site_key'   => defined('CDJE92_RECAPTCHA_SITE_KEY') ? trim(CDJE92_RECAPTCHA_SITE_KEY) : '',
        'secret_key' => defined('CDJE92_RECAPTCHA_SECRET_KEY') ? trim(CDJE92_RECAPTCHA_SECRET_KEY) : '',
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

add_filter('cdje92_contact_form_recaptcha_keys', function ( $keys ) {
    if (! empty($keys['site_key']) && ! empty($keys['secret_key'])) {
        return $keys;
    }

    return [
        'site_key'   => '6LcEiAksAAAAAIv5n_PExZ7e2g2P_UEdU0bo-y2z',
        'secret_key' => '6LcEiAksAAAAABHRrA46QvOx6pcsZISxnf2hq5sz',
    ];
});

add_action('wp_enqueue_scripts', function () {
    $theme_version = wp_get_theme()->get('Version');
    $child_style_path = get_stylesheet_directory() . '/style.css';
    $header_script_path = get_stylesheet_directory() . '/header.js';
    $child_style_version = file_exists($child_style_path) ? filemtime($child_style_path) : $theme_version;
    $header_script_version = file_exists($header_script_path) ? filemtime($header_script_path) : $theme_version;
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
            . 'text-align:center;padding:6px 8px;}';
        wp_add_inline_style('echecs92-child', $debug_css);
    }

    $is_92_map = is_page('carte-des-clubs-92') || is_page_template('page-carte-des-clubs-92.html');
    $is_92_detail = is_page('club-92') || is_page_template('page-club-92.html');
    $is_fr_map = is_page('carte-des-clubs') || is_page_template('page-carte-des-clubs.html');
    $is_fr_detail = is_page('club') || is_page_template('page-club.html');
    $is_fr_listing = is_page('clubs') || is_page_template('page-clubs.html');

    $needs_leaflet = $is_92_map || $is_fr_map || $is_92_detail || $is_fr_detail || $is_fr_listing;
    $needs_markercluster = $is_fr_map || $is_fr_listing;

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

    if ($is_92_map) {
        wp_enqueue_script(
            'echecs92-clubs-map',
            get_stylesheet_directory_uri() . '/assets/js/clubs-map.js',
            ['leaflet'],
            wp_get_theme()->get('Version'),
            true
        );
    }

    if ($is_fr_map || $is_fr_listing) {
        wp_enqueue_script(
            'echecs92-clubs-map-france',
            get_stylesheet_directory_uri() . '/assets/js/clubs-map-france.js',
            $fr_map_deps,
            wp_get_theme()->get('Version'),
            true
        );
    }

    if (cdje92_contact_form_should_enqueue_recaptcha()) {
        wp_enqueue_script(
            'google-recaptcha',
            'https://www.google.com/recaptcha/api.js?hl=fr',
            [],
            null,
            true
        );
    }
}, 20);

add_action('wp_footer', function () {
    if (!isset($_GET['cdje-debug'])) {
        return;
    }

    global $wp_styles;

    $theme = wp_get_theme();
    $stylesheet = $theme->get_stylesheet();
    $template = $theme->get_template();
    $theme_version = $theme->get('Version');

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
    $current_template_id = $GLOBALS['_wp_current_template_id'] ?? 'n/a';
    $current_template_slug = $GLOBALS['_wp_current_template_slug'] ?? 'n/a';
    $child_style_enqueued = wp_style_is('echecs92-child', 'enqueued') ? 'yes' : 'no';
    $child_style_done = wp_style_is('echecs92-child', 'done') ? 'yes' : 'no';

    $output = [];
    $output[] = 'Theme stylesheet: ' . $stylesheet;
    $output[] = 'Theme template: ' . $template;
    $output[] = 'Theme version: ' . $theme_version;
    $output[] = 'Current block template id: ' . $current_template_id;
    $output[] = 'Current block template slug: ' . $current_template_slug;
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
        if (get_option('cdje92_demo_actualites_seeded')) {
            return;
        }

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

        $samples = [
            [
                'title'   => 'Rentrée des clubs du 92',
                'slug'    => 'rentree-des-clubs-du-92',
                'date'    => '2024-09-12 09:00:00',
                'excerpt' => 'Inscriptions ouvertes, créneaux débutants et animations locales.',
                'content' => "Inscriptions ouvertes pour la saison.\n\nCréneaux débutants et animations locales.",
            ],
            [
                'title'   => 'Stage départemental U12',
                'slug'    => 'stage-departemental-u12',
                'date'    => '2024-09-28 09:00:00',
                'excerpt' => "Journée de jeu et d'analyse encadrée.",
                'content' => "Journée de jeu et d'analyse encadrée.\n\nPublic U12, places limitées.",
            ],
            [
                'title'   => 'Tournois rapides du week-end',
                'slug'    => 'tournois-rapides-du-week-end',
                'date'    => '2024-10-05 09:00:00',
                'excerpt' => 'Rendez-vous ouverts à tous les niveaux.',
                'content' => "Rendez-vous ouverts à tous les niveaux.\n\nRenseignements auprès des clubs.",
            ],
            [
                'title'   => 'Championnat par équipes',
                'slug'    => 'championnat-par-equipes',
                'date'    => '2024-10-12 09:00:00',
                'excerpt' => 'Calendrier et groupes publiés.',
                'content' => "Calendrier et groupes publiés.\n\nConsultez les divisions.",
            ],
            [
                'title'   => 'Formation animateurs',
                'slug'    => 'formation-animateurs',
                'date'    => '2024-10-19 09:00:00',
                'excerpt' => "Session d'automne pour bénévoles.",
                'content' => "Session d'automne pour bénévoles.\n\nInscriptions ouvertes.",
            ],
            [
                'title'   => 'Coupe Loubatière',
                'slug'    => 'coupe-loubatiere',
                'date'    => '2024-11-02 09:00:00',
                'excerpt' => 'Inscriptions avant le 25/10.',
                'content' => "Inscriptions avant le 25/10.\n\nRèglement disponible.",
            ],
            [
                'title'   => 'Open du comité',
                'slug'    => 'open-du-comite',
                'date'    => '2024-11-15 09:00:00',
                'excerpt' => 'Infos pratiques et règlement mis à jour.',
                'content' => "Infos pratiques et règlement mis à jour.\n\nTournoi ouvert à tous.",
            ],
            [
                'title'   => 'Arbitrage rapide',
                'slug'    => 'arbitrage-rapide',
                'date'    => '2024-11-23 09:00:00',
                'excerpt' => 'Atelier de mise à niveau pour arbitres.',
                'content' => "Atelier de mise à niveau pour arbitres.\n\nUne demi-journée.",
            ],
            [
                'title'   => 'Noël des jeunes',
                'slug'    => 'noel-des-jeunes',
                'date'    => '2024-12-07 09:00:00',
                'excerpt' => 'Blitz et animations pour les U14.',
                'content' => "Blitz et animations pour les U14.\n\nAmbiance conviviale.",
            ],
            [
                'title'   => 'Assemblée générale',
                'slug'    => 'assemblee-generale',
                'date'    => '2024-12-14 09:00:00',
                'excerpt' => 'Ordre du jour et documents disponibles.',
                'content' => "Ordre du jour et documents disponibles.\n\nParticipation des clubs.",
            ],
            [
                'title'   => 'Calendrier 2025',
                'slug'    => 'calendrier-2025',
                'date'    => '2025-01-04 09:00:00',
                'excerpt' => 'Dates clés des compétitions.',
                'content' => "Dates clés des compétitions.\n\nMise à jour progressive.",
            ],
            [
                'title'   => "Stages d'hiver",
                'slug'    => 'stages-d-hiver',
                'date'    => '2025-01-18 09:00:00',
                'excerpt' => 'Sessions ouvertes à tous.',
                'content' => "Sessions ouvertes à tous.\n\nFormats courts.",
            ],
            [
                'title'   => 'Coupe 92',
                'slug'    => 'coupe-92',
                'date'    => '2025-02-01 09:00:00',
                'excerpt' => 'Tirage et lieux annoncés.',
                'content' => "Tirage et lieux annoncés.\n\nDéplacements organisés.",
            ],
            [
                'title'   => 'Initiation écoles',
                'slug'    => 'initiation-ecoles',
                'date'    => '2025-02-15 09:00:00',
                'excerpt' => 'Nouvelles interventions prévues.',
                'content' => "Nouvelles interventions prévues.\n\nContactez le comité.",
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
            wp_insert_post($post_data);
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

    $messages = [
        'success' => __('Votre message a bien été envoyé. Une réponse  sera apportée sous 48 heures ouvrées.', 'echecs92-child'),
        'error'   => [
            'invalid_nonce' => __('Une erreur est survenue. Merci de réessayer.', 'echecs92-child'),
            'incomplete'    => __('Merci de renseigner les champs obligatoires.', 'echecs92-child'),
            'invalid_email' => __('L’adresse e-mail semble invalide.', 'echecs92-child'),
            'recaptcha_failed' => __('Merci de confirmer que vous n’êtes pas un robot.', 'echecs92-child'),
            'send_failed'   => __('L’envoi a échoué. Merci de réessayer dans quelques instants ou d’utiliser les coordonnées directes.', 'echecs92-child'),
        ],
    ];

    $notice       = '';
    $notice_class = '';
    $recaptcha    = cdje92_contact_form_get_recaptcha_keys();

    if ($status === 'success') {
        $notice       = $messages['success'];
        $notice_class = 'success';
        $prefill_map  = array_fill_keys(array_keys($prefill_map), '');
    } elseif ($status === 'error') {
        $notice       = isset($messages['error'][ $error_code ]) ? $messages['error'][ $error_code ] : __('Votre message n’a pas pu être envoyé. Merci de réessayer.', 'echecs92-child');
        $notice_class = 'error';
    }

    ob_start();
    ?>
    <div class="cdje92-contact-form-wrapper" id="contact-form">
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
                    <div class="contact-form__field contact-form__field--full contact-form__captcha">
                        <div class="g-recaptcha" data-sitekey="<?php echo esc_attr($recaptcha['site_key']); ?>" aria-labelledby="cdje92-contact-captcha-label"></div>
                    </div>
                <?php endif; ?>
            </div>
            <button type="submit" class="contact-form__submit"><?php esc_html_e('Envoyer', 'echecs92-child'); ?></button>
        </form>
    </div>
    <?php

    return ob_get_clean();
}
add_shortcode('cdje92_contact_form', 'cdje92_render_contact_form');

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
    $url .= '#contact-form';
    wp_safe_redirect($url);
    exit;
}

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
            'contact_status' => 'success',
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

    if (cdje92_contact_form_use_recaptcha()) {
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

    $subject = sprintf('[CDJE 92] Message du formulaire – %s', $email);
    $body    = [
        'Email : ' . $email,
        'Club / structure : ' . ($club ?: __('Non renseigné', 'echecs92-child')),
        '',
        'Message :',
        $message,
    ];

    $headers = [
        'Content-Type: text/plain; charset=UTF-8',
        sprintf('Reply-To: %s', $email),
    ];

    $sent = wp_mail($recipients, $subject, implode("\n", $body), $headers);

    if (! $sent) {
        cdje92_contact_form_safe_redirect([
            'contact_status' => 'error',
            'contact_error'  => 'send_failed',
            'contact_email'  => $email,
            'contact_club'   => $club,
            'contact_message'=> $message,
        ]);
    }

    cdje92_contact_form_safe_redirect([
        'contact_status' => 'success',
    ]);
}
add_action('admin_post_cdje92_contact', 'cdje92_handle_contact_form');
add_action('admin_post_nopriv_cdje92_contact', 'cdje92_handle_contact_form');
