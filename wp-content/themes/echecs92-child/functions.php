<?php
add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style(
        'echecs92-child',
        get_stylesheet_uri(),
        [],
        '1.0'
    wp_enqueue_script(
        'echecs92-header',
        get_stylesheet_directory_uri() . '/header.js',
        [],
        '1.0',
        true
    );

});