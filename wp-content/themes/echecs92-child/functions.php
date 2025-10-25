<?php
if (!defined('ABSPATH')) exit;

// Charger le CSS et le JS du thème enfant
add_action('wp_enqueue_scripts', function () {
    // CSS du thème enfant
    wp_enqueue_style(
        'echecs92-child',
        get_stylesheet_uri(),
        [],
        '1.0'
    );

    // JS du header (menu burger)
    wp_enqueue_script(
        'echecs92-header',
        get_stylesheet_directory_uri() . '/header.js',
        [],
        '1.0',
        true
    );
});
