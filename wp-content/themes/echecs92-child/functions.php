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
    // charge le CSS du child
    wp_enqueue_style(
        'echecs92-child',
        get_stylesheet_uri(),
        [],
        wp_get_theme()->get('Version')
    );

    // charge le JS du header
    wp_enqueue_script(
        'echecs92-header',
        get_stylesheet_directory_uri() . '/header.js',
        [],
        wp_get_theme()->get('Version'),
        true // charge le script en footer
    );

    $needs_leaflet = (
        is_page('carte-des-clubs') ||
        is_page_template('page-carte-des-clubs.html') ||
        is_page('club') ||
        is_page_template('page-club.html')
    );

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
        wp_enqueue_script(
            'echecs92-clubs-map',
            get_stylesheet_directory_uri() . '/assets/js/clubs-map.js',
            ['leaflet'],
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
});

add_action('init', function () {
    add_rewrite_rule('^club/([^/]+)/?$', 'index.php?pagename=club&club_commune=$matches[1]', 'top');
});

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

add_action('after_switch_theme', function () {
    cdje92_register_actualites_cpt();
    flush_rewrite_rules();
});

add_filter('query_vars', function ($vars) {
    $vars[] = 'club_commune';
    return $vars;
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
        'name'    => isset($_GET['contact_name']) ? sanitize_text_field(wp_unslash($_GET['contact_name'])) : '',
        'email'   => isset($_GET['contact_email']) ? sanitize_text_field(wp_unslash($_GET['contact_email'])) : '',
        'phone'   => isset($_GET['contact_phone']) ? sanitize_text_field(wp_unslash($_GET['contact_phone'])) : '',
        'club'    => isset($_GET['contact_club']) ? sanitize_text_field(wp_unslash($_GET['contact_club'])) : '',
        'message' => isset($_GET['contact_message']) ? sanitize_textarea_field(wp_unslash($_GET['contact_message'])) : '',
    ];

    $messages = [
        'success' => __('Votre message a bien été envoyé. Une réponse vous sera apportée sous 48 heures ouvrées.', 'echecs92-child'),
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
                        <span class="contact-form__label" id="cdje92-contact-captcha-label"><?php esc_html_e('Vérification anti-robot', 'echecs92-child'); ?><span>*</span></span>
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

    $name    = isset($_POST['cdje92_name']) ? cdje92_contact_form_truncate(sanitize_text_field(wp_unslash($_POST['cdje92_name'])), 120) : '';
    $email   = isset($_POST['cdje92_email']) ? sanitize_email(wp_unslash($_POST['cdje92_email'])) : '';
    $phone   = isset($_POST['cdje92_phone']) ? cdje92_contact_form_truncate(sanitize_text_field(wp_unslash($_POST['cdje92_phone'])), 40) : '';
    $club    = isset($_POST['cdje92_club']) ? cdje92_contact_form_truncate(sanitize_text_field(wp_unslash($_POST['cdje92_club'])), 160) : '';
    $message = isset($_POST['cdje92_message']) ? cdje92_contact_form_truncate(sanitize_textarea_field(wp_unslash($_POST['cdje92_message'])), 1200) : '';

    if (empty($name) || empty($email) || empty($message)) {
        cdje92_contact_form_safe_redirect([
            'contact_status' => 'error',
            'contact_error'  => 'incomplete',
            'contact_name'   => $name,
            'contact_email'  => $email,
            'contact_phone'  => $phone,
            'contact_club'   => $club,
            'contact_message'=> $message,
        ]);
    }

    if (! is_email($email)) {
        cdje92_contact_form_safe_redirect([
            'contact_status' => 'error',
            'contact_error'  => 'invalid_email',
            'contact_name'   => $name,
            'contact_email'  => $email,
            'contact_phone'  => $phone,
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
                'contact_name'   => $name,
                'contact_email'  => $email,
                'contact_phone'  => $phone,
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

    $subject = sprintf('[CDJE 92] Message du formulaire – %s', $name);
    $body    = [
        'Nom et prénom : ' . $name,
        'Email : ' . $email,
        'Téléphone : ' . ($phone ?: __('Non renseigné', 'echecs92-child')),
        'Club / structure : ' . ($club ?: __('Non renseigné', 'echecs92-child')),
        '',
        'Message :',
        $message,
    ];

    $headers = [
        'Content-Type: text/plain; charset=UTF-8',
        sprintf('Reply-To: %s <%s>', $name, $email),
    ];

    $sent = wp_mail($recipients, $subject, implode("\n", $body), $headers);

    if (! $sent) {
        cdje92_contact_form_safe_redirect([
            'contact_status' => 'error',
            'contact_error'  => 'send_failed',
            'contact_name'   => $name,
            'contact_email'  => $email,
            'contact_phone'  => $phone,
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
