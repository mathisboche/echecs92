<?php
/**
 * Plugin Name: Echecs92 Core
 * Description: Fonctions cœur du Comité des Échecs 92 (clubs, événements, etc.).
 * Author: Comité des Échecs 92
 * Version: 0.1
 */

if (!defined('ABSPATH')) exit;

// ====== CPT CLUBS ======
add_action('init', function () {
    register_post_type('club', [
        'label' => 'Clubs',
        'public' => true,
        'show_in_menu' => true,
        'menu_icon' => 'dashicons-groups',
        'supports' => ['title', 'editor', 'thumbnail'],
        'has_archive' => true,
    ]);
});

// ====== CPT EVENEMENTS ======
add_action('init', function () {
    register_post_type('evenement', [
        'label' => 'Événements',
        'public' => true,
        'show_in_menu' => true,
        'menu_icon' => 'dashicons-calendar',
        'supports' => ['title', 'editor', 'thumbnail'],
        'has_archive' => true,
    ]);
});
