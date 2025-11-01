<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

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
});

add_action('init', function () {
    add_rewrite_rule('^club/([^/]+)/?$', 'index.php?pagename=club&club_commune=$matches[1]', 'top');
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
            'send_failed'   => __('L’envoi a échoué. Merci de réessayer dans quelques instants ou d’utiliser les coordonnées directes.', 'echecs92-child'),
        ],
    ];

    $notice       = '';
    $notice_class = '';

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
                    <label class="contact-form__label" for="cdje92-contact-name"><?php esc_html_e('Nom et prénom', 'echecs92-child'); ?><span>*</span></label>
                    <input class="contact-form__input" type="text" id="cdje92-contact-name" name="cdje92_name" required value="<?php echo esc_attr($prefill_map['name']); ?>">
                </div>

                <div class="contact-form__field">
                    <label class="contact-form__label" for="cdje92-contact-email"><?php esc_html_e('Adresse e-mail', 'echecs92-child'); ?><span>*</span></label>
                    <input class="contact-form__input" type="email" id="cdje92-contact-email" name="cdje92_email" required value="<?php echo esc_attr($prefill_map['email']); ?>">
                </div>

                <div class="contact-form__field">
                    <label class="contact-form__label" for="cdje92-contact-phone"><?php esc_html_e('Téléphone (optionnel)', 'echecs92-child'); ?></label>
                    <input class="contact-form__input" type="text" id="cdje92-contact-phone" name="cdje92_phone" value="<?php echo esc_attr($prefill_map['phone']); ?>">
                </div>

                <div class="contact-form__field">
                    <label class="contact-form__label" for="cdje92-contact-club"><?php esc_html_e('Club / structure (optionnel)', 'echecs92-child'); ?></label>
                    <input class="contact-form__input" type="text" id="cdje92-contact-club" name="cdje92_club" value="<?php echo esc_attr($prefill_map['club']); ?>">
                </div>

                <div class="contact-form__field contact-form__field--full">
                    <label class="contact-form__label" for="cdje92-contact-message"><?php esc_html_e('Message', 'echecs92-child'); ?><span>*</span></label>
                    <textarea class="contact-form__textarea" id="cdje92-contact-message" name="cdje92_message" required><?php echo esc_textarea($prefill_map['message']); ?></textarea>
                    <p class="contact-form__hint"><?php esc_html_e('Merci de préciser l’objet de votre demande (compétitions, clubs, communication, administration…).', 'echecs92-child'); ?></p>
                </div>
            </div>

            <p class="contact-form__legal">
                <?php esc_html_e('Les informations saisies sont utilisées exclusivement pour répondre à votre demande. Elles ne sont ni conservées, ni transmises à des tiers.', 'echecs92-child'); ?>
            </p>

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
