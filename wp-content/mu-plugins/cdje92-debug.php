<?php
if (!defined('ABSPATH')) {
    exit;
}

add_action('template_include', function ($template) {
    $GLOBALS['cdje92_debug_template_path'] = $template;
    return $template;
}, 99);

add_action('wp_enqueue_scripts', function () {
    if (!isset($_GET['cdje-debug']) || !current_user_can('manage_options')) {
        return;
    }

    $css = 'html{outline:6px solid #ef4444;}'
        . 'body::before{content:"CDJE DEBUG CSS ACTIVE";position:fixed;top:0;left:0;right:0;'
        . 'z-index:99999;background:#ef4444;color:#fff;font:700 12px/1.2 system-ui;'
        . 'text-align:center;padding:6px 8px;}';

    if (wp_style_is('echecs92-child', 'enqueued')) {
        wp_add_inline_style('echecs92-child', $css);
        return;
    }

    wp_register_style('cdje92-debug-inline', false);
    wp_enqueue_style('cdje92-debug-inline');
    wp_add_inline_style('cdje92-debug-inline', $css);
}, 99);

add_action('wp_footer', function () {
    if (!isset($_GET['cdje-debug']) || !current_user_can('manage_options')) {
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
    $template_path = $GLOBALS['cdje92_debug_template_path'] ?? 'n/a';
    $current_template_id = $GLOBALS['_wp_current_template_id'] ?? 'n/a';
    $current_template_slug = $GLOBALS['_wp_current_template_slug'] ?? 'n/a';
    $child_style_enqueued = wp_style_is('echecs92-child', 'enqueued') ? 'yes' : 'no';
    $child_style_done = wp_style_is('echecs92-child', 'done') ? 'yes' : 'no';

    $output = [];
    $output[] = 'Theme stylesheet: ' . $stylesheet;
    $output[] = 'Theme template: ' . $template;
    $output[] = 'Theme version: ' . $theme_version;
    $output[] = 'Template path: ' . $template_path;
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
