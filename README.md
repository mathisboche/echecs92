## Contact + reCAPTCHA (formulaire)

Le formulaire de contact du site est fourni par le thème enfant `echecs92-child` via le shortcode:

- `[cdje92_contact_form]`

Il est protégé par **Google reCAPTCHA v2 (case "Je ne suis pas un robot")**. Si reCAPTCHA n'est pas configuré, le formulaire est désactivé.

### 1) Créer des clés reCAPTCHA (Google)

1. Aller dans la console reCAPTCHA (Google).
2. Créer un nouveau site en choisissant **reCAPTCHA v2** (checkbox).
3. Ajouter les domaines autorisés (ex: `echecs92.com`, `www.echecs92.com`).
4. Récupérer:
   - `site key` (clé du site)
   - `secret key` (clé secrète)

### 2) Renseigner les clés dans WordPress (solution la plus simple)

Dans l'admin WordPress:

1. `Réglages` -> `Contact CDJE 92`
2. Renseigner la clé du site + la clé secrète
3. Enregistrer

### 3) Alternative: fichier de secrets (serveur / déploiement)

Le thème sait aussi lire les clés depuis un fichier (non commité):

- `wp-content/.secrets/recaptcha.php`

Format attendu:

```php
<?php
if (!defined('ABSPATH')) { exit; }

return [
  'site_key' => '...',
  'secret_key' => '...',
];
```

Ou via:

- `wp-content/themes/echecs92-child/config/recaptcha.php`

(voir `wp-content/themes/echecs92-child/config/recaptcha.example.php`).

### 3bis) OVH (mutualisé) - approche "déploiement"

Sur un hébergement web mutualisé OVH, l'approche la plus courante est de **définir les clés dans `wp-config.php`**
(ça évite de les stocker en base via l'admin WordPress).

Dans `wp-config.php` (avant la ligne "That's all, stop editing"):

```php
define('CDJE92_RECAPTCHA_SITE_KEY', '...');
define('CDJE92_RECAPTCHA_SECRET_KEY', '...');
```

Snippets prêts à l'emploi dans ce dépôt:

- `deploy/ovh/wp-config.recaptcha.snippet.php`
- `deploy/ovh/htaccess.recaptcha.snippet.conf`

Alternative (si tu préfères des variables d'environnement au niveau Apache): tu peux aussi utiliser `SetEnv`
dans `.htaccess` au niveau de WordPress:

```apacheconf
SetEnv CDJE92_RECAPTCHA_SITE_KEY "..."
SetEnv CDJE92_RECAPTCHA_SECRET_KEY "..."
```

### 4) En local (Docker + localhost)

Si tu testes sur `http://localhost:8080`, reCAPTCHA peut afficher "Invalid domain for site key" si tes clés sont limitées au domaine de prod.

Options:

1. Créer des clés dédiées au local en autorisant `localhost`.
2. Utiliser les **clés de test** Google (reCAPTCHA v2) uniquement en local (voir `wp-content/themes/echecs92-child/config/recaptcha.example.php`).
