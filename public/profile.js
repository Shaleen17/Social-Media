(function () {
  "use strict";

  const PROFILE_ROUTE_PARAM = "profile";
  const QR_MENU_LABEL = "My QR Code";
  const QR_SCAN_MENU_LABEL = "Scan QR Code";
  const QR_MODAL_ID = "profileQrOvl";
  const QR_SCANNER_MODAL_ID = "profileQrScannerOvl";
  const QR_QUERY_KEYS_TO_CLEAR = ["reel", "r", "partner", "brandPartner"];
  let pendingSharedProfileId = getInitialSharedProfileId();
  let profileQrScannerStream = null;
  let profileQrScannerDetector = null;
  let profileQrScannerFrameId = 0;
  let profileQrScannerActive = false;
  let profileQrScannerBusy = false;
  let profileQrScannerLastValue = "";
  let profileQrScannerLastScannedAt = 0;

  function normalizeProfileId(value) {
    const id = String(value || "").trim();
    return /^[0-9a-fA-F]{24}$/.test(id) ? id : "";
  }

  function getInitialSharedProfileId() {
    try {
      const params = new URLSearchParams(window.location.search);
      return normalizeProfileId(params.get(PROFILE_ROUTE_PARAM) || "");
    } catch {
      return "";
    }
  }

  function getCurrentProfileId() {
    return normalizeProfileId(window.curProfId || window.CU?.id || window.CU?._id || "");
  }

  function getCurrentProfileUser() {
    const id = getCurrentProfileId();
    if (!id || typeof window.getUser !== "function") return null;
    return window.getUser(id) || null;
  }

  function getCurrentPageName() {
    const activePage = document.querySelector(".page:not(.hide)");
    const activeId = String(activePage?.id || "");
    if (!activeId.startsWith("pg") || activeId.length <= 2) return "";
    const pageName = activeId.slice(2);
    return pageName.charAt(0).toLowerCase() + pageName.slice(1);
  }

  function buildProfileShareUrl(userId) {
    const id = normalizeProfileId(userId);
    const url = new URL(window.location.href);
    url.hash = "";
    url.search = "";
    if (id) {
      url.searchParams.set(PROFILE_ROUTE_PARAM, id);
    }
    return url.toString();
  }

  function buildProfileQrPreviewUrl(userId) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=${encodeURIComponent(buildProfileShareUrl(userId))}`;
  }

  function extractProfileIdFromQrValue(value) {
    const rawValue = String(value || "").trim();
    const directId = normalizeProfileId(rawValue);
    if (directId) return directId;

    try {
      const url = new URL(rawValue, window.location.origin);
      const sharedId = normalizeProfileId(
        url.searchParams.get(PROFILE_ROUTE_PARAM) || ""
      );
      if (sharedId) return sharedId;
    } catch {}

    const match = rawValue.match(/[?&]profile=([0-9a-fA-F]{24})\b/);
    return normalizeProfileId(match?.[1] || "");
  }

  function copyProfileLink(url) {
    if (!url) return;
    if (typeof window.copyTextToClipboard === "function") {
      window.copyTextToClipboard(url, "Profile link copied.");
      return;
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(url)
        .then(() => window.MC?.success?.("Profile link copied."))
        .catch(() => window.MC?.error?.("Could not copy right now."));
    }
  }

  function closeProfileActionMenu() {
    document.querySelectorAll(".profile-action-dropdown.show").forEach((menu) => {
      menu.classList.remove("show");
      const button = menu.parentElement?.querySelector(".profile-menu-btn");
      if (button) button.setAttribute("aria-expanded", "false");
    });
  }

  function ensureProfileQrModal() {
    let overlay = document.getElementById(QR_MODAL_ID);
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.className = "ovl";
    overlay.id = QR_MODAL_ID;
    overlay.innerHTML = `
      <div class="modal profile-qr-modal" role="dialog" aria-modal="true" aria-labelledby="profileQrTitle">
        <div class="mhdr">
          <h3 id="profileQrTitle">${QR_MENU_LABEL}</h3>
          <button class="xbtn" type="button" aria-label="Close QR code">
            <svg viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="mpad">
          <div class="profile-qr-shell">
            <div class="profile-qr-preview">
              <img id="profileQrImage" alt="Profile QR code" referrerpolicy="no-referrer">
            </div>
            <div class="profile-qr-name" id="profileQrName"></div>
            <div class="profile-qr-handle" id="profileQrHandle"></div>
            <p class="profile-qr-copy" id="profileQrCopy">Scan this QR code to open the profile directly.</p>
            <div class="profile-qr-link" id="profileQrLink"></div>
            <div class="profile-qr-fallback" id="profileQrFallback" hidden>
              QR preview is unavailable right now. The direct profile link below still works.
            </div>
            <div class="profile-qr-actions">
              <button class="btn btn-p" id="profileQrCopyBtn" type="button">Copy Profile Link</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const closeButton = overlay.querySelector(".xbtn");
    closeButton?.addEventListener("click", () => {
      if (typeof window.closeOvl === "function") {
        window.closeOvl(QR_MODAL_ID);
      } else {
        overlay.classList.remove("show");
      }
    });

    overlay.addEventListener("click", (event) => {
      if (event.target !== overlay) return;
      if (typeof window.closeOvl === "function") {
        window.closeOvl(QR_MODAL_ID);
      } else {
        overlay.classList.remove("show");
      }
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  function setProfileQrScannerStatus(message, isError = false) {
    const status = document.getElementById("profileQrScannerStatus");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", !!isError);
  }

  function stopProfileQrScanner() {
    profileQrScannerActive = false;
    profileQrScannerBusy = false;
    profileQrScannerLastValue = "";
    profileQrScannerLastScannedAt = 0;

    if (profileQrScannerFrameId) {
      window.cancelAnimationFrame(profileQrScannerFrameId);
      profileQrScannerFrameId = 0;
    }

    const video = document.getElementById("profileQrScannerVideo");
    if (video) {
      try {
        video.pause();
      } catch {}
      video.srcObject = null;
    }

    if (profileQrScannerStream) {
      profileQrScannerStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
    }

    profileQrScannerStream = null;
    profileQrScannerDetector = null;
  }

  function closeProfileQrScannerModal() {
    stopProfileQrScanner();
    const overlay = document.getElementById(QR_SCANNER_MODAL_ID);
    if (!overlay) return;
    if (typeof window.closeOvl === "function") {
      window.closeOvl(QR_SCANNER_MODAL_ID);
    } else {
      overlay.classList.remove("show");
    }
  }

  function ensureProfileQrScannerModal() {
    let overlay = document.getElementById(QR_SCANNER_MODAL_ID);
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.className = "ovl";
    overlay.id = QR_SCANNER_MODAL_ID;
    overlay.innerHTML = `
      <div class="modal profile-qr-modal profile-qr-scanner-modal" role="dialog" aria-modal="true" aria-labelledby="profileQrScannerTitle">
        <div class="mhdr">
          <h3 id="profileQrScannerTitle">${QR_SCAN_MENU_LABEL}</h3>
          <button class="xbtn" type="button" aria-label="Close QR scanner">
            <svg viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="mpad">
          <div class="profile-qr-shell profile-qr-scanner-shell">
            <div class="profile-qr-scanner-stage">
              <video id="profileQrScannerVideo" autoplay playsinline muted></video>
              <div class="profile-qr-scanner-target" aria-hidden="true"></div>
            </div>
            <p class="profile-qr-copy profile-qr-scanner-status" id="profileQrScannerStatus">
              Point your camera at a profile QR code.
            </p>
            <div class="profile-qr-actions profile-qr-scanner-actions">
              <button class="btn" id="profileQrScannerRetryBtn" type="button" hidden>Retry Camera</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const closeButton = overlay.querySelector(".xbtn");
    closeButton?.addEventListener("click", closeProfileQrScannerModal);

    overlay.addEventListener("click", (event) => {
      if (event.target !== overlay) return;
      closeProfileQrScannerModal();
    });

    overlay
      .querySelector("#profileQrScannerRetryBtn")
      ?.addEventListener("click", () => {
        startProfileQrScanner();
      });

    const observer = new MutationObserver(() => {
      if (!overlay.classList.contains("show")) {
        stopProfileQrScanner();
      }
    });
    observer.observe(overlay, {
      attributes: true,
      attributeFilter: ["class"],
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  function openProfileQrModal(profileId) {
    const id = normalizeProfileId(profileId) || getCurrentProfileId();
    const user = id && typeof window.getUser === "function" ? window.getUser(id) : null;
    if (!user) {
      window.MC?.error?.("Profile QR code is not ready yet.");
      return;
    }

    const overlay = ensureProfileQrModal();
    const shareUrl = buildProfileShareUrl(id);
    const image = overlay.querySelector("#profileQrImage");
    const name = overlay.querySelector("#profileQrName");
    const handle = overlay.querySelector("#profileQrHandle");
    const link = overlay.querySelector("#profileQrLink");
    const fallback = overlay.querySelector("#profileQrFallback");
    const copyButton = overlay.querySelector("#profileQrCopyBtn");
    const title = overlay.querySelector("#profileQrTitle");

    if (title) title.textContent = QR_MENU_LABEL;
    if (name) name.textContent = user.name || "Profile";
    if (handle) handle.textContent = user.handle ? `@${user.handle}` : "";
    if (link) link.textContent = shareUrl;
    if (copyButton) {
      copyButton.onclick = () => copyProfileLink(shareUrl);
    }

    if (image) {
      image.hidden = false;
      image.onload = () => {
        image.hidden = false;
        if (fallback) fallback.hidden = true;
      };
      image.onerror = () => {
        image.hidden = true;
        if (fallback) fallback.hidden = false;
      };
      image.alt = `QR code for ${user.name || "profile"}`;
      image.src = buildProfileQrPreviewUrl(id);
    }

    if (fallback) {
      fallback.hidden = true;
    }

    closeProfileActionMenu();
    if (typeof window.openOvl === "function") {
      window.openOvl(QR_MODAL_ID);
    } else {
      overlay.classList.add("show");
    }
  }

  async function openProfileFromQrValue(rawValue) {
    const profileId = extractProfileIdFromQrValue(rawValue);
    if (!profileId) {
      setProfileQrScannerStatus(
        "This QR code does not contain a profile link.",
        true
      );
      return false;
    }

    setProfileQrScannerStatus("Opening profile...");

    try {
      const user = await fetchProfileUser(profileId);
      const resolvedId = normalizeProfileId(user?.id || user?._id || profileId);
      if (!resolvedId) {
        setProfileQrScannerStatus("This profile is not available.", true);
        return false;
      }

      closeProfileQrScannerModal();
      window.curProfId = resolvedId;
      if (typeof window.gp === "function") {
        window.gp("profile");
      } else if (typeof window.renderProfile === "function") {
        window.renderProfile(resolvedId);
      }
      window.MC?.success?.("Profile opened.");
      return true;
    } catch (error) {
      console.warn("Failed to open scanned profile:", error);
      setProfileQrScannerStatus("Could not open this profile right now.", true);
      return false;
    }
  }

  async function scanProfileQrFrame() {
    if (!profileQrScannerActive) return;

    const video = document.getElementById("profileQrScannerVideo");
    if (!video || !profileQrScannerDetector) {
      stopProfileQrScanner();
      return;
    }

    if (video.readyState < 2 || profileQrScannerBusy) {
      profileQrScannerFrameId = window.requestAnimationFrame(scanProfileQrFrame);
      return;
    }

    profileQrScannerBusy = true;
    try {
      const codes = await profileQrScannerDetector.detect(video);
      const match = codes.find((item) => String(item?.rawValue || "").trim());
      if (match) {
        const rawValue = String(match.rawValue || "").trim();
        const now = Date.now();
        if (
          rawValue &&
          (rawValue !== profileQrScannerLastValue ||
            now - profileQrScannerLastScannedAt > 1800)
        ) {
          profileQrScannerLastValue = rawValue;
          profileQrScannerLastScannedAt = now;
          const opened = await openProfileFromQrValue(rawValue);
          if (opened) return;
        }
      }
    } catch (error) {
      if (
        error?.name !== "NotSupportedError" &&
        error?.name !== "InvalidStateError"
      ) {
        console.warn("QR scanner detect error:", error);
      }
    } finally {
      profileQrScannerBusy = false;
    }

    if (profileQrScannerActive) {
      profileQrScannerFrameId = window.requestAnimationFrame(scanProfileQrFrame);
    }
  }

  async function startProfileQrScanner() {
    const overlay = ensureProfileQrScannerModal();
    const retryButton = overlay.querySelector("#profileQrScannerRetryBtn");
    const video = overlay.querySelector("#profileQrScannerVideo");

    stopProfileQrScanner();
    if (retryButton) retryButton.hidden = true;

    if (
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      setProfileQrScannerStatus(
        "Camera scanning is not available on this device.",
        true
      );
      if (retryButton) retryButton.hidden = false;
      return;
    }

    if (typeof window.BarcodeDetector !== "function") {
      setProfileQrScannerStatus(
        "This browser does not support live QR scanning yet. Use a recent Chrome browser on mobile.",
        true
      );
      if (retryButton) retryButton.hidden = false;
      return;
    }

    setProfileQrScannerStatus("Starting camera...");

    try {
      profileQrScannerDetector = new window.BarcodeDetector({
        formats: ["qr_code"],
      });
      profileQrScannerStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
        },
      });

      if (video) {
        video.srcObject = profileQrScannerStream;
        await video.play();
      }

      profileQrScannerActive = true;
      setProfileQrScannerStatus("Point your camera at a profile QR code.");
      profileQrScannerFrameId = window.requestAnimationFrame(scanProfileQrFrame);
    } catch (error) {
      console.warn("Failed to start QR scanner:", error);
      stopProfileQrScanner();
      setProfileQrScannerStatus(
        error?.name === "NotAllowedError"
          ? "Camera access was blocked. Allow camera permission and try again."
          : "Could not start the camera right now.",
        true
      );
      if (retryButton) retryButton.hidden = false;
    }
  }

  function openProfileQrScannerModal() {
    ensureProfileQrScannerModal();
    closeProfileActionMenu();
    if (typeof window.openOvl === "function") {
      window.openOvl(QR_SCANNER_MODAL_ID);
    } else {
      document.getElementById(QR_SCANNER_MODAL_ID)?.classList.add("show");
    }
    window.setTimeout(() => {
      startProfileQrScanner();
    }, 60);
  }

  function createProfileActionMenu(userId) {
    const wrapper = document.createElement("div");
    wrapper.className = "profile-action-menu";
    wrapper.dataset.profileUserId = normalizeProfileId(userId);

    const button = document.createElement("button");
    button.className = "profile-menu-btn";
    button.type = "button";
    button.setAttribute("aria-label", "Open profile actions");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");

    const dots = document.createElement("span");
    dots.className = "profile-menu-dots";
    for (let i = 0; i < 3; i += 1) {
      const dot = document.createElement("span");
      dot.className = "profile-menu-dot";
      dots.appendChild(dot);
    }
    button.appendChild(dots);

    const menu = document.createElement("div");
    menu.className = "profile-action-dropdown";
    menu.setAttribute("role", "menu");

    const item = document.createElement("button");
    item.className = "profile-action-item";
    item.type = "button";
    item.textContent = QR_MENU_LABEL;
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openProfileQrModal(wrapper.dataset.profileUserId);
    });

    const scanItem = document.createElement("button");
    scanItem.className = "profile-action-item";
    scanItem.type = "button";
    scanItem.textContent = QR_SCAN_MENU_LABEL;
    scanItem.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openProfileQrScannerModal();
    });

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const shouldOpen = !menu.classList.contains("show");
      closeProfileActionMenu();
      menu.classList.toggle("show", shouldOpen);
      button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    });

    menu.appendChild(item);
    menu.appendChild(scanItem);
    wrapper.appendChild(button);
    wrapper.appendChild(menu);
    return wrapper;
  }

  function ensureProfileActionMenu() {
    const actions = document.getElementById("prActions");
    const headerSlot = document.getElementById("profileHeaderActionSlot");
    const slot = document.getElementById("profileActionSlot");
    const user = getCurrentProfileUser();
    const host = headerSlot || slot || actions;

    if (!host || !user) {
      closeProfileActionMenu();
      return;
    }

    let menu =
      headerSlot?.querySelector(".profile-action-menu") ||
      actions?.querySelector(".profile-action-menu") ||
      document.querySelector("#pgProfile .profile-action-menu");
    const userId = normalizeProfileId(user.id || user._id || "");
    if (!menu) {
      menu = createProfileActionMenu(userId);
      host.appendChild(menu);
      return;
    }

    menu.dataset.profileUserId = userId;
    if (menu.parentElement !== host) {
      host.appendChild(menu);
    }
  }

  function syncProfileRouteParam(pageName) {
    try {
      const url = new URL(window.location.href);
      const page = pageName || getCurrentPageName();
      const profileId = page === "profile" ? getCurrentProfileId() : "";

      if (profileId) {
        url.searchParams.set(PROFILE_ROUTE_PARAM, profileId);
        QR_QUERY_KEYS_TO_CLEAR.forEach((key) => url.searchParams.delete(key));
      } else {
        url.searchParams.delete(PROFILE_ROUTE_PARAM);
      }

      url.hash = "";
      history.replaceState(history.state || { page: page || "home" }, "", url.toString());
    } catch {}
  }

  function wrapProfileNavigation() {
    if (typeof window.gp !== "function" || window.gp.__profileQrWrapped) return;
    const originalGp = window.gp;
    const wrappedGp = function (page) {
      const result = originalGp.apply(this, arguments);
      syncProfileRouteParam(page);
      if (page !== "profile") {
        closeProfileActionMenu();
      }
      return result;
    };
    wrappedGp.__profileQrWrapped = true;
    window.gp = wrappedGp;
  }

  function wrapProfileRenderer() {
    if (typeof window.renderProfile !== "function" || window.renderProfile.__profileQrWrapped) return;
    const originalRenderProfile = window.renderProfile;
    const wrappedRenderProfile = function () {
      const result = originalRenderProfile.apply(this, arguments);
      ensureProfileActionMenu();
      if (getCurrentPageName() === "profile") {
        syncProfileRouteParam("profile");
      }
      return result;
    };
    wrappedRenderProfile.__profileQrWrapped = true;
    window.renderProfile = wrappedRenderProfile;
  }

  async function fetchProfileUser(profileId) {
    const id = normalizeProfileId(profileId);
    if (!id) return null;

    const cachedUser = typeof window.getUser === "function" ? window.getUser(id) : null;
    if (cachedUser) return cachedUser;

    if (!window.API || typeof window.API.getUser !== "function") return null;
    const remoteUser = await window.API.getUser(id);
    if (!remoteUser) return null;

    if (typeof window.hydrateRemoteUser === "function") {
      return window.hydrateRemoteUser(remoteUser) || remoteUser;
    }

    return remoteUser;
  }

  async function handlePendingProfileRoute() {
    const profileId = pendingSharedProfileId || getInitialSharedProfileId();
    if (!profileId) return false;
    pendingSharedProfileId = "";

    try {
      const user = await fetchProfileUser(profileId);
      if (!user) return false;

      const resolvedId = normalizeProfileId(user.id || user._id || profileId);
      if (!resolvedId) return false;

      window.curProfId = resolvedId;
      if (typeof window.gp === "function") {
        window.gp("profile");
      } else if (typeof window.renderProfile === "function") {
        window.renderProfile(resolvedId);
      }
      return true;
    } catch (error) {
      console.warn("Failed to open shared profile route:", error);
      return false;
    }
  }

  function schedulePendingProfileRoute() {
    const run = () => {
      Promise.resolve(window.__TS_BOOT_PROMISE)
        .catch(() => null)
        .finally(() => {
          handlePendingProfileRoute().finally(() => {
            syncProfileRouteParam(getCurrentPageName());
          });
        });
    };

    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          window.setTimeout(run, 0);
        },
        { once: true }
      );
    } else {
      window.setTimeout(run, 0);
    }
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest(".profile-action-menu")) return;
    closeProfileActionMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.getElementById(QR_SCANNER_MODAL_ID)?.classList.contains("show")) {
      closeProfileQrScannerModal();
    }
    closeProfileActionMenu();
  });

  window.addEventListener("resize", closeProfileActionMenu);
  window.addEventListener("pagehide", stopProfileQrScanner);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopProfileQrScanner();
    }
  });
  window.addEventListener("popstate", () => {
    window.setTimeout(() => {
      stopProfileQrScanner();
      closeProfileActionMenu();
      syncProfileRouteParam(getCurrentPageName());
    }, 0);
  });

  wrapProfileNavigation();
  wrapProfileRenderer();
  ensureProfileQrModal();
  schedulePendingProfileRoute();

  window.openProfileQrModal = openProfileQrModal;
  window.openProfileQrScannerModal = openProfileQrScannerModal;
  window.handlePendingProfileRoute = handlePendingProfileRoute;
})();
