# Maintenance technique

Ce document s'adresse aux personnes qui maintiennent le site (technique / déploiement).

## Contenu du depot

- `wp-content/` : thèmes, plugins et assets du site (WordPress core n'est pas versionné ici).
- `wp-content/themes/echecs92-child/` : thème enfant (basé sur `twentytwentyfive`).
- `scripts/` : scripts de maintenance (synchronisation et generation de donnees).
- `.github/workflows/` : automatisations (déploiement, synchronisations, sauvegardes).
- `deploy/` : snippets de configuration (OVH, etc.).
- `archive-wayback/` : archive historique (si utile).

## Formulaire de contact (reCAPTCHA)

Le formulaire de contact est fourni par le thème enfant `echecs92-child` via le shortcode :

- `[cdje92_contact_form]`

Il est protégé par **Google reCAPTCHA v2** (case "Je ne suis pas un robot").
Si reCAPTCHA n'est pas configuré, le formulaire est désactivé.

### Configuration des cles

Option 1 (recommandée) : dans l'admin WordPress :

1. `Réglages` -> `Contact CDJE 92`
2. Renseigner la clé du site + la clé secrète
3. Enregistrer

Option 2 : définir les clés côté serveur (pratique sur OVH mutualisé), par exemple dans `wp-config.php` :

```php
define('CDJE92_RECAPTCHA_SITE_KEY', '...');
define('CDJE92_RECAPTCHA_SECRET_KEY', '...');
```

Snippets prets a l'emploi :

- `deploy/ovh/wp-config.recaptcha.snippet.php`
- `deploy/ovh/htaccess.recaptcha.snippet.conf`

Option 3 : fournir un fichier de secrets (non commité) :

- `wp-content/.secrets/recaptcha.php` (ou `wp-content/themes/echecs92-child/config/recaptcha.php`)

Exemple : `wp-content/themes/echecs92-child/config/recaptcha.example.php`.

### En local (Docker + localhost)

Sur `http://localhost:8080`, reCAPTCHA peut refuser des clés limitées au domaine de production.
Utiliser des clés dédiées à `localhost` ou les **clés de test** (voir `wp-content/themes/echecs92-child/config/recaptcha.example.php`).

## Développement local (Docker)

Le dépôt inclut un environnement WordPress + MySQL via `docker-compose.yml` :

```bash
docker compose up
```

Puis ouvrir `http://localhost:8080`.

## Déploiement

Le déploiement du contenu de `wp-content/` est automatisé via GitHub Actions (workflows dans `.github/workflows/`).

### Données FFE (déploiement atomique)

Les workflows de synchro FFE déploient désormais les données via un dossier de staging FTP puis un swap final :

- upload dans `assets/data.__staging`
- bascule atomique vers `assets/data` en fin de run

Ce mécanisme évite les états intermédiaires visibles sur le site pendant la synchronisation.
