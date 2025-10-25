<?php
// Empêche l'accès direct
if (!defined('ABSPATH')) exit;
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>

<header class="cm-header">
    <div class="cm-header-inner">

        <div class="cm-header-left">
            <a class="cm-logo" href="<?php echo esc_url(home_url('/')); ?>">
                <span class="cm-logo-title">Échecs 92</span>
            </a>
        </div>

        <nav class="cm-nav-desktop">
            <a href="<?php echo esc_url(home_url('/')); ?>">Accueil</a>
            <a href="<?php echo esc_url(home_url('/le-comite')); ?>">Le Comité</a>
            <a href="<?php echo esc_url(home_url('/clubs')); ?>">Clubs</a>
            <a href="<?php echo esc_url(home_url('/competitions')); ?>">Compétitions</a>
            <a href="<?php echo esc_url(home_url('/resultats')); ?>">Résultats</a>
            <a href="<?php echo esc_url(home_url('/actualites')); ?>">Actualités</a>
            <a href="<?php echo esc_url(home_url('/contact')); ?>">Contact</a>
        </nav>

        <button class="cm-burger" aria-expanded="false" aria-controls="cm-mobile-menu">
            <span></span>
            <span></span>
            <span></span>
        </button>

    </div>

    <nav id="cm-mobile-menu" class="cm-nav-mobile" hidden>
        <a href="<?php echo esc_url(home_url('/')); ?>">Accueil</a>
        <a href="<?php echo esc_url(home_url('/le-comite')); ?>">Le Comité</a>
        <a href="<?php echo esc_url(home_url('/clubs')); ?>">Clubs</a>
        <a href="<?php echo esc_url(home_url('/competitions')); ?>">Compétitions</a>
        <a href="<?php echo esc_url(home_url('/resultats')); ?>">Résultats</a>
        <a href="<?php echo esc_url(home_url('/actualites')); ?>">Actualités</a>
        <a href="<?php echo esc_url(home_url('/contact')); ?>">Contact</a>
    </nav>
</header>
