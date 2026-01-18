// debug flag
window.echecs92_test = true;

(function () {
  const OVERLAY_ID = 'clubs-loading-overlay';
  const DEFAULT_LABEL = 'Patientez…';
  const FALLBACK_ICON = '/wp-content/themes/echecs92-child/assets/cdje92.svg';
  const MIN_VISIBLE_MS = 480;
  let overlayEl = null;
  let visibleSince = 0;
  let hideTimer = null;
  let stack = 0;

  const resolveFaviconUrl = () => {
    const selectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel*="icon"]',
      'link[rel="apple-touch-icon"]',
    ];
    for (const selector of selectors) {
      const link = document.querySelector(selector);
      if (link && link.href) {
        return link.href;
      }
    }
    return FALLBACK_ICON;
  };

  const lockPage = (active) => {
    const method = active ? 'add' : 'remove';
    document.documentElement?.classList[method]('clubs-loading-lock');
    document.body?.classList[method]('clubs-loading-lock');
    if (active) {
      const burger = document.querySelector('.cm-burger[aria-expanded="true"]');
      const menu = document.getElementById('cm-mobile-menu');
      if (burger) {
        burger.setAttribute('aria-expanded', 'false');
        burger.classList.remove('is-active');
      }
      if (menu) {
        menu.classList.remove('is-open');
        menu.setAttribute('hidden', '');
        menu.style.top = '';
      }
      document.body?.classList.remove('cm-menu-open');
      document.documentElement?.classList.remove('cm-menu-open');
    }
  };

  const ensureOverlay = () => {
    if (overlayEl) {
      return overlayEl;
    }
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'clubs-loading-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="clubs-loading-overlay__backdrop"></div>
      <div class="clubs-loading-overlay__content" role="status" aria-live="polite">
        <div class="clubs-loading-overlay__spinner">
          <span class="clubs-loading-overlay__ring"></span>
          <img class="clubs-loading-overlay__icon" alt="" loading="lazy" decoding="async" />
        </div>
        <p class="clubs-loading-overlay__label">${DEFAULT_LABEL}</p>
      </div>
    `;
    const icon = overlay.querySelector('.clubs-loading-overlay__icon');
    const faviconUrl = resolveFaviconUrl();
    if (icon && faviconUrl) {
      icon.setAttribute('src', faviconUrl);
    }
    document.body.appendChild(overlay);
    overlayEl = overlay;
    return overlay;
  };

  const setLabel = (label) => {
    const overlay = ensureOverlay();
    if (!overlay) {
      return;
    }
    const labelNode = overlay.querySelector('.clubs-loading-overlay__label');
    if (labelNode) {
      labelNode.textContent = label || DEFAULT_LABEL;
    }
    const icon = overlay.querySelector('.clubs-loading-overlay__icon');
    const faviconUrl = resolveFaviconUrl();
    if (icon && faviconUrl && icon.getAttribute('src') !== faviconUrl) {
      icon.setAttribute('src', faviconUrl);
    }
  };

  const hideOne = () => {
    if (!overlayEl || stack <= 0) {
      stack = 0;
      return;
    }
    stack -= 1;
    if (stack > 0) {
      return;
    }
    const elapsed = Date.now() - visibleSince;
    const delay = Math.max(0, MIN_VISIBLE_MS - elapsed);
    if (hideTimer) {
      clearTimeout(hideTimer);
    }
    hideTimer = setTimeout(() => {
      overlayEl.classList.remove('is-visible');
      overlayEl.setAttribute('aria-hidden', 'true');
      lockPage(false);
      hideTimer = null;
    }, delay);
  };

  const show = (label) => {
    const overlay = ensureOverlay();
    if (!overlay) {
      return () => {};
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (stack === 0) {
      visibleSince = Date.now();
      lockPage(true);
    }
    stack += 1;
    setLabel(label);
    overlay.classList.add('is-visible');
    overlay.setAttribute('aria-hidden', 'false');
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      hideOne();
    };
  };

  const hideAll = () => {
    if (stack <= 0) {
      return;
    }
    stack = 1;
    hideOne();
  };

  window.cdjeSpinner = {
    show,
    hide: hideOne,
    hideAll,
    isActive: () => stack > 0,
  };

  document.addEventListener('cdje:spinner', (event) => {
    const action = event?.detail?.action || '';
    if (action === 'show') {
      const release = show(event.detail?.label);
      if (event.detail) {
        event.detail.release = release;
      }
    } else if (action === 'hide') {
      hideOne();
    } else if (action === 'reset') {
      hideAll();
    }
  });
})();

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
    if (
      path === '/clubs' ||
      path === '/clubs-92' ||
      path === '/carte-des-clubs' ||
      path === '/carte-des-clubs-92' ||
      path === '/creer-un-club'
    ) {
      return true;
    }
    return path.startsWith('/club/') || path.startsWith('/club-92/');
  };
  const isComiteSectionPath = (path) => {
    if (!path) {
      return false;
    }
    if (
      path === '/comite' ||
      path === '/comite/gouvernance' ||
      path === '/comite/presentation' ||
      path === '/comite/documents'
    ) {
      return true;
    }
    return path.startsWith('/comite/');
  };

  const isActualitesSectionPath = (path) => {
    if (!path) {
      return false;
    }
    if (path === '/actualites') {
      return true;
    }
    return path.startsWith('/actualite/');
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
      } else if (!isCurrent && matchGroup === 'actualites' && isActualitesSectionPath(currentPath)) {
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

    // Si on passe en desktop (>960px), on force fermé
    window.matchMedia('(min-width: 960px)').addEventListener('change', (e) => {
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

  const setupHeaderReveal = () => {
    if (!headerWrapper) {
      return;
    }

    const root = document.documentElement;
    const resultsShell = document.getElementById('clubs-results-shell');
    let headerHeight = headerWrapper.offsetHeight;
    const scrollTolerance = 6;
    let ticking = false;
    let isHidden = false;
    let lastWindowScrollY = window.scrollY || document.documentElement?.scrollTop || 0;
    let lastShellScrollY = resultsShell ? resultsShell.scrollTop || 0 : 0;

    const getScrollContext = () => {
      if (resultsShell && document.body && document.body.classList.contains('clubs-results-open')) {
        return 'shell';
      }
      return 'window';
    };

    const getScrollTop = (context) => {
      if (context === 'shell') {
        return resultsShell ? resultsShell.scrollTop || 0 : 0;
      }
      return window.scrollY || document.documentElement?.scrollTop || 0;
    };

    let activeScrollContext = getScrollContext();

    const syncScrollContext = () => {
      const nextContext = getScrollContext();
      if (nextContext !== activeScrollContext) {
        activeScrollContext = nextContext;
        if (nextContext === 'shell') {
          lastShellScrollY = getScrollTop('shell');
        } else {
          lastWindowScrollY = getScrollTop('window');
        }
      }
    };

    const applyHeaderOffset = (hidden) => {
      const offset = hidden ? 0 : headerHeight;
      root.style.setProperty('--cm-header-offset', `${offset}px`);
    };

    const updateHeaderHeight = () => {
      headerHeight = headerWrapper.offsetHeight;
      if (!isHidden) {
        applyHeaderOffset(false);
      }
    };

    const setHidden = (hidden) => {
      headerWrapper.classList.toggle('is-hidden', hidden);
      isHidden = hidden;
      applyHeaderOffset(hidden);
    };

    const updateHeaderVisibility = () => {
      syncScrollContext();
      const context = activeScrollContext || 'window';
      const scrollY = getScrollTop(context);
      const lastScrollY = context === 'shell' ? lastShellScrollY : lastWindowScrollY;
      const delta = scrollY - lastScrollY;

      if (document.documentElement.classList.contains('cm-menu-open')) {
        setHidden(false);
        if (context === 'shell') {
          lastShellScrollY = scrollY;
        } else {
          lastWindowScrollY = scrollY;
        }
        return;
      }

      if (scrollY <= headerHeight) {
        setHidden(false);
        if (context === 'shell') {
          lastShellScrollY = scrollY;
        } else {
          lastWindowScrollY = scrollY;
        }
        return;
      }

      if (delta > scrollTolerance) {
        setHidden(true);
      } else if (delta < -scrollTolerance) {
        setHidden(false);
      }

      if (context === 'shell') {
        lastShellScrollY = scrollY;
      } else {
        lastWindowScrollY = scrollY;
      }
    };

    const onScroll = () => {
      if (ticking) {
        return;
      }
      ticking = true;
      window.requestAnimationFrame(() => {
        updateHeaderVisibility();
        ticking = false;
      });
    };

    setHidden(false);
    window.addEventListener('resize', updateHeaderHeight);
    window.addEventListener('scroll', onScroll, { passive: true });
    if (resultsShell) {
      resultsShell.addEventListener('scroll', onScroll, { passive: true });
      if (document.body && typeof MutationObserver === 'function') {
        const observer = new MutationObserver(() => {
          syncScrollContext();
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      }
    }
  };

  setupHeaderReveal();

  const setupNewsCards = () => {
    const newsRoot = document.querySelector('.news-simple');
    if (!newsRoot) {
      return;
    }

    const getCardLink = (card) =>
      card.querySelector('.news-simple-card__title a, .news-simple-card__more a, a[href]');
    const isInteractive = (target) =>
      target.closest('a, button, input, textarea, select, summary, label');

    newsRoot.querySelectorAll('.news-simple-card').forEach((card) => {
      if (!card.hasAttribute('tabindex')) {
        card.setAttribute('tabindex', '0');
      }
      card.setAttribute('role', 'link');
    });

    newsRoot.addEventListener('click', (event) => {
      const card = event.target.closest('.news-simple-card');
      if (!card || !newsRoot.contains(card) || isInteractive(event.target)) {
        return;
      }
      const link = getCardLink(card);
      if (link && link.href) {
        link.click();
      }
    });

    newsRoot.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      const card = event.target.closest('.news-simple-card');
      if (!card || !newsRoot.contains(card) || event.target !== card) {
        return;
      }
      event.preventDefault();
      const link = getCardLink(card);
      if (link && link.href) {
        link.click();
      }
    });
  };

  setupNewsCards();
});
