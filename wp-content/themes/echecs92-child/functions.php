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