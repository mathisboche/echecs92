// debug flag
window.echecs92_test = true;

document.addEventListener('DOMContentLoaded', () => {
  const btn   = document.querySelector('.cm-burger');
  const menu  = document.getElementById('cm-mobile-menu');
  const headerWrapper = document.querySelector('header.wp-block-template-part');
  const adminBar = document.getElementById('wpadminbar');

  if (!btn || !menu) {
    console.warn('[header.js] bouton ou menu introuvable');
    return;
  }

  const onCloseTransitionEnd = (e) => {
    if (e.propertyName === 'opacity') {
      menu.setAttribute('hidden', '');
      menu.removeEventListener('transitionend', onCloseTransitionEnd);
    }
  };

  // OUVERTURE : affiche le menu plein écran avec animation
  const openMenu = () => {
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('is-active');
    menu.removeEventListener('transitionend', onCloseTransitionEnd);
    document.body.classList.add('cm-menu-open');

    // 1. on enlève hidden pour que l'élément existe visuellement
    menu.removeAttribute('hidden');

    // 2. forcer un reflow pour que la transition parte bien de opacity:0 / translateY(-8px)
    void menu.offsetWidth;

    // 3. on ajoute la classe qui déclenche l'état visible (opacity:1 / translateY(0))
    menu.classList.add('is-open');
  };

  // FERMETURE : joue l'anim inverse, puis cache complètement
  const closeMenu = () => {
    if (menu.hasAttribute('hidden')) {
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('is-active');
      return;
    }

    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('is-active');
    document.body.classList.remove('cm-menu-open');

    // on retire la classe "is-open" -> revient à opacity:0 / translateY(-8px)
    menu.classList.remove('is-open');

    // quand la transition est finie (sur l'opacité), on remet hidden
    menu.addEventListener('transitionend', onCloseTransitionEnd);
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

  // Effet sticky : élévation légère après quelques pixels de scroll
  if (headerWrapper) {
    const toggleElevation = () => {
      if (window.scrollY > 8) {
        headerWrapper.classList.add('is-elevated');
      } else {
        headerWrapper.classList.remove('is-elevated');
      }
    };

    toggleElevation();
    window.addEventListener('scroll', toggleElevation, { passive: true });
  }

  const getStickyOffset = () => {
    const headerHeight = headerWrapper ? headerWrapper.offsetHeight : 0;
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

  if (window.location.hash) {
    scrollHashTargetIntoView();
  }

  window.addEventListener('hashchange', scrollHashTargetIntoView);
});
