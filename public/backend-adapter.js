/**
 * Backend Adapter — Monkey-patches the original Script.js functions
 * to use the real backend API instead of LocalStorage.
 *
 * This file loads AFTER Script.js, api.js, and socket-client.js.
 * It overrides specific functions to wire them to the backend,
 * keeping all UI logic and rendering functions intact.
 */

(function () {
  "use strict";

  window.handleRemoteStopTyping = function (data) {
    if (data.convId !== activeChatId) return;
    const ti = document.getElementById("remoteTypingIndicator");
    if (ti) ti.remove();
    const sub = document.getElementById("chatWinSub");
    const conv = getConversationById(activeChatId);
    if (sub && conv) sub.textContent = getChatHeaderStatus(conv);
  };

  window.handleRemoteRead = function (data) {
    const convId = (data.convId || "").toString();
    const msgs = _conversationMessages[convId] || [];
    msgs.forEach((m) => {
      if (
        (m.isMe || (m.from && m.from.toString() === myId())) &&
        (!data.messageIds || data.messageIds.includes((m.id || "").toString()))
      ) {
        m.read = true;
        m.delivered = true;
        m.status = "read";
      }
    });
    if (convId === activeChatId) renderChatMessages(activeChatId);
  };

  window.handleMessageDelivered = function (data) {
    const convId = (data.convId || "").toString();
    const msgs = _conversationMessages[convId] || [];
    const target = msgs.find(
      (m) =>
        (m.isMe || (m.from && m.from.toString() === myId())) &&
        (m.id || "").toString() === (data.messageId || "").toString()
    );
    if (target && target.status !== "read") {
      target.delivered = true;
      target.status = "delivered";
    }
    if (convId === activeChatId) renderChatMessages(activeChatId);
  };

  window.handleMessageUpdated = function (data) {
    const convId = (data.convId || "").toString();
    const incoming = data.message;
    if (!incoming) return;
    if (!_conversationMessages[convId]) _conversationMessages[convId] = [];
    const idx = _conversationMessages[convId].findIndex(
      (item) => (item.id || "").toString() === (incoming.id || "").toString()
    );
    if (idx > -1) {
      _conversationMessages[convId][idx] = incoming;
      updateConversationPreview(convId, incoming);
      if (convId === activeChatId) renderChatMessages(activeChatId);
      if (curPage === "chats") {
        updateChatItemDOM(convId, getMessagePreview(incoming), fmtChatTs(incoming.ts), 0);
      }
    }
  };

  window.updateChatHeaderOnline = function (userId, online, lastSeen) {
    const conv = _cachedConversations.find(
      (item) => (item.uid || "").toString() === (userId || "").toString()
    );
    if (conv?.user && lastSeen) conv.user.lastSeen = lastSeen;
    const sub = document.getElementById("chatWinSub");
    if (sub) {
      const uid = sub.getAttribute("data-chat-uid");
      if (uid === userId) {
        const activeConv = getConversationById(activeChatId);
        if (activeConv) sub.textContent = getChatHeaderStatus(activeConv);
      }
    }
    if (curPage === "chats") renderChatsList();
  };

  // =============================================
  // CACHE: In-memory cache of data from the API
  // =============================================
  let _cachedUsers = [];
  let _cachedPosts = [];
  let _cachedVideos = [];
  let _cachedLiveStreams = [];
  let _cachedVidStories = [];
  let _remoteHashtagDiscovery = [];
  let _remoteSearchHashtags = [];
  let _activeSearchRequestId = 0;
  let _dataLoaded = false;
  let _liveRefreshTimer = null;
  let _liveRefreshInFlight = false;
  const BOOT_CACHE_KEY = "backendBootCache";
  const BOOT_CACHE_TTL = 1000 * 60 * 60 * 24 * 30;
  const LIVE_REFRESH_INTERVAL_MS = 15000;

  function scheduleNonCriticalWork(task, timeout = 800) {
    if (typeof task !== "function") return;
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => task(), { timeout });
      return;
    }
    setTimeout(task, Math.min(timeout, 250));
  }

  function syncBackendCache(payload) {
    if (!payload || typeof payload !== "object") return false;
    const users = Array.isArray(payload.users) ? payload.users : null;
    const posts = Array.isArray(payload.posts) ? payload.posts : null;
    const videos = Array.isArray(payload.videos) ? payload.videos : null;
    const liveStreams = Array.isArray(payload.liveStreams)
      ? payload.liveStreams
      : null;
    const vidStories = Array.isArray(payload.vidStories)
      ? payload.vidStories
      : null;

    if (!users || !posts || !videos || !liveStreams || !vidStories) {
      return false;
    }

    _cachedUsers = users;
    _cachedPosts = posts;
    _cachedVideos = videos;
    _cachedLiveStreams = liveStreams;
    _cachedVidStories = vidStories;
    _dataLoaded = true;
    return true;
  }

  function writeBootCache() {
    Store.s(BOOT_CACHE_KEY, {
      ts: Date.now(),
      users: _cachedUsers,
      posts: _cachedPosts,
      videos: _cachedVideos,
      liveStreams: _cachedLiveStreams,
      vidStories: _cachedVidStories,
    });
  }

  function mapLiveStreamsFromVideos(videos) {
    return (videos || [])
      .filter((v) => v && v.live)
      .map((v) => ({
        id: v.id,
        uid: v.uid,
        title: v.title,
        src: v.src,
        viewers: v.viewers || 0,
        started: v.started || "recently",
        poster: v.thumb || v.poster || "",
      }));
  }

  function shouldRefreshLiveStreams() {
    return document.visibilityState === "visible" && curPage === "video";
  }

  async function refreshLiveStreamsIfNeeded() {
    if (
      _liveRefreshInFlight ||
      !shouldRefreshLiveStreams() ||
      typeof window.refreshLiveStreamsFromBackend !== "function"
    ) {
      return false;
    }

    _liveRefreshInFlight = true;
    try {
      return await window.refreshLiveStreamsFromBackend({ render: true });
    } finally {
      _liveRefreshInFlight = false;
    }
  }

  function ensureLiveRefreshLoop() {
    if (_liveRefreshTimer) return;

    _liveRefreshTimer = window.setInterval(() => {
      refreshLiveStreamsIfNeeded().catch(() => {});
    }, LIVE_REFRESH_INTERVAL_MS);

    document.addEventListener("visibilitychange", () => {
      if (shouldRefreshLiveStreams()) {
        refreshLiveStreamsIfNeeded().catch(() => {});
      }
    });
  }

  function hydrateBootCache() {
    const cached = Store.g(BOOT_CACHE_KEY);
    if (!cached || typeof cached !== "object") return false;
    if (
      typeof cached.ts === "number" &&
      Date.now() - cached.ts > BOOT_CACHE_TTL
    ) {
      Store.d(BOOT_CACHE_KEY);
      return false;
    }
    return syncBackendCache(cached);
  }

  function renderCurrentPageShell() {
    initUI();
    updateInstallButtons();

    const refreshMap = {
      home: () => {
        renderFeed();
        renderStories();
        renderWidgets();
      },
      mandir: () => renderMandir(),
      mandirCommunity: () => {
        if (currentMandirSlug) loadMandirPosts(currentMandirSlug);
      },
      video: () => renderVideoPage(),
      reels: () => renderReelsPage(),
      search: () => {
        doSearch("");
        renderWidgets();
      },
      notifs: () => renderNotifs(),
      bookmarks: () => renderBM(),
      profile: () => renderProfile(CU ? CU.id : curProfId || "u1"),
      chats: () => renderChatsPage(),
      about: () => {},
      language: () => renderLanguagePage(),
      helpSupport: () => renderHelpSupportPage(),
      settingsPrivacy: () => renderSettingsPrivacyPage(),
    };

    const render = refreshMap[curPage] || refreshMap.home;
    render();
    if (
      typeof window.scheduleGoogleTranslate === "function" &&
      typeof window.getCurrentLanguageCode === "function"
    ) {
      const languageCode = window.getCurrentLanguageCode() || "en";
      if (languageCode !== "en") {
        window.scheduleGoogleTranslate({
          languageCode,
          force: true,
          delay: 180,
        });
      }
    }
  }

  function getAppBaseUrl() {
    const url = new URL(window.location.href);
    url.hash = "";
    url.search = "";
    if (!url.pathname.endsWith("/")) {
      url.pathname = url.pathname.substring(0, url.pathname.lastIndexOf("/") + 1);
    }
    return url.toString();
  }

  function getInviteAwareReturnToUrl() {
    const returnTo = new URL(getAppBaseUrl());
    const referralCode =
      typeof window.getActiveReferralCode === "function"
        ? window.getActiveReferralCode()
        : "";
    if (referralCode) {
      returnTo.searchParams.set("ref", referralCode);
    }
    return returnTo.toString();
  }

  function consumeAuthRedirectHash() {
    const rawHash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";
    const params = rawHash
      ? new URLSearchParams(rawHash)
      : new URLSearchParams(window.location.search);
    const authToken = params.get("authToken");
    const authError = params.get("authError");
    const authSource = params.get("authSource");
    const status = params.get("status");

    if (!authToken && !authError && !status) {
      return null;
    }

    history.replaceState(
      null,
      document.title,
      window.location.pathname
    );

    return {
      authToken,
      authError,
      authSource,
      status,
      verified: params.get("verified"),
    };
  }

  function consumeOpenChatParam() {
    const url = new URL(window.location.href);
    const convId = url.searchParams.get("openChat");
    if (!convId) return "";
    url.searchParams.delete("openChat");
    history.replaceState(null, document.title, url.toString());
    return convId;
  }

  let _chatPushSetupPromise = null;
  let _pendingOpenChatId = consumeOpenChatParam();
  const APP_ASSET_VERSION = "20260425-scale-search-oauth-1";
  let _appSwPromise = null;
  let _deferredInstallPrompt = null;
  let _installPromptBound = false;

  function isStandaloneApp() {
    return (
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function isLocalDevHost() {
    return (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    );
  }

  function isIosDevice() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || "");
  }

  async function ensureAppServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    if (_appSwPromise) return _appSwPromise;

    _appSwPromise = (async () => {
      const reg = await navigator.serviceWorker.register(`/sw.js?v=${APP_ASSET_VERSION}`);
      try {
        await reg.update();
      } catch {}
      return reg;
    })();

    try {
      return await _appSwPromise;
    } catch (err) {
      console.warn("App service worker registration skipped:", err.message);
      _appSwPromise = null;
      return null;
    }
  }

  function updateInstallButtons() {
    const allowUi =
      !isStandaloneApp() &&
      (isIosDevice() || window.isSecureContext || isLocalDevHost());
    const installText = _deferredInstallPrompt
      ? "Install App"
      : isIosDevice()
        ? "Add to Home Screen"
        : "Install App";

    [
      { id: "moreInstallBtn", display: allowUi ? "flex" : "none", textId: "moreInstallTxt" },
    ].forEach(({ id, display, textId }) => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = display;
      if (textId) {
        const txt = document.getElementById(textId);
        if (txt) txt.textContent = installText;
      }
    });

    const divider = document.getElementById("moreUtilityDivider");
    if (divider) divider.style.display = allowUi ? "block" : "none";

    if (typeof window.syncMoreMenu === "function") {
      window.syncMoreMenu();
    }
  }

  function setupInstallPromptBridge() {
    if (_installPromptBound) return;
    _installPromptBound = true;

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      _deferredInstallPrompt = event;
      updateInstallButtons();
    });

    window.addEventListener("appinstalled", () => {
      _deferredInstallPrompt = null;
      updateInstallButtons();
      MC?.success("Tirth Sutra installed successfully.");
    });
  }

  window.promptInstallApp = async function () {
    await ensureAppServiceWorker().catch(() => {});

    if (isStandaloneApp()) {
      MC?.info("Tirth Sutra is already installed on this device.");
      return;
    }

    if (_deferredInstallPrompt) {
      const promptEvent = _deferredInstallPrompt;
      _deferredInstallPrompt = null;
      promptEvent.prompt();
      const choice = await promptEvent.userChoice.catch(() => null);
      updateInstallButtons();
      if (choice?.outcome === "accepted") {
        MC?.success("Install started. Open Tirth Sutra from your home screen when it finishes.");
      } else {
        MC?.info("Install cancelled.");
      }
      return;
    }

    if (isIosDevice()) {
      MC?.info("On iPhone, tap Share in Safari and then choose Add to Home Screen.");
      return;
    }

    if (!window.isSecureContext && !isLocalDevHost()) {
      MC?.warn("Install is available only on HTTPS or localhost.");
      return;
    }

    MC?.info("Use your browser menu and choose Install app or Add to Home Screen.");
  };

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function disableChatPushNotifications() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      const subscription = await reg.pushManager.getSubscription();
      if (!subscription) return;
      await API.deletePushSubscription(subscription.endpoint).catch(() => {});
      await subscription.unsubscribe().catch(() => {});
    } catch {}
  }

  async function ensureChatPushNotifications(askPermission) {
    if (
      _chatPushSetupPromise &&
      (Notification.permission === "granted" || !askPermission)
    ) {
      return _chatPushSetupPromise;
    }

    if (
      !CU ||
      !API.getToken() ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      return null;
    }

    _chatPushSetupPromise = (async () => {
      let permission = Notification.permission;
      if (permission === "default" && askPermission) {
        permission = await Notification.requestPermission();
      }

      if (permission !== "granted") return null;

      const reg = await ensureAppServiceWorker();
      if (!reg) return null;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await API.savePushSubscription(existing.toJSON()).catch(() => {});
        return existing;
      }

      const { publicKey } = await API.getPushPublicKey();
      if (!publicKey) return null;

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await API.savePushSubscription(subscription.toJSON());
      return subscription;
    })();

    try {
      return await _chatPushSetupPromise;
    } catch (err) {
      console.warn("Push setup skipped:", err.message);
      _chatPushSetupPromise = null;
      return null;
    }
  }

  function openPendingChatIfNeeded() {
    const convId = _pendingOpenChatId;
    if (!convId || !CU) return;
    _pendingOpenChatId = "";
    gp("chats");
    setTimeout(() => {
      loadConversations().then(() => {
        openChatWindow(convId).catch(() => {});
      });
    }, 160);
  }

  function mergeUniqueById(existing, incoming) {
    const map = new Map();
    [...(existing || []), ...(incoming || [])].forEach((item) => {
      const key = (item?.id || item?._id || "").toString();
      if (!key) return;
      map.set(key, { ...(map.get(key) || {}), ...item });
    });
    return Array.from(map.values());
  }

  function mergeHashtagCollections() {
    const map = new Map();
    Array.from(arguments)
      .flat()
      .filter(Boolean)
      .forEach((item) => {
        const tag = String(item.tag || "").trim();
        if (!tag) return;
        const key = tag.toLowerCase();
        const current = map.get(key) || {
          tag,
          category: item.category || "Hashtag",
          count: 0,
          countLabel: item.countLabel || "",
        };
        current.count = Math.max(Number(current.count) || 0, Number(item.count) || 0);
        current.category = item.category || current.category;
        current.countLabel = item.countLabel || current.countLabel || "";
        map.set(key, current);
      });
    return Array.from(map.values()).sort(
      (left, right) =>
        (Number(right.count) || 0) - (Number(left.count) || 0) ||
        left.tag.localeCompare(right.tag)
    );
  }

  function mergeSearchResultsIntoCaches(result) {
    if (!result || typeof result !== "object") return;
    if (Array.isArray(result.users) && result.users.length) {
      _cachedUsers = mergeUniqueById(_cachedUsers, result.users);
    }
    if (Array.isArray(result.posts) && result.posts.length) {
      _cachedPosts = mergeUniqueById(_cachedPosts, result.posts);
    }
    if (Array.isArray(result.videos) && result.videos.length) {
      _cachedVideos = mergeUniqueById(_cachedVideos, result.videos);
      _cachedLiveStreams = mapLiveStreamsFromVideos(_cachedVideos);
    }
    writeBootCache();
  }

  async function loadTrendingHashtagDiscovery() {
    if (!API?.getTrendingHashtags) return [];
    try {
      const tags = await API.getTrendingHashtags(18);
      _remoteHashtagDiscovery = Array.isArray(tags) ? tags : [];
      return _remoteHashtagDiscovery;
    } catch {
      return [];
    }
  }

  // =============================================
  // Override getUsers/getPosts/etc to use cache
  // =============================================
  window.getUsers = function () {
    return _cachedUsers;
  };
  window.getPosts = function () {
    return _cachedPosts;
  };
  window.getVideos = function () {
    return _cachedVideos;
  };
  window.getLiveStreams = function () {
    return _cachedLiveStreams;
  };
  window.getVidStories = function () {
    return _cachedVidStories;
  };

  window.getUser = function (id) {
    if (!id) return null;
    const idStr = id.toString();
    return _cachedUsers.find((u) => {
      const uid = (u.id || u._id || "").toString();
      return uid === idStr;
    }) || null;
  };

  window.getPost = function (id) {
    if (!id) return null;
    const idStr = id.toString();
    return _cachedPosts.find((p) => {
      const pid = (p.id || p._id || "").toString();
      return pid === idStr;
    }) || null;
  };

  window.getVideo = function (id) {
    if (!id) return null;
    const idStr = id.toString();
    return _cachedVideos.find((v) => {
      const vid = (v.id || v._id || "").toString();
      return vid === idStr;
    }) || null;
  };

  window.prependLiveStreamCache = function (stream, options = {}) {
    if (!stream || !stream.id) return false;
    const normalized = {
      id: (stream.id || "").toString(),
      uid: (stream.uid || "").toString(),
      title: stream.title || "Live Stream",
      src: stream.src || "",
      viewers: Number(stream.viewers) || 0,
      started: stream.started || "Just now",
      poster: stream.poster || "",
    };

    _cachedLiveStreams = [
      normalized,
      ..._cachedLiveStreams.filter(
        (item) => (item?.id || "").toString() !== normalized.id
      ),
    ];
    writeBootCache();

    if (options.render && typeof renderLiveSection === "function") {
      renderLiveSection();
    }
    return true;
  };

  window.refreshLiveStreamsFromBackend = async function (options = {}) {
    try {
      const liveVideos = await API.getVideos(undefined, "live");
      _cachedLiveStreams = mapLiveStreamsFromVideos(liveVideos || []);
      writeBootCache();

      if (options.render && typeof renderLiveSection === "function") {
        renderLiveSection();
      }
      return true;
    } catch (err) {
      console.warn("Failed to refresh live streams:", err);
      return false;
    }
  };

  ensureLiveRefreshLoop();

  // =============================================
  // Override seedData — load from API instead
  // =============================================
  window.seedData = function () {
    // No-op — data comes from the database
  };

  // =============================================
  // Override savePost/saveVideo/updateUser
  // =============================================
  window.savePost = function (id, data) {
    const i = _cachedPosts.findIndex(
      (x) => (x.id || x._id || "").toString() === id.toString()
    );
    if (i > -1) {
      Object.assign(_cachedPosts[i], data);
      window.clearAppDataCache?.();
    }
  };

  window.saveVideo = function (id, data) {
    const i = _cachedVideos.findIndex(
      (x) => (x.id || x._id || "").toString() === id.toString()
    );
    if (i > -1) Object.assign(_cachedVideos[i], data);
  };

  window.updateUser = function (id, data) {
    const i = _cachedUsers.findIndex(
      (x) => (x.id || x._id || "").toString() === id.toString()
    );
    if (i > -1) Object.assign(_cachedUsers[i], data);
    if (CU && (CU.id || CU._id || "").toString() === id.toString()) {
      Object.assign(CU, data);
      API.setUser(CU);
    }
    if (i > -1 || (CU && (CU.id || CU._id || "").toString() === id.toString())) {
      window.clearAppDataCache?.();
    }
    // Also push to backend (fire and forget)
    if (API.getToken()) {
      API.updateUser(id, data).catch(() => {});
    }
  };

  // =============================================
  // Override avHTML for ObjectId compatibility
  // =============================================
  window.avHTML = function (uid, cls) {
    cls = cls || "av40";
    const u = getUser(uid);
    if (!u) return '<div class="av ' + cls + '">?</div>';
    const ini = getIni(u.name);
    return (
      '<div class="av ' +
      cls +
      '">' +
      (u.avatar ? '<img src="' + u.avatar + '" alt="">' : ini) +
      "</div>"
    );
  };

  // =============================================
  // Legacy auth block kept only for reference; live OTP auth overrides are defined below.
  // =============================================
  const legacyDoLogin = async function () {
    const em = (document.getElementById("liEml")?.value || "").trim();
    const pw = document.getElementById("liPw")?.value || "";
    let ok = true;
    const se = (id, show) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.toggle("show", show);
        el.style.display = show ? "block" : "none";
      }
    };
    se("liEE", !em || !em.includes("@"));
    if (!em || !em.includes("@")) ok = false;
    se("liPE", !pw);
    if (!pw) ok = false;
    if (!ok) return;

    try {
      const data = await API.login(em, pw);
      const e = document.getElementById("liErr");
      const resendBtn = document.getElementById("resendSignupOtpBtn");
      if (e) e.style.display = "none";
      if (resendBtn) resendBtn.style.display = "none";
      CU = data.user;
      ["liEml", "liPw"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      closeOvl("authOvl");
      // Connect socket
      SocketClient.connect((CU.id || CU._id).toString());
      ensureChatPushNotifications(true).catch(() => {});
      await loadAllData();
      initUI();
      MC.success("Welcome back, " + CU.name.split(" ")[0] + "! 🙏");
      gp("home");
    } catch (err) {
      const e = document.getElementById("liErr");
      const resendBtn = document.getElementById("resendSignupOtpBtn");
      if (e) {
        e.textContent = "❌ " + (err.message || "Invalid email or password");
        e.style.display = "block";
      }
      if (resendBtn) {
        resendBtn.style.display =
          err?.message && err.message.toLowerCase().includes("verify your email")
            ? "inline-block"
            : "none";
      }
      MC.error(err.message || "Invalid email or password. Please try again.");
    }
  };

  const legacyDoSignup = async function () {
    const nm = (document.getElementById("suNm")?.value || "").trim();
    const em = (document.getElementById("suEml")?.value || "").trim();
    const hdl = (document.getElementById("suHdl")?.value || "")
      .trim()
      .replace("@", "")
      .toLowerCase()
      .replace(/\s+/g, "");
    const pw = document.getElementById("suPw")?.value || "";
    const se = (id, show) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.toggle("show", show);
        el.style.display = show ? "block" : "none";
      }
    };
    let ok = true;
    se("suNE", !nm);
    if (!nm) ok = false;
    se("suEE", !em || !em.includes("@"));
    if (!em || !em.includes("@")) ok = false;
    se("suHE", !hdl || hdl.length < 3);
    if (!hdl || hdl.length < 3) ok = false;
    se("suPE", !pw || pw.length < 6);
    if (!pw || pw.length < 6) ok = false;
    if (!ok) return;

    try {
      // Legacy fallback kept for reference. Live signup now finishes through OTP verification in-app.
      const referralCode =
        typeof window.getActiveReferralCode === "function"
          ? window.getActiveReferralCode()
          : "";
      const data = await API.signup(nm, hdl, em, pw, referralCode);
      ["suNm", "suEml", "suHdl", "suPw"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      closeOvl("authOvl");
      // Do NOT set CU, connect socket, or call loadAllData here.
      // The user must verify their email before they can log in.
      MC.success(
        data.message ||
          "We sent a 6-digit OTP to your email. Your account will be created after verification."
      );
      const loginEmail = document.getElementById("liEml");
      if (loginEmail) loginEmail.value = em;
      authToggle("login");
    } catch (err) {
      const e = document.getElementById("suErr");
      if (e) {
        e.textContent = "❌ " + (err.message || "Signup failed");
        e.style.display = "block";
      }
      MC.error(err.message || "Signup failed.");
    }
  };

  window.logout = function () {
    const loaderToken =
      typeof window.startAppTopLoader === "function"
        ? window.startAppTopLoader({ initialProgress: 0.18 })
        : "";
    disableChatPushNotifications().catch(() => {});
    CU = null;
    API.logout();
    SocketClient.disconnect();
    _cachedUsers = [];
    _cachedPosts = [];
    initUI();
    gp("home");
    // Reload data as guest
    Promise.resolve(loadAllData())
      .catch(() => {})
      .finally(() => {
        if (loaderToken && typeof window.stopAppTopLoader === "function") {
          window.stopAppTopLoader(loaderToken, { delay: 0, minVisible: 150 });
        }
      });
    MC.info("Signed out. Jai Shri Ram 🙏");
  };

  const legacyResendSignupOtp = async function () {
    const email =
      (document.getElementById("liEml")?.value || "").trim() ||
      (document.getElementById("suEml")?.value || "").trim();

    if (!email || !email.includes("@")) {
      MC.warn("Enter your email address first so we can resend the OTP.");
      return;
    }

    const resendBtn = document.getElementById("resendSignupOtpBtn");
    if (resendBtn) {
      resendBtn.disabled = true;
      resendBtn.textContent = "Sending OTP...";
    }

    try {
      const data = await API.resendSignupOtp(email);
      MC.success(data.message || "A fresh OTP has been sent to your email.");
    } catch (err) {
      MC.error(err.message || "Could not resend OTP.");
    } finally {
      if (resendBtn) {
        resendBtn.disabled = false;
        resendBtn.textContent = "Resend OTP";
      }
    }
  };

  function setOtpAuthFieldError(id, show, message) {
    const el = document.getElementById(id);
    if (!el) return;
    if (typeof message === "string") {
      el.textContent = message;
    }
    el.classList.toggle("show", show);
    el.style.display = show ? "block" : "none";
  }

  function getOtpSignupEmail() {
    return (
      (document.getElementById("suEml")?.value || "").trim().toLowerCase() ||
      (document.getElementById("liEml")?.value || "").trim().toLowerCase()
    );
  }

  function getOtpCooldownSeconds(payload, fallbackSeconds = 30) {
    const fromPayload = Number(payload?.verification?.resendAfterSeconds);
    return Number.isFinite(fromPayload) && fromPayload > 0
      ? fromPayload
      : fallbackSeconds;
  }

  function getBackendTargetLabel() {
    const backendBase =
      typeof window.getBackendBaseUrl === "function"
        ? window.getBackendBaseUrl()
        : typeof CONFIG !== "undefined" && CONFIG && CONFIG.BACKEND_URL
          ? String(CONFIG.BACKEND_URL).replace(/\/+$/, "")
          : "";

    if (!backendBase) {
      return "server";
    }

    const normalized = String(backendBase).toLowerCase();
    let hostname = "";

    try {
      hostname = new URL(backendBase).hostname.toLowerCase();
    } catch {
      hostname = "";
    }

    if (
      normalized.includes("localhost") ||
      normalized.includes("127.0.0.1") ||
      normalized.includes("://10.") ||
      normalized.includes("://192.168.") ||
      /:\/\/172\.(1[6-9]|2\d|3[0-1])\./.test(normalized) ||
      hostname === "::1" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".lan") ||
      (!hostname.includes(".") && /^[a-z0-9-]+$/.test(hostname))
    ) {
      return "local server";
    }

    return "live server";
  }

  function buildOtpErrorMessage(error, fallbackMessage) {
    const status = Number(error?.status);
    const baseMessage = error?.message || fallbackMessage;
    const attemptsRemaining = Number(error?.details?.attemptsRemaining);
    const backendTarget = getBackendTargetLabel();

    if (status === 404) {
      return `The ${backendTarget} does not have the OTP verification routes yet. Redeploy or restart the latest backend build and try again.`;
    }

    if (
      status === 500 ||
      status === 502 ||
      /email delivery|send the email|configured incorrectly/i.test(baseMessage)
    ) {
      return `The ${backendTarget} could not send the OTP email. Check the SMTP settings on that backend and try again.`;
    }

    if (Number.isFinite(attemptsRemaining) && attemptsRemaining > 0) {
      return `${baseMessage} ${attemptsRemaining} attempt${
        attemptsRemaining === 1 ? "" : "s"
      } left.`;
    }

    if (error?.details?.requiresResend) {
      return `${baseMessage} Request a new OTP to continue.`;
    }

    return baseMessage;
  }

  function buildSignupErrorMessage(error, fallbackMessage) {
    const status = Number(error?.status);
    const baseMessage = error?.message || fallbackMessage;
    const backendTarget = getBackendTargetLabel();

    if (status === 404) {
      return `The ${backendTarget} is still on an older auth build. Restart or redeploy the latest backend so OTP signup routes are available.`;
    }

    if (
      status === 500 ||
      status === 502 ||
      /email delivery|send the email|configured incorrectly/i.test(baseMessage)
    ) {
      return `OTP email sending is not working on the ${backendTarget}. Add or fix the SMTP environment variables on that backend first.`;
    }

    return baseMessage;
  }

  function setButtonBusy(button, isBusy, busyText) {
    if (!button) return;

    if (!button.dataset.defaultText) {
      button.dataset.defaultText = button.textContent;
    }

    button.disabled = !!isBusy;
    button.textContent = isBusy ? busyText : button.dataset.defaultText;
  }

  function syncOtpPendingState(email, options = {}) {
    const normalizedEmail = (email || "").trim().toLowerCase();
    const signupEmail = document.getElementById("suEml");
    const loginEmail = document.getElementById("liEml");

    if (signupEmail && normalizedEmail) signupEmail.value = normalizedEmail;
    if (loginEmail && normalizedEmail) loginEmail.value = normalizedEmail;

    if (typeof window.setPendingSignupOtp === "function") {
      window.setPendingSignupOtp(normalizedEmail, options);
    }
  }

  function clearOtpPendingState() {
    if (typeof window.clearPendingSignupOtp === "function") {
      window.clearPendingSignupOtp();
    }
  }

  function clearActiveSessionForPendingSignup() {
    CU = null;
    if (typeof API.logout === "function") {
      API.logout();
    }
    if (
      typeof SocketClient !== "undefined" &&
      SocketClient &&
      typeof SocketClient.disconnect === "function"
    ) {
      SocketClient.disconnect();
    }
    initUI();
  }

  async function bootstrapOtpSession(user, successMessage) {
    CU = user;
    closeOvl("authOvl");

    if (
      typeof SocketClient !== "undefined" &&
      SocketClient &&
      typeof SocketClient.connect === "function"
    ) {
      SocketClient.connect((CU.id || CU._id).toString());
    }

    if (typeof ensureChatPushNotifications === "function") {
      ensureChatPushNotifications(true).catch(() => {});
    }

    await loadAllData();
    initUI();

    if (successMessage) {
      MC.success(successMessage);
    }

    gp("home");
  }

  // Final auth overrides: keep the live app on OTP-based signup across all devices.
  window.doLogin = async function () {
    const email = (document.getElementById("liEml")?.value || "").trim();
    const password = document.getElementById("liPw")?.value || "";
    let ok = true;

    setOtpAuthFieldError("liEE", !email || !email.includes("@"), "Valid email required");
    if (!email || !email.includes("@")) ok = false;
    setOtpAuthFieldError("liPE", !password, "Password required");
    if (!password) ok = false;
    if (!ok) return;

    const authLoaderToken =
      typeof window.startAppTopLoader === "function"
        ? window.startAppTopLoader({ initialProgress: 0.18 })
        : "";

    try {
      const data = await API.login(email, password);
      const resendBtn = document.getElementById("resendSignupOtpBtn");
      setOtpAuthFieldError("liErr", false);
      if (resendBtn) resendBtn.style.display = "none";
      clearOtpPendingState();
      if (typeof window.clearPendingReferralCode === "function") {
        window.clearPendingReferralCode();
      }
      ["liEml", "liPw"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      await bootstrapOtpSession(
        data.user,
        "Welcome back, " + data.user.name.split(" ")[0] + "! " + String.fromCodePoint(0x1f64f)
      );
    } catch (err) {
      const resendBtn = document.getElementById("resendSignupOtpBtn");
      const needsOtp =
        !!(err && err.details && err.details.requiresVerification) ||
        (err?.message || "").toLowerCase().includes("verify your email");

      setOtpAuthFieldError(
        "liErr",
        true,
        String.fromCodePoint(0x274c) + " " + (err.message || "Invalid email or password")
      );

      if (resendBtn) {
        resendBtn.style.display = needsOtp ? "inline-flex" : "none";
      }

      if (needsOtp) {
        clearActiveSessionForPendingSignup();
        syncOtpPendingState((err.details && err.details.email) || email);
      }

      MC.error(err.message || "Invalid email or password. Please try again.");
    } finally {
      if (authLoaderToken && typeof window.stopAppTopLoader === "function") {
        window.stopAppTopLoader(authLoaderToken, {
          delay: 0,
          minVisible: 150,
        });
      }
    }
  };

  window.doSignup = async function () {
    const name = (document.getElementById("suNm")?.value || "").trim();
    const email = (document.getElementById("suEml")?.value || "").trim();
    const handle = (document.getElementById("suHdl")?.value || "")
      .trim()
      .replace("@", "")
      .toLowerCase()
      .replace(/\s+/g, "");
    const password = document.getElementById("suPw")?.value || "";
    const signupBtn = document.getElementById("signupBtn");
    let ok = true;

    setOtpAuthFieldError("suNE", !name, "Name required");
    if (!name) ok = false;
    setOtpAuthFieldError("suEE", !email || !email.includes("@"), "Valid email required");
    if (!email || !email.includes("@")) ok = false;
    setOtpAuthFieldError("suHE", !handle || handle.length < 3, "Username required (min 3 chars)");
    if (!handle || handle.length < 3) ok = false;
    setOtpAuthFieldError("suPE", !password || password.length < 6, "Min 6 characters");
    if (!password || password.length < 6) ok = false;
    if (!ok) return;

    try {
      setButtonBusy(signupBtn, true, "Sending OTP...");
      const referralCode =
        typeof window.getActiveReferralCode === "function"
          ? window.getActiveReferralCode()
          : "";
      const data = await API.signup(name, handle, email, password, referralCode);
      const passwordInput = document.getElementById("suPw");
      const firstOtpDigit = document.getElementById("suOtpDigit0");

      clearActiveSessionForPendingSignup();
      setOtpAuthFieldError("suErr", false);
      setOtpAuthFieldError("suOtpErr", false);
      syncOtpPendingState(data.email || email, {
        cooldownSeconds: getOtpCooldownSeconds(data),
      });

      if (passwordInput) passwordInput.value = "";

      if (typeof authToggle === "function") {
        authToggle("signup");
      }

      if (firstOtpDigit) {
        window.setTimeout(() => firstOtpDigit.focus(), 30);
      }

      MC.success(
        data.message ||
          "We sent a 6-digit OTP to your email. Enter it to verify your email and create your account."
      );
    } catch (err) {
      const message = buildSignupErrorMessage(err, "Signup failed");
      setOtpAuthFieldError(
        "suErr",
        true,
        String.fromCodePoint(0x274c) + " " + message
      );
      MC.error(message);
    } finally {
      setButtonBusy(signupBtn, false, "Sending OTP...");
    }
  };

  window.verifySignupOtp = async function () {
    const email = getOtpSignupEmail();
    const otp = (document.getElementById("suOtp")?.value || "").trim();
    const verifyBtn = document.getElementById("verifyOtpBtn");

    if (!email || !email.includes("@")) {
      setOtpAuthFieldError("suEE", true, "Valid email required");
      return;
    }

    if (!/^\d{6}$/.test(otp)) {
      setOtpAuthFieldError(
        "suOtpErr",
        true,
        String.fromCodePoint(0x274c) + " Enter a valid 6-digit OTP"
      );
      return;
    }

    const authLoaderToken =
      typeof window.startAppTopLoader === "function"
        ? window.startAppTopLoader({ initialProgress: 0.18 })
        : "";

    try {
      setButtonBusy(verifyBtn, true, "Verifying OTP...");
      const data = await API.verifySignupOtp(email, otp);
      clearOtpPendingState();
      if (typeof window.clearPendingReferralCode === "function") {
        window.clearPendingReferralCode();
      }
      ["suNm", "suEml", "suHdl", "suPw", "suOtp", "liEml", "liPw"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      setOtpAuthFieldError("suErr", false);
      setOtpAuthFieldError("suOtpErr", false);
      await bootstrapOtpSession(
        data.user,
        "Welcome to Tirth Sutra, " +
          data.user.name.split(" ")[0] +
          "! " +
          String.fromCodePoint(0x1f64f)
      );
    } catch (err) {
      const message = buildOtpErrorMessage(err, "OTP verification failed");
      setOtpAuthFieldError(
        "suOtpErr",
        true,
        String.fromCodePoint(0x274c) + " " + message
      );
      MC.error(message);
      if (err?.details?.requiresResend && typeof window.renderOtpResendState === "function") {
        window.renderOtpResendState();
      }
    } finally {
      setButtonBusy(verifyBtn, false, "Verifying OTP...");
      if (authLoaderToken && typeof window.stopAppTopLoader === "function") {
        window.stopAppTopLoader(authLoaderToken, {
          delay: 0,
          minVisible: 150,
        });
      }
    }
  };

  window.resendSignupOtp = async function () {
    const email = getOtpSignupEmail();
    const resendBtn = document.getElementById("resendSignupOtpBtnInline");

    if (!email || !email.includes("@")) {
      setOtpAuthFieldError("suEE", true, "Valid email required");
      return;
    }

    try {
      setButtonBusy(resendBtn, true, "Sending...");
      const data = await API.resendSignupOtp(email);
      syncOtpPendingState(data.email || email, {
        cooldownSeconds: getOtpCooldownSeconds(data),
      });
      setOtpAuthFieldError("suOtpErr", false);
      MC.success(data.message || "A fresh OTP has been sent to your email.");
    } catch (err) {
      if (err?.details?.retryAfterSeconds) {
        syncOtpPendingState(email, {
          cooldownSeconds: err.details.retryAfterSeconds,
        });
      }
      const message = buildOtpErrorMessage(err, "Could not resend OTP");
      setOtpAuthFieldError(
        "suOtpErr",
        true,
        String.fromCodePoint(0x274c) + " " + message
      );
      MC.error(message);
    } finally {
      if (typeof window.renderOtpResendState === "function") {
        window.renderOtpResendState();
      } else {
        setButtonBusy(resendBtn, false, "Sending...");
      }
    }
  };

  window.resendSignupOtpFromLogin = async function () {
    const email = getOtpSignupEmail();

    if (!email || !email.includes("@")) {
      setOtpAuthFieldError("liEE", true, "Valid email required");
      MC.warn("Enter your email address first so we can resend the OTP.");
      return;
    }

    const resendBtn = document.getElementById("resendSignupOtpBtn");
    if (resendBtn) {
      resendBtn.disabled = true;
      resendBtn.textContent = "Sending OTP...";
    }

    try {
      const data = await API.resendSignupOtp(email);
      syncOtpPendingState(data.email || email, {
        cooldownSeconds: getOtpCooldownSeconds(data),
      });
      if (typeof authToggle === "function") {
        authToggle("signup");
      }
      document.getElementById("suOtpDigit0")?.focus();
      MC.success(data.message || "A fresh OTP has been sent to your email.");
    } catch (err) {
      const message = buildOtpErrorMessage(err, "Could not resend OTP");
      setOtpAuthFieldError(
        "liErr",
        true,
        String.fromCodePoint(0x274c) + " " + message
      );
      MC.error(message);
    } finally {
      if (resendBtn) {
        resendBtn.disabled = false;
        resendBtn.textContent = "Resend OTP";
      }
    }
  };

  function normalizeGoogleAuthMode(mode) {
    return mode === "signup" ? "signup" : "login";
  }

  window.doGoogleLogin = function (mode = "login") {
    const authMode = normalizeGoogleAuthMode(mode);
    if (typeof window.startAppwriteGoogleAuth === "function") {
      window.startAppwriteGoogleAuth(authMode);
      return;
    }

    MC?.error("Google Sign-In is still loading. Please refresh and try again.");
  };

  // =============================================
  // Override toggleLike for API
  // =============================================
  const _origToggleLike = window.toggleLike;
  window.toggleLike = async function (id, btn, e) {
    if (e) e.stopPropagation();
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    try {
      const result = await API.toggleLike(id);
      // Update cache
      const p = getPost(id);
      if (p) p.likes = result.likes;
      const liked = result.liked;
      if (btn) {
        btn.className = "pa" + (liked ? " liked" : "");
        const sv = btn.querySelector("svg");
        if (sv) {
          sv.style.fill = liked ? "#e53935" : "";
          sv.style.stroke = liked ? "#e53935" : "";
        }
      }
      const sp = document.getElementById("lc_" + id);
      if (sp) sp.textContent = result.likes.length;
    } catch (err) {
      // Fallback to original
      _origToggleLike(id, btn, e);
    }
  };

  // =============================================
  // Override submitCmt for API
  // =============================================
  window.submitCmt = async function (id) {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    const inp =
      document.getElementById("ci_" + id) ||
      document.getElementById("pdc_" + id);
    const text = inp?.value?.trim() || "";
    if (!text) return;

    try {
      const result = await API.addComment(id, text);
      // Update cache
      const p = getPost(id);
      if (p) {
        p.cmts = p.cmts || [];
        p.cmts.push(result);
      }
      const cm = document.getElementById("cm_" + id);
      if (cm) {
        const d = document.createElement("div");
        d.className = "cmt";
        d.innerHTML =
          avHTML(CU.id || CU._id, "av28") +
          '<div class="cmt-body" style="margin-left:8px"><span class="cmt-name">' +
          CU.name +
          "</span><br>" +
          esc(text) +
          "</div>";
        cm.insertBefore(d, cm.lastElementChild);
      }
      if (inp) inp.value = "";
      MC.success("Reply posted 🙏");
    } catch (err) {
      MC.error("Failed to post comment");
    }
  };

  // =============================================
  // Override toggleRepost/Bookmark for API
  // =============================================
  window.doRepost = async function () {
    if (!CU || !activeRP) return;
    try {
      const result = await API.toggleRepost(activeRP);
      const p = getPost(activeRP);
      if (p) p.reposts = result.reposts;
      MC.success(result.reposted ? "Reposted! 🔁" : "Repost removed");
    } catch {
      MC.error("Repost failed");
    }
    closeRP();
    renderFeed();
  };

  const _origToggleBM = window.toggleBM;
  window.toggleBM = async function (id, btn, e) {
    if (e) e.stopPropagation();
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    try {
      const result = await API.toggleBookmark(id);
      const p = getPost(id);
      if (p) p.bm = result.bookmarks;
      const saved = result.bookmarked;
      if (btn) {
        btn.className = "pa" + (saved ? " saved" : "");
        const sv = btn.querySelector("svg");
        if (sv) {
          sv.style.fill = saved ? "var(--ad)" : "";
          sv.style.stroke = saved ? "var(--ad)" : "";
        }
      }
      MC.info(saved ? "Saved to bookmarks 🔖" : "Removed from bookmarks");
    } catch {
      _origToggleBM(id, btn, e);
    }
  };

  // =============================================
  // Override castVote for API
  // =============================================
  window.castVote = async function (id, opt) {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    try {
      const result = await API.castVote(id, opt);
      const p = getPost(id);
      if (p && result.poll) p.poll = result.poll;
      renderFeed();
      MC.success("Vote cast! 🗳");
    } catch (err) {
      MC.error(err.message || "Already voted");
    }
  };

  // =============================================
  // Override submitPost for API
  // =============================================
  window.submitPost = async function () {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    const txt = document.getElementById("compTxt")?.value?.trim() || "";
    if (!txt && !compImg && !compYTId) {
      MC.warn("Please write something or add a YouTube video to share 🙏");
      return;
    }

    let poll = null;
    const pa = document.getElementById("pollArea");
    if (pa && !pa.classList.contains("hide")) {
      const o1 = document.getElementById("p1")?.value?.trim() || "";
      const o2 = document.getElementById("p2")?.value?.trim() || "";
      const o3 = document.getElementById("p3")?.value?.trim() || "";
      if (o1 && o2) poll = { opts: [o1, o2, ...(o3 ? [o3] : [])] };
    }

    // Upload image if present
    let imageUrl = compImg;
    if (compImg && compImg.startsWith("data:")) {
      try {
        const uploadResult = await API.uploadBase64(compImg);
        imageUrl = uploadResult.url;
      } catch {
        // Use data URL as fallback
      }
    }

    try {
      const newPost = await API.createPost(txt, imageUrl, compYTId, poll);
      _cachedPosts.unshift(newPost);
      window.clearAppDataCache?.();

      const ta = document.getElementById("compTxt");
      if (ta) ta.value = "";
      removeCompImg();
      clearYTLink();
      const ytRow = document.getElementById("ytLinkRow");
      if (ytRow) ytRow.classList.add("hide");
      const ytBtn = document.getElementById("ytBtn");
      if (ytBtn) ytBtn.style.color = "";
      document.getElementById("pollArea")?.classList.add("hide");
      document.getElementById("emojiArea")?.classList.add("hide");
      closeOvl("compOvl");
      renderFeed();
      MC.success("Posted! 🙏");
      if (curPage !== "home") gp("home");
    } catch (err) {
      MC.error("Failed to create post: " + err.message);
    }
  };

  // =============================================
  // Override delPost for API
  // =============================================
  window.delPost = async function (id) {
    if (!CU) return;
    try {
      await API.deletePost(id);
      _cachedPosts = _cachedPosts.filter(
        (p) => (p.id || p._id || "").toString() !== id.toString()
      );
      window.clearAppDataCache?.();
      closeMore();
      const el = document.getElementById("pt_" + id);
      if (el) el.remove();
      MC.info("Post deleted");
    } catch {
      MC.error("Failed to delete post");
    }
  };

  // =============================================
  // Override toggleFollow for API
  // =============================================
  window.toggleFollow = async function (uid, btn) {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    if (uid === (CU.id || CU._id || "").toString()) return;
    if (typeof isUserBlocked === "function" && isUserBlocked(uid)) {
      MC.warn("Unblock this user from Settings & Privacy before following.");
      return;
    }

    try {
      const result = await API.toggleFollow(uid);
      // Update local state
      CU.following = result.myFollowing;
      API.setUser(CU);

      const tu = getUser(uid);
      if (tu) tu.followers = result.targetFollowers;
      window.clearAppDataCache?.();

      const now = result.following;
      if (btn) {
        btn.textContent = now ? "Following" : "Follow";
        btn.className = "btn btn-sm " + (now ? "btn-w" : "btn-p");
      }
      MC.info(
        now
          ? "Following @" + (tu?.handle || "user") + " 🙏"
          : "Unfollowed"
      );
      renderWidgets();
      if (curProfId === uid) renderProfile(uid);
    } catch {
      MC.error("Failed to follow/unfollow");
    }
  };

  // =============================================
  // Override renderNotifs for API
  // =============================================
  const _origRenderNotifs = window.renderNotifs;
  window.renderNotifs = async function (filter) {
    if (!API.getToken()) {
      _origRenderNotifs(filter);
      return;
    }
    try {
      const notifs = await API.getNotifications();
      const c = document.getElementById("notifsWrap");
      if (!c) return;

      let filtered =
        typeof filterVisibleNotifications === "function"
          ? filterVisibleNotifications(notifs)
          : notifs;
      if (filter === "mentions")
        filtered = filtered.filter((n) => n.type === "comment" || n.type === "mention");
      if (filter === "pranams")
        filtered = filtered.filter((n) => n.type === "like");

      const icons = {
        like: "❤️",
        comment: "💬",
        repost: "🔁",
        follow: "👤",
      };

      if (!filtered.length) {
        c.innerHTML =
          '<div class="empty"><div class="empty-ico">🔔</div><div class="empty-ttl">No notifications yet</div></div>';
        if (typeof refreshNotificationBadges === "function") {
          refreshNotificationBadges();
        }
        return;
      }

      c.innerHTML = filtered
        .map((n) => {
          const u = n.sender || {};
          const ini = getIni(u.name || "U");
          const avH = u.avatar
            ? '<img src="' + u.avatar + '" alt="">'
            : ini;
          return (
            '<div class="notif' +
            (n.unread ? " unread" : "") +
            '" onclick="handleNC(\'' +
            (n.pid || "") +
            "','" +
            ((n.from || n.sender?._id || "") + "") +
            "')\">" +
            '<div class="notif-ico" style="background:var(--a)">' +
            (icons[n.type] || "🔔") +
            "</div>" +
            '<div style="display:flex;align-items:center;gap:8px;flex:1">' +
            '<div class="av av36">' +
            avH +
            "</div>" +
            "<div>" +
            '<div class="notif-txt"><strong>' +
            (u.name || "Someone") +
            "</strong> " +
            n.txt +
            (Number(n.count) > 1 ? " (" + Number(n.count) + ")" : "") +
            "</div>" +
            '<div class="notif-tm">' +
            [n.t, n.priority].filter(Boolean).join(" • ") +
            "</div>" +
            "</div></div></div>"
          );
        })
        .join("");

      // Mark read
      API.markNotificationsRead().catch(() => {});
      if (typeof setNotificationBadgeVisible === "function") {
        setNotificationBadgeVisible(false);
      }
    } catch {
      _origRenderNotifs(filter);
    }
  };

  // =============================================
  // Override addNotif — notifications now handled by backend
  // =============================================
  window.addNotif = function () {
    // No-op — the API routes create notifications automatically
  };

  // =============================================
  // Override handleAvUp/handleBanner — upload to Cloudinary
  // =============================================
  window.handleAvUp = async function (e) {
    const f = e.target?.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async (ev) => {
      const src = ev.target.result;
      const epAv = document.getElementById("epAv");
      if (epAv) epAv.innerHTML = '<img src="' + src + '" alt="">';

      // Try uploading to Cloudinary
      let url = src;
      if (API.getToken()) {
        try {
          const result = await API.uploadBase64(src, "tirth-sutra/avatars");
          url = result.url;
        } catch {}
      }
      updateUser(CU.id || CU._id, { avatar: url });
      syncAvatars();
    };
    r.readAsDataURL(f);
  };

  window.handleBanner = async function (e) {
    const f = e.target?.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async (ev) => {
      const src = ev.target.result;
      const bi = document.getElementById("epBanner");
      if (bi) {
        bi.src = src;
        bi.style.display = "block";
      }
      let url = src;
      if (API.getToken()) {
        try {
          const result = await API.uploadBase64(src, "tirth-sutra/banners");
          url = result.url;
        } catch {}
      }
      updateUser(CU.id || CU._id, { banner: url });
    };
    r.readAsDataURL(f);
  };

  // =============================================
  // Override saveEP for API
  // =============================================
  window.saveEP = async function () {
    if (!CU) return;
    const nm = document.getElementById("epNm")?.value?.trim() || "";
    if (!nm) {
      MC.error("Name is required");
      return;
    }
    const updates = {
      name: nm,
      bio: document.getElementById("epBio")?.value?.trim() || "",
      location: document.getElementById("epLoc")?.value?.trim() || "",
      website: document.getElementById("epWeb")?.value?.trim() || "",
      ...(typeof getProfileOptionalUpdates === "function"
        ? getProfileOptionalUpdates()
        : {}),
    };

    updateUser(CU.id || CU._id, updates);
    closeOvl("epOvl");
    renderProfile(CU.id || CU._id);
    syncAvatars();
    MC.success("Profile updated! 🙏");
  };

  // =============================================
  // Override trackVidView for API
  // =============================================
  window.trackVidView = function (id) {
    const v = getVideo(id);
    if (v) v.views = (v.views || 0) + 1;
    if (API.getToken()) {
      API.viewVideo(id).catch(() => {});
    }
  };

  // =============================================
  // Data Loading from Backend
  // =============================================
  async function loadAllData() {
    try {
      const [users, posts, videos, vidStories] = await Promise.all([
        API.getAllUsers().catch(() => []),
        API.getPosts().catch(() => []),
        API.getVideos().catch(() => []),
        API.getVideoStories().catch(() => []),
      ]);

      _cachedUsers = users || [];
      _cachedPosts = posts || [];

      _cachedVideos = (videos || []).filter((v) => !v.live);
      _cachedLiveStreams = mapLiveStreamsFromVideos(videos || []);

      _cachedVidStories = vidStories || [];

      _dataLoaded = true;
      writeBootCache();
      loadTrendingHashtagDiscovery().catch(() => {});
      return true;
    } catch (err) {
      console.error("Failed to load data from backend:", err);
      return false;
    }
  }

  // =============================================
  // Load notification badge count
  // =============================================
  async function checkNotifications() {
    if (!API.getToken()) return;
    try {
      const notifs = await API.getNotifications();
      const unread = (
        typeof filterVisibleNotifications === "function"
          ? filterVisibleNotifications(notifs)
          : notifs
      ).some((item) => item.unread);
      if (typeof setNotificationBadgeVisible === "function") {
        setNotificationBadgeVisible(unread);
      }
    } catch {}
  }
  window.checkNotifications = checkNotifications;

  // =============================================
  // Enhanced Search — warm results from backend
  // =============================================
  const _origDoSearch = window.doSearch;
  const _origGetSearchHashtags = window.getSearchHashtags;

  window.getSearchHashtags = function () {
    const base =
      typeof _origGetSearchHashtags === "function" ? _origGetSearchHashtags() : [];
    return mergeHashtagCollections(
      base,
      _remoteHashtagDiscovery,
      _remoteSearchHashtags
    );
  };

  window.doSearch = function (q) {
    const query = String(q || "").trim();
    const requestId = ++_activeSearchRequestId;
    const rendered =
      typeof _origDoSearch === "function" ? _origDoSearch(q) : undefined;

    if (!query || !API?.searchAll) {
      _remoteSearchHashtags = [];
      return rendered;
    }

    API.searchAll(query, curSTabVal || "all", 12)
      .then((result) => {
        if (requestId !== _activeSearchRequestId) return;
        mergeSearchResultsIntoCaches(result);
        _remoteSearchHashtags = Array.isArray(result?.hashtags)
          ? result.hashtags
          : [];
        if (typeof _origDoSearch === "function") {
          _origDoSearch(query);
        }
      })
      .catch(() => {});

    return rendered;
  };

  // =============================================
  // ======= REAL-TIME CHAT MODULE =======
  // Overrides all chat functions from Script.js
  // to use backend API + Socket.io
  // =============================================

  // In-memory cache of conversations from the backend
  let _cachedConversations = []; // from GET /api/messages
  let _conversationMessages = {}; // convId -> messages array
  let _currentConvId = null; // currently open conversation
  let _typingIndicatorTimer = null;
  let _chatReplyDraft = null;
  let _chatMsgMenuState = null;
  let _chatForwardMessage = null;
  let _chatLongPressTimer = null;

  // ── Helper: get userId string ──
  function myId() {
    if (!CU) return "";
    return (CU.id || CU._id || "").toString();
  }

  // ── Helper: format chat timestamp ──
  function fmtChatTs(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; // e.g. "Just now"
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { day: "2-digit", month: "short" });
  }

  function fmtMsgTs(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function getConversationById(convId) {
    return _cachedConversations.find(
      (conv) => (conv.id || conv._id || "").toString() === (convId || "").toString()
    );
  }

  function getConversationParticipants(conv) {
    return (conv?.participants || [])
      .map((participant) => (participant._id || participant.id || participant || "").toString())
      .filter(Boolean);
  }

  function getAttachmentLabel(attachment) {
    if (!attachment) return "Attachment";
    switch (attachment.kind) {
      case "image":
        return "Photo";
      case "video":
        return "Video";
      case "audio":
        return "Audio";
      default:
        return attachment.name || "Document";
    }
  }

  function getAttachmentKindFromMime(mimeType = "") {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return "document";
  }

  function getReplyPreviewText(reply) {
    if (!reply) return "";
    if (reply.text) return reply.text;
    if (reply.attachmentName) return reply.attachmentName;
    if (reply.attachmentKind) return getAttachmentLabel(reply);
    return "Message";
  }

  function getMessagePreview(m) {
    if (!m) return "";
    if (m.deleted) return "This message was deleted";
    if (m.txt) return m.txt;
    if (m.attachments?.length) {
      return "📎 " + getAttachmentLabel(m.attachments[0]);
    }
    return "Message";
  }

  function formatLastSeen(dateStr) {
    if (!dateStr) return "last seen recently";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "last seen recently";
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return "last seen just now";
    if (diff < 3600000) return "last seen " + Math.max(1, Math.floor(diff / 60000)) + "m ago";
    if (diff < 86400000) return "last seen " + Math.max(1, Math.floor(diff / 3600000)) + "h ago";
    return (
      "last seen " +
      d.toLocaleDateString([], {
        day: "numeric",
        month: "short",
      })
    );
  }

  function getChatHeaderStatus(conv) {
    if (!conv || conv.isGroup) {
      return (conv?.participants?.length || 0) + " members";
    }
    const uid = conv.uid ? conv.uid.toString() : "";
    if (uid && SocketClient.isUserOnline(uid)) return "🟢 online";
    return formatLastSeen(conv.user?.lastSeen);
  }

  function getOutgoingStatus(m, conv) {
    if (!m) return "";
    if (m.status) return m.status;
    if (m.read) return "read";
    if (m.delivered) return "delivered";
    const participants = getConversationParticipants(conv);
    const recipientCount = participants.filter((id) => id !== myId()).length;
    const readCount = (m.readBy || []).length;
    const deliveredCount = (m.deliveredTo || []).length;
    if (recipientCount > 0 && readCount >= recipientCount) return "read";
    if (deliveredCount > 0) return "delivered";
    return "sent";
  }

  function renderTickHtml(status) {
    const tickSvg =
      '<svg class="msg-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    if (status === "queued" || status === "sending") {
      return '<span class="msg-tick-wrap"><span class="msg-queued-state">' +
        (status === "sending" ? "sending" : "queued") +
        "</span></span>";
    }
    if (status === "read") {
      return '<span class="msg-tick-wrap">' +
        tickSvg.replace('class="msg-tick"', 'class="msg-tick double tick-read"') +
        tickSvg.replace('class="msg-tick"', 'class="msg-tick double tick-read"') +
        "</span>";
    }
    if (status === "delivered") {
      return '<span class="msg-tick-wrap">' +
        tickSvg.replace('class="msg-tick"', 'class="msg-tick double tick-delivered"') +
        tickSvg.replace('class="msg-tick"', 'class="msg-tick double tick-delivered"') +
        "</span>";
    }
    return '<span class="msg-tick-wrap">' +
      tickSvg.replace('class="msg-tick"', 'class="msg-tick tick-sent"') +
      "</span>";
  }

  function renderReplyHtml(reply) {
    if (!reply) return "";
    return (
      '<div class="msg-bubble-reply">' +
      '<div class="msg-bubble-reply-name">' +
      esc(reply.senderName || "Message") +
      "</div>" +
      '<div class="msg-bubble-reply-text">' +
      esc(getReplyPreviewText(reply)) +
      "</div>" +
      "</div>"
    );
  }

  function renderAttachmentsHtml(message) {
    const attachments = message.attachments || [];
    if (!attachments.length) return "";

    return attachments
      .map((attachment) => {
        if (attachment.kind === "image") {
          return '<img class="msg-bubble-img" src="' + attachment.url + '" alt="' + esc(attachment.name || "Photo") + '">';
        }
        if (attachment.kind === "video") {
          return '<video class="msg-bubble-video" src="' + attachment.url + '" controls playsinline preload="metadata"></video>';
        }
        if (attachment.kind === "audio") {
          return '<audio class="msg-bubble-audio" src="' + attachment.url + '" controls preload="metadata"></audio>';
        }
        return (
          '<a class="msg-bubble-doc" href="' +
          attachment.url +
          '" target="_blank" rel="noopener">' +
          '<span class="msg-bubble-doc-ico">📄</span>' +
          '<span class="msg-bubble-doc-meta">' +
          '<span class="msg-bubble-doc-name">' +
          esc(attachment.name || "Document") +
          "</span>" +
          '<span class="msg-bubble-doc-sub">' +
          esc((attachment.mimeType || "document").replace("application/", "")) +
          "</span>" +
          "</span></a>"
        );
      })
      .join("");
  }

  function buildMessageRowHtml(chatId, message, prevMessage) {
    const conv = getConversationById(chatId);
    const isGroup = !!conv?.isGroup;
    const isOut = message.isMe || (message.from && message.from.toString() === myId());
    const sender = message.sender || {};
    const senderName = sender.name || "Unknown";
    const showAv =
      !isOut &&
      isGroup &&
      (!prevMessage || (prevMessage.from?.toString() !== message.from?.toString()));
    const ini = getIni(senderName);
    const avHtml = `<div class="msg-av-small">${sender.avatar ? '<img src="' + sender.avatar + '">' : ini}</div>`;
    const avOrSpacer =
      !isOut && isGroup
        ? showAv
          ? avHtml
          : '<div class="msg-av-placeholder"></div>'
        : "";
    const d = message.ts ? new Date(message.ts) : null;
    const timeStr = d && !isNaN(d.getTime()) ? fmtMsgTs(d) : (message.t || "");
    const tickHtml = isOut ? renderTickHtml(getOutgoingStatus(message, conv)) : "";
    const bubbleHandlers =
      message.status === "queued" || message.status === "sending"
        ? ""
        : ' oncontextmenu="openChatMessageMenu(event,\'' +
          chatId +
          "','" +
          message.id +
          '\');return false" onpointerdown="startChatMessagePress(event,\'' +
          chatId +
          "','" +
          message.id +
          '\')" onpointerup="endChatMessagePress()" onpointerleave="endChatMessagePress()" onpointercancel="endChatMessagePress()"';

    return `<div class="msg-row ${isOut ? "out" : "in"}">
      ${avOrSpacer}
      <div class="msg-bubble"${bubbleHandlers}>
        ${showAv ? '<div class="msg-sender-name">' + esc(senderName) + "</div>" : ""}
        ${message.forwarded ? '<div class="msg-bubble-forwarded">Forwarded</div>' : ""}
        ${renderReplyHtml(message.replyTo)}
        ${renderAttachmentsHtml(message)}
        ${message.txt ? '<div class="' + (message.deleted ? "msg-bubble-deleted" : "") + '">' + esc(message.txt) + "</div>" : ""}
        <div class="msg-meta">
          <span class="msg-time">${timeStr}</span>
          ${tickHtml}
        </div>
      </div>
    </div>`;
  }

  function upsertConversationMessage(convId, message) {
    if (!convId || !message) return message;
    if (!_conversationMessages[convId]) {
      _conversationMessages[convId] = [];
    }

    const targetId = (message.id || "").toString();
    const targetClientId = (message.clientId || "").toString();
    const existingIndex = _conversationMessages[convId].findIndex((item) => {
      const itemId = (item.id || "").toString();
      const itemClientId = (item.clientId || "").toString();
      return (
        (targetId && itemId === targetId) ||
        (targetClientId && itemClientId === targetClientId) ||
        (targetClientId && itemId === targetClientId)
      );
    });

    if (existingIndex > -1) {
      _conversationMessages[convId][existingIndex] = {
        ..._conversationMessages[convId][existingIndex],
        ...message,
      };
      return _conversationMessages[convId][existingIndex];
    }

    _conversationMessages[convId].push(message);
    _conversationMessages[convId].sort((left, right) => {
      const leftSeq = Number(left?.seq) || 0;
      const rightSeq = Number(right?.seq) || 0;
      if (leftSeq && rightSeq && leftSeq !== rightSeq) {
        return leftSeq - rightSeq;
      }
      return new Date(left.ts || 0).getTime() - new Date(right.ts || 0).getTime();
    });
    return message;
  }

  function buildQueuedMessageDraft(payload, clientId) {
    const now = new Date().toISOString();
    return {
      id: clientId,
      clientId,
      seq: 0,
      from: myId(),
      sender: {
        _id: myId(),
        name: CU?.name || "You",
        handle: CU?.handle || "",
        avatar: CU?.avatar || null,
      },
      txt: payload.text || "",
      ts: now,
      t: "Queued",
      read: false,
      delivered: false,
      status: "queued",
      isMe: true,
      deleted: false,
      forwarded: !!payload.forwarded,
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      replyTo: payload.replyTo || null,
    };
  }

  function reconcilePendingMessage(detail) {
    const convId = (detail?.convId || "").toString();
    const clientId = (detail?.clientId || "").toString();
    const message = detail?.message;
    if (!convId || !message) return;

    const normalized = {
      ...message,
      clientId: message.clientId || clientId,
      isMe: true,
    };

    upsertConversationMessage(convId, normalized);
    updateConversationPreview(convId, normalized);
    if (activeChatId === convId) {
      renderChatMessages(convId);
    }
    if (curPage === "chats") {
      updateChatItemDOM(convId, getMessagePreview(normalized), "just now", 0);
    }
  }

  function syncReplyPreview() {
    const box = document.getElementById("chatReplyPreview");
    if (!box) return;
    if (!_chatReplyDraft || _chatReplyDraft.chatId !== activeChatId) {
      box.classList.add("hide");
      box.innerHTML = "";
      return;
    }
    box.classList.remove("hide");
    box.innerHTML =
      '<div class="chat-reply-preview-main">' +
      '<div class="chat-reply-preview-title">Replying to ' +
      esc(_chatReplyDraft.senderName || "message") +
      "</div>" +
      '<div class="chat-reply-preview-text">' +
      esc(getReplyPreviewText(_chatReplyDraft)) +
      "</div></div>" +
      '<button class="chat-reply-preview-close" onclick="clearChatReply()" aria-label="Cancel reply">✕</button>';
  }

  function closeChatMessageMenu() {
    document.getElementById("chatMsgMenu")?.classList.add("hide");
    _chatMsgMenuState = null;
  }

  function updateConversationPreview(convId, message) {
    const conv = getConversationById(convId);
    if (!conv) return;
    conv.lastMessage = getMessagePreview(message);
    conv.lastMessageTime = message.ts || new Date().toISOString();
  }

  // ── Load conversations from API ──
  async function loadConversations() {
    if (!API.getToken()) return [];
    try {
      _cachedConversations = await API.getConversations();
      return _cachedConversations;
    } catch (err) {
      console.error("Failed to load conversations:", err);
      return [];
    }
  }

  // ── Load messages for a conversation ──
  async function loadMessages(convId) {
    if (!API.getToken() || !convId) return [];
    try {
      const data = await API.getMessages(convId);
      _conversationMessages[convId] = data.messages || [];
      return data;
    } catch (err) {
      console.error("Failed to load messages:", err);
      return { messages: [] };
    }
  }

  window.clearChatReply = function () {
    _chatReplyDraft = null;
    syncReplyPreview();
  };

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#chatMsgMenu")) {
      closeChatMessageMenu();
    }
  });

  document.addEventListener(
    "scroll",
    () => {
      closeChatMessageMenu();
    },
    true
  );

  window.startChatMessagePress = function (event, chatId, messageId) {
    endChatMessagePress();
    if (event.pointerType && event.pointerType !== "touch") return;
    _chatLongPressTimer = setTimeout(() => {
      openChatMessageMenu(event, chatId, messageId);
    }, 420);
  };

  window.endChatMessagePress = function () {
    if (_chatLongPressTimer) {
      clearTimeout(_chatLongPressTimer);
      _chatLongPressTimer = null;
    }
  };

  window.openChatMessageMenu = function (event, chatId, messageId) {
    const messages = _conversationMessages[chatId] || [];
    const message = messages.find((item) => (item.id || "").toString() === messageId.toString());
    const menu = document.getElementById("chatMsgMenu");
    if (!message || !menu) return;

    if (event?.preventDefault) event.preventDefault();
    if (event?.stopPropagation) event.stopPropagation();

    const isOut = message.isMe || (message.from && message.from.toString() === myId());
    const canDeleteForEveryone = isOut && !message.deleted;

    menu.innerHTML =
      '<button class="chat-msg-action" onclick="replyToChatMessage(\'' +
      chatId +
      "','" +
      messageId +
      '\')">Reply</button>' +
      '<button class="chat-msg-action" onclick="openChatForwardPicker(\'' +
      chatId +
      "','" +
      messageId +
      '\')">Forward</button>' +
      '<button class="chat-msg-action red" onclick="deleteChatMessage(\'me\')">Delete for me</button>' +
      (canDeleteForEveryone
        ? '<button class="chat-msg-action red" onclick="deleteChatMessage(\'everyone\')">Delete for everyone</button>'
        : "");

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const x = event?.clientX ?? viewportWidth / 2;
    const y = event?.clientY ?? viewportHeight / 2;
    menu.style.left = Math.min(x, viewportWidth - 190) + "px";
    menu.style.top = Math.min(y, viewportHeight - 220) + "px";
    menu.classList.remove("hide");
    _chatMsgMenuState = { chatId, messageId };
  };

  window.replyToChatMessage = function (chatId, messageId) {
    closeChatMessageMenu();
    const message = (_conversationMessages[chatId] || []).find(
      (item) => (item.id || "").toString() === messageId.toString()
    );
    if (!message) return;

    _chatReplyDraft = {
      chatId,
      messageId,
      sender: (message.sender?._id || message.from || "").toString(),
      senderName: message.sender?.name || (message.isMe ? CU?.name : "Message"),
      text: message.txt || "",
      attachmentKind: message.attachments?.[0]?.kind || "",
      attachmentName: message.attachments?.[0]?.name || getAttachmentLabel(message.attachments?.[0]),
    };
    syncReplyPreview();
    document.getElementById("chatMsgInput")?.focus();
  };

  window.openChatForwardPicker = function (chatId, messageId) {
    closeChatMessageMenu();
    _chatForwardMessage = { chatId, messageId };
    const input = document.getElementById("chatForwardSearch");
    if (input) input.value = "";
    filterChatForwardTargets("");
    openOvl("chatForwardModal");
  };

  window.filterChatForwardTargets = function (query) {
    const list = document.getElementById("chatForwardList");
    if (!list) return;
    const q = (query || "").trim().toLowerCase();
    const items = _cachedConversations.filter((conv) => {
      const name = conv.isGroup ? conv.groupName || "Group" : conv.user?.name || "Unknown";
      return !q || name.toLowerCase().includes(q);
    });

    if (!items.length) {
      const following = new Set((CU?.following || []).map((id) => (id || "").toString()));
      const followers = new Set((CU?.followers || []).map((id) => (id || "").toString()));
      const suggestions = getUsers()
        .filter((u) => (u.id || u._id || "").toString() !== myId())
        .map((u) => {
          const uid = (u.id || u._id || "").toString();
          const score =
            (following.has(uid) ? 4 : 0) +
            (followers.has(uid) ? 3 : 0) +
            (u.verified ? 1 : 0);
          return { user: u, uid, score };
        })
        .sort((a, b) => b.score - a.score || a.user.name.localeCompare(b.user.name))
        .slice(0, 8);

      if (suggestions.length) {
        c.innerHTML =
          '<div style="padding:16px 14px 8px;font-size:13px;font-weight:700;color:var(--t2)">People you can message</div>' +
          suggestions
            .map(({ user, uid }) => {
              const online = SocketClient.isUserOnline(uid);
              return `<div class="dm-user-item" onclick="startDMWith('${uid}')" style="margin:0 10px">
                <div class="av av36">${user.avatar ? '<img src="' + user.avatar + '">' : getIni(user.name)}</div>
                <div style="min-width:0">
                  <div style="font-weight:600;font-size:14px">${esc(user.name)}${user.verified ? " 🔱" : ""} ${online ? '<span style="color:#4caf50;font-size:11px">● online</span>' : ""}</div>
                  <div style="font-size:12px;color:var(--t3)">@${esc(user.handle || "")}</div>
                </div>
              </div>`;
            })
            .join("");
        return;
      }
      list.innerHTML = '<div class="empty-sub" style="padding:10px 0">No chats found.</div>';
      return;
    }

    list.innerHTML = items
      .map((conv) => {
        const id = (conv.id || conv._id || "").toString();
        const name = conv.isGroup ? conv.groupName || "Group" : conv.user?.name || "Unknown";
        const sub = conv.lastMessage || "Tap to forward here";
        const avatarHtml = conv.isGroup
          ? '<div class="av av36">👥</div>'
          : '<div class="av av36">' +
            (conv.user?.avatar ? '<img src="' + conv.user.avatar + '">' : getIni(name)) +
            "</div>";
        return (
          '<div class="chat-forward-item" onclick="forwardChatMessageTo(\'' +
          id +
          "')\">" +
          avatarHtml +
          '<div class="chat-forward-item-meta">' +
          '<div class="chat-forward-item-name">' +
          esc(name) +
          "</div>" +
          '<div class="chat-forward-item-sub">' +
          esc(sub) +
          "</div></div></div>"
        );
      })
      .join("");
  };

  window.forwardChatMessageTo = async function (targetConvId) {
    if (!_chatForwardMessage) return;
    try {
      const payload = await API.forwardMessage(
        _chatForwardMessage.chatId,
        _chatForwardMessage.messageId,
        targetConvId
      );

      if (!_conversationMessages[targetConvId]) {
        _conversationMessages[targetConvId] = [];
      }
      _conversationMessages[targetConvId].push(payload);
      updateConversationPreview(targetConvId, payload);
      await loadConversations();
      if (curPage === "chats") renderChatsList();
      if (activeChatId === targetConvId) {
        appendChatMessageDOM(payload, targetConvId);
        updateChatItemDOM(targetConvId, getMessagePreview(payload), "just now", 0);
      }
      _chatForwardMessage = null;
      closeOvl("chatForwardModal");
      MC.success("Message forwarded");
    } catch (err) {
      MC.error("Could not forward message: " + (err.message || ""));
    }
  };

  window.deleteChatMessage = async function (scope) {
    if (!_chatMsgMenuState) return;
    const { chatId, messageId } = _chatMsgMenuState;
    closeChatMessageMenu();

    try {
      await API.deleteMessage(chatId, messageId, scope);
      if (scope === "everyone") {
        const target = (_conversationMessages[chatId] || []).find(
          (item) => (item.id || "").toString() === messageId.toString()
        );
        if (target) {
          target.deleted = true;
          target.txt = "This message was deleted";
          target.attachments = [];
          target.replyTo = null;
          target.forwarded = false;
          target.status = "";
        }
      } else {
        _conversationMessages[chatId] = (_conversationMessages[chatId] || []).filter(
          (item) => (item.id || "").toString() !== messageId.toString()
        );
        if (_chatReplyDraft?.messageId?.toString() === messageId.toString()) {
          window.clearChatReply();
        }
      }

      await loadConversations();
      if (activeChatId === chatId) {
        renderChatMessages(chatId);
      }
      if (curPage === "chats") renderChatsList();
      MC.info(scope === "everyone" ? "Message deleted for everyone" : "Message deleted");
    } catch (err) {
      MC.error("Could not delete message: " + (err.message || ""));
    }
  };

  // =============================================
  // Override renderChatsPage
  // =============================================
  window.renderChatsPage = async function () {
    if (!CU) {
      const c = document.getElementById("chatsList");
      if (c)
        c.innerHTML =
          '<div class="empty" style="padding:40px 20px"><div class="empty-ico">💬</div><div class="empty-sub">Sign in to chat</div><button class="btn btn-p" style="margin-top:12px" onclick="openOvl(\'authOvl\')">Sign In</button></div>';
      return;
    }
    await loadConversations();
    renderChatsList();
    if (window.innerWidth >= 641) {
      const win = document.getElementById("chatWindow");
      if (win) win.classList.remove("hide");
      const bar = document.getElementById("chatWinBar");
      if (bar) bar.style.display = "none";
      const empty = document.getElementById("chatEmptyState");
      if (empty) {
        empty.style.display = "flex";
        empty.style.flexDirection = "column";
      }
    } else {
      const win = document.getElementById("chatWindow");
      if (win) win.classList.add("hide");
      activeChatId = null;
    }
  };

  // =============================================
  // Override renderChatsList — uses backend data
  // =============================================
  window.renderChatsList = function () {
    const c = document.getElementById("chatsList");
    if (!c) return;

    let items = _cachedConversations.map((conv) => {
      const isGroup = conv.isGroup;
      const uid = conv.uid ? conv.uid.toString() : "";
      const user = conv.user || {};
      const online = uid ? SocketClient.isUserOnline(uid) : false;
      return {
        id: (conv.id || conv._id || "").toString(),
        type: isGroup ? "group" : "direct",
        name: isGroup ? conv.groupName : user.name || "Unknown",
        online: online,
        uid: uid,
        avatar: user.avatar || null,
        verified: user.verified || false,
        lastMsg: conv.lastMessage || "",
        lastTime: fmtChatTs(conv.lastMessageTime || ""),
        unread: conv.unreadCount || 0,
        participants: conv.participants || [],
      };
    });

    if (typeof isUserBlocked === "function") {
      items = items.filter((item) => item.type === "group" || !isUserBlocked(item.uid));
    }

    // Apply filters
    const q = (
      document.getElementById("chatsSearchIn")?.value || ""
    ).toLowerCase();
    if (chatFilter === "direct") items = items.filter((i) => i.type === "direct");
    if (chatFilter === "groups") items = items.filter((i) => i.type === "group");
    if (chatFilter === "unread") items = items.filter((i) => i.unread > 0);
    if (q) items = items.filter((i) => i.name.toLowerCase().includes(q));

    if (
      activeChatId &&
      !items.some((item) => item.id === activeChatId) &&
      typeof closeChatWindow === "function"
    ) {
      closeChatWindow();
    }

    if (!items.length) {
      c.innerHTML =
        '<div class="empty" style="padding:40px 20px"><div class="empty-ico">💬</div><div class="empty-sub">No chats yet — start a conversation!</div></div>';
      return;
    }

    c.innerHTML = items
      .map((item) => {
        const isActive = item.id === activeChatId;
        const ini = getIni(item.name);
        const avHtml = item.type === "group"
          ? `<div style="width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--pl));display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0">👥</div>`
          : `<div style="width:46px;height:46px;border-radius:50%;overflow:hidden;background:var(--p);display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:600;flex-shrink:0">${item.avatar ? '<img src="' + item.avatar + '" style="width:100%;height:100%;object-fit:cover">' : ini}</div>`;

        return `<div class="chat-item${isActive ? " active" : ""}" id="ci_${item.id}" onclick="openChatWindow('${item.id}')">
        <div class="chat-item-av">
          ${avHtml}
          ${item.online ? '<div class="chat-item-online" data-online-uid="' + item.uid + '"></div>' : '<div class="chat-item-online" data-online-uid="' + item.uid + '" style="display:none"></div>'}
        </div>
        <div class="chat-item-body">
          <div class="chat-item-top">
            <span class="chat-item-name">${esc(item.name)}${item.verified ? " 🔱" : ""} ${item.type === "group" ? '<span class="chat-group-badge">Group</span>' : ""}</span>
            <span class="chat-item-time${item.unread ? " unread-time" : ""}">${item.lastTime}</span>
          </div>
          <div class="chat-item-bottom">
            <span class="chat-item-prev${item.unread ? " bold" : ""}">${esc((item.lastMsg || "Tap to start chatting").substring(0, 55))}</span>
            ${item.unread ? '<span class="chat-unread-badge">' + (item.unread > 9 ? "9+" : item.unread) + "</span>" : ""}
          </div>
        </div>
      </div>`;
      })
      .join("");
  };

  // =============================================
  // Override openChatWindow — loads real messages
  // =============================================
  window.openChatWindow = async function (chatId) {
    if (!CU) {
      openOvl("authOvl");
      return;
    }

    // Leave previous conversation room
    if (_currentConvId && _currentConvId !== chatId) {
      SocketClient.leaveConversation(_currentConvId);
      SocketClient.emitStopTyping(_currentConvId);
    }

    activeChatId = chatId;
    _currentConvId = chatId;

    // Join this conversation's Socket.io room
    SocketClient.joinConversation(chatId);

    // Mark active in UI
    document.querySelectorAll(".chat-item").forEach((el) => el.classList.remove("active"));
    const el = document.getElementById("ci_" + chatId);
    if (el) el.classList.add("active");

    // Show chat window
    const win = document.getElementById("chatWindow");
    const bar = document.getElementById("chatWinBar");
    const empty = document.getElementById("chatEmptyState");
    if (win) win.classList.remove("hide");
    if (bar) bar.style.display = "flex";
    if (empty) empty.style.display = "none";

    // On mobile, go fullscreen (hide top/bottom nav)
    if (window.innerWidth < 641) {
      document.body.classList.add('chat-fullscreen');
    }

    // Find conversation info
    const conv = _cachedConversations.find(
      (c) => (c.id || c._id || "").toString() === chatId
    );

    const winAv = document.getElementById("chatWinAv");
    const winName = document.getElementById("chatWinName");
    const winSub = document.getElementById("chatWinSub");

    if (conv?.isGroup) {
      if (winAv)
        winAv.innerHTML =
          '<div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--pl));display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">👥</div>';
      if (winName) winName.textContent = conv.groupName || "Group";
      if (winSub)
        winSub.textContent = (conv.participants?.length || 0) + " members";
    } else {
      const u = conv?.user || {};
      const uid = conv?.uid ? conv.uid.toString() : "";
      const online = uid ? SocketClient.isUserOnline(uid) : false;
      const ini = getIni(u.name || "U");
      if (winAv)
        winAv.innerHTML = `<div style="width:38px;height:38px;border-radius:50%;overflow:hidden;background:var(--p);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:600;flex-shrink:0">${u.avatar ? '<img src="' + u.avatar + '" style="width:100%;height:100%;object-fit:cover">' : ini}</div>`;
      if (winName) winName.textContent = (u.name || "Unknown") + (u.verified ? " 🔱" : "");
      if (winSub) winSub.textContent = online ? "🟢 online" : "last seen recently";
      // Store uid for online status updates
      if (winSub) winSub.setAttribute("data-chat-uid", uid);
      if (winSub) {
        winSub.textContent = getChatHeaderStatus(conv);
        winSub.setAttribute("data-last-seen", u.lastSeen || "");
      }
    }

    // Load messages from API
    const data = await loadMessages(chatId);
    renderChatMessages(chatId, data.messages || []);

    // Emit read receipt
    SocketClient.emitMessageRead(chatId);

    // Update unread count in list
    if (conv) conv.unreadCount = 0;
    renderChatsList();

    setTimeout(() => document.getElementById("chatMsgInput")?.focus(), 100);
  };

  // =============================================
  // Override renderChatMessages — uses real data
  // =============================================
  window.renderChatMessages = function (chatId, msgs) {
    const c = document.getElementById("chatWinMsgs");
    if (!c) return;

    // If msgs not passed, use cached
    if (!msgs) msgs = _conversationMessages[chatId] || [];

    let rendered = "";
    let lastRenderedDate = "";
    msgs.forEach((message, idx) => {
      const ts = message.ts || message.t;
      let d;
      try {
        d = new Date(ts);
        if (isNaN(d.getTime())) d = null;
      } catch {
        d = null;
      }
      if (d) {
        const dateStr = d.toDateString();
        if (dateStr !== lastRenderedDate) {
          const now = new Date();
          const yest = new Date(now);
          yest.setDate(now.getDate() - 1);
          const label =
            dateStr === now.toDateString()
              ? "Today"
              : dateStr === yest.toDateString()
                ? "Yesterday"
                : d.toLocaleDateString([], {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  });
          rendered += '<div class="msg-date-sep"><span>' + label + "</span></div>";
          lastRenderedDate = dateStr;
        }
      }
      rendered += buildMessageRowHtml(chatId, message, msgs[idx - 1]);
    });

    c.innerHTML =
      rendered ||
      '<div class="chat-empty-state"><div style="font-size:36px;margin-bottom:8px">ðŸ‘‹</div><div style="font-size:14px;color:var(--t3)">Say hello!</div></div>';
    c.scrollTop = c.scrollHeight;
    syncReplyPreview();
    return;

    const conv = _cachedConversations.find(
      (cv) => (cv.id || cv._id || "").toString() === chatId
    );
    const isGroup = conv?.isGroup;

    let html = "";
    let lastDate = "";

    msgs.forEach((m, idx) => {
      // Date separators
      const ts = m.ts || m.t;
      let d;
      try {
        d = new Date(ts);
        if (isNaN(d.getTime())) d = null;
      } catch {
        d = null;
      }

      if (d) {
        const dateStr = d.toDateString();
        if (dateStr !== lastDate) {
          const now = new Date();
          const yest = new Date(now);
          yest.setDate(now.getDate() - 1);
          const label =
            dateStr === now.toDateString()
              ? "Today"
              : dateStr === yest.toDateString()
                ? "Yesterday"
                : d.toLocaleDateString([], {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  });
          html += '<div class="msg-date-sep"><span>' + label + "</span></div>";
          lastDate = dateStr;
        }
      }

      const isOut = m.isMe || (m.from && m.from.toString() === myId());
      const sender = m.sender || {};
      const senderName = sender.name || "Unknown";
      const prev = msgs[idx - 1];
      const showAv = !isOut && isGroup && (!prev || (prev.from?.toString() !== m.from?.toString()));
      const ini = getIni(senderName);

      const avHtml = `<div class="msg-av-small">${sender.avatar ? '<img src="' + sender.avatar + '">' : ini}</div>`;
      const avOrSpacer =
        !isOut && isGroup
          ? showAv
            ? avHtml
            : '<div class="msg-av-placeholder"></div>'
          : "";

      const tickClass = m.read ? "tick-read" : "tick-sent";
      const tickSvg = isOut
        ? `<svg class="msg-tick ${tickClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
        : "";

      const timeStr = d ? fmtMsgTs(d) : (m.t || "");

      html += `<div class="msg-row ${isOut ? "out" : "in"}">
        ${avOrSpacer}
        <div class="msg-bubble">
          ${showAv ? '<div class="msg-sender-name">' + esc(senderName) + "</div>" : ""}
          ${m.img ? '<img class="msg-bubble-img" src="' + m.img + '" alt="">' : ""}
          ${m.txt ? esc(m.txt) : ""}
          <div class="msg-meta">
            <span class="msg-time">${timeStr}</span>
            ${tickSvg}
          </div>
        </div>
      </div>`;
    });

    c.innerHTML =
      html ||
      '<div class="chat-empty-state"><div style="font-size:36px;margin-bottom:8px">👋</div><div style="font-size:14px;color:var(--t3)">Say hello!</div></div>';

    c.scrollTop = c.scrollHeight;
  };

  // =============================================
  // Override sendChatMessage — sends via API + Socket.io
  // =============================================
  async function sendChatPayload(payload, restoreText) {
    const convId = activeChatId;
    try {
      const msg = await API.sendMessage(convId, payload);
      upsertConversationMessage(convId, msg);
      updateConversationPreview(convId, msg);
      appendChatMessageDOM(msg, convId);
      updateChatItemDOM(convId, getMessagePreview(msg), "just now", 0);
      window.clearChatReply();
      return msg;
    } catch (err) {
      if (err?.queued) {
        const queuedMsg = buildQueuedMessageDraft(payload, err.clientId);
        upsertConversationMessage(convId, queuedMsg);
        updateConversationPreview(convId, queuedMsg);
        appendChatMessageDOM(queuedMsg, convId);
        updateChatItemDOM(convId, getMessagePreview(queuedMsg), "queued", 0);
        window.clearChatReply();
        MC?.info("Message queued. It will send automatically when your connection returns.");
        return queuedMsg;
      }
      throw err;
    }
  }

  window.sendChatMessage = async function () {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    if (!activeChatId) return;

    const inp = document.getElementById("chatMsgInput");
    const txt = inp?.value?.trim() || "";
    if (!txt) return;

    // Stop typing
    SocketClient.emitStopTyping(activeChatId);

    // Clear input immediately for responsiveness
    inp.value = "";

    const payload = {
      text: txt,
      attachments: [],
      replyTo: _chatReplyDraft
        ? {
            messageId: _chatReplyDraft.messageId,
            sender: _chatReplyDraft.sender,
            senderName: _chatReplyDraft.senderName,
            text: _chatReplyDraft.text || "",
            attachmentKind: _chatReplyDraft.attachmentKind || "",
            attachmentName: _chatReplyDraft.attachmentName || "",
          }
        : null,
    };

    try {
      await sendChatPayload(payload, txt);
      return;
    } catch (err) {
      MC.error("Failed to send message: " + (err.message || ""));
      inp.value = txt; // Restore text on error
    }
  };

  // =============================================
  // Override handleChatImgAttach — upload + send
  // =============================================
  window.handleChatImgAttach = async function (e) {
    if (!CU || !activeChatId) {
      openOvl("authOvl");
      return;
    }
    const f = e.target?.files?.[0];
    if (!f) return;

    const input = e.target;
    const replyTo = _chatReplyDraft
      ? {
          messageId: _chatReplyDraft.messageId,
          sender: _chatReplyDraft.sender,
          senderName: _chatReplyDraft.senderName,
          text: _chatReplyDraft.text || "",
          attachmentKind: _chatReplyDraft.attachmentKind || "",
          attachmentName: _chatReplyDraft.attachmentName || "",
        }
      : null;

    try {
      const uploaded = await API.uploadFile(f);
      const attachment = {
        kind: uploaded.type || getAttachmentKindFromMime(uploaded.mimeType || f.type),
        url: uploaded.url,
        name: uploaded.name || f.name,
        mimeType: uploaded.mimeType || f.type,
        size: uploaded.size || f.size || 0,
        duration: uploaded.duration ?? null,
      };
      await sendChatPayload(
        {
          text: "",
          attachments: [attachment],
          replyTo,
        },
        ""
      );
      if (input) input.value = "";
      return;
    } catch (err) {
      MC.error("Failed to send attachment: " + (err.message || ""));
      if (input) input.value = "";
      return;
    }

    const r = new FileReader();
    r.onload = async (ev) => {
      let imgUrl = ev.target.result;

      // Upload to Cloudinary
      try {
        const result = await API.uploadBase64(imgUrl, "tirth-sutra/chat");
        imgUrl = result.url;
      } catch {
        // Use data URL as fallback
      }

      // Send as image message
      try {
        const msg = await API.sendMessage(activeChatId, "📷 Photo");
        // The backend stores text, but we display the image locally
        msg.img = imgUrl;
        msg.txt = "";

        if (!_conversationMessages[activeChatId]) {
          _conversationMessages[activeChatId] = [];
        }
        _conversationMessages[activeChatId].push(msg);

        const conv = _cachedConversations.find(
          (c) => (c.id || c._id || "").toString() === activeChatId
        );
        const recipients = conv?.participants?.map((p) =>
          (p._id || p.id || p).toString()
        ) || [];

        SocketClient.sendMessage(activeChatId, Object.assign({}, msg, { isMe: false }), recipients);

        if (conv) {
          conv.lastMessage = "📷 Photo";
          conv.lastMessageTime = "Just now";
        }

        // Fast DOM updates
        appendChatMessageDOM(msg, activeChatId);
        updateChatItemDOM(activeChatId, "📷 Photo", "Just now", 0);
      } catch {
        MC.error("Failed to send image");
      }
    };
    r.readAsDataURL(f);
  };

  // =============================================
  // Override updateChatTyping for Socket.io
  // =============================================
  window.updateChatTyping = function () {
    if (!activeChatId || !CU) return;
    SocketClient.emitTyping(activeChatId);

    // Auto stop after 3 seconds of no typing
    clearTimeout(_typingIndicatorTimer);
    _typingIndicatorTimer = setTimeout(() => {
      SocketClient.emitStopTyping(activeChatId);
    }, 3000);
  };

  // =============================================
  // Override closeChatWindow
  // =============================================
  window.closeChatWindow = function () {
    if (_currentConvId) {
      SocketClient.leaveConversation(_currentConvId);
      SocketClient.emitStopTyping(_currentConvId);
    }
    closeChatMessageMenu();
    window.clearChatReply();
    activeChatId = null;
    _currentConvId = null;

    document.querySelectorAll(".chat-item").forEach((el) => el.classList.remove("active"));

    if (window.innerWidth < 641) {
      document.getElementById("chatWindow")?.classList.add("hide");
      document.body.classList.remove('chat-fullscreen');
    } else {
      const bar = document.getElementById("chatWinBar");
      if (bar) bar.style.display = "none";
      const msgs = document.getElementById("chatWinMsgs");
      if (msgs)
        msgs.innerHTML =
          '<div class="chat-empty-state" id="chatEmptyState" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--t3);text-align:center;padding:40px"><div style="font-size:48px;margin-bottom:12px">💬</div><div style="font-size:16px;font-weight:600;margin-bottom:6px">Select a chat</div><div style="font-size:13px">Choose a conversation from the left to start chatting.</div></div>';
      const winAv = document.getElementById("chatWinAv");
      if (winAv) winAv.innerHTML = "";
      const winName = document.getElementById("chatWinName");
      if (winName) winName.textContent = "";
      const winSub = document.getElementById("chatWinSub");
      if (winSub) winSub.textContent = "";
    }
    renderChatsList();
  };

  // =============================================
  // Override startDMWith — creates real conversation
  // =============================================
  window.startDMWith = async function (uid) {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    closeOvl("newDMModal");
    try {
      const result = await API.startConversation(uid);
      const convId = (result.id || result._id || "").toString();

      // Reload conversations to get the new one
      await loadConversations();

      gp("chats");
      setTimeout(() => openChatWindow(convId), 150);
    } catch (err) {
      MC.error("Failed to start conversation: " + (err.message || ""));
    }
  };

  // =============================================
  // Override createGroup — creates real group
  // =============================================
  window.createGroup = async function () {
    const name = document.getElementById("ngName")?.value?.trim() || "";
    if (!name) {
      MC.warn("Please enter a group name");
      return;
    }
    if (selectedGroupMembers.length < 1) {
      MC.warn("Add at least 1 member");
      return;
    }

    try {
      const result = await API.createGroupChat(name, selectedGroupMembers);
      const convId = (result.id || result._id || "").toString();

      await loadConversations();

      closeOvl("newGroupModal");
      renderChatsList();
      openChatWindow(convId);
      MC.success('Group "' + name + '" created! 🎉');
    } catch (err) {
      MC.error("Failed to create group: " + (err.message || ""));
    }
  };

  // =============================================
  // Override openNewDMModal — uses real user list
  // =============================================
  window.filterDMSearch = function (q) {
    const c = document.getElementById("dmUserList");
    if (!c) return;
    const all = getUsers().filter((u) => (u.id || u._id || "").toString() !== myId());
    const filtered = q
      ? all.filter(
          (u) =>
            u.name.toLowerCase().includes(q.toLowerCase()) ||
            u.handle.toLowerCase().includes(q.toLowerCase())
        )
      : all;
    c.innerHTML = filtered
      .map((u) => {
        const uid = (u.id || u._id || "").toString();
        const online = SocketClient.isUserOnline(uid);
        return `<div class="dm-user-item" onclick="startDMWith('${uid}')">
      <div class="av av36">${u.avatar ? '<img src="' + u.avatar + '">' : getIni(u.name)}</div>
      <div><div style="font-weight:600;font-size:14px">${u.name}${u.verified ? " 🔱" : ""} ${online ? '<span style="color:#4caf50;font-size:11px">● online</span>' : ""}</div><div style="font-size:12px;color:var(--t3)">@${u.handle}</div></div>
    </div>`;
      })
      .join("");
  };

  // =============================================
  // Override openNewGroupModal — uses real user list
  // =============================================
  window.openNewGroupModal = function () {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    selectedGroupMembers = [];
    const el = document.getElementById("ngName");
    if (el) el.value = "";
    const ml = document.getElementById("ngMemberList");
    if (!ml) return;
    const users = getUsers().filter((u) => (u.id || u._id || "").toString() !== myId());
    ml.innerHTML = users
      .map((u) => {
        const uid = (u.id || u._id || "").toString();
        return `<div class="ng-member-item" onclick="toggleGroupMember('${uid}')">
      <div class="ng-check" id="ngc_${uid}"></div>
      <div class="av av36">${u.avatar ? '<img src="' + u.avatar + '">' : getIni(u.name)}</div>
      <div><div style="font-weight:600;font-size:14px">${u.name}</div><div style="font-size:12px;color:var(--t3)">@${u.handle}</div></div>
    </div>`;
      })
      .join("");
    openOvl("newGroupModal");
  };

  // =============================================
  // Override old Messages page too (pgMessages)
  // =============================================
  window.renderConvs = async function () {
    const cl = document.getElementById("convsList");
    const cv = document.getElementById("chatView");
    if (cl) cl.style.display = "block";
    if (cv) cv.classList.add("hide");
    if (!CU) {
      if (cl)
        cl.innerHTML =
          '<div class="empty"><div class="empty-ico">✉️</div><div class="empty-ttl">Sign in to message</div><button class="btn btn-p" style="margin-top:12px" onclick="openOvl(\'authOvl\')">Sign In</button></div>';
      return;
    }
    // Show loading skeleton
    if (cl) cl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--t3)">Loading messages…</div>';
    try {
      const data = await API.getConversations();
      let convs = data.conversations || data || [];
      if (typeof isUserBlocked === "function") {
        convs = convs.filter((conv) => {
          const other =
            conv.otherUser || conv.participants?.find((p) => p._id !== CU.id) || {};
          return !isUserBlocked(other._id || other.id || "");
        });
      }
      if (!convs.length) {
        if (cl) cl.innerHTML = '<div class="empty"><div class="empty-ico">✉️</div><div class="empty-ttl">No messages yet</div><div class="empty-sub">Start a conversation from someone\'s profile</div></div>';
        return;
      }
      if (cl) {
        cl.innerHTML = convs.map(conv => {
          const other = conv.otherUser || conv.participants?.find(p => p._id !== CU.id) || {};
          const name = other.name || "User";
          const handle = other.handle || "";
          const avatar = other.avatar;
          const ini = name.charAt(0).toUpperCase();
          const avH = avatar ? `<img src="${avatar}" alt="">` : ini;
          const lastMsg = conv.lastMessage || "";
          const time = conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : "";
          const convId = conv._id || conv.id || "";
          return `<div class="conv" onclick="openMsgChat('${convId}')">
            <div class="av av40">${avH}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;justify-content:space-between">
                <span class="conv-name">${name}</span>
                <span class="conv-tm">${time}</span>
              </div>
              <div class="conv-prev">${lastMsg}</div>
            </div>
          </div>`;
        }).join("");
      }
    } catch (err) {
      console.error("renderConvs error:", err);
      if (cl) cl.innerHTML = '<div class="empty"><div class="empty-ico">✉️</div><div class="empty-ttl">Could not load messages</div><div class="empty-sub">Please check your connection</div></div>';
    }
  };

  // Open a conversation in the Messages page chat view
  window.openMsgChat = async function(convId) {
    const cl = document.getElementById("convsList");
    const cv = document.getElementById("chatView");
    if (cl) cl.style.display = "none";
    if (cv) cv.classList.remove("hide");

    try {
      const data = await API.getMessages(convId);
      const msgs = data.messages || data || [];
      const conv = (await API.getConversations()).conversations?.find(c => c._id === convId) || {};
      const other = conv.otherUser || conv.participants?.find(p => p._id !== CU.id) || {};

      const chatNm = document.getElementById("chatNm");
      const chatAv = document.getElementById("chatAv");
      if (chatNm) chatNm.textContent = other.name || "User";
      if (chatAv) chatAv.innerHTML = other.avatar ? `<img src="${other.avatar}" alt="">` : (other.name || "U").charAt(0).toUpperCase();

      const chatMsgs = document.getElementById("chatMsgs");
      if (chatMsgs) {
        chatMsgs.innerHTML = msgs.map(m => {
          const isMe = m.sender === CU.id || m.sender?._id === CU.id;
          return `<div class="msg ${isMe ? 'msg-me' : 'msg-them'}">${m.text || ""}</div>`;
        }).join("");
        chatMsgs.scrollTop = chatMsgs.scrollHeight;
      }

      // Wire up send button for this conversation
      const msgIn = document.getElementById("msgIn");
      window._msgConvId = convId;
      window.sendMsg = async function() {
        const text = (msgIn?.value || "").trim();
        if (!text) return;
        msgIn.value = "";
        try {
          await API.sendMessage(convId, text);
          const chatMsgs = document.getElementById("chatMsgs");
          if (chatMsgs) {
            chatMsgs.innerHTML += `<div class="msg msg-me">${text}</div>`;
            chatMsgs.scrollTop = chatMsgs.scrollHeight;
          }
        } catch(e) { console.error("Send msg error:", e); }
      };
    } catch(err) {
      console.error("openMsgChat error:", err);
    }
  };

  window.openDM = function (uid) {
    if (!auth(() => openDM(uid))) return;
    if (typeof canStartDirectMessageWith === "function" && !canStartDirectMessageWith(uid)) {
      const user = typeof getUser === "function" ? getUser(uid) : null;
      MC.info(
        typeof isUserBlocked === "function" && isUserBlocked(uid)
          ? `Unblock ${user?.name || "this user"} in Settings & Privacy before messaging.`
          : `Follow @${user?.handle || "user"} first to message this private account.`,
      );
      return;
    }
    gp("chats");
    setTimeout(() => {
      startDMWith(uid);
    }, 200);
  };

  // =============================================
  // Socket.io Real-Time Event Handlers
  // =============================================

  // Handle incoming message from another user
  window.handleIncomingMessage = function (data) {
    const convId = (data.convId || "").toString();
    const msg = data.message;
    if (!msg) return;

    // Add to local cache
    if (!_conversationMessages[convId]) {
      _conversationMessages[convId] = [];
    }

    const existing = _conversationMessages[convId].find((m) => {
      const incomingId = (msg.id || "").toString();
      const incomingClientId = (msg.clientId || "").toString();
      return (
        (incomingId && (m.id || "").toString() === incomingId) ||
        (incomingClientId && (m.clientId || "").toString() === incomingClientId)
      );
    });
    if (!existing) {
      upsertConversationMessage(convId, msg);
      SocketClient.emitMessageDelivered(convId, msg.id);
    }

    // If this conversation is currently open, do fast append
    if (activeChatId === convId) {
      appendChatMessageDOM(msg, convId);
      // Send read receipt
      SocketClient.emitMessageRead(convId);
    }

    // Update conversation list data
    const conv = _cachedConversations.find(
      (c) => (c.id || c._id || "").toString() === convId
    );
    if (conv) {
      conv.lastMessage = msg.txt || "📷 Photo";
      conv.lastMessageTime = "Just now";
      updateConversationPreview(convId, msg);
      let unreadInc = 0;
      if (activeChatId !== convId) {
        conv.unreadCount = (conv.unreadCount || 0) + 1;
        unreadInc = 1;
      }
      
      if (curPage === "chats") {
        updateChatItemDOM(convId, conv.lastMessage, fmtChatTs(conv.lastMessageTime), unreadInc);
      }
    } else {
      // New conversation — reload the list
      loadConversations().then(() => {
        if (curPage === "chats") renderChatsList();
      });
    }
  };

  // High-performance DOM appending for chat messages
  function appendChatMessageDOM(m, convId) {
    const c = document.getElementById("chatWinMsgs");
    if (!c || activeChatId !== convId) return;

    // Remove empty state if present
    const empty = document.getElementById("chatEmptyState");
    if (empty) empty.style.display = "none";

    // Remove typing indicator temporarily to append above it
    const ti = document.getElementById("remoteTypingIndicator");
    if (ti) ti.remove();

    const quickMsgs = _conversationMessages[convId] || [];
    const quickPrev = quickMsgs.length > 1 ? quickMsgs[quickMsgs.length - 2] : null;
    c.insertAdjacentHTML("beforeend", buildMessageRowHtml(convId, m, quickPrev));
    if (ti && !(m.isMe || (m.from && m.from.toString() === myId()))) {
      c.appendChild(ti);
    }
    c.scroll({ top: c.scrollHeight, behavior: "smooth" });
    return;

    const isOut = m.isMe || (m.from && m.from.toString() === myId());
    const sender = m.sender || {};
    const senderName = sender.name || "Unknown";
    
    // Check previous message to see if we should show avatar
    const msgs = _conversationMessages[convId] || [];
    const prev = msgs.length > 1 ? msgs[msgs.length - 2] : null; // -2 because `m` is already in the array
    
    const isGroup = _cachedConversations.find(c => (c.id || c._id || "").toString() === convId)?.isGroup;
    const showAv = !isOut && isGroup && (!prev || (prev.from?.toString() !== m.from?.toString()));
    const ini = getIni(senderName);

    const avHtml = `<div class="msg-av-small">${sender.avatar ? '<img src="' + sender.avatar + '">' : ini}</div>`;
    const avOrSpacer = !isOut && isGroup ? (showAv ? avHtml : '<div class="msg-av-placeholder"></div>') : "";

    const tickClass = m.read ? "tick-read" : "tick-sent";
    const tickSvg = isOut ? `<svg class="msg-tick ${tickClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : "";
    const timeStr = m.t || "Just now";

    const msgHtml = `<div class="msg-row ${isOut ? "out" : "in"}">
      ${avOrSpacer}
      <div class="msg-bubble">
        ${showAv ? '<div class="msg-sender-name">' + esc(senderName) + "</div>" : ""}
        ${m.img ? '<img class="msg-bubble-img" src="' + m.img + '" alt="">' : ""}
        ${m.txt ? esc(m.txt) : ""}
        <div class="msg-meta">
          <span class="msg-time">${timeStr}</span>
          ${tickSvg}
        </div>
      </div>
    </div>`;

    c.insertAdjacentHTML("beforeend", msgHtml);

    // Re-append typing indicator if it was there
    if (ti && !isOut) c.appendChild(ti);

    // Use smooth scrolling to prevent jank
    c.scroll({ top: c.scrollHeight, behavior: 'smooth' });
  }

  // Fast update of the sidebar chat item position and text
  function updateChatItemDOM(convId, lastMsg, lastTime, unreadInc) {
    const item = document.getElementById("ci_" + convId);
    if (!item) {
      if (curPage === "chats") renderChatsList(); // fallback
      return;
    }
    
    const prevEl = item.querySelector(".chat-item-prev");
    const timeEl = item.querySelector(".chat-item-time");
    if (prevEl) prevEl.textContent = (lastMsg || "Media").substring(0, 55);
    if (timeEl) timeEl.textContent = lastTime;

    // Handle Unread badge
    const bottomRow = item.querySelector(".chat-item-bottom");
    if (bottomRow && unreadInc > 0) {
      item.classList.add("unread-time");
      if (prevEl) prevEl.classList.add("bold");
      
      let badge = item.querySelector(".chat-unread-badge");
      if (!badge) {
        bottomRow.insertAdjacentHTML("beforeend", '<span class="chat-unread-badge">1</span>');
      } else {
        const val = parseInt(badge.textContent) || 0;
        badge.textContent = val + unreadInc > 9 ? "9+" : val + unreadInc;
      }
    } else if (unreadInc === 0 && activeChatId === convId) {
      // If we are currently in the chat, remove unread styling
      const badge = item.querySelector(".chat-unread-badge");
      if (badge) badge.remove();
      if (prevEl) prevEl.classList.remove("bold");
      item.classList.remove("unread-time");
    }

    // Move to top of the list for fresh activity
    const list = document.getElementById("chatsList");
    if (list && list.firstChild !== item) {
      list.prepend(item);
      item.style.animation = "mIn 0.3s ease"; // small nice highlight
    }
  }

  // Handle remote user typing
  window.handleRemoteTyping = function (data) {
    if (data.convId !== activeChatId) return;
    const c = document.getElementById("chatWinMsgs");
    if (!c) return;

    // Show typing indicator
    let ti = document.getElementById("remoteTypingIndicator");
    if (!ti) {
      ti = document.createElement("div");
      ti.className = "msg-row in";
      ti.id = "remoteTypingIndicator";
      ti.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
      c.appendChild(ti);
      c.scrollTop = c.scrollHeight;
    }

    // Update sub-header
    const sub = document.getElementById("chatWinSub");
    if (sub) sub.textContent = (data.userName || "Someone") + " is typing...";
  };

  // Handle remote user stop typing
  window.handleRemoteStopTyping = function (data) {
    if (data.convId !== activeChatId) return;

    const ti = document.getElementById("remoteTypingIndicator");
    if (ti) ti.remove();

    // Restore sub-header
    const sub = document.getElementById("chatWinSub");
    const conv = _cachedConversations.find(
      (c) => (c.id || c._id || "").toString() === activeChatId
    );
    if (sub && conv && !conv.isGroup) {
      const uid = sub.getAttribute("data-chat-uid");
      sub.textContent = uid && SocketClient.isUserOnline(uid) ? "🟢 online" : "last seen recently";
    }
  };

  // Handle read receipt from remote user
  window.handleRemoteRead = function (data) {
    if (data.convId !== activeChatId) return;
    // Mark all outgoing messages as read
    const msgs = _conversationMessages[activeChatId] || [];
    msgs.forEach((m) => {
      if (m.isMe || (m.from && m.from.toString() === myId())) {
        m.read = true;
      }
    });
    renderChatMessages(activeChatId);
  };

  // Handle online status change for chat header
  window.updateChatHeaderOnline = function (userId, online) {
    const sub = document.getElementById("chatWinSub");
    if (!sub) return;
    const uid = sub.getAttribute("data-chat-uid");
    if (uid === userId) {
      sub.textContent = online ? "🟢 online" : "last seen recently";
    }
    // Also update chat list indicators
    if (curPage === "chats") renderChatsList();
  };

  // =============================================
  // Override init — bootstrap from backend
  // =============================================
  const _origInit = window.init;
  window.init = async function () {
    if (window.__TS_BOOT_PROMISE) return window.__TS_BOOT_PROMISE;

    window.__TS_BOOT_PROMISE = (async () => {
      ensureAppServiceWorker().catch(() => {});
      setupInstallPromptBridge();
      updateInstallButtons();

      // Restore theme
      if (typeof applyThemePreference === "function") {
        applyThemePreference(
          typeof getStoredThemeMode === "function"
            ? getStoredThemeMode()
            : Store.g("theme", "light"),
          { silent: true }
        );
      }

      // Wire auth buttons
      const lb = document.getElementById("loginBtn");
      if (lb) lb.addEventListener("click", doLogin);
      const sb2 = document.getElementById("signupBtn");
      if (sb2) sb2.addEventListener("click", doSignup);
      document.getElementById("liPw")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doLogin();
      });
      document.getElementById("suPw")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doSignup();
      });

      const appwriteRedirect =
        typeof window.consumePendingAppwriteAuth === "function"
          ? await window.consumePendingAppwriteAuth()
          : null;
      if (appwriteRedirect?.token) {
        API.setToken(appwriteRedirect.token);
      } else if (appwriteRedirect?.authError) {
        // Google auth failed — show the error and guide user to the right form
        MC.error(appwriteRedirect.authError);
        const details = appwriteRedirect.authDetails || {};
        if (details.requiresSignup) {
          openOvl("authOvl");
          if (typeof authToggle === "function") authToggle("signup");
        } else if (details.requiresSignin) {
          openOvl("authOvl");
          if (typeof authToggle === "function") authToggle("login");
        }
      }

      const authRedirect = consumeAuthRedirectHash();
      if (authRedirect?.authToken) {
        API.setToken(authRedirect.authToken);
      }

      // Try to restore session from stored token
      const storedToken = API.getToken();
      if (
        storedToken &&
        storedToken !== "undefined" &&
        storedToken !== "null"
      ) {
        try {
          CU = await API.getMe();
          SocketClient.connect((CU.id || CU._id).toString());
          API.flushPendingChatMessages?.().catch(() => {});
          ensureChatPushNotifications(false).catch(() => {});
        } catch {
          CU = null;
          API.logout();
        }
      } else if (storedToken === "undefined" || storedToken === "null") {
        API.logout();
      }

      const renderedFromCache = hydrateBootCache();

      if (renderedFromCache) {
        renderCurrentPageShell();
        if (typeof window.handlePendingReelRoute === "function") {
          window.handlePendingReelRoute();
        }
        if (typeof window.hideBrandSplash === "function") {
          window.hideBrandSplash();
        }

        loadAllData()
          .then((loaded) => {
            if (loaded) {
              renderCurrentPageShell();
              if (typeof window.handlePendingReelRoute === "function") {
                window.handlePendingReelRoute();
              }
            }
          })
          .catch(() => {});
      } else {
        await loadAllData();
        renderCurrentPageShell();
        if (typeof window.handlePendingReelRoute === "function") {
          window.handlePendingReelRoute();
        }
        if (typeof window.hideBrandSplash === "function") {
          window.hideBrandSplash();
        }
      }

      if (appwriteRedirect?.authError) {
        MC.error(appwriteRedirect.authError);
      } else if (
        appwriteRedirect?.token &&
        String(appwriteRedirect.authSource || "").startsWith("appwrite")
      ) {
        if (typeof window.clearPendingReferralCode === "function") {
          window.clearPendingReferralCode();
        }
        const providerLabel =
          {
            google: "Google",
            github: "GitHub",
            discord: "Discord",
            apple: "Apple",
            facebook: "Facebook",
            microsoft: "Microsoft",
          }[String(appwriteRedirect.provider || "").toLowerCase()] || "Social";
        MC.success(providerLabel + " Sign-In completed successfully.");
      } else if (authRedirect?.authError) {
        MC.error(authRedirect.authError);
      } else if (
        authRedirect?.authToken &&
        authRedirect.authSource === "google"
      ) {
        if (typeof window.clearPendingReferralCode === "function") {
          window.clearPendingReferralCode();
        }
        MC.success("Google Sign-In completed successfully.");
      }

      scheduleNonCriticalWork(() => {
        loadTrendingHashtagDiscovery().catch(() => {});
        checkNotifications();
        openPendingChatIfNeeded();
      });
    })();

    return window.__TS_BOOT_PROMISE;
  };

  // =============================================
  // WebRTC Call Initiation
  // =============================================
  window.startWebrtcCall = function (isVideo) {
    if (!activeChatId) return MC?.error("No active chat.");

    if (!window.isSecureContext && !isLocalDevHost()) {
      return MC?.error("Voice and video calling require HTTPS or localhost.");
    }

    const conv = _cachedConversations.find(
      (c) => (c.id || c._id || "").toString() === activeChatId
    );

    if (!conv) {
      return MC?.error("Could not find this chat.");
    }

    if (conv.isGroup) {
      return MC?.info("Voice and video calling are available in direct chats only.");
    }

    if (!conv.uid) {
      return MC?.error("Could not find user details to call.");
    }

    const uid = conv.uid.toString();
    const userName = conv.user ? conv.user.name : "User";
    const avatar = conv.user ? conv.user.avatar : null;
    const selfId = (CU?.id || CU?._id || "").toString();
    if (selfId) {
      SocketClient.connect(selfId);
    }
    const hasPresenceData =
      typeof SocketClient.getOnlineUsers === "function" &&
      SocketClient.getOnlineUsers().size > 0;
    if (SocketClient.isConnected() && hasPresenceData && !SocketClient.isUserOnline(uid)) {
      MC?.info((userName || "User") + " may be offline. Trying the call anyway...");
    }

    if (typeof WebRTCClient !== "undefined") {
      WebRTCClient.startCall(uid, userName, avatar, isVideo);
    } else {
      MC?.error("Calling feature is not initialized.");
    }
  };

  // =============================================
  // Mobile Keyboard — keep chat input visible
  // =============================================
  (function setupMobileKeyboardHandler() {
    if (!window.visualViewport) return;

    let chatWindow = null;

    function onViewportResize() {
      chatWindow = chatWindow || document.getElementById("chatWindow");
      if (!chatWindow || chatWindow.classList.contains("hide")) return;
      if (window.innerWidth > 640) return;

      const vvh = window.visualViewport.height;
      const vvTop = window.visualViewport.offsetTop;

      // Set chat window height to match the visible viewport (excludes keyboard)
      chatWindow.style.height = vvh + "px";
      chatWindow.style.top = vvTop + "px";

      // Scroll messages to bottom so latest message stays visible
      const msgs = document.getElementById("chatWinMsgs");
      if (msgs) {
        requestAnimationFrame(() => {
          msgs.scrollTop = msgs.scrollHeight;
        });
      }
    }

    function onViewportScroll() {
      // Prevent the page from scrolling when keyboard pushes the viewport
      chatWindow = chatWindow || document.getElementById("chatWindow");
      if (!chatWindow || chatWindow.classList.contains("hide")) return;
      if (window.innerWidth > 640) return;

      const vvTop = window.visualViewport.offsetTop;
      chatWindow.style.top = vvTop + "px";
    }

    window.visualViewport.addEventListener("resize", onViewportResize);
    window.visualViewport.addEventListener("scroll", onViewportScroll);

    // Also reset when chat window is closed
    const origClose = window.closeChatWindow;
    window.closeChatWindow = function () {
      if (chatWindow) {
        chatWindow.style.height = "";
        chatWindow.style.top = "";
      }
      origClose.apply(this, arguments);
    };
  })();

  // Remove the old DOMContentLoaded listener and re-fire init
  window.addEventListener("online", () => {
    API.flushPendingChatMessages?.().catch(() => {});
  });
  window.addEventListener("ts:pending-message-sent", (event) => {
    reconcilePendingMessage(event.detail || {});
  });
  window.init();
})();
