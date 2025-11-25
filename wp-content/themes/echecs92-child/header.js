// debug flag
window.echecs92_test = true;

document.addEventListener('DOMContentLoaded', () => {
  const btn   = document.querySelector('.cm-burger');
  const menu  = document.getElementById('cm-mobile-menu');
  const headerWrapper = document.querySelector('header.wp-block-template-part');
  const adminBar = document.getElementById('wpadminbar');
  const desktopNavLinks = document.querySelectorAll('.cm-nav-desktop a[href]');
  const mobileNavLinks = document.querySelectorAll('.cm-mobile-link[href]');
  const desktopSubmenus = document.querySelectorAll('.cm-nav-item[data-submenu]');

  const normalizePath = (value) => {
    try {
      const path = new URL(value, window.location.origin).pathname;
      return path.replace(/\/+$/, '') || '/';
    } catch (error) {
      return '/';
    }
  };

  const isClubsSectionPath = (path) => {
    if (!path) {
      return false;
    }
    if (path === '/clubs' || path === '/carte-des-clubs' || path === '/creer-un-club') {
      return true;
    }
    return path.startsWith('/club/');
  };
  const isComiteSectionPath = (path) => {
    if (!path) {
      return false;
    }
    if (path === '/comite' || path === '/mathis-boche') {
      return true;
    }
    return false;
  };

  const markCurrentLinks = (links) => {
    if (!links.length) {
      return;
    }
    const currentPath = normalizePath(window.location.href);
    links.forEach((link) => {
      const linkPath = normalizePath(link.href);
      const matchGroup = link.dataset.currentGroup || '';
      let isCurrent = linkPath === currentPath;
      if (!isCurrent && matchGroup === 'clubs' && isClubsSectionPath(currentPath)) {
        isCurrent = true;
      } else if (!isCurrent && matchGroup === 'comite' && isComiteSectionPath(currentPath)) {
        isCurrent = true;
      }
      link.classList.toggle('is-current', isCurrent);
    });
  };

  markCurrentLinks(desktopNavLinks);
  markCurrentLinks(mobileNavLinks);

  if (desktopSubmenus.length) {
    desktopSubmenus.forEach((item) => {
      const trigger = item.querySelector('.cm-nav-link');
      if (!trigger) {
        return;
      }

      const setExpanded = (state) => {
        trigger.setAttribute('aria-expanded', state ? 'true' : 'false');
        item.classList.toggle('submenu-open', state);
      };

      item.addEventListener('mouseenter', () => setExpanded(true));
      item.addEventListener('mouseleave', (event) => {
        const next = event.relatedTarget;
        if (next && item.contains(next)) {
          return;
        }
        setExpanded(false);
      });
      item.addEventListener('focusin', () => setExpanded(true));
      item.addEventListener('focusout', (event) => {
        const next = event.relatedTarget;
        if (!next || !item.contains(next)) {
          setExpanded(false);
        }
      });
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setExpanded(false);
          trigger.focus();
        }
      });
    });
  }

  const mobilePanels = menu ? Array.from(menu.querySelectorAll('.cm-mobile-panel')) : [];
  let activeMobilePanel = 'root';

  const updateDrillTriggerState = (panelName, expanded) => {
    if (!menu) {
      return;
    }
    menu.querySelectorAll(`[data-panel-target="${panelName}"].has-children`).forEach((trigger) => {
      trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  };

  const activateMobilePanel = (panelName = 'root') => {
    if (!menu || !mobilePanels.length) {
      return;
    }
    const targetPanel = menu.querySelector(`.cm-mobile-panel[data-panel="${panelName}"]`);
    if (!targetPanel) {
      return;
    }
    const previousPanel = activeMobilePanel;
    mobilePanels.forEach((panel) => {
      panel.classList.toggle('is-active', panel === targetPanel);
    });
    if (previousPanel && previousPanel !== panelName) {
      updateDrillTriggerState(previousPanel, false);
    }
    if (panelName !== 'root') {
      updateDrillTriggerState(panelName, true);
    }
    activeMobilePanel = panelName;
    menu.scrollTop = 0;
  };

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

    menu.querySelectorAll('[data-panel-target]').forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        const targetPanel = trigger.getAttribute('data-panel-target');
        if (!targetPanel) {
          return;
        }
        event.preventDefault();
        activateMobilePanel(targetPanel);
      });
    });

    // OUVERTURE : affiche le menu plein écran
    const openMenu = () => {
      activateMobilePanel('root');
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
      activateMobilePanel('root');
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
    menu.querySelectorAll('a[href]').forEach(a => {
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
