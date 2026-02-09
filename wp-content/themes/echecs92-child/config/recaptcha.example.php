<?php
if (!defined('ABSPATH')) {
    exit;
}

return [
    // Copiez ce fichier en `recaptcha.php` puis renseignez vos clés reCAPTCHA.
    //
    // Important:
    // - Le thème utilise reCAPTCHA v2 (case "Je ne suis pas un robot").
    // - En local (localhost), vous pouvez utiliser les clés de test officielles Google.
    //   Ne pas utiliser ces clés en production.
    //   https://developers.google.com/recaptcha/docs/faq
    //
    // 'site_key' => '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI',
    // 'secret_key' => '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe',
    'site_key' => 'YOUR_SITE_KEY',
    'secret_key' => 'YOUR_SECRET_KEY',
];
