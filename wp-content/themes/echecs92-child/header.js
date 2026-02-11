// debug flag
window.echecs92_test = true;

(function () {
  const OVERLAY_ID = 'clubs-loading-overlay';
  const DEFAULT_LABEL = 'Patientez…';
  const FALLBACK_ICON = '/wp-content/themes/echecs92-child/assets/cdje92.svg';
  const MIN_VISIBLE_MS = 250;
  const SHOW_DELAY_MS = 200;
  let overlayEl = null;
  let overlayHost = null;
  let visibleSince = 0;
  let showTimer = null;
  let hideTimer = null;
  let stack = 0;
  let scrollLockCount = 0;
  let scrollLockActive = false;
  let pinCount = 0;
  let pinActive = false;
  let pinListenerAttached = false;

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

  const resolveElement = (value) => {
    if (!value) {
      return null;
    }
    if (value instanceof Element) {
      return value;
    }
    if (typeof value === 'string') {
      return document.querySelector(value);
    }
    if (typeof value === 'function') {
      try {
        return resolveElement(value());
      } catch (error) {
        return null;
      }
    }
    return null;
  };

  const resolveOverlayHost = (options = {}) => {
    if (typeof document === 'undefined') {
      return null;
    }
    const requested =
      resolveElement(options.host) || resolveElement(options.container) || resolveElement(options.scope);
    if (requested) {
      return requested === document.documentElement ? document.body : requested;
    }
    const clubsPage = document.querySelector('.clubs-page');
    return clubsPage || document.body;
  };

  const updateScrollbarCompensation = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    if (!root) {
      return;
    }
    const scrollbarWidth = (window.innerWidth || 0) - (root.clientWidth || 0);
    if (Number.isFinite(scrollbarWidth) && scrollbarWidth > 0) {
      root.style.setProperty('--cdje-scrollbar-width', `${Math.round(scrollbarWidth)}px`);
    } else {
      root.style.removeProperty('--cdje-scrollbar-width');
    }
  };

  const setScrollLockActive = (active) => {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    const body = document.body;
    if (!root || !body) {
      return;
    }
    if (active) {
      updateScrollbarCompensation();
      root.classList.add('cdje-spinner-lock');
      body.classList.add('cdje-spinner-lock');
    } else {
      root.classList.remove('cdje-spinner-lock');
      body.classList.remove('cdje-spinner-lock');
      root.style.removeProperty('--cdje-scrollbar-width');
    }
  };

  const clearPinStyles = () => {
    if (!overlayEl) {
      return;
    }
    overlayEl.classList.remove('clubs-loading-overlay--pinned');
    overlayEl.style.top = '';
    overlayEl.style.bottom = '';
    overlayEl.style.height = '';
    overlayEl.style.left = '';
    overlayEl.style.right = '';
  };

  const syncPinnedOverlay = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    if (!overlayEl || !overlayHost) {
      return;
    }
    if (overlayHost === document.body) {
      clearPinStyles();
      return;
    }
    const rect = overlayHost.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    const safeViewportHeight = Number.isFinite(viewportHeight) ? viewportHeight : 0;
    const visibleTop = Math.max(0, Number.isFinite(rect.top) ? rect.top : 0);
    const visibleBottom = Math.min(
      safeViewportHeight,
      Number.isFinite(rect.bottom) ? rect.bottom : safeViewportHeight
    );
    const visibleHeight = Math.max(0, Math.round(visibleBottom - visibleTop));
    const offsetTop = Math.max(0, Math.round(visibleTop - (Number.isFinite(rect.top) ? rect.top : 0)));
    const fallbackHeight = Number.isFinite(rect.height) ? Math.round(rect.height) : safeViewportHeight;
    overlayEl.classList.add('clubs-loading-overlay--pinned');
    overlayEl.style.top = `${offsetTop}px`;
    overlayEl.style.bottom = 'auto';
    overlayEl.style.height = `${Math.max(visibleHeight, 0) || Math.max(fallbackHeight, 0) || safeViewportHeight}px`;
    overlayEl.style.left = '0';
    overlayEl.style.right = '0';
  };

  const setPinModeActive = (active) => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!active) {
      if (pinListenerAttached) {
        window.removeEventListener('resize', syncPinnedOverlay);
        pinListenerAttached = false;
      }
      clearPinStyles();
      return;
    }
    syncPinnedOverlay();
    if (!pinListenerAttached) {
      window.addEventListener('resize', syncPinnedOverlay, { passive: true });
      pinListenerAttached = true;
    }
  };

  const ensureOverlay = () => {
    if (overlayEl) {
      return overlayEl;
    }
    if (typeof document === 'undefined' || !document.body) {
      return null;
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
    overlayEl = overlay;
    return overlay;
  };

  const mountOverlay = (requestedHost) => {
    const overlay = ensureOverlay();
    if (!overlay) {
      return null;
    }
    const host = requestedHost && requestedHost instanceof Element ? requestedHost : document.body;
    if (!host || !document.body) {
      return overlay;
    }

    if (stack > 0 && overlayHost && overlayHost !== host) {
      if (overlayHost.contains(host)) {
        // Conserve le host actuel (plus large).
        return overlay;
      }
      if (host.contains(overlayHost)) {
        overlayHost.removeAttribute('aria-busy');
      }
    }

    const nextHost =
      stack > 0 && overlayHost && overlayHost !== host && overlayHost.contains(host)
        ? overlayHost
        : host;

    if (overlayHost && overlayHost !== nextHost) {
      overlayHost.removeAttribute('aria-busy');
    }

    overlayHost = nextHost;
    const scoped = overlayHost !== document.body;
    if (scoped) {
      overlayHost.classList.add('clubs-loading-host');
    }
    if (overlay.parentElement !== overlayHost) {
      overlayHost.appendChild(overlay);
    }
    overlay.classList.toggle('clubs-loading-overlay--scoped', scoped);
    return overlay;
  };

  const setLabel = (label) => {
    const overlay = overlayEl || ensureOverlay();
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
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
      overlayEl.classList.remove('is-visible');
      overlayEl.setAttribute('aria-hidden', 'true');
      overlayHost?.removeAttribute('aria-busy');
      if (scrollLockCount <= 0) {
        scrollLockActive = false;
        setScrollLockActive(false);
      }
      if (pinCount <= 0) {
        pinActive = false;
        setPinModeActive(false);
      }
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
      overlayHost?.removeAttribute('aria-busy');
      hideTimer = null;
      if (scrollLockCount <= 0) {
        scrollLockActive = false;
        setScrollLockActive(false);
      }
      if (pinCount <= 0) {
        pinActive = false;
        setPinModeActive(false);
      }
    }, delay);
  };

  const show = (label, options = {}) => {
    const requestedHost = resolveOverlayHost(options);
    const overlay = mountOverlay(requestedHost);
    if (!overlay) {
      return () => {};
    }
    const wantsScrollLock = options.lockScroll === true;
    const wantsPin = options.pinToViewport === true || options.pinToViewport === '1';
    if (wantsScrollLock) {
      scrollLockCount += 1;
      if (!scrollLockActive && overlayEl && overlayEl.classList.contains('is-visible')) {
        scrollLockActive = true;
        setScrollLockActive(true);
      }
    }
    if (wantsPin) {
      pinCount += 1;
      if (!pinActive) {
        pinActive = true;
      }
      setPinModeActive(true);
    } else if (pinActive) {
      setPinModeActive(true);
    } else {
      clearPinStyles();
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    stack += 1;
    setLabel(label);
    const ensureVisible = () => {
      if (!overlayEl || stack <= 0) {
        return;
      }
      if (scrollLockCount > 0 && !scrollLockActive) {
        scrollLockActive = true;
        setScrollLockActive(true);
      }
      if (pinActive) {
        syncPinnedOverlay();
      }
      if (overlayEl.classList.contains('is-visible')) {
        overlayHost?.setAttribute('aria-busy', 'true');
        return;
      }
      visibleSince = Date.now();
      overlayEl.classList.add('is-visible');
      overlayEl.setAttribute('aria-hidden', 'false');
      overlayHost?.setAttribute('aria-busy', 'true');
    };
    if (overlayEl && overlayEl.classList.contains('is-visible')) {
      overlayHost?.setAttribute('aria-busy', 'true');
    } else if (!showTimer) {
      showTimer = setTimeout(() => {
        showTimer = null;
        ensureVisible();
      }, SHOW_DELAY_MS);
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      if (wantsScrollLock) {
        scrollLockCount = Math.max(0, scrollLockCount - 1);
      }
      if (wantsPin) {
        pinCount = Math.max(0, pinCount - 1);
      }
      hideOne();
    };
  };

  const hideAll = () => {
    if (stack <= 0) {
      return;
    }
    stack = 1;
    scrollLockCount = 0;
    pinCount = 0;
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
      const payload = event?.detail && typeof event.detail === 'object' ? event.detail : {};
      const release = show(payload?.label, payload);
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

(() => {
  const scopeBanner = typeof document !== 'undefined' ? document.querySelector('.clubs-scope-banner') : null;
  if (!scopeBanner) {
    return;
  }

  const syncScopeBannerHeight = () => {
    const rect = scopeBanner.getBoundingClientRect();
    const height = Number.isFinite(rect.height) ? Math.max(0, Math.round(rect.height)) : 0;
    document.documentElement.style.setProperty('--clubs-scope-banner-height', `${height}px`);
  };

  syncScopeBannerHeight();
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(syncScopeBannerHeight);
  }
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      syncScopeBannerHeight();
    });
    observer.observe(scopeBanner);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', syncScopeBannerHeight);
  }
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

  const isPlayersSectionPath = (path) => {
    if (!path) {
      return false;
    }
    if (path === '/joueurs' || path === '/joueurs-92') {
      return true;
    }
    return path.startsWith('/joueur/');
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
      } else if (!isCurrent && matchGroup === 'joueurs' && isPlayersSectionPath(currentPath)) {
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
    const scopeHeightRaw = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue('--clubs-scope-banner-height');
    const scopeHeight = Number.isFinite(Number.parseFloat(scopeHeightRaw)) ? Number.parseFloat(scopeHeightRaw) : 0;
    return headerHeight + adminBarHeight + scopeHeight + 12;
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
      root.style.setProperty('--cm-header-real-height', `${headerHeight}px`);
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

    updateHeaderHeight();
    setHidden(false);
    window.addEventListener('resize', updateHeaderHeight);
    window.addEventListener('load', updateHeaderHeight);
    if (typeof ResizeObserver === 'function') {
      const headerObserver = new ResizeObserver(() => {
        updateHeaderHeight();
      });
      headerObserver.observe(headerWrapper);
    }
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

  // Tooltips are displayed via :focus (mobile tap) and can otherwise get "stuck" until another
  // focusable element is tapped. Blur them when tapping outside.
  const setupTooltipDismissal = () => {
    const TOOLTIP_HOST_SELECTOR = '[data-tooltip][tabindex]';

    const getActiveTooltipHost = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) {
        return null;
      }
      return active.hasAttribute('data-tooltip') ? active : null;
    };

    const getTooltipHostFromTarget = (target) => {
      if (!(target instanceof Element)) {
        return null;
      }
      const host = target.closest(TOOLTIP_HOST_SELECTOR);
      return host instanceof HTMLElement ? host : null;
    };

    const blurIfOutside = (target) => {
      const activeTooltip = getActiveTooltipHost();
      if (!activeTooltip) {
        return;
      }
      if (target instanceof Node && activeTooltip.contains(target)) {
        return;
      }
      if (typeof activeTooltip.blur === 'function') {
        activeTooltip.blur();
      }
    };

    const focusTooltipHost = (host) => {
      if (!host || host === document.activeElement) {
        return;
      }
      try {
        host.focus({ preventScroll: true });
      } catch (error) {
        try {
          host.focus();
        } catch (err) {
          // Ignore focus errors for non-focusable nodes.
        }
      }
    };

    const handlePointerDown = (event) => {
      blurIfOutside(event?.target);
      if (event && event.pointerType === 'touch') {
        focusTooltipHost(getTooltipHostFromTarget(event.target));
      }
    };

    const handleTouchStart = (event) => {
      blurIfOutside(event?.target);
      focusTooltipHost(getTooltipHostFromTarget(event.target));
    };

    // Use capture so it runs even when inner components stop propagation.
    document.addEventListener('pointerdown', handlePointerDown, { capture: true });
    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') {
        return;
      }
      const activeTooltip = getActiveTooltipHost();
      if (activeTooltip && typeof activeTooltip.blur === 'function') {
        activeTooltip.blur();
      }
    });
  };

  setupTooltipDismissal();
});
