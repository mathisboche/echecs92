// debug flag
window.echecs92_test = true;

document.addEventListener('DOMContentLoaded', () => {
  const btn   = document.querySelector('.cm-burger');
  const menu  = document.getElementById('cm-mobile-menu');
  const headerWrapper = document.querySelector('header.wp-block-template-part');
  const adminBar = document.getElementById('wpadminbar');
  const desktopNavLinks = document.querySelectorAll('.cm-nav-desktop a[href]');

  const normalizePath = (value) => {
    try {
      const path = new URL(value, window.location.origin).pathname;
      return path.replace(/\/+$/, '') || '/';
    } catch (error) {
      return '/';
    }
  };

  if (desktopNavLinks.length) {
    const currentPath = normalizePath(window.location.href);
    desktopNavLinks.forEach((link) => {
      const linkPath = normalizePath(link.href);
      if (linkPath === currentPath) {
        link.classList.add('is-current');
      } else {
        link.classList.remove('is-current');
      }
    });
  }

  const getHeaderMenuOffset = () => {
    if (!headerWrapper) {
      return 0;
    }
    const rect = headerWrapper.getBoundingClientRect();
    return Math.max(rect.bottom, 0);
  };

  if (!btn || !menu) {
    console.warn('[header.js] bouton ou menu introuvable');
  } else {
    const updateMenuOffset = () => {
      const offsetTop = getHeaderMenuOffset();
      menu.style.top = `${offsetTop}px`;
    };

    // OUVERTURE : affiche le menu plein écran
    const openMenu = () => {
      updateMenuOffset();
      btn.setAttribute('aria-expanded', 'true');
      btn.classList.add('is-active');
      document.body.classList.add('cm-menu-open');
      document.documentElement.classList.add('cm-menu-open');

      // 1. on enlève hidden pour que l'élément existe visuellement
      menu.removeAttribute('hidden');

      // 2. on ajoute la classe qui déclenche l'état visible
      menu.classList.add('is-open');
    };

    // FERMETURE : cache immédiatement
    const closeMenu = () => {
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('is-active');
      document.body.classList.remove('cm-menu-open');
      document.documentElement.classList.remove('cm-menu-open');

      menu.classList.remove('is-open');
      menu.setAttribute('hidden', '');
      menu.style.top = '';
    };

    // Toggle au clic sur le burger
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    // Fermer au clic sur un lien du menu mobile
    document.querySelectorAll('.cm-nav-mobile a').forEach(a => {
      a.addEventListener('click', closeMenu);
    });

    // Fermer avec Échap
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeMenu();
      }
    });

    // Si on passe en desktop (>900px), on force fermé
    window.matchMedia('(min-width: 900px)').addEventListener('change', (e) => {
      if (e.matches) {
        closeMenu();
      }
    });

    window.addEventListener('resize', () => {
      if (menu.classList.contains('is-open')) {
        updateMenuOffset();
      }
    });
  }

  const isHeaderPinned = () => {
    if (!headerWrapper) {
      return false;
    }
    const position = window.getComputedStyle(headerWrapper).position;
    return position === 'fixed' || position === 'sticky';
  };

  const getStickyOffset = () => {
    const headerHeight = headerWrapper && isHeaderPinned() ? headerWrapper.offsetHeight : 0;
    const adminBarHeight = adminBar ? adminBar.offsetHeight : 0;
    return headerHeight + adminBarHeight + 12;
  };

  const scrollHashTargetIntoView = () => {
    const { hash } = window.location;
    if (!hash || hash.length <= 1) {
      return;
    }

    let targetId;
    try {
      targetId = decodeURIComponent(hash.slice(1));
    } catch (error) {
      return;
    }

    const target = document.getElementById(targetId);
    if (!target) {
      return;
    }

    requestAnimationFrame(() => {
      const targetPosition = target.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: Math.max(targetPosition - getStickyOffset(), 0),
        behavior: 'auto',
      });
    });
  };

  const ensureHashVisibility = () => {
    if (!window.location.hash) {
      return;
    }
    scrollHashTargetIntoView();
    requestAnimationFrame(scrollHashTargetIntoView);
  };

  if (window.location.hash) {
    ensureHashVisibility();
  }

  window.addEventListener('load', ensureHashVisibility);
  window.addEventListener('hashchange', ensureHashVisibility);
});
