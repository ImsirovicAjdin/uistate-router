// @uistate/router — SPA router factory for EventState stores
// Routing is just state: navigate() writes to store paths, components subscribe.

/**
 * Compile a route pattern like '/users/:id/posts/:postId' into a matcher.
 * Returns { regex, paramNames } for extraction.
 */
function compilePattern(pattern) {
  const paramNames = [];
  const parts = pattern.split(/:([a-zA-Z_][a-zA-Z0-9_]*)/);
  const regexStr = parts
    .map((part, i) => {
      if (i % 2 === 1) {
        paramNames.push(part);
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return { regex: new RegExp('^' + regexStr + '$'), paramNames };
}

/**
 * Create a SPA router bound to an EventState store.
 *
 * @param {Object} config
 * @param {Array}  config.routes       - [{ path: '/users/:id', view: 'user', component: UserView }]
 * @param {Object} [config.store]      - EventState store instance
 * @param {string} [config.rootSelector='[data-route-root]'] - Root element for view mounting
 * @param {Object} [config.fallback]   - Fallback route when nothing matches
 * @param {boolean} [config.debug=false]
 * @param {string} [config.linkSelector='a[data-link]'] - Selector for intercepted links
 * @param {string} [config.navSelector='nav a[data-link]'] - Selector for nav links to toggle .active class
 *
 * Store-driven navigation (requires store):
 *   Any code with store access can navigate without importing the router:
 *   - store.set('ui.route.go', '/about')
 *   - store.set('ui.route.go', { path: '/users/1', search: '?tab=posts' })
 *   - store.set('ui.route.go', { query: { tab: 'posts' } })  // patch query only
 */
export function createRouter(config) {
  const {
    routes = [],
    store,
    rootSelector = '[data-route-root]',
    fallback = null,
    debug = false,
    linkSelector = 'a[data-link]',
    navSelector = 'nav a[data-link]',
  } = config;

  // Pre-compile route patterns
  const compiled = routes.map(route => ({
    ...route,
    ...compilePattern(route.path),
  }));

  const compiledFallback = fallback
    ? { ...fallback, ...compilePattern(fallback.path || '/*'), params: {} }
    : null;

  // Detect base path from <base href> if present
  const BASE_PATH = (() => {
    const b = document.querySelector('base[href]');
    if (!b) return '';
    try {
      const u = new URL(b.getAttribute('href'), location.href);
      let p = u.pathname;
      if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
      return p;
    } catch { return ''; }
  })();

  function stripBase(pathname) {
    if (BASE_PATH && pathname.startsWith(BASE_PATH)) {
      const rest = pathname.slice(BASE_PATH.length) || '/';
      return rest.startsWith('/') ? rest : ('/' + rest);
    }
    return pathname;
  }

  function withBase(pathname) {
    if (!BASE_PATH) return pathname;
    if (pathname === '/') return BASE_PATH || '/';
    return BASE_PATH + (pathname.startsWith('/') ? '' : '/') + pathname;
  }

  function normalizePath(p) {
    if (!p) return '/';
    if (p[0] !== '/') p = '/' + p;
    if (p === '/index.html') return '/';
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p;
  }

  function resolve(pathname) {
    const p = normalizePath(pathname);
    for (const route of compiled) {
      const match = p.match(route.regex);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
        return { path: route.path, view: route.view, component: route.component, params };
      }
    }
    if (compiledFallback) return { ...compiledFallback, params: {} };
    return null;
  }

  function getRoot() {
    const el = document.querySelector(rootSelector);
    if (!el) throw new Error('[router] Route root not found: ' + rootSelector);
    return el;
  }

  function log(...args) {
    if (debug) console.debug('[router]', ...args);
  }

  function setActiveNav(pathname) {
    document.querySelectorAll(navSelector).forEach(a => {
      const url = new URL(a.getAttribute('href'), location.href);
      const linkPath = normalizePath(stripBase(url.pathname));
      const here = normalizePath(pathname);
      const isExact = linkPath === here;
      const isParent = !isExact && linkPath !== '/' && here.startsWith(linkPath);
      const active = isExact || isParent;
      a.classList.toggle('active', active);
      if (isExact) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  // Internal state
  let current = { viewKey: null, unboot: null, path: null, search: '' };
  let navController = null;
  const scrollPositions = new Map();
  history.scrollRestoration = 'manual';

  /**
   * Navigate to a pathname.
   * @param {string} pathname
   * @param {Object} [opts]
   * @param {boolean} [opts.replace=false]
   * @param {string}  [opts.search='']
   * @param {boolean} [opts.restoreScroll=false]
   */
  async function navigate(pathname, { replace = false, search = '', restoreScroll = false } = {}) {
    const root = getRoot();
    const appPath = normalizePath(stripBase(pathname));
    const resolved = resolve(appPath);

    if (!resolved) {
      log('no route found for:', appPath);
      return;
    }

    const viewKey = resolved.view;
    const component = resolved.component;
    const searchStr = search && search.startsWith('?') ? search : (search ? ('?' + search) : '');

    log('navigate', { from: current.path, to: appPath, view: viewKey, params: resolved.params });

    // Same-route no-op guard
    if (current.path === appPath && current.search === searchStr) {
      return;
    }

    // Abort in-flight boot
    if (navController) navController.abort();
    navController = new AbortController();
    const { signal } = navController;

    // Transition start
    const html = document.documentElement;
    html.setAttribute('data-transitioning', 'on');
    if (store) {
      try { store.set('ui.route.transitioning', true); } catch {}
    }

    // Save scroll position for current route
    if (current.path) {
      scrollPositions.set(current.path, { x: scrollX, y: scrollY });
      if (scrollPositions.size > 50) scrollPositions.delete(scrollPositions.keys().next().value);
    }

    // Unboot previous view
    if (typeof current.unboot === 'function') {
      try { await current.unboot(); } catch {}
    }

    // Clear root
    root.replaceChildren();

    // Boot new view
    let unboot = null;
    if (component && typeof component.boot === 'function') {
      unboot = await component.boot({ store, el: root, signal, params: resolved.params });
    }

    // Guard: if navigation was superseded during boot, bail out
    if (signal.aborted) return;

    const prevViewKey = current.viewKey;
    current = { viewKey, unboot, path: appPath, search: searchStr };

    // Parse query params
    const fullUrl = new URL(location.origin + withBase(appPath) + searchStr);
    const query = {};
    fullUrl.searchParams.forEach((v, k) => { query[k] = v; });

    // Update store with route state + end transition atomically
    if (store) {
      try {
        store.setMany({
          'ui.route.view': viewKey,
          'ui.route.path': appPath,
          'ui.route.params': resolved.params || {},
          'ui.route.query': query,
          'ui.route.transitioning': false,
        });
      } catch {}
    }

    // Update browser history
    const useReplace = replace;
    if (useReplace) history.replaceState({}, '', withBase(appPath) + searchStr);
    else history.pushState({}, '', withBase(appPath) + searchStr);

    // Set view attribute on <html> for CSS hooks
    html.setAttribute('data-view', viewKey);
    html.setAttribute('data-transitioning', 'off');

    // Update nav active state
    setActiveNav(appPath);

    // Focus management (accessibility)
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    try { root.focus({ preventScroll: true }); } catch {}

    // Scroll
    if (restoreScroll) {
      const pos = scrollPositions.get(appPath);
      if (pos) scrollTo(pos.x, pos.y);
    } else {
      scrollTo(0, 0);
    }

    log('routed', { view: viewKey, path: appPath, params: resolved.params, query });
  }

  /**
   * Patch query parameters without changing the path.
   * Pass null/undefined/'' as a value to remove a key.
   */
  function navigateQuery(patch = {}, { replace = true } = {}) {
    const params = new URLSearchParams(current.search?.replace(/^\?/, '') || '');
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') params.delete(k);
      else params.set(k, String(v));
    }
    const searchStr = params.toString();
    const prefixed = searchStr ? ('?' + searchStr) : '';
    const path = current.path || normalizePath(stripBase(location.pathname));
    return navigate(path, { search: prefixed, replace });
  }

  /**
   * Navigate to a new path, keeping the current search string.
   * @param {string} path
   * @param {Object} [opts]
   * @param {boolean} [opts.replace=true]
   */
  function navigatePath(path, { replace = true } = {}) {
    const appPath = normalizePath(stripBase(path));
    const searchStr = current.search || '';
    return navigate(appPath, { search: searchStr, replace });
  }

  // Event handlers
  function onClick(e) {
    const a = e.target.closest(linkSelector);
    if (!a) return;
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const href = a.getAttribute('href');
    if (!href) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    e.preventDefault();
    log('click', { href, text: a.textContent.trim() });
    navigate(url.pathname, { search: url.search }).catch(() => {});
  }

  function onPop() {
    navigate(location.pathname, {
      replace: true,
      search: location.search,
      restoreScroll: true,
    }).catch(() => {});
  }

  // Store-driven navigation: write ui.route.go to navigate from anywhere
  let unsubGo = null;
  let processingGo = false;
  if (store) {
    unsubGo = store.subscribe('ui.route.go', (value) => {
      if (processingGo || !value) return;
      processingGo = true;
      try { store.set('ui.route.go', null); } catch {}
      processingGo = false;

      if (typeof value === 'string') {
        navigate(value).catch(() => {});
      } else if (typeof value === 'object') {
        if (!value.path && value.query) {
          navigateQuery(value.query, { replace: value.replace ?? true }).catch(() => {});
        } else {
          navigate(value.path || '/', {
            search: value.search || '',
            replace: value.replace || false,
          }).catch(() => {});
        }
      }
    });
  }

  // Public API
  return {
    navigate,
    navigateQuery,
    navigatePath,

    start() {
      window.addEventListener('click', onClick);
      window.addEventListener('popstate', onPop);
      navigate(location.pathname, {
        replace: true,
        search: location.search,
        restoreScroll: true,
      });
      return this;
    },

    stop() {
      window.removeEventListener('click', onClick);
      window.removeEventListener('popstate', onPop);
      if (unsubGo) { unsubGo(); unsubGo = null; }
      if (typeof current.unboot === 'function') {
        try { Promise.resolve(current.unboot()).catch(() => {}); } catch {}
      }
      return this;
    },

    getCurrent() {
      return {
        view: current.viewKey,
        path: current.path,
        search: current.search,
      };
    },
  };
}
