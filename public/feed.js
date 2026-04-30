(function initFeedPager(global) {
  "use strict";

  const DEFAULT_PAGE_SIZE = 20;
  const state = {
    currentView: "forYou",
    pageByView: Object.create(null),
    hasMoreByView: Object.create(null),
    loadingByView: Object.create(null),
    scrollBound: false,
  };

  function normalizeView(view) {
    const normalized = String(view || "forYou").trim().toLowerCase();
    if (normalized === "following") return "following";
    if (normalized === "trending") return "trending";
    if (normalized === "latest") return "latest";
    return "forYou";
  }

  function setCurrentView(view) {
    state.currentView = normalizeView(view);
    return state.currentView;
  }

  function getCurrentView() {
    return state.currentView;
  }

  function resetView(view) {
    const key = normalizeView(view);
    delete state.pageByView[key];
    delete state.hasMoreByView[key];
    delete state.loadingByView[key];
  }

  function primeView(view, items, options = {}) {
    const key = normalizeView(view);
    const limit = Math.max(1, Number(options.limit) || DEFAULT_PAGE_SIZE);
    state.pageByView[key] = Math.max(1, Number(options.page) || 1);
    state.hasMoreByView[key] =
      typeof options.hasMore === "boolean"
        ? options.hasMore
        : Array.isArray(items) && items.length >= limit;
    return key;
  }

  function canLoadMore(view) {
    const key = normalizeView(view);
    return state.hasMoreByView[key] !== false;
  }

  async function loadNextPage(options = {}) {
    const key = normalizeView(options.view || state.currentView);
    const limit = Math.max(1, Number(options.limit) || DEFAULT_PAGE_SIZE);

    if (state.loadingByView[key] || !canLoadMore(key) || !global.API?.getHomeFeed) {
      return [];
    }

    state.loadingByView[key] = true;
    try {
      const nextPage = Math.max(1, Number(state.pageByView[key] || 0) + 1);
      const items = await global.API.getHomeFeed(key, nextPage, limit);
      state.pageByView[key] = nextPage;
      state.hasMoreByView[key] = Array.isArray(items) && items.length >= limit;
      return Array.isArray(items) ? items : [];
    } finally {
      state.loadingByView[key] = false;
    }
  }

  function bindInfiniteScroll(config = {}) {
    if (state.scrollBound) return;
    state.scrollBound = true;

    const threshold = Math.max(160, Number(config.threshold) || 420);
    const pageSize = Math.max(1, Number(config.pageSize) || DEFAULT_PAGE_SIZE);

    global.addEventListener(
      "scroll",
      async () => {
        if (typeof config.isActive === "function" && !config.isActive()) {
          return;
        }

        const doc = global.document?.documentElement;
        if (!doc) return;

        const remaining =
          Math.max(doc.scrollHeight, global.document?.body?.scrollHeight || 0) -
          (global.innerHeight + global.scrollY);
        if (remaining > threshold) return;

        const items = await loadNextPage({
          view:
            typeof config.getView === "function"
              ? config.getView()
              : state.currentView,
          limit: pageSize,
        });

        if (items.length && typeof config.onAppend === "function") {
          config.onAppend(items, getCurrentView());
        }
      },
      { passive: true }
    );
  }

  global.TSFeedPager = {
    DEFAULT_PAGE_SIZE,
    bindInfiniteScroll,
    canLoadMore,
    getCurrentView,
    loadNextPage,
    primeView,
    resetView,
    setCurrentView,
  };
})(window);
