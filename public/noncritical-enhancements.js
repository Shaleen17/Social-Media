(function initNonCriticalEnhancements(global) {
  const CONSENT_KEY = "ts_cookieConsent_v1";
  const SESSION_KEY = "ts_analyticsSessionId";
  const ANON_KEY = "ts_analyticsAnonymousId";
  const COOKIE_BANNER_ID = "tsCookieConsent";
  const PRIVACY_MODAL_ID = "tsPrivacyModal";
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

    global.API.trackEvent(type, name, {
      sessionId: ensureStoredId(SESSION_KEY, "sess"),
      anonymousId: ensureStoredId(ANON_KEY, "anon"),
      page: global.curPage || document.body?.dataset?.page || "home",
      ...meta,
    }).catch(() => {});
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

  function upgradeVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    if (!video.hasAttribute("preload")) {
      video.setAttribute("preload", "metadata");
    }
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
    const state = setConsentState(mode);
    document.getElementById(COOKIE_BANNER_ID)?.remove();
    safeTrack("consent", "cookie_preferences_updated", {
      mode: state.mode,
      updatedAt: state.updatedAt,
    });
  }

  function mountCookieConsent() {
    if (getConsentState() || document.getElementById(COOKIE_BANNER_ID)) return;
    const banner = document.createElement("aside");
    banner.id = COOKIE_BANNER_ID;
    banner.className = "cookie-consent-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-live", "polite");
    banner.innerHTML = `
      <div class="cookie-consent-copy">
        <strong>Cookie choices</strong>
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
    document.body.appendChild(banner);
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
    mountCookieConsent();
    enhanceSettingsPrivacyPage();
    appendPrivacyControls();
    autoDetectLanguage();
    installPageTracking();
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
