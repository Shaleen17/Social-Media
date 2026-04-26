(function initNonCriticalEnhancements(global) {
  const CONSENT_KEY = "ts_cookieConsent_v1";
  const CONSENT_PROMPT_KEY = "ts_cookieConsentPrompt_v1";
  const SESSION_KEY = "ts_analyticsSessionId";
  const ANON_KEY = "ts_analyticsAnonymousId";
  const COOKIE_BANNER_ID = "tsCookieConsent";
  const PRIVACY_MODAL_ID = "tsPrivacyModal";
  const COOKIE_BANNER_DELAY_MS = 60 * 1000;
  const HEARTBEAT_MS = 30 * 1000;
  const IDLE_MS = 45 * 1000;
  const PAUSE_SIGNAL_MS = 12 * 1000;
  let cookieConsentTimerId = 0;
  let heartbeatTimerId = 0;
  let idleTimerId = 0;
  let trackedPage = "home";
  let pageEnteredAt = Date.now();
  let maxScrollDepth = 0;
  let lastActivityAt = Date.now();
  let sessionIsIdle = false;
  let lastTrackedScrollDepth = 0;
  let lastScrollSignalAt = 0;
  let lastTrackedSearch = { query: "", at: 0 };
  let lastTrackedTypingAt = 0;
  let hoverIntentTimerId = 0;
  let hoverIntentTarget = null;
  const trackedVideos = new WeakSet();
  const trackedVideoTimers = new WeakMap();
  const SUPPORTED_LANGUAGES = {
    en: "english",
    hi: "hindi",
    bn: "bengali",
    ta: "tamil",
    te: "telugu",
    mr: "marathi",
  };

  function randomId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }

  function ensureStoredId(key, prefix) {
    try {
      const existing = localStorage.getItem(key);
      if (existing) return existing;
      const next = randomId(prefix);
      localStorage.setItem(key, next);
      return next;
    } catch {
      return randomId(prefix);
    }
  }

  function compactText(value, maxLength = 120) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
  }

  function getConsentState() {
    try {
      return JSON.parse(localStorage.getItem(CONSENT_KEY) || "null");
    } catch {
      return null;
    }
  }

  function setConsentState(mode) {
    const value = {
      mode,
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(value));
    } catch {}
    return value;
  }

  function getConsentPromptState() {
    try {
      return JSON.parse(localStorage.getItem(CONSENT_PROMPT_KEY) || "null");
    } catch {
      return null;
    }
  }

  function markConsentPromptSeen(reason = "auto_prompted") {
    const current = getConsentPromptState() || {};
    const next = {
      seenAt: current.seenAt || new Date().toISOString(),
      reason,
    };
    try {
      localStorage.setItem(CONSENT_PROMPT_KEY, JSON.stringify(next));
    } catch {}
    return next;
  }

  function hasSeenConsentPrompt() {
    return !!getConsentPromptState()?.seenAt;
  }

  function clearCookieConsentTimer() {
    if (!cookieConsentTimerId) return;
    global.clearTimeout(cookieConsentTimerId);
    cookieConsentTimerId = 0;
  }

  function getCurrentPageName() {
    return global.curPage || document.body?.dataset?.page || trackedPage || "home";
  }

  function getResolvedTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      return "";
    }
  }

  function enrichTrackMeta(meta) {
    const nextMeta = meta && typeof meta === "object" ? { ...meta } : {};
    const nextContext =
      nextMeta.context && typeof nextMeta.context === "object"
        ? { ...nextMeta.context }
        : {};
    const now = new Date();
    if (!Number.isFinite(nextMeta.localHour)) {
      nextMeta.localHour = now.getHours();
    }
    if (!Number.isFinite(nextMeta.weekday)) {
      nextMeta.weekday = now.getDay();
    }
    if (!nextMeta.timezone) {
      nextMeta.timezone = getResolvedTimezone();
    }
    nextMeta.context = {
      locale: navigator.language || "",
      timezone: nextMeta.timezone || nextContext.timezone || "",
      referrer: nextContext.referrer || document.referrer || "",
      screen: nextContext.screen || `${global.innerWidth || 0}x${global.innerHeight || 0}`,
      ...nextContext,
    };
    return nextMeta;
  }

  function safeTrack(type, name, meta) {
    if (!global.API || typeof global.API.trackEvent !== "function") return;
    const consent = getConsentState();
    if (
      type !== "consent" &&
      consent &&
      consent.mode === "essential_only" &&
      type !== "error"
    ) {
      return;
    }

    const enrichedMeta = enrichTrackMeta(meta);

    global.API.trackEvent(type, name, {
      sessionId: ensureStoredId(SESSION_KEY, "sess"),
      anonymousId: ensureStoredId(ANON_KEY, "anon"),
      page: enrichedMeta.page || getCurrentPageName(),
      ...enrichedMeta,
    }).catch(() => {});
  }

  function computeScrollDepth() {
    const viewport = Math.max(global.innerHeight || 0, 1);
    const scrollHeight = Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
      viewport
    );
    if (scrollHeight <= viewport) return 100;
    const scrollTop =
      global.scrollY ||
      document.documentElement?.scrollTop ||
      document.body?.scrollTop ||
      0;
    return Math.max(
      0,
      Math.min(100, Math.round(((scrollTop + viewport) / scrollHeight) * 100))
    );
  }

  function updateScrollDepth() {
    maxScrollDepth = Math.max(maxScrollDepth, computeScrollDepth());
  }

  function clearIdleTimer() {
    if (!idleTimerId) return;
    global.clearTimeout(idleTimerId);
    idleTimerId = 0;
  }

  function scheduleIdleCheck() {
    clearIdleTimer();
    idleTimerId = global.setTimeout(() => {
      if (document.visibilityState !== "visible" || sessionIsIdle) return;
      sessionIsIdle = true;
      safeTrack("interaction", "session_idle", {
        page: trackedPage || getCurrentPageName(),
        idleSeconds: Math.round((Date.now() - lastActivityAt) / 1000),
      });
    }, IDLE_MS);
  }

  function noteUserActivity(source, extra = {}) {
    const now = Date.now();
    const pauseGapMs = now - lastActivityAt;
    if (pauseGapMs >= PAUSE_SIGNAL_MS && pauseGapMs < 5 * 60 * 1000) {
      safeTrack("interaction", "attention_pause", {
        page: trackedPage || getCurrentPageName(),
        pauseSeconds: Math.round(pauseGapMs / 1000),
        resumedBy: source,
        ...extra,
      });
    }
    if (sessionIsIdle) {
      sessionIsIdle = false;
      safeTrack("interaction", "session_resumed", {
        page: trackedPage || getCurrentPageName(),
        resumedBy: source,
      });
    }
    lastActivityAt = now;
    scheduleIdleCheck();
  }

  function resetTrackedPage(page) {
    trackedPage = page || getCurrentPageName();
    pageEnteredAt = Date.now();
    maxScrollDepth = computeScrollDepth();
    lastTrackedScrollDepth = maxScrollDepth;
    lastScrollSignalAt = 0;
  }

  function flushPageDuration(reason, extra = {}) {
    const page = trackedPage || getCurrentPageName();
    const durationMs = Math.max(0, Date.now() - pageEnteredAt);
    if (!page || durationMs < 1000) return;
    const payload = {
      page,
      durationMs,
      reason,
      maxScrollDepth: Math.max(maxScrollDepth, computeScrollDepth()),
      ...extra,
    };
    safeTrack("interaction", "page_duration", payload);
    if (reason === "hidden" || reason === "pagehide" || reason === "logout") {
      safeTrack(
        "interaction",
        reason === "pagehide" ? "session_exit" : "session_hidden",
        payload
      );
    }
  }

  function startHeartbeatLoop() {
    if (heartbeatTimerId) {
      global.clearInterval(heartbeatTimerId);
    }
    heartbeatTimerId = global.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      updateScrollDepth();
      safeTrack("interaction", "session_heartbeat", {
        page: trackedPage || getCurrentPageName(),
        durationMs: Math.max(0, Date.now() - pageEnteredAt),
        maxScrollDepth,
      });
    }, HEARTBEAT_MS);
  }

  function installLifecycleTracking() {
    resetTrackedPage(getCurrentPageName());
    lastActivityAt = Date.now();
    safeTrack("interaction", "session_started", {
      page: trackedPage,
      entryPage: trackedPage,
    });
    startHeartbeatLoop();
    scheduleIdleCheck();

    if (typeof global.gp === "function" && !global.gp.__tsFounderTelemetry) {
      const originalGp = global.gp;
      const wrappedGp = function wrappedGp(page) {
        const fromPage = trackedPage || getCurrentPageName();
        if (page && fromPage && fromPage !== page) {
          flushPageDuration("navigation", {
            fromPage,
            toPage: page,
          });
          safeTrack("interaction", "page_transition", {
            page: fromPage,
            fromPage,
            toPage: page,
          });
        }
        const result = originalGp.apply(this, arguments);
        resetTrackedPage(page || getCurrentPageName());
        noteUserActivity("navigation", { toPage: page || getCurrentPageName() });
        return result;
      };
      wrappedGp.__tsFounderTelemetry = true;
      global.gp = wrappedGp;
    }

    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") {
          flushPageDuration("hidden");
          clearIdleTimer();
          return;
        }
        resetTrackedPage(getCurrentPageName());
        noteUserActivity("visibility");
      },
      { passive: true }
    );

    global.addEventListener(
      "pagehide",
      () => {
        flushPageDuration("pagehide");
      },
      { passive: true }
    );

    global.addEventListener(
      "scroll",
      () => {
        updateScrollDepth();
        const now = Date.now();
        const currentDepth = computeScrollDepth();
        const deltaDepth = Math.abs(currentDepth - lastTrackedScrollDepth);
        const deltaSeconds = Math.max(1, Math.round((now - (lastScrollSignalAt || now)) / 1000));
        if (!lastScrollSignalAt || now - lastScrollSignalAt >= 6000 || deltaDepth >= 12) {
          safeTrack("interaction", "scroll_activity", {
            page: trackedPage || getCurrentPageName(),
            currentScrollDepth: currentDepth,
            maxScrollDepth,
            deltaDepth,
            scrollSpeed: Number((deltaDepth / deltaSeconds).toFixed(1)),
          });
          lastScrollSignalAt = now;
          lastTrackedScrollDepth = currentDepth;
        }
        noteUserActivity("scroll", {
          currentScrollDepth: currentDepth,
        });
      },
      { passive: true }
    );

    ["pointerdown", "touchstart", "keydown"].forEach((eventName) => {
      global.addEventListener(
        eventName,
        () => {
          noteUserActivity(eventName);
        },
        { passive: true }
      );
    });

    global.addEventListener(
      "mousemove",
      () => {
        if (Date.now() - lastActivityAt < 2500) return;
        noteUserActivity("mousemove");
      },
      { passive: true }
    );
  }

  function guessAltText(img) {
    const explicit = img.getAttribute("data-alt") || img.getAttribute("title") || "";
    if (explicit) return explicit;

    const labelledBy = img.getAttribute("aria-label");
    if (labelledBy) return labelledBy;

    const nearbyText =
      img.closest("[aria-label]")?.getAttribute("aria-label") ||
      img.closest("button")?.textContent ||
      img.closest("a")?.textContent ||
      img.closest("figure")?.querySelector("figcaption")?.textContent ||
      "";

    const cleanedNearby = String(nearbyText || "").replace(/\s+/g, " ").trim();
    if (cleanedNearby) return cleanedNearby.slice(0, 90);

    const src = img.getAttribute("src") || "";
    const fileName = src.split("/").pop()?.split("?")[0] || "";
    if (!fileName) return "Image";
    return fileName
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .trim()
      .slice(0, 90) || "Image";
  }

  function optimizeCloudinaryUrl(url) {
    const raw = String(url || "");
    if (!/res\.cloudinary\.com/i.test(raw) || !/\/upload\//i.test(raw)) {
      return raw;
    }
    if (/\/upload\/(?:f_auto|q_auto|c_fill|w_\d+)/i.test(raw)) {
      return raw;
    }
    return raw.replace("/upload/", "/upload/f_auto,q_auto:good,dpr_auto/");
  }

  function upgradeImage(img) {
    if (!(img instanceof HTMLImageElement)) return;
    if (!img.hasAttribute("alt") || !img.getAttribute("alt").trim()) {
      img.setAttribute("alt", guessAltText(img));
    }
    if (!img.hasAttribute("loading")) {
      img.setAttribute("loading", "lazy");
    }
    if (!img.hasAttribute("decoding")) {
      img.setAttribute("decoding", "async");
    }
    if (
      !img.hasAttribute("fetchpriority") &&
      !img.closest("#topBar, #sidebar, .sidebar-logo-area, .topbar-logo")
    ) {
      img.setAttribute("fetchpriority", "low");
    }
    const src = img.getAttribute("src");
    const optimized = optimizeCloudinaryUrl(src);
    if (optimized && optimized !== src) {
      img.setAttribute("src", optimized);
    }
  }

  function upgradeIframe(frame) {
    if (!(frame instanceof HTMLIFrameElement)) return;
    if (!frame.hasAttribute("loading")) frame.setAttribute("loading", "lazy");
    if (!frame.hasAttribute("title")) {
      frame.setAttribute("title", "Embedded content");
    }
  }

  function getVideoAnalyticsInfo(video) {
    const source =
      video.currentSrc ||
      video.getAttribute("src") ||
      video.querySelector("source")?.getAttribute("src") ||
      "";
    const closestVideoNode = video.closest("[data-video-id]");
    const videoId =
      video.dataset.videoId ||
      closestVideoNode?.getAttribute("data-video-id") ||
      compactText(source.split("/").pop()?.split("?")[0] || "video", 80);
    const videoTitle =
      video.dataset.videoTitle ||
      closestVideoNode?.getAttribute("data-video-title") ||
      compactText(
        video.getAttribute("aria-label") ||
          video.closest("figure")?.querySelector("figcaption")?.textContent ||
          "",
        110
      );
    return {
      videoId,
      videoTitle,
      source,
    };
  }

  function attachVideoTracking(video) {
    if (!(video instanceof HTMLVideoElement) || trackedVideos.has(video)) return;
    trackedVideos.add(video);

    const state = {
      started: false,
      completed: false,
      milestones: new Set(),
      lastPlayStartedAt: 0,
      lastPausedAt: 0,
      lastKnownTime: 0,
    };

    function stopHeartbeat() {
      const existing = trackedVideoTimers.get(video);
      if (existing) {
        global.clearInterval(existing);
        trackedVideoTimers.delete(video);
      }
    }

    function startHeartbeat() {
      stopHeartbeat();
      const timerId = global.setInterval(() => {
        if (video.paused || video.ended || document.visibilityState !== "visible") return;
        const info = getVideoAnalyticsInfo(video);
        safeTrack("interaction", "video_playback_heartbeat", {
          page: getCurrentPageName(),
          ...info,
          currentTimeSeconds: Math.round(video.currentTime || 0),
          durationSeconds: Number.isFinite(video.duration) ? Math.round(video.duration) : 0,
        });
      }, 15000);
      trackedVideoTimers.set(video, timerId);
    }

    video.addEventListener("play", () => {
      if (state.lastKnownTime && video.currentTime + 3 < state.lastKnownTime) {
        const info = getVideoAnalyticsInfo(video);
        safeTrack("interaction", "video_replay", {
          page: getCurrentPageName(),
          ...info,
          previousTimeSeconds: Math.round(state.lastKnownTime),
          currentTimeSeconds: Math.round(video.currentTime || 0),
        });
      }
      state.lastPlayStartedAt = Date.now();
      state.lastPausedAt = 0;
      startHeartbeat();
      if (state.started) return;
      state.started = true;
      const info = getVideoAnalyticsInfo(video);
      safeTrack("interaction", "video_started", {
        page: getCurrentPageName(),
        ...info,
        durationSeconds: Number.isFinite(video.duration) ? Math.round(video.duration) : 0,
      });
    });

    video.addEventListener("pause", () => {
      state.lastKnownTime = Math.max(state.lastKnownTime, Number(video.currentTime) || 0);
      stopHeartbeat();
      if (video.ended) return;
      const info = getVideoAnalyticsInfo(video);
      const pauseSeconds = state.lastPlayStartedAt
        ? Math.max(0, Math.round((Date.now() - state.lastPlayStartedAt) / 1000))
        : 0;
      state.lastPausedAt = Date.now();
      safeTrack("interaction", "video_paused", {
        page: getCurrentPageName(),
        ...info,
        currentTimeSeconds: Math.round(video.currentTime || 0),
        pauseSeconds,
      });
    });

    video.addEventListener("seeked", () => {
      const currentTime = Number(video.currentTime) || 0;
      if (state.lastKnownTime && currentTime + 3 < state.lastKnownTime) {
        const info = getVideoAnalyticsInfo(video);
        safeTrack("interaction", "video_replay", {
          page: getCurrentPageName(),
          ...info,
          previousTimeSeconds: Math.round(state.lastKnownTime),
          currentTimeSeconds: Math.round(currentTime),
        });
      } else {
        const info = getVideoAnalyticsInfo(video);
        safeTrack("interaction", "video_seek", {
          page: getCurrentPageName(),
          ...info,
          currentTimeSeconds: Math.round(currentTime),
        });
      }
      state.lastKnownTime = Math.max(state.lastKnownTime, currentTime);
    });

    video.addEventListener("timeupdate", () => {
      state.lastKnownTime = Math.max(state.lastKnownTime, Number(video.currentTime) || 0);
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const progress = Math.round((video.currentTime / video.duration) * 100);
      [25, 50, 75].forEach((milestone) => {
        if (progress < milestone || state.milestones.has(milestone)) return;
        state.milestones.add(milestone);
        const info = getVideoAnalyticsInfo(video);
        safeTrack("interaction", "video_progress", {
          page: getCurrentPageName(),
          ...info,
          milestone,
          currentTimeSeconds: Math.round(video.currentTime),
          durationSeconds: Math.round(video.duration),
        });
      });
    });

    video.addEventListener("ended", () => {
      stopHeartbeat();
      if (state.completed) return;
      state.completed = true;
      const info = getVideoAnalyticsInfo(video);
      safeTrack("interaction", "video_completed", {
        page: getCurrentPageName(),
        ...info,
        durationSeconds: Number.isFinite(video.duration) ? Math.round(video.duration) : 0,
      });
    });
  }

  function upgradeVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    if (!video.hasAttribute("preload")) {
      video.setAttribute("preload", "metadata");
    }
    attachVideoTracking(video);
  }

  function enhanceMedia(root = document) {
    root.querySelectorAll("img").forEach(upgradeImage);
    root.querySelectorAll("iframe").forEach(upgradeIframe);
    root.querySelectorAll("video").forEach(upgradeVideo);
  }

  function enhanceTabs() {
    const searchTabs = document.getElementById("srchTabs");
    if (!searchTabs) return;
    searchTabs.setAttribute("role", "tablist");
    const tabs = Array.from(searchTabs.querySelectorAll(".tab"));
    tabs.forEach((tab, index) => {
      tab.setAttribute("role", "tab");
      tab.setAttribute("tabindex", tab.classList.contains("on") ? "0" : "-1");
      tab.setAttribute("aria-selected", tab.classList.contains("on") ? "true" : "false");
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;
        tabs[nextIndex]?.focus();
        tabs[nextIndex]?.click();
      });
    });
  }

  function syncTabStates() {
    document.querySelectorAll("#srchTabs .tab").forEach((tab) => {
      tab.setAttribute("tabindex", tab.classList.contains("on") ? "0" : "-1");
      tab.setAttribute("aria-selected", tab.classList.contains("on") ? "true" : "false");
    });
  }

  function injectSkipLink() {
    if (document.querySelector(".skip-link")) return;
    const skip = document.createElement("a");
    skip.className = "skip-link";
    skip.href = "#feedWrap";
    skip.textContent = "Skip to main content";
    document.body.insertBefore(skip, document.body.firstChild || null);
  }

  function ensureToastAccessibility() {
    const toastContainer = document.getElementById("toastContainer");
    if (!toastContainer) return;
    toastContainer.setAttribute("aria-live", "polite");
    toastContainer.setAttribute("aria-atomic", "false");
  }

  function closePrivacyPolicyModal() {
    document.getElementById(PRIVACY_MODAL_ID)?.remove();
    document.body.classList.remove("policy-modal-open");
  }

  function openPrivacyPolicyModal() {
    closePrivacyPolicyModal();
    const overlay = document.createElement("div");
    overlay.id = PRIVACY_MODAL_ID;
    overlay.className = "privacy-policy-overlay";
    overlay.innerHTML = `
      <div class="privacy-policy-dialog" role="dialog" aria-modal="true" aria-labelledby="privacyPolicyTitle">
        <div class="privacy-policy-head">
          <div>
            <span class="about-card-label">Privacy</span>
            <h2 id="privacyPolicyTitle">Privacy, cookies, and your account data</h2>
          </div>
          <button class="privacy-policy-close" type="button" aria-label="Close privacy policy">✕</button>
        </div>
        <div class="privacy-policy-body">
          <section>
            <h3>What we store</h3>
            <p>We store your profile details, posts, videos, messages, notification preferences, and operational security logs needed to run the community safely.</p>
          </section>
          <section>
            <h3>Cookies and local storage</h3>
            <p>Essential security cookies keep sessions safer. Functional storage keeps theme, language, offline data, and chat retry queues working across visits.</p>
          </section>
          <section>
            <h3>Your choices</h3>
            <p>You can export your account data, request account deletion, manage cookie preferences, and tune notification/privacy settings from Settings & Privacy.</p>
          </section>
          <section>
            <h3>Moderation and abuse prevention</h3>
            <p>We use automated spam and safety signals to reduce abuse, then review flagged content before stronger actions are taken.</p>
          </section>
        </div>
        <div class="privacy-policy-actions">
          <button class="btn btn-w" type="button" data-policy-action="essential">Use essential cookies only</button>
          <button class="btn btn-p" type="button" data-policy-action="accept">Accept analytics cookies</button>
        </div>
      </div>
    `;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closePrivacyPolicyModal();
    });
    overlay.querySelector(".privacy-policy-close")?.addEventListener("click", closePrivacyPolicyModal);
    overlay.querySelector('[data-policy-action="essential"]')?.addEventListener("click", () => {
      applyConsentChoice("essential_only");
      closePrivacyPolicyModal();
    });
    overlay.querySelector('[data-policy-action="accept"]')?.addEventListener("click", () => {
      applyConsentChoice("full");
      closePrivacyPolicyModal();
    });
    document.body.appendChild(overlay);
    document.body.classList.add("policy-modal-open");
    overlay.querySelector(".privacy-policy-close")?.focus();
    return false;
  }

  function applyConsentChoice(mode) {
    clearCookieConsentTimer();
    markConsentPromptSeen(`selected_${mode}`);
    const state = setConsentState(mode);
    document.getElementById(COOKIE_BANNER_ID)?.remove();
    appendPrivacyControlsRefresh();
    safeTrack("consent", "cookie_preferences_updated", {
      mode: state.mode,
      updatedAt: state.updatedAt,
    });
  }

  function dismissCookieConsent(reason = "dismissed") {
    clearCookieConsentTimer();
    markConsentPromptSeen(reason);
    document.getElementById(COOKIE_BANNER_ID)?.remove();
    appendPrivacyControlsRefresh();
  }

  function mountCookieConsent() {
    clearCookieConsentTimer();
    if (getConsentState() || hasSeenConsentPrompt() || document.getElementById(COOKIE_BANNER_ID)) return;
    markConsentPromptSeen("auto_prompted");
    const banner = document.createElement("aside");
    banner.id = COOKIE_BANNER_ID;
    banner.className = "cookie-consent-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-live", "polite");
    banner.innerHTML = `
      <div class="cookie-consent-copy">
        <div class="cookie-consent-head">
          <strong>Cookie choices</strong>
          <button class="cookie-consent-close" type="button" aria-label="Dismiss cookie choices">&times;</button>
        </div>
        <p>We use essential storage for sign-in safety, offline support, and chat reliability. Optional analytics helps us improve performance and accessibility.</p>
      </div>
      <div class="cookie-consent-actions">
        <button class="btn btn-w" type="button" data-consent="essential_only">Essential only</button>
        <button class="btn btn-w" type="button" data-consent="policy">Read policy</button>
        <button class="btn btn-p" type="button" data-consent="full">Accept all</button>
      </div>
    `;
    banner.querySelectorAll("[data-consent]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-consent");
        if (action === "policy") {
          openPrivacyPolicyModal();
          return;
        }
        applyConsentChoice(action);
      });
    });
    banner.querySelector(".cookie-consent-close")?.addEventListener("click", () => {
      dismissCookieConsent("dismissed");
    });
    document.body.appendChild(banner);
  }

  function scheduleCookieConsent() {
    clearCookieConsentTimer();
    if (getConsentState() || hasSeenConsentPrompt() || document.getElementById(COOKIE_BANNER_ID)) {
      return;
    }
    cookieConsentTimerId = global.setTimeout(() => {
      cookieConsentTimerId = 0;
      mountCookieConsent();
    }, COOKIE_BANNER_DELAY_MS);
  }

  function downloadJsonFile(fileName, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportMyData() {
    if (!global.API || typeof global.API.exportMyData !== "function") {
      global.MC?.error("Data export is not available right now.");
      return;
    }
    try {
      const payload = await global.API.exportMyData();
      downloadJsonFile(
        `tirth-sutra-data-export-${new Date().toISOString().slice(0, 10)}.json`,
        payload
      );
      global.MC?.success("Your data export is ready.");
      safeTrack("interaction", "account_export_requested", {});
    } catch (error) {
      global.MC?.error(error?.message || "Could not export your data.");
    }
  }

  async function deleteMyAccountFlow() {
    if (!global.API || typeof global.API.deleteMyAccount !== "function") {
      global.MC?.error("Account deletion is not available right now.");
      return;
    }
    const accepted = global.confirm(
      'This will permanently remove your account profile and authored public content. Type confirmation in the next step to continue.'
    );
    if (!accepted) return;
    const typed = global.prompt('Type DELETE to permanently remove your account', "");
    if (typed !== "DELETE") {
      global.MC?.info("Account deletion was canceled.");
      return;
    }
    try {
      await global.API.deleteMyAccount("DELETE");
      safeTrack("interaction", "account_deleted", {});
      global.API.logout();
      global.MC?.success("Your account was deleted.");
      global.setTimeout(() => global.location.reload(), 600);
    } catch (error) {
      global.MC?.error(error?.message || "Could not delete your account.");
    }
  }

  function appendPrivacyControls() {
    const page = document.getElementById("pgSettingsPrivacy");
    if (!page || page.querySelector(".privacy-compliance-card")) return;
    const shell = page.querySelector(".more-page-shell") || page;
    const section = document.createElement("section");
    section.className = "more-surface-card more-surface-card-feature privacy-compliance-card";
    const consent = getConsentState();
    section.innerHTML = `
      <div class="more-section-head">
        <div>
          <span class="about-card-label">Privacy & Compliance</span>
          <h2>Understand and control your data</h2>
          <p>Review privacy details, choose cookie preferences, export your data, or remove your account safely.</p>
        </div>
      </div>
      <div class="privacy-compliance-grid">
        <div class="privacy-compliance-item">
          <strong>Cookie preference</strong>
          <span>${consent?.mode === "full" ? "Analytics cookies allowed" : consent?.mode === "essential_only" ? "Essential cookies only" : "Not chosen yet"}</span>
        </div>
        <div class="privacy-compliance-item">
          <strong>Account tools</strong>
          <span>${global.CU ? "Export or delete your account data." : "Sign in to use account privacy tools."}</span>
        </div>
      </div>
      <div class="more-action-row">
        <button class="btn btn-w" type="button" id="openPrivacyPolicyBtn">Privacy Policy</button>
        <button class="btn btn-w" type="button" id="cookiePrefsBtn">Cookie Preferences</button>
        ${global.CU ? '<button class="btn btn-w" type="button" id="exportDataBtn">Export My Data</button>' : ""}
        ${global.CU ? '<button class="btn btn-p" type="button" id="deleteAccountBtn">Delete Account</button>' : ""}
      </div>
    `;
    shell.appendChild(section);
    section.querySelector("#openPrivacyPolicyBtn")?.addEventListener("click", openPrivacyPolicyModal);
    section.querySelector("#cookiePrefsBtn")?.addEventListener("click", () => {
      const current = getConsentState()?.mode || "essential_only";
      applyConsentChoice(current === "full" ? "essential_only" : "full");
      appendPrivacyControlsRefresh();
    });
    section.querySelector("#exportDataBtn")?.addEventListener("click", exportMyData);
    section.querySelector("#deleteAccountBtn")?.addEventListener("click", deleteMyAccountFlow);
  }

  function appendPrivacyControlsRefresh() {
    document.querySelector(".privacy-compliance-card")?.remove();
    appendPrivacyControls();
  }

  function enhanceSettingsPrivacyPage() {
    if (typeof global.renderSettingsPrivacyPage !== "function") return;
    if (global.renderSettingsPrivacyPage.__tsEnhanced) return;
    const original = global.renderSettingsPrivacyPage;
    const wrapped = function wrappedRenderSettingsPrivacyPage() {
      const result = original.apply(this, arguments);
      appendPrivacyControls();
      return result;
    };
    wrapped.__tsEnhanced = true;
    global.renderSettingsPrivacyPage = wrapped;
  }

  function autoDetectLanguage() {
    try {
      const saved = JSON.parse(localStorage.getItem("ts_morePrefs") || "{}");
      if (saved && saved.language) return;
    } catch {}
    const navLanguage = (navigator.language || "en").slice(0, 2).toLowerCase();
    const mapped = SUPPORTED_LANGUAGES[navLanguage];
    if (mapped && typeof global.setAppLanguage === "function") {
      global.setAppLanguage(mapped);
    }
  }

  function installPageTracking() {
    const originalTrack = global.trackVirtualPageView;
    if (typeof originalTrack !== "function" || originalTrack.__tsEnhanced) return;
    const wrapped = function wrappedTrackVirtualPageView(page) {
      const result = originalTrack.apply(this, arguments);
      safeTrack("page_view", "virtual_page_view", {
        page: page || "home",
        path: page === "home" ? "/" : `/${page}`,
      });
      return result;
    };
    wrapped.__tsEnhanced = true;
    global.trackVirtualPageView = wrapped;
    safeTrack("page_view", "initial_page_view", {
      page: global.curPage || "home",
      path: global.location.pathname || "/",
    });
  }

  function installSearchTracking() {
    if (typeof global.doSearch !== "function" || global.doSearch.__tsEnhanced) return;
    const originalSearch = global.doSearch;
    const wrappedSearch = function wrappedSearch(query) {
      const text = String(query || "").trim();
      noteUserActivity("search");
      if (text.length >= 2) {
        const now = Date.now();
        if (
          text.toLowerCase() !== lastTrackedSearch.query ||
          now - lastTrackedSearch.at > 8000
        ) {
          lastTrackedSearch = {
            query: text.toLowerCase(),
            at: now,
          };
          safeTrack("interaction", "search_used", {
            page: "search",
            query: compactText(text, 80),
            queryLength: text.length,
          });
        }
      }
      return originalSearch.apply(this, arguments);
    };
    wrappedSearch.__tsEnhanced = true;
    global.doSearch = wrappedSearch;
  }

  function getHoverInterestLabel(target) {
    const node = target?.closest?.(
      "button, a, .post, .card, .vid-card, [data-video-id], [data-user-id], .chat-item, .fol-item"
    );
    if (!node) return "";
    const explicit =
      node.getAttribute("aria-label") ||
      node.getAttribute("title") ||
      node.getAttribute("data-video-title") ||
      node.getAttribute("data-alt") ||
      "";
    if (explicit) return compactText(explicit, 70);
    return compactText(node.textContent || "", 70);
  }

  function installHoverInterestTracking() {
    document.addEventListener(
      "mouseover",
      (event) => {
        const label = getHoverInterestLabel(event.target);
        if (!label) return;
        hoverIntentTarget = label;
        if (hoverIntentTimerId) {
          global.clearTimeout(hoverIntentTimerId);
        }
        hoverIntentTimerId = global.setTimeout(() => {
          hoverIntentTimerId = 0;
          if (!hoverIntentTarget) return;
          safeTrack("interaction", "hover_interest", {
            page: getCurrentPageName(),
            targetLabel: hoverIntentTarget,
          });
        }, 900);
      },
      { passive: true }
    );

    document.addEventListener(
      "mouseout",
      () => {
        hoverIntentTarget = null;
        if (hoverIntentTimerId) {
          global.clearTimeout(hoverIntentTimerId);
          hoverIntentTimerId = 0;
        }
      },
      { passive: true }
    );
  }

  function installChatTracking() {
    if (typeof global.openChatWindow === "function" && !global.openChatWindow.__tsEnhanced) {
      const originalOpenChatWindow = global.openChatWindow;
      const wrappedOpenChatWindow = function wrappedOpenChatWindow(chatId) {
        const chatKey = String(chatId || "").trim();
        if (chatKey) {
          safeTrack("interaction", "chat_opened", {
            page: "chats",
            chatId: chatKey,
            conversationType: chatKey.startsWith("cg") ? "group" : "direct",
          });
        }
        return originalOpenChatWindow.apply(this, arguments);
      };
      wrappedOpenChatWindow.__tsEnhanced = true;
      global.openChatWindow = wrappedOpenChatWindow;
    }

    if (typeof global.openNewDMModal === "function" && !global.openNewDMModal.__tsEnhanced) {
      const originalOpenNewDMModal = global.openNewDMModal;
      const wrappedOpenNewDMModal = function wrappedOpenNewDMModal() {
        safeTrack("interaction", "dm_modal_opened", {
          page: "chats",
        });
        return originalOpenNewDMModal.apply(this, arguments);
      };
      wrappedOpenNewDMModal.__tsEnhanced = true;
      global.openNewDMModal = wrappedOpenNewDMModal;
    }

    if (typeof global.openNewGroupModal === "function" && !global.openNewGroupModal.__tsEnhanced) {
      const originalOpenNewGroupModal = global.openNewGroupModal;
      const wrappedOpenNewGroupModal = function wrappedOpenNewGroupModal() {
        safeTrack("interaction", "group_modal_opened", {
          page: "chats",
        });
        return originalOpenNewGroupModal.apply(this, arguments);
      };
      wrappedOpenNewGroupModal.__tsEnhanced = true;
      global.openNewGroupModal = wrappedOpenNewGroupModal;
    }

    if (typeof global.updateChatTyping === "function" && !global.updateChatTyping.__tsEnhanced) {
      const originalUpdateChatTyping = global.updateChatTyping;
      const wrappedUpdateChatTyping = function wrappedUpdateChatTyping() {
        const now = Date.now();
        if (now - lastTrackedTypingAt >= 10000) {
          lastTrackedTypingAt = now;
          safeTrack("interaction", "chat_typing", {
            page: "chats",
          });
        }
        return originalUpdateChatTyping.apply(this, arguments);
      };
      wrappedUpdateChatTyping.__tsEnhanced = true;
      global.updateChatTyping = wrappedUpdateChatTyping;
    }
  }

  function installLogoutTracking() {
    if (typeof global.logout !== "function" || global.logout.__tsEnhanced) return;
    const originalLogout = global.logout;
    const wrappedLogout = function wrappedLogout() {
      clearIdleTimer();
      flushPageDuration("logout");
      safeTrack("interaction", "auth_logout", {
        page: getCurrentPageName(),
      });
      return originalLogout.apply(this, arguments);
    };
    wrappedLogout.__tsEnhanced = true;
    global.logout = wrappedLogout;
  }

  function installErrorTracking() {
    global.addEventListener("error", (event) => {
      safeTrack("error", "client_error", {
        message: event.message || "Unknown error",
        source: event.filename || "",
        line: event.lineno || 0,
        column: event.colno || 0,
      });
    });
    global.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      safeTrack("error", "unhandled_rejection", {
        message: reason?.message || String(reason || "Unhandled rejection"),
      });
    });
  }

  function installPerformanceTracking() {
    const navigationEntry = performance.getEntriesByType?.("navigation")?.[0];
    if (navigationEntry) {
      safeTrack("performance", "page_load_time", {
        value: Math.round(navigationEntry.loadEventEnd || navigationEntry.duration || 0),
        domContentLoadedMs: Math.round(
          navigationEntry.domContentLoadedEventEnd || 0
        ),
        responseMs: Math.round(navigationEntry.responseEnd || 0),
      });
    }
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const observer = new PerformanceObserver((entryList) => {
        entryList.getEntries().forEach((entry) => {
          if (entry.entryType === "largest-contentful-paint") {
            safeTrack("performance", "largest_contentful_paint", {
              value: Math.round(entry.startTime),
            });
          }
          if (entry.entryType === "layout-shift" && !entry.hadRecentInput) {
            safeTrack("performance", "layout_shift", {
              value: Number(entry.value || 0).toFixed(4),
            });
          }
        });
      });
      observer.observe({ type: "largest-contentful-paint", buffered: true });
      observer.observe({ type: "layout-shift", buffered: true });
    } catch {}
  }

  function observeDom() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.("img")) upgradeImage(node);
          if (node.matches?.("iframe")) upgradeIframe(node);
          if (node.matches?.("video")) upgradeVideo(node);
          enhanceMedia(node);
          ensureToastAccessibility();
          syncTabStates();
          appendPrivacyControls();
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    injectSkipLink();
    enhanceMedia(document);
    ensureToastAccessibility();
    enhanceTabs();
    syncTabStates();
    scheduleCookieConsent();
    enhanceSettingsPrivacyPage();
    appendPrivacyControls();
    autoDetectLanguage();
    installLifecycleTracking();
    installPageTracking();
    installSearchTracking();
    installHoverInterestTracking();
    installChatTracking();
    installLogoutTracking();
    installErrorTracking();
    installPerformanceTracking();
    observeDom();
  }

  global.openPrivacyPolicyModal = openPrivacyPolicyModal;
  global.exportMyData = exportMyData;
  global.deleteMyAccountFlow = deleteMyAccountFlow;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
