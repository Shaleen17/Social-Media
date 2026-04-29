(function initFounderControl(global) {
  "use strict";

  const FOUNDER_OWNER_EMAILS = [
    "tirthsutra@gmail.com",
    "tirthsutra@gemail.com",
  ];
  const FOUNDER_OWNER_HANDLES = ["tirthsutra"];
  const PAGE_ID = "founderControl";
  const ROOT_ID = "pgFounderControl";
  const USER_PAGE_SIZE = 18;
  const OVERVIEW_POLL_MS = 14000;
  const DIRECTORY_POLL_MS = 18000;
  const DETAIL_POLL_MS = 8000;
  const BUTTON_POLL_MS = 45000;
  const BUTTON_FETCH_MIN_GAP_MS = 15000;
  const BUTTON_FETCH_BACKOFF_MS = 60000;
  const BUTTON_PULSE_KEY = "tsFounderButtonPulseV2";
  const SAVED_VIEWS_KEY = "tsFounderSavedViewsV2";
  const MAX_SAVED_VIEWS = 8;

  const state = {
    overview: null,
    directory: null,
    selectedUserId: "",
    selectedUser: null,
    userQuery: "",
    userSort: "active",
    userPage: 1,
    rootBound: false,
    searchTimerId: 0,
    overviewTimerId: 0,
    directoryTimerId: 0,
    detailTimerId: 0,
    latestOverviewRequestId: 0,
    latestDirectoryRequestId: 0,
    latestDetailRequestId: 0,
    currentProfileId: "",
    profileActionsObserver: null,
    founderLayoutSyncBound: false,
    overviewSignature: "",
    directorySignature: "",
    detailSignature: "",
    pendingDashboardRefresh: false,
    streamAbortController: null,
    detailStreamAbortController: null,
    usingOverviewStream: false,
    usingDetailStream: false,
    buttonPulse: null,
    buttonTimerId: 0,
    latestButtonRequestId: 0,
    buttonFetchInFlight: false,
    buttonFetchQueued: false,
    buttonNextAllowedAt: 0,
    buttonSyncRafId: 0,
    savedViews: [],
    activeSavedViewId: "",
    selectedFunnelKey: "home_to_video_complete",
    selectedFunnelSteps: ["home", "tirth_tube", "video_started", "video_completed"],
    customFunnel: null,
    customFunnelSignature: "",
    latestFunnelRequestId: 0,
    releaseWindow: "24h",
  };

  function getCurrentUser() {
    return global.CU || global.API?.getStoredUser?.() || null;
  }

  function getCurrentUserId() {
    const user = getCurrentUser();
    return String(user?.id || user?._id || "").trim();
  }

  function getCurrentProfileHandle() {
    return String(document.getElementById("prHdl")?.textContent || "")
      .trim()
      .toLowerCase()
      .replace(/^@/, "");
  }

  function isOwnProfileActionArea(prActions) {
    if (!prActions) return false;
    const text = String(prActions.textContent || "").toLowerCase();
    return text.includes("edit profile") && text.includes("sign out");
  }

  function hasFounderProfileContext(prActions = document.getElementById("prActions")) {
    const handle = getCurrentProfileHandle();
    return (
      isOwnProfileActionArea(prActions) &&
      !!handle &&
      FOUNDER_OWNER_HANDLES.includes(handle)
    );
  }

  function isFounderOwner(user = getCurrentUser()) {
    const email = String(user?.email || "").trim().toLowerCase();
    const handle = String(user?.handle || "").trim().toLowerCase().replace(/^@/, "");
    return (
      (!!email && FOUNDER_OWNER_EMAILS.includes(email)) ||
      (!!handle && FOUNDER_OWNER_HANDLES.includes(handle)) ||
      hasFounderProfileContext()
    );
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString("en-IN");
  }

  function formatDurationMinutes(value) {
    const minutes = Number(value || 0);
    if (minutes >= 60) return `${(minutes / 60).toFixed(1)}h`;
    return `${minutes}m`;
  }

  function formatDurationSeconds(value) {
    const seconds = Number(value || 0);
    if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
    return `${seconds}s`;
  }

  function formatPercent(value) {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  function formatSignedPercent(value) {
    const safe = Number(value || 0);
    return `${safe > 0 ? "+" : ""}${safe.toFixed(1)}%`;
  }

  function formatFounderDirectoryLastSeen(value) {
    const safe = String(value || "").trim();
    if (!safe) return "Inactive";
    const staleDays = safe.match(/^(\d+)d ago$/i);
    if (staleDays && Number(staleDays[1]) > 365) return "No recent activity";
    return safe;
  }

  function formatFounderDirectoryHandle(value) {
    const safe = String(value || "").trim().replace(/^@+/, "");
    return safe ? `@${safe}` : "@no-handle";
  }

  function formatFounderDirectoryUsage(value) {
    const safe = String(value || "").trim();
    return safe || "Varied usage";
  }

  function formatFounderDirectorySignal(value) {
    const safe = String(value || "").trim();
    if (!safe || /^unknown$/i.test(safe)) return "";
    return safe;
  }

  function compactText(value, maxLength = 120) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
  }

  function buildPayloadSignature(payload) {
    try {
      return JSON.stringify(payload || {});
    } catch {
      return String(Date.now());
    }
  }

  function getBackendBase() {
    if (typeof global.getBackendBaseUrl === "function") {
      return global.getBackendBaseUrl();
    }
    if (global.CONFIG?.BACKEND_URL) {
      return String(global.CONFIG.BACKEND_URL).replace(/\/+$/, "");
    }
    return global.location.origin.replace(/\/+$/, "");
  }

  async function fetchFounderJson(path) {
    const token = global.API?.getToken?.() || "";
    const response = await fetch(`${getBackendBase()}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      cache: "no-store",
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {}
    if (!response.ok) {
      const error = new Error(data.error || "Could not load founder data.");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function fetchFounderOverview() {
    return fetchFounderJson("/api/founder/overview");
  }

  function fetchFounderUsers({ page = 1, limit = USER_PAGE_SIZE, q = "", sort = "active" } = {}) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      sort: String(sort || "active"),
    });
    if (q) params.set("q", q);
    return fetchFounderJson(`/api/founder/users?${params.toString()}`);
  }

  function fetchFounderUserIntelligence(userId) {
    return fetchFounderJson(`/api/founder/users/${encodeURIComponent(userId)}/intelligence`);
  }

  function fetchFounderButtonPulse() {
    return fetchFounderJson("/api/founder/button");
  }

  function fetchFounderFunnel(steps = []) {
    const params = new URLSearchParams();
    const safeSteps = Array.isArray(steps)
      ? steps.map((step) => String(step || "").trim()).filter(Boolean)
      : [];
    if (safeSteps.length) {
      params.set("steps", safeSteps.join(","));
    }
    return fetchFounderJson(`/api/founder/funnel?${params.toString()}`);
  }

  function buildStreamRequest(path, signal) {
    const token = global.API?.getToken?.() || "";
    return fetch(`${getBackendBase()}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/x-ndjson, application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      cache: "no-store",
      signal,
    });
  }

  function getStoredButtonPulse() {
    try {
      const raw = localStorage.getItem(BUTTON_PULSE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setStoredButtonPulse(value) {
    state.buttonPulse = value || null;
    try {
      if (value) localStorage.setItem(BUTTON_PULSE_KEY, JSON.stringify(value));
    } catch {}
  }

  function loadSavedViews() {
    try {
      const raw = localStorage.getItem(SAVED_VIEWS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      state.savedViews = Array.isArray(parsed) ? parsed.slice(0, MAX_SAVED_VIEWS) : [];
    } catch {
      state.savedViews = [];
    }
  }

  function persistSavedViews() {
    try {
      localStorage.setItem(
        SAVED_VIEWS_KEY,
        JSON.stringify((state.savedViews || []).slice(0, MAX_SAVED_VIEWS))
      );
    } catch {}
  }

  function toViewRecord(name = "") {
    return {
      id: `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: String(name || `Founder view ${(state.savedViews?.length || 0) + 1}`).trim(),
      userSort: state.userSort,
      userQuery: state.userQuery,
      funnelKey: state.selectedFunnelKey,
      funnelSteps: [...(state.selectedFunnelSteps || [])],
      releaseWindow: state.releaseWindow,
      createdAt: new Date().toISOString(),
    };
  }

  function saveCurrentFounderView() {
    loadSavedViews();
    const next = toViewRecord();
    state.savedViews = [next, ...(state.savedViews || [])].slice(0, MAX_SAVED_VIEWS);
    state.activeSavedViewId = next.id;
    persistSavedViews();
    renderFounderControl();
    global.MC?.success?.("Founder view saved.");
  }

  function deleteFounderView(viewId) {
    state.savedViews = (state.savedViews || []).filter((view) => view.id !== viewId);
    if (state.activeSavedViewId === viewId) {
      state.activeSavedViewId = "";
    }
    persistSavedViews();
    renderFounderControl();
  }

  function applyFounderView(view) {
    if (!view) return;
    state.activeSavedViewId = view.id || "";
    state.userSort = String(view.userSort || "active");
    state.userQuery = String(view.userQuery || "");
    state.selectedFunnelKey = String(view.funnelKey || "home_to_video_complete");
    state.selectedFunnelSteps = Array.isArray(view.funnelSteps) && view.funnelSteps.length
      ? view.funnelSteps.slice(0, 5)
      : ["home", "tirth_tube", "video_started", "video_completed"];
    state.releaseWindow = String(view.releaseWindow || "24h");
    refreshFounderUsers({ initial: true, force: true });
    refreshFounderFunnel({ force: true });
    renderFounderControl();
  }

  function getRoot() {
    return document.getElementById(ROOT_ID);
  }

  function isFounderControlVisible() {
    return !document.hidden && global.curPage === PAGE_ID;
  }

  function getFounderPanelHost() {
    return document.getElementById("founderUserPanelHost");
  }

  function captureFounderPanelScroll() {
    const panel = document.querySelector(".founder-user-panel");
    return panel
      ? {
          top: panel.scrollTop || 0,
          left: panel.scrollLeft || 0,
        }
      : { top: 0, left: 0 };
  }

  function restoreFounderPanelScroll(position) {
    if (!position) return;
    global.requestAnimationFrame(() => {
      const panel = document.querySelector(".founder-user-panel");
      if (!panel) return;
      panel.scrollTop = Number(position.top || 0);
      panel.scrollLeft = Number(position.left || 0);
    });
  }

  function ensureRootShell() {
    const root = getRoot();
    if (!root) return null;
    root.classList.add("founder-control-page");
    bindRootEvents(root);
    return root;
  }

  function renderState(kind, title, message) {
    const root = ensureRootShell();
    if (!root) return;
    root.innerHTML = `
      <section class="founder-state founder-state-${escapeHtml(kind)}">
        <div class="founder-state-badge">${escapeHtml(kind)}</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        ${
          kind === "locked"
            ? '<button class="btn btn-p" type="button" onclick="gp(\'home\')">Return home</button>'
            : ""
        }
      </section>
    `;
  }

  function renderMiniBars(items, valueKey, formatter = formatCount) {
    const list = Array.isArray(items) ? items : [];
    const maxValue = list.reduce((max, item) => Math.max(max, Number(item?.[valueKey]) || 0), 0) || 1;
    return list
      .map((item) => {
        const value = Number(item?.[valueKey]) || 0;
        const width = Math.max(8, Math.round((value / maxValue) * 100));
        return `
          <div class="founder-bar-row">
            <div class="founder-bar-label">${escapeHtml(item.label || item.page || item.tag || "Unknown")}</div>
            <div class="founder-bar-track"><span style="width:${width}%"></span></div>
            <div class="founder-bar-value">${escapeHtml(formatter(value))}</div>
          </div>
        `;
      })
      .join("");
  }

  function renderSeries(series) {
    const list = Array.isArray(series) ? series : [];
    const maxValue = list.reduce((max, item) => Math.max(max, Number(item?.count) || 0), 0) || 1;
    return `
      <div class="founder-series">
        ${list
          .map((item) => {
            const value = Number(item?.count) || 0;
            const height = Math.max(10, Math.round((value / maxValue) * 100));
            return `
              <div class="founder-series-col">
                <span style="height:${height}%"></span>
                <em>${escapeHtml(item.label || item.date || "")}</em>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderStatCards(snapshot) {
    const live = snapshot?.live || {};
    const cards = [
      ["Live people", live.activePeople, "Within the live activity window"],
      ["Live sessions", live.activeSessions, "Browser sessions active now"],
      ["Online signed-in", live.onlineSignedInUsers, "Socket-connected devotees"],
      ["Visitors today", live.visitorsToday, "Unique active journeys today"],
      ["Signed-in today", live.signedInUsersToday, "Authenticated users today"],
      ["New users today", live.newUsersToday, "Fresh signups since midnight"],
    ];
    return cards
      .map(
        ([label, value, hint]) => `
          <article class="founder-stat-card">
            <span>${escapeHtml(label)}</span>
            <strong>${formatCount(value)}</strong>
            <small>${escapeHtml(hint)}</small>
          </article>
        `
      )
      .join("");
  }

  function renderFounderIntelRail(snapshot) {
    const topPage = Array.isArray(snapshot?.pageAnalytics?.byPage)
      ? snapshot.pageAnalytics.byPage[0]
      : null;
    const topDropOff = Array.isArray(snapshot?.journey?.dropOffPages)
      ? snapshot.journey.dropOffPages[0]
      : null;
    const topHashtag = Array.isArray(snapshot?.trending?.hashtags)
      ? snapshot.trending.hashtags[0]
      : null;
    const topRecommendation = Array.isArray(snapshot?.recommendations)
      ? snapshot.recommendations[0]
      : "";
    const cards = [
      {
        label: "Attention magnet",
        value: topPage?.label || topPage?.page || "Waiting for signal",
        hint: topPage ? `${formatCount(topPage.visits || 0)} visits in the current window` : "Live page intelligence builds as sessions arrive",
      },
      {
        label: "Biggest drop-off",
        value: topDropOff?.label || topDropOff?.page || "No friction hotspot yet",
        hint: topDropOff ? `${formatCount(topDropOff.count || 0)} exits detected` : "No strong exit page pattern detected",
      },
      {
        label: "Rising theme",
        value: topHashtag?.label || topHashtag?.tag || "No hashtag spike yet",
        hint: topHashtag ? `${formatCount(topHashtag.count || 0)} discovery signals` : "Trending insight will surface here",
      },
      {
        label: "Founder next move",
        value: compactText(topRecommendation || "Focus on the clearest repeated user pattern next.", 56),
        hint: "System-curated recommendation from live platform behavior",
      },
    ];

    return `
      <section class="founder-intel-rail">
        ${cards
          .map(
            (card) => `
              <article class="founder-intel-card">
                <span>${escapeHtml(card.label)}</span>
                <strong>${escapeHtml(card.value)}</strong>
                <small>${escapeHtml(card.hint)}</small>
              </article>
            `
          )
          .join("")}
      </section>
    `;
  }

  function renderSavedViewChips(snapshot) {
    const presets = Array.isArray(snapshot?.savedViewPresets) ? snapshot.savedViewPresets : [];
    const savedViews = Array.isArray(state.savedViews) ? state.savedViews : [];
    return `
      <section class="founder-viewbar founder-card">
        <div class="founder-card-head">
          <h2>Saved founder views</h2>
          <span>Presets + your saved lenses</span>
        </div>
        <div class="founder-viewbar-row">
          ${presets
            .map(
              (view) => `
                <button
                  class="founder-view-chip ${state.activeSavedViewId === view.id ? "is-active" : ""}"
                  type="button"
                  data-founder-apply-preset="${escapeHtml(view.id)}"
                >
                  ${escapeHtml(view.label)}
                </button>
              `
            )
            .join("")}
          ${savedViews
            .map(
              (view) => `
                <div class="founder-view-chip-shell">
                  <button
                    class="founder-view-chip ${state.activeSavedViewId === view.id ? "is-active" : ""}"
                    type="button"
                    data-founder-apply-view="${escapeHtml(view.id)}"
                  >
                    ${escapeHtml(view.name)}
                  </button>
                  <button class="founder-view-delete" type="button" data-founder-delete-view="${escapeHtml(view.id)}" aria-label="Delete saved founder view">×</button>
                </div>
              `
            )
            .join("")}
          <button class="btn btn-w founder-view-save" type="button" data-founder-save-view="true">Save current view</button>
        </div>
      </section>
    `;
  }

  function renderAnomalyDeck(snapshot) {
    const items = Array.isArray(snapshot?.anomalies) ? snapshot.anomalies : [];
    return `
      <article class="founder-card">
        <div class="founder-card-head">
          <h2>Live anomaly radar</h2>
          <span>${formatCount(items.length)} active founder alerts</span>
        </div>
        <div class="founder-alert-grid">
          ${
            items.length
              ? items
                  .map(
                    (item) => `
                      <div class="founder-alert-card founder-alert-${escapeHtml(item.severity || "watch")}">
                        <div class="founder-alert-top">
                          <strong>${escapeHtml(item.title || "Alert")}</strong>
                          <span>${escapeHtml(item.metric || "")}</span>
                        </div>
                        <p>${escapeHtml(item.summary || "")}</p>
                        <div class="founder-alert-meta">
                          <small>${formatCount(item.current || 0)} now vs ${formatCount(item.previous || 0)} before</small>
                          <small>${formatSignedPercent(item.deltaPercent || 0)}</small>
                        </div>
                        <em>${escapeHtml(item.nextMove || "")}</em>
                      </div>
                    `
                  )
                  .join("")
              : '<div class="founder-empty">No active anomaly spike right now.</div>'
          }
        </div>
      </article>
    `;
  }

  function renderCohorts(snapshot) {
    const cohorts = snapshot?.cohorts || {};
    const audienceMix = Array.isArray(cohorts.audienceMix) ? cohorts.audienceMix : [];
    const behaviorSegments = Array.isArray(cohorts.behaviorSegments)
      ? cohorts.behaviorSegments
      : [];
    return `
      <article class="founder-card">
        <div class="founder-card-head">
          <h2>Cohorts & segments</h2>
          <span>Compare who is active right now</span>
        </div>
        <div class="founder-grid founder-grid-2 founder-grid-no-margin">
          <div class="founder-subcard">
            <h3>Audience mix</h3>
            ${renderMiniBars(audienceMix, "count")}
          </div>
          <div class="founder-subcard">
            <h3>Behavior segments</h3>
            ${renderMiniBars(behaviorSegments, "count")}
          </div>
          <div class="founder-subcard">
            <h3>Devices</h3>
            ${renderMiniBars(cohorts.devices || [], "count")}
          </div>
          <div class="founder-subcard">
            <h3>Time bands</h3>
            ${renderMiniBars(cohorts.timeBands || [], "count")}
          </div>
        </div>
      </article>
    `;
  }

  function renderFunnelSection(snapshot) {
    const funnelData = state.customFunnel || {};
    const presets = Array.isArray(snapshot?.funnels?.presets) ? snapshot.funnels.presets : [];
    const stepCatalog = Array.isArray(snapshot?.funnels?.stepCatalog) ? snapshot.funnels.stepCatalog : [];
    const selectedPreset = presets.find((item) => item.key === state.selectedFunnelKey) || presets[0] || null;
    const activeFunnel = funnelData.steps?.length ? funnelData : selectedPreset;
    const steps = Array.isArray(activeFunnel?.steps) ? activeFunnel.steps : [];
    return `
      <article class="founder-card">
        <div class="founder-card-head">
          <h2>Funnel builder</h2>
          <span>${escapeHtml(activeFunnel?.label || "Founder journey funnel")}</span>
        </div>
        <div class="founder-funnel-toolbar">
          <div class="founder-segmented" role="tablist" aria-label="Founder funnel presets">
            ${presets
              .map(
                (preset) => `
                  <button
                    class="founder-segmented-btn ${state.selectedFunnelKey === preset.key ? "is-active" : ""}"
                    type="button"
                    data-founder-funnel-preset="${escapeHtml(preset.key)}"
                  >
                    ${escapeHtml(preset.label)}
                  </button>
                `
              )
              .join("")}
          </div>
          <div class="founder-funnel-builder">
            ${Array.from({ length: 4 }).map((_, index) => `
              <label class="founder-funnel-select-shell">
                <span>Step ${index + 1}</span>
                <select data-founder-funnel-step="${index}">
                  ${stepCatalog
                    .map(
                      (option) => `
                        <option value="${escapeHtml(option.key)}" ${
                          state.selectedFunnelSteps[index] === option.key ? "selected" : ""
                        }>${escapeHtml(option.label)}</option>
                      `
                    )
                    .join("")}
                </select>
              </label>
            `).join("")}
            <button class="btn btn-p" type="button" data-founder-run-funnel="true">Analyze funnel</button>
          </div>
        </div>
        <div class="founder-funnel-steps">
          ${
            steps.length
              ? steps
                  .map(
                    (step) => `
                      <div class="founder-funnel-step">
                        <strong>${escapeHtml(step.label || "Step")}</strong>
                        <span>${formatCount(step.count || 0)} sessions</span>
                        <small>${formatPercent(step.conversionFromStart || 0)} from start</small>
                      </div>
                    `
                  )
                  .join("")
              : '<div class="founder-empty">Choose funnel steps to see the live conversion path.</div>'
          }
        </div>
        ${
          activeFunnel?.topDrop
            ? `<div class="founder-funnel-drop">Biggest drop: ${escapeHtml(activeFunnel.topDrop.from)} -> ${escapeHtml(activeFunnel.topDrop.to)} (${formatCount(activeFunnel.topDrop.lost || 0)} lost)</div>`
            : ""
        }
      </article>
    `;
  }

  function renderReleaseImpact(snapshot) {
    const impact = snapshot?.releaseImpact || {};
    const metrics = Array.isArray(impact.metrics) ? impact.metrics : [];
    return `
      <article class="founder-card">
        <div class="founder-card-head">
          <h2>Release impact mode</h2>
          <span>${escapeHtml(impact.label || "Recent release motion")}</span>
        </div>
        <div class="founder-impact-grid">
          ${metrics
            .map(
              (metric) => `
                <div class="founder-impact-card founder-impact-${escapeHtml(metric.direction || "flat")}">
                  <strong>${escapeHtml(metric.label || "Metric")}</strong>
                  <span>${formatCount(metric.current || 0)} now</span>
                  <small>${formatCount(metric.previous || 0)} before</small>
                  <em>${formatSignedPercent(metric.deltaPercent || 0)}</em>
                </div>
              `
            )
            .join("")}
        </div>
      </article>
    `;
  }

  function renderDecisionEngine(snapshot) {
    const items = Array.isArray(snapshot?.decisionEngine) ? snapshot.decisionEngine : [];
    return `
      <article class="founder-card">
        <div class="founder-card-head">
          <h2>Founder decision engine</h2>
          <span>What to improve next</span>
        </div>
        <div class="founder-recommendations founder-decision-list">
          ${
            items.length
              ? items
                  .map(
                    (item) => `
                      <div class="founder-decision-card founder-decision-${escapeHtml(item.severity || "info")}">
                        <strong>${escapeHtml(item.title || "Decision")}</strong>
                        <span>${escapeHtml(item.evidence || "")}</span>
                        <small>${escapeHtml(item.action || "")}</small>
                      </div>
                    `
                  )
                  .join("")
              : '<div class="founder-empty">Decision suggestions will appear as behavior patterns sharpen.</div>'
          }
        </div>
      </article>
    `;
  }

  function renderActivityItem(item) {
    const userId = item?.actor?.isGuest ? "" : String(item?.actor?.id || "").trim();
    const actionAttrs = userId ? `data-founder-open="${escapeHtml(userId)}"` : "";
    return `
      <button class="founder-activity-item founder-click-card" type="button" ${actionAttrs}>
        <div class="founder-activity-copy">
          <strong>${escapeHtml(item?.actor?.label || "Visitor")}</strong>
          <span>${escapeHtml(item?.title || "Activity")}</span>
          <small>${escapeHtml(item?.detail || item?.page || "")}</small>
        </div>
        <time>${escapeHtml(item?.ageLabel || "")}</time>
      </button>
    `;
  }

  function renderSessionItem(session) {
    const userId = session?.actor?.isGuest ? "" : String(session?.actor?.id || "").trim();
    const actionAttrs = userId ? `data-founder-open="${escapeHtml(userId)}"` : "";
    return `
      <button class="founder-session-item founder-click-card" type="button" ${actionAttrs}>
        <strong>${escapeHtml(session?.actor?.label || "Visitor")}</strong>
        <span>${escapeHtml(session?.currentPageLabel || session?.currentPage || "")}</span>
        <small>${escapeHtml(session?.deviceType || "device")} · ${escapeHtml(session?.browser || "browser")} · ${escapeHtml(session?.country || "Unknown")}</small>
        <time>${escapeHtml(formatDurationMinutes(session?.durationMinutes || 0))}</time>
      </button>
    `;
  }

  function renderUserDirectoryCard() {
    const directory = state.directory;
    const items = Array.isArray(directory?.items) ? directory.items : [];
    return `
      <article class="founder-card founder-user-explorer">
        <div class="founder-card-head">
          <h2>Open User Mode</h2>
          <span>${directory ? `${formatCount(directory.total)} visible users` : "Founder-only view"}</span>
        </div>
        <div class="founder-toolbar">
          <label class="founder-search-shell">
            <span>Search</span>
            <input id="founderUserSearch" type="search" placeholder="Find a seeker by name or handle" value="${escapeHtml(state.userQuery)}" />
          </label>
          <div class="founder-segmented" role="tablist" aria-label="Sort users">
            ${["active", "engaged", "newest"]
              .map(
                (sort) => `
                  <button
                    class="founder-segmented-btn ${state.userSort === sort ? "is-active" : ""}"
                    type="button"
                    data-founder-sort="${escapeHtml(sort)}"
                  >
                    ${escapeHtml(sort === "active" ? "Live" : sort === "engaged" ? "Engaged" : "Newest")}
                  </button>
                `
              )
              .join("")}
          </div>
        </div>
        <div class="founder-user-list">
          ${
            !directory
              ? '<div class="founder-empty">Loading live user directory...</div>'
              : items.length
              ? items
                  .map((user) => {
                    const name = String(user.name || "Unknown").trim() || "Unknown";
                    const handle = formatFounderDirectoryHandle(user.handle);
                    const activityLabel =
                      String(user.activityLabel || user.currentPageLabel || "").trim() ||
                      "No live activity yet";
                    const statusLabel = user.online
                      ? "Live now"
                      : formatFounderDirectoryLastSeen(user.lastSeenLabel);
                    const currentPageLabel = formatFounderDirectorySignal(user.currentPageLabel);
                    const presenceLabel = currentPageLabel
                      ? `${user.online ? "Currently in" : "Last page"} ${currentPageLabel}`
                      : "";
                    const chips = [
                      `Score ${formatCount(user.engagementScore)}`,
                      formatFounderDirectoryUsage(user.usageBand),
                      currentPageLabel,
                    ]
                      .filter(Boolean)
                      .map(
                        (chip) =>
                          `<span class="founder-user-chip">${escapeHtml(chip)}</span>`
                      )
                      .join("");
                    return `
                      <button class="founder-user-item founder-click-card" type="button" data-founder-open="${escapeHtml(user.id)}">
                        <div class="founder-user-item-top">
                          <div class="founder-user-item-main">
                            <div class="founder-avatar-badge">${escapeHtml((name || "U").slice(0, 2).toUpperCase())}</div>
                            <div class="founder-user-copy">
                              <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
                              <span class="founder-user-handle" title="${escapeHtml(handle)}">${escapeHtml(handle)}</span>
                              <small class="founder-user-activity">${escapeHtml(activityLabel)}</small>
                            </div>
                          </div>
                          <div class="founder-user-meta">
                            <div class="founder-user-status ${user.online ? "is-online" : "is-offline"}">${escapeHtml(statusLabel)}</div>
                            ${
                              presenceLabel
                                ? `<small class="founder-user-presence">${escapeHtml(presenceLabel)}</small>`
                                : ""
                            }
                          <small>${formatCount(user.engagementScore)} score · ${escapeHtml(user.usageBand || "Varied usage")}</small>
                        </div>
                        <div class="founder-user-item-bottom">
                          <div class="founder-user-chip-row">${chips}</div>
                        </div>
                      </button>
                    `;
                  })
                  .join("")
              : '<div class="founder-empty">No users matched this founder search.</div>'
          }
        </div>
        <div class="founder-directory-foot">
          <small>${directory ? `Page ${formatCount(directory.page)} · ${formatCount(directory.limit)} per load` : "Founder directory readying..."}</small>
          ${
            directory?.hasMore
              ? '<button class="btn btn-w founder-load-more" type="button" data-founder-load-more="true">Load more</button>'
              : ""
          }
        </div>
      </article>
    `;
  }

  function renderFounderUserPanel() {
    if (!state.selectedUserId) return "";
    const detail = state.selectedUser;
    if (!detail || detail.user?.id !== state.selectedUserId) {
      return `
        <section class="founder-user-panel-shell is-open">
          <div class="founder-user-panel-backdrop" data-founder-close-panel="true"></div>
          <aside class="founder-user-panel">
            <div class="founder-user-panel-head">
              <div>
                <div class="founder-eyebrow">User Intelligence Panel</div>
                <h2>Loading live user analysis</h2>
              </div>
              <button class="btn btn-w" type="button" data-founder-close-panel="true">Close</button>
            </div>
            <div class="founder-empty">Gathering the user’s live session, journey map, and intelligence signals...</div>
          </aside>
        </section>
      `;
    }

    const user = detail.user || {};
    const live = detail.liveState || {};
    const journey = detail.journey || {};
    const micro = detail.microBehavior || {};
    const interest = detail.interestProfile || {};
    const engagement = detail.engagement || {};
    const context = detail.context || {};
    const content = detail.content || {};
    const replayLite = detail.replayLite || {};
    const sessions = Array.isArray(detail.sessions) ? detail.sessions : [];
    const liveFeed = Array.isArray(detail.liveFeed) ? detail.liveFeed : [];
    const timeline = Array.isArray(detail.timeline) ? detail.timeline : [];
    const segmentTags = Array.isArray(detail.segmentTags) ? detail.segmentTags : [];
    const friction = Array.isArray(detail.friction) ? detail.friction : [];
    const predictions = Array.isArray(detail.predictions) ? detail.predictions : [];

    return `
      <section class="founder-user-panel-shell is-open">
        <div class="founder-user-panel-backdrop" data-founder-close-panel="true"></div>
        <aside class="founder-user-panel" role="dialog" aria-modal="true" aria-labelledby="founderUserPanelTitle">
          <div class="founder-user-panel-head">
            <div>
              <div class="founder-eyebrow">User Intelligence Panel</div>
              <h2 id="founderUserPanelTitle">${escapeHtml(user.name || "User")} · Real-time journey view</h2>
              <p>Observe live behavior, friction, patterns, and meaningful next-step insights without exposing sensitive private content.</p>
            </div>
            <div class="founder-user-panel-actions">
              <button class="btn btn-w" type="button" data-founder-refresh-user="true">Refresh</button>
              <button class="btn btn-p" type="button" data-founder-close-panel="true">Close</button>
            </div>
          </div>
          <div class="founder-user-panel-grid">
            <section class="founder-card founder-user-summary">
              <div class="founder-user-summary-top">
                <div class="founder-avatar-badge founder-avatar-lg">${escapeHtml((user.name || "U").slice(0, 2).toUpperCase())}</div>
                <div>
                  <h3>${escapeHtml(user.name || "Unknown")}</h3>
                  <span>@${escapeHtml(user.handle || "")}</span>
                  <small>${escapeHtml(user.maskedEmail || "")}</small>
                </div>
              </div>
              <div class="founder-user-live-pill ${live.online ? "is-online" : "is-offline"}">
                <strong>${live.online ? "Online now" : "Offline"}</strong>
                <span>${escapeHtml(live.currentAction || "No active signal")}</span>
                <small>${escapeHtml(live.currentPageLabel || "Unknown page")} · ${escapeHtml(live.lastActivityLabel || "")}</small>
              </div>
              <div class="founder-score-tile">
                <strong>${formatCount(engagement.score || 0)}%</strong>
                <span>${escapeHtml(engagement.label || "Engagement score")}</span>
                <small>${formatCount(engagement.activeDays || 0)} active days · ${formatDurationMinutes(engagement.avgSessionMinutes || 0)}</small>
              </div>
              <div class="founder-tag-cloud">
                ${segmentTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") || '<span>Spiritual Explorer</span>'}
              </div>
              <div class="founder-detail-metrics">
                <div><strong>${escapeHtml(interest.behaviorType || "Unknown")}</strong><span>Behavior type</span></div>
                <div><strong>${escapeHtml(interest.usageBand || "Varied usage")}</strong><span>Usage pattern</span></div>
                <div><strong>${escapeHtml(live.deviceType || "unknown")}</strong><span>Current device</span></div>
                <div><strong>${escapeHtml(live.country || "Unknown")}</strong><span>Approx region</span></div>
              </div>
              <div class="founder-user-summary-list">
                <div><strong>${formatCount(user.followersCount || 0)}</strong><span>Followers</span></div>
                <div><strong>${formatCount(user.followingCount || 0)}</strong><span>Following</span></div>
                <div><strong>${formatCount(content.postsCreated || 0)}</strong><span>Posts created</span></div>
                <div><strong>${formatCount(content.videosCreated || 0)}</strong><span>Videos created</span></div>
              </div>
            </section>
            <section class="founder-card founder-user-center">
              <div class="founder-card-head"><h2>Live Session & Journey</h2><span>${escapeHtml(live.currentPageLabel || "Unknown")}</span></div>
              <div class="founder-journey-path">
                ${(journey.currentPath || [])
                  .map(
                    (step) => `
                      <div class="founder-journey-step">
                        <strong>${escapeHtml(step.label || "Step")}</strong>
                        <span>${formatDurationSeconds(step.durationSeconds || 0)} · ${formatCount(step.engagementScore || 0)} intensity</span>
                      </div>
                    `
                  )
                  .join("") || '<div class="founder-empty">No detailed journey path yet.</div>'}
              </div>
              <div class="founder-card-head"><h2>Live Feed</h2><span>${formatCount(liveFeed.length)} signals</span></div>
              <div class="founder-activity-list founder-activity-list-tight">
                ${liveFeed.map(renderTimelineFeedItem).join("") || '<div class="founder-empty">No live feed events yet.</div>'}
              </div>
              <div class="founder-card-head"><h2>Timeline</h2><span>${formatCount(detail.recentActivityCount || 0)} recent events</span></div>
              <div class="founder-timeline-list">
                ${timeline.slice(0, 18).map(renderTimelineFeedItem).join("") || '<div class="founder-empty">No timeline yet.</div>'}
              </div>
              <div class="founder-card-head"><h2>Session replay-lite</h2><span>${escapeHtml(replayLite.summary || "Latest session focus")}</span></div>
              <div class="founder-replay-strip">
                ${(replayLite.frames || [])
                  .map(
                    (frame) => `
                      <div class="founder-replay-frame">
                        <strong>${escapeHtml(frame.label || "Step")}</strong>
                        <span>${formatDurationSeconds(frame.dwellSeconds || 0)} dwell</span>
                        <small>${escapeHtml(frame.highlight || "Browsing")} Â· ${formatCount(frame.scrollDepth || 0)}% depth</small>
                      </div>
                    `
                  )
                  .join("") || '<div class="founder-empty">Replay frames will appear after a full session path is captured.</div>'}
              </div>
            </section>
            <section class="founder-card founder-user-side">
              <div class="founder-card-head"><h2>Insights & Predictions</h2><span>Decision support</span></div>
              <div class="founder-insight-block">
                <h3>Top interests</h3>
                <div class="founder-tag-cloud">
                  ${(interest.topInterests || [])
                    .map((item) => `<span>${escapeHtml(item.label)} · ${formatCount(item.score)}</span>`)
                    .join("") || "<span>No strong preference yet</span>"}
                </div>
              </div>
              <div class="founder-insight-block">
                <h3>Micro behavior</h3>
                <div class="founder-detail-metrics founder-detail-metrics-compact">
                  <div><strong>${formatCount(micro.maxScrollDepth || 0)}%</strong><span>Deepest scroll</span></div>
                  <div><strong>${formatCount(micro.avgScrollSpeed || 0)}</strong><span>Avg scroll speed</span></div>
                  <div><strong>${formatDurationSeconds(micro.avgPauseSeconds || 0)}</strong><span>Avg pause</span></div>
                  <div><strong>${formatCount(micro.replayCount || 0)}</strong><span>Replay count</span></div>
                </div>
              </div>
              <div class="founder-insight-block">
                <h3>Friction alerts</h3>
                <div class="founder-recommendations">
                  ${friction.map((item) => `<div class="founder-recommendation">${escapeHtml(item)}</div>`).join("") || '<div class="founder-empty">No strong friction pattern detected yet.</div>'}
                </div>
              </div>
              <div class="founder-insight-block">
                <h3>Predictions</h3>
                <div class="founder-recommendations">
                  ${predictions.map((item) => `<div class="founder-recommendation">${escapeHtml(item)}</div>`).join("") || '<div class="founder-empty">Predictions will appear as more behavior accumulates.</div>'}
                </div>
              </div>
              <div class="founder-insight-block">
                <h3>Behavior patterns</h3>
                <div class="founder-recommendations">
                  <div class="founder-recommendation">${escapeHtml(detail.patterns?.peakUsageLabel || "No clear usage pattern yet")}</div>
                  ${
                    detail.patterns?.repeatTransition
                      ? `<div class="founder-recommendation">${escapeHtml(detail.patterns.repeatTransition.label)} repeats ${formatCount(detail.patterns.repeatTransition.count)} times.</div>`
                      : ""
                  }
                </div>
              </div>
              <div class="founder-insight-block">
                <h3>Context</h3>
                ${renderMiniBars(context.devices || [], "count")}
                ${renderMiniBars(context.countries || [], "count")}
              </div>
              <div class="founder-insight-block">
                <h3>Session history</h3>
                <div class="founder-session-list">
                  ${sessions
                    .slice(0, 5)
                    .map(
                      (session) => `
                        <div class="founder-session-item">
                          <strong>${escapeHtml(session.currentPageLabel || "Unknown")}</strong>
                          <span>${escapeHtml(session.entryPageLabel || "Unknown entry")}</span>
                          <small>${escapeHtml(session.deviceType || "device")} · ${escapeHtml(session.country || "Unknown")}</small>
                          <time>${escapeHtml(formatDurationMinutes(session.durationMinutes || 0))}</time>
                        </div>
                      `
                    )
                    .join("") || '<div class="founder-empty">No completed sessions yet.</div>'}
                </div>
              </div>
              <div class="founder-insight-block">
                <h3>Replay hotspots</h3>
                <div class="founder-recommendations">
                  ${(replayLite.hotspots || [])
                    .map(
                      (item) => `
                        <div class="founder-recommendation">
                          ${escapeHtml(item.label)} Â· ${formatDurationSeconds(item.dwellSeconds || 0)} Â· ${formatCount(item.scrollDepth || 0)}% depth
                        </div>
                      `
                    )
                    .join("") || '<div class="founder-empty">Hotspots will surface as dwell and depth signals accumulate.</div>'}
                </div>
              </div>
              <div class="founder-insight-block">
                <h3>Action trail</h3>
                <div class="founder-timeline-list">
                  ${(replayLite.actionTrail || []).map(renderTimelineFeedItem).join("") || '<div class="founder-empty">No action trail yet.</div>'}
                </div>
              </div>
            </section>
          </div>
        </aside>
      </section>
    `;
  }

  function syncFounderUserPanel(options = {}) {
    const host = getFounderPanelHost();
    if (!host) return false;
    const scrollPosition = options.preserveScroll === false
      ? { top: 0, left: 0 }
      : captureFounderPanelScroll();
    host.innerHTML = renderFounderUserPanel();
    restoreFounderPanelScroll(scrollPosition);
    return true;
  }

  function renderTimelineFeedItem(item) {
    return `
      <div class="founder-activity-item founder-activity-item-plain">
        <div class="founder-activity-copy">
          <strong>${escapeHtml(item?.label || "Event")}</strong>
          <span>${escapeHtml(item?.pageLabel || item?.page || "")}</span>
          <small>${escapeHtml(item?.detail || "")}</small>
        </div>
        <time>${escapeHtml(item?.ageLabel || "")}</time>
      </div>
    `;
  }

  function renderFounderControl() {
    const root = ensureRootShell();
    if (!root) return;
    const snapshot = state.overview || {};
    const activity = Array.isArray(snapshot.activityStream) ? snapshot.activityStream : [];
    const sessions = Array.isArray(snapshot.userBehavior?.activeSessions)
      ? snapshot.userBehavior.activeSessions
      : [];
    const pageRows = Array.isArray(snapshot.pageAnalytics?.byPage) ? snapshot.pageAnalytics.byPage : [];
    const topPosts = Array.isArray(snapshot.content?.topPosts) ? snapshot.content.topPosts : [];
    const topVideos = Array.isArray(snapshot.content?.topVideos) ? snapshot.content.topVideos : [];
    const recommendations = Array.isArray(snapshot.recommendations) ? snapshot.recommendations : [];

    root.innerHTML = `
      <section class="founder-hero">
        <div>
          <div class="founder-eyebrow">Founder Control Center</div>
          <h1>Live behavioral intelligence for every seeker journey</h1>
          <p>Watch platform health, open individual user intelligence, and understand what is truly helping or slowing the path toward meaningful connection.</p>
        </div>
        <div class="founder-live-pill">
          <span></span>
          Real-time founder visibility
          <small>Updated ${escapeHtml(snapshot.generatedAt ? new Date(snapshot.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "just now")}</small>
        </div>
      </section>

      <section class="founder-stat-grid">${renderStatCards(snapshot)}</section>

      ${renderFounderIntelRail(snapshot)}
      ${renderSavedViewChips(snapshot)}
      ${renderAnomalyDeck(snapshot)}

      <section class="founder-grid founder-grid-2 founder-grid-featured">
        ${renderUserDirectoryCard()}
        <article class="founder-card">
          <div class="founder-card-head"><h2>Live Activity Stream</h2><span>${formatCount(activity.length)} signals</span></div>
          <div class="founder-activity-list">
            ${activity.map(renderActivityItem).join("") || '<div class="founder-empty">No recent platform activity yet.</div>'}
          </div>
        </article>
      </section>

      <section class="founder-grid founder-grid-2">
        ${renderCohorts(snapshot)}
        ${renderFunnelSection(snapshot)}
      </section>

      <section class="founder-grid founder-grid-2">
        ${renderReleaseImpact(snapshot)}
        ${renderDecisionEngine(snapshot)}
      </section>

      <section class="founder-grid founder-grid-2">
        <article class="founder-card">
          <div class="founder-card-head"><h2>Live Sessions</h2><span>${formatCount(sessions.length)} people</span></div>
          <div class="founder-session-list">
            ${sessions.map(renderSessionItem).join("") || '<div class="founder-empty">No live sessions in the current window.</div>'}
          </div>
        </article>
        <article class="founder-card">
          <div class="founder-card-head"><h2>Decision Support</h2><span>Founder recommendations</span></div>
          <div class="founder-recommendations">
            ${recommendations.map((item) => `<div class="founder-recommendation">${escapeHtml(item)}</div>`).join("") || '<div class="founder-empty">Insights will appear once activity accumulates.</div>'}
          </div>
        </article>
      </section>

      <section class="founder-grid founder-grid-3">
        <article class="founder-card">
          <div class="founder-card-head"><h2>Page Engagement</h2><span>Visits and time</span></div>
          ${renderMiniBars(pageRows.slice(0, 6), "visits")}
        </article>
        <article class="founder-card">
          <div class="founder-card-head"><h2>Drop-Off Pages</h2><span>Where journeys stop</span></div>
          ${renderMiniBars(snapshot.journey?.dropOffPages || [], "count")}
        </article>
        <article class="founder-card">
          <div class="founder-card-head"><h2>Trending Hashtags</h2><span>What is rising</span></div>
          ${renderMiniBars(snapshot.trending?.hashtags || [], "count")}
        </article>
      </section>

      <section class="founder-grid founder-grid-2">
        <article class="founder-card">
          <div class="founder-card-head"><h2>Growth Pulse</h2><span>DAU ${formatCount(snapshot.growth?.dailyActiveUsers || 0)} · WAU ${formatCount(snapshot.growth?.weeklyActiveUsers || 0)} · MAU ${formatCount(snapshot.growth?.monthlyActiveUsers || 0)}</span></div>
          ${renderSeries(snapshot.growth?.activeSeries || [])}
          <div class="founder-growth-summary">
            <div><strong>${formatPercent(snapshot.growth?.retentionRate || 0)}</strong><span>Retention</span></div>
            <div><strong>${formatCount(snapshot.growth?.newUsersWeek || 0)}</strong><span>New users this week</span></div>
            <div><strong>${formatCount(snapshot.userBehavior?.repeatVsNew?.returningUsers || 0)}</strong><span>Returning users today</span></div>
          </div>
        </article>
        <article class="founder-card">
          <div class="founder-card-head"><h2>System Health</h2><span>Speed and stability</span></div>
          <div class="founder-health-grid">
            <div><strong>${formatCount(snapshot.health?.avgLcpMs || 0)}ms</strong><span>Average LCP</span></div>
            <div><strong>${snapshot.health?.avgCls || 0}</strong><span>Average CLS</span></div>
            <div><strong>${formatCount(snapshot.health?.avgPageLoadMs || 0)}ms</strong><span>Page load</span></div>
            <div><strong>${formatCount(snapshot.health?.monitoring?.totalErrors || 0)}</strong><span>Total server errors</span></div>
          </div>
          ${renderMiniBars(snapshot.health?.slowRoutes || [], "avgMs", (value) => `${formatCount(value)}ms`)}
        </article>
      </section>

      <section class="founder-grid founder-grid-2">
        <article class="founder-card">
          <div class="founder-card-head"><h2>Top Posts</h2><span>Highest engagement</span></div>
          <div class="founder-top-list">
            ${topPosts
              .map(
                (post) => `
                  <div class="founder-top-item">
                    <strong>${escapeHtml(post.user?.name || "Unknown")}</strong>
                    <span>${escapeHtml(post.preview || "")}</span>
                    <small>${formatCount(post.likes)} likes · ${formatCount(post.comments)} comments · ${formatCount(post.shares)} shares</small>
                  </div>
                `
              )
              .join("") || '<div class="founder-empty">No post data yet.</div>'}
          </div>
        </article>
        <article class="founder-card">
          <div class="founder-card-head"><h2>Top Videos</h2><span>Most watched and engaged</span></div>
          <div class="founder-top-list">
            ${topVideos
              .map(
                (video) => `
                  <div class="founder-top-item">
                    <strong>${escapeHtml(video.title || "Untitled video")}</strong>
                    <span>${escapeHtml(video.user?.name || "Unknown")} · ${escapeHtml(video.category || "Other")}</span>
                    <small>${formatCount(video.views)} views · ${formatCount(video.likes)} likes · ${formatCount(video.comments)} comments</small>
                  </div>
                `
              )
              .join("") || '<div class="founder-empty">No video data yet.</div>'}
          </div>
        </article>
      </section>

      <section class="founder-grid founder-grid-2">
        <article class="founder-card">
          <div class="founder-card-head"><h2>User Context</h2><span>Devices and regions</span></div>
          <h3>Devices</h3>
          ${renderMiniBars(snapshot.context?.devices || [], "count")}
          <h3>Countries</h3>
          ${renderMiniBars(snapshot.context?.countries || [], "count")}
        </article>
        <article class="founder-card founder-card-vision">
          <div class="founder-card-head"><h2>Real-Time Founder Questions</h2><span>Clarity over noise</span></div>
          <div class="founder-recommendations">
            <div class="founder-recommendation">What is working best for today’s seekers?</div>
            <div class="founder-recommendation">Where do users lose interest or get stuck?</div>
            <div class="founder-recommendation">Which content pattern deserves stronger discovery?</div>
            <div class="founder-recommendation">Which individual users reveal the clearest UX truth right now?</div>
          </div>
        </article>
      </section>

      <div id="founderUserPanelHost">${renderFounderUserPanel()}</div>
    `;
  }

  function bindRootEvents(root) {
    if (!root || state.rootBound) return;
    state.rootBound = true;

    root.addEventListener("click", (event) => {
      const openTrigger = event.target.closest("[data-founder-open]");
      if (openTrigger) {
        openFounderUserPanel(openTrigger.getAttribute("data-founder-open"));
        return;
      }

      if (event.target.closest("[data-founder-close-panel]")) {
        closeFounderUserPanel();
        return;
      }

      const sortTrigger = event.target.closest("[data-founder-sort]");
      if (sortTrigger) {
        const nextSort = String(sortTrigger.getAttribute("data-founder-sort") || "active");
        if (state.userSort !== nextSort) {
          state.userSort = nextSort;
          state.userPage = 1;
          refreshFounderUsers({ initial: true });
        }
        return;
      }

      if (event.target.closest("[data-founder-load-more]")) {
        refreshFounderUsers({ page: (state.directory?.page || state.userPage || 1) + 1, append: true });
        return;
      }

      if (event.target.closest("[data-founder-refresh-user]")) {
        refreshFounderUserIntelligence({ force: true });
        return;
      }

      if (event.target.closest("[data-founder-save-view]")) {
        saveCurrentFounderView();
        return;
      }

      const presetTrigger = event.target.closest("[data-founder-apply-preset]");
      if (presetTrigger) {
        const presetId = String(presetTrigger.getAttribute("data-founder-apply-preset") || "");
        const preset = (state.overview?.savedViewPresets || []).find((item) => item.id === presetId);
        if (preset) {
          applyFounderView({
            id: preset.id,
            name: preset.label,
            userSort: preset.userSort,
            userQuery: "",
            funnelKey: preset.funnelKey,
            funnelSteps:
              (state.overview?.funnels?.presets || []).find((item) => item.key === preset.funnelKey)?.steps?.map((step) => step.key) ||
              state.selectedFunnelSteps,
            releaseWindow: preset.releaseWindow,
          });
        }
        return;
      }

      const savedViewTrigger = event.target.closest("[data-founder-apply-view]");
      if (savedViewTrigger) {
        const viewId = String(savedViewTrigger.getAttribute("data-founder-apply-view") || "");
        const view = (state.savedViews || []).find((item) => item.id === viewId);
        if (view) applyFounderView(view);
        return;
      }

      const deleteViewTrigger = event.target.closest("[data-founder-delete-view]");
      if (deleteViewTrigger) {
        deleteFounderView(String(deleteViewTrigger.getAttribute("data-founder-delete-view") || ""));
        return;
      }

      const funnelPresetTrigger = event.target.closest("[data-founder-funnel-preset]");
      if (funnelPresetTrigger) {
        const key = String(funnelPresetTrigger.getAttribute("data-founder-funnel-preset") || "");
        const preset = (state.overview?.funnels?.presets || []).find((item) => item.key === key);
        state.selectedFunnelKey = key;
        if (preset?.steps?.length) {
          state.selectedFunnelSteps = preset.steps.map((step) => step.key).slice(0, 5);
        }
        state.customFunnel = preset || null;
        renderFounderControl();
        return;
      }

      if (event.target.closest("[data-founder-run-funnel]")) {
        refreshFounderFunnel({ force: true });
      }
    });

    root.addEventListener("change", (event) => {
      const select = event.target.closest("[data-founder-funnel-step]");
      if (!select) return;
      const index = Number(select.getAttribute("data-founder-funnel-step"));
      if (!Number.isFinite(index)) return;
      state.selectedFunnelSteps[index] = String(select.value || "").trim();
    });

    root.addEventListener("input", (event) => {
      if (event.target.id !== "founderUserSearch") return;
      const nextValue = String(event.target.value || "");
      state.userQuery = nextValue;
      state.userPage = 1;
      if (state.searchTimerId) {
        global.clearTimeout(state.searchTimerId);
      }
      state.searchTimerId = global.setTimeout(() => {
        state.searchTimerId = 0;
        refreshFounderUsers({ initial: true });
      }, 280);
    });
  }

  async function refreshFounderOverview(options = {}) {
    if (!isFounderOwner()) {
      renderState("locked", "Founder access only", "This control room is visible only to the founder account.");
      return;
    }
    if (!options.initial && !isFounderControlVisible()) return;
    if (options.initial && !state.overview && !state.directory) {
      renderState("loading", "Loading founder control room", "Gathering live user, content, growth, and health signals...");
    }
    const requestId = ++state.latestOverviewRequestId;
    try {
      const snapshot = await fetchFounderOverview();
      if (requestId !== state.latestOverviewRequestId) return;
      const signature = buildPayloadSignature(snapshot);
      if (signature === state.overviewSignature && !options.force) return;
      state.overviewSignature = signature;
      state.overview = snapshot;
      if (state.selectedUserId && getRoot()) {
        state.pendingDashboardRefresh = true;
        return;
      }
      renderFounderControl();
    } catch (error) {
      if (requestId !== state.latestOverviewRequestId) return;
      if (error?.status === 403) {
        stopFounderRealtime();
        renderState("locked", "Founder access only", "This page is hidden for all non-owner accounts.");
        return;
      }
      renderState("error", "Live founder feed is unavailable", error?.message || "Please try again in a moment.");
    }
  }

  async function refreshFounderUsers(options = {}) {
    if (!isFounderOwner()) return;
    if (!options.initial && !options.force && !isFounderControlVisible()) return;
    const nextPage = Number(options.page || state.userPage || 1);
    const requestPage = options.append ? nextPage : 1;
    const requestLimit = options.append ? USER_PAGE_SIZE : USER_PAGE_SIZE * nextPage;
    const requestId = ++state.latestDirectoryRequestId;
    try {
      const snapshot = await fetchFounderUsers({
        page: requestPage,
        limit: requestLimit,
        q: state.userQuery,
        sort: state.userSort,
      });
      if (requestId !== state.latestDirectoryRequestId) return;
      state.userPage = nextPage;
      state.directory = options.append && state.directory
        ? {
            ...snapshot,
            page: nextPage,
            limit: USER_PAGE_SIZE,
            hasMore: nextPage * USER_PAGE_SIZE < Number(snapshot.total || 0),
            items: [...(state.directory.items || []), ...(snapshot.items || [])],
          }
        : {
            ...snapshot,
            page: nextPage,
            limit: USER_PAGE_SIZE,
            hasMore: nextPage * USER_PAGE_SIZE < Number(snapshot.total || 0),
          };
      const signature = buildPayloadSignature(state.directory);
      if (signature === state.directorySignature && !options.force) return;
      state.directorySignature = signature;
      if (state.selectedUserId && getRoot()) {
        state.pendingDashboardRefresh = true;
        if (state.usingOverviewStream) startFounderDashboardStream();
        return;
      }
      if (state.usingOverviewStream) startFounderDashboardStream();
      renderFounderControl();
    } catch {}
  }

  async function refreshFounderFunnel(options = {}) {
    if (!isFounderOwner()) return;
    const requestId = ++state.latestFunnelRequestId;
    try {
      const snapshot = await fetchFounderFunnel(state.selectedFunnelSteps);
      if (requestId !== state.latestFunnelRequestId) return;
      const signature = buildPayloadSignature(snapshot);
      if (signature === state.customFunnelSignature && !options.force) return;
      state.customFunnelSignature = signature;
      state.customFunnel = snapshot;
      if (state.selectedUserId && getRoot()) {
        state.pendingDashboardRefresh = true;
        return;
      }
      renderFounderControl();
    } catch {}
  }

  async function refreshFounderUserIntelligence(options = {}) {
    if (!isFounderOwner() || !state.selectedUserId) return;
    if (!options.force && !isFounderControlVisible()) return;
    const requestId = ++state.latestDetailRequestId;
    if (options.force) {
      state.selectedUser = null;
      syncFounderUserPanel({ preserveScroll: true });
    }
    try {
      const snapshot = await fetchFounderUserIntelligence(state.selectedUserId);
      if (requestId !== state.latestDetailRequestId) return;
      const signature = buildPayloadSignature(snapshot);
      if (signature === state.detailSignature && !options.force) return;
      state.detailSignature = signature;
      state.selectedUser = snapshot;
      if (!syncFounderUserPanel({ preserveScroll: true })) {
        renderFounderControl();
      }
    } catch (error) {
      if (requestId !== state.latestDetailRequestId) return;
      if (error?.status === 404) {
        closeFounderUserPanel();
      }
    }
  }

  async function refreshFounderButton(options = {}) {
    if (!isFounderOwner()) return;
    const now = Date.now();
    if (state.buttonFetchInFlight) {
      state.buttonFetchQueued = true;
      return;
    }
    if (!options.force && state.buttonNextAllowedAt && now < state.buttonNextAllowedAt) {
      return;
    }
    const requestId = ++state.latestButtonRequestId;
    state.buttonFetchInFlight = true;
    state.buttonNextAllowedAt = now + BUTTON_FETCH_MIN_GAP_MS;
    try {
      const snapshot = await fetchFounderButtonPulse();
      if (requestId !== state.latestButtonRequestId) return;
      setStoredButtonPulse(snapshot);
      if (!options.silent) ensureFounderButton();
    } catch (error) {
      if (Number(error?.status || 0) === 429) {
        state.buttonNextAllowedAt = Date.now() + BUTTON_FETCH_BACKOFF_MS;
      }
      if (!state.buttonPulse) {
        state.buttonPulse = getStoredButtonPulse();
      }
    } finally {
      state.buttonFetchInFlight = false;
      if (state.buttonFetchQueued) {
        state.buttonFetchQueued = false;
        global.setTimeout(() => {
          refreshFounderButton({ silent: true });
        }, 250);
      }
    }
  }

  async function consumeFounderStream(path, onMessage, options = {}) {
    const response = await buildStreamRequest(path, options.signal);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let message = "Founder live stream unavailable.";
      try {
        const data = text ? JSON.parse(text) : {};
        message = data.error || message;
      } catch {}
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    if (!response.body?.getReader) {
      throw new Error("Streaming is not supported in this browser.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach((line) => {
        const trimmed = String(line || "").trim();
        if (!trimmed) return;
        try {
          const chunk = JSON.parse(trimmed);
          onMessage?.(chunk, options);
        } catch {}
      });
    }
  }

  function updateOverviewSnapshot(snapshot, options = {}) {
    const signature = buildPayloadSignature(snapshot);
    if (signature === state.overviewSignature && !options.force) return;
    state.overviewSignature = signature;
    state.overview = snapshot;
    if (snapshot?.founderBadge) {
      setStoredButtonPulse(snapshot.founderBadge);
      ensureFounderButton();
    }
    if (state.selectedUserId && getRoot()) {
      state.pendingDashboardRefresh = true;
      return;
    }
    renderFounderControl();
  }

  function updateDirectorySnapshot(snapshot, options = {}) {
    const signature = buildPayloadSignature(snapshot);
    if (signature === state.directorySignature && !options.force) return;
    state.directorySignature = signature;
    state.directory = {
      ...snapshot,
      page: state.userPage,
      limit: USER_PAGE_SIZE,
      hasMore:
        Number(state.userPage || 1) * USER_PAGE_SIZE < Number(snapshot?.total || 0),
    };
    if (state.selectedUserId && getRoot()) {
      state.pendingDashboardRefresh = true;
      return;
    }
    renderFounderControl();
  }

  function startFounderDashboardStream() {
    if (state.streamAbortController) {
      state.streamAbortController.abort();
      state.streamAbortController = null;
    }
    const params = new URLSearchParams({
      page: String(state.userPage || 1),
      limit: String(Math.max(USER_PAGE_SIZE, (state.userPage || 1) * USER_PAGE_SIZE)),
      sort: String(state.userSort || "active"),
    });
    if (state.userQuery) params.set("q", state.userQuery);
    const path = `/api/founder/stream?${params.toString()}`;
    const controller = new AbortController();
    state.streamAbortController = controller;
    state.usingOverviewStream = true;

    consumeFounderStream(
      path,
      (chunk) => {
        if (controller.signal.aborted) return;
        if (chunk.type === "overview") {
          updateOverviewSnapshot(chunk.payload || {});
        } else if (chunk.type === "directory") {
          updateDirectorySnapshot(chunk.payload || {});
        } else if (chunk.type === "button") {
          setStoredButtonPulse(chunk.payload || null);
          ensureFounderButton();
        }
      },
      { signal: controller.signal }
    ).catch(() => {
      if (controller.signal.aborted) return;
      state.usingOverviewStream = false;
      state.streamAbortController = null;
      state.overviewTimerId = global.setInterval(() => refreshFounderOverview(), OVERVIEW_POLL_MS);
      state.directoryTimerId = global.setInterval(() => refreshFounderUsers(), DIRECTORY_POLL_MS);
      refreshFounderOverview({ initial: true, force: true });
      refreshFounderUsers({ initial: true, force: true });
    });
  }

  function startFounderDetailStream() {
    if (state.detailStreamAbortController) {
      state.detailStreamAbortController.abort();
      state.detailStreamAbortController = null;
    }
    if (!state.selectedUserId) return;
    const controller = new AbortController();
    state.detailStreamAbortController = controller;
    state.usingDetailStream = true;

    consumeFounderStream(`/api/founder/users/${encodeURIComponent(state.selectedUserId)}/stream`, (chunk) => {
      if (controller.signal.aborted) return;
      if (chunk.type === "detail") {
        const signature = buildPayloadSignature(chunk.payload || {});
        if (signature === state.detailSignature) return;
        state.detailSignature = signature;
        state.selectedUser = chunk.payload || null;
        if (!syncFounderUserPanel({ preserveScroll: true })) {
          renderFounderControl();
        }
      } else if (chunk.type === "error" && Number(chunk.payload?.status || 0) === 404) {
        closeFounderUserPanel();
      }
    }, {
      signal: controller.signal,
    }).catch(() => {
      if (controller.signal.aborted) return;
      state.usingDetailStream = false;
      state.detailStreamAbortController = null;
      refreshFounderUserIntelligence({ force: true });
      state.detailTimerId = global.setInterval(() => {
        refreshFounderUserIntelligence();
      }, DETAIL_POLL_MS);
    });
  }

  function startFounderRealtime() {
    stopFounderRealtime();
    loadSavedViews();
    refreshFounderButton({ silent: true });
    startFounderDashboardStream();
    refreshFounderFunnel({ force: true });
    syncFounderDetailPolling();
  }

  function syncFounderDetailPolling() {
    if (state.detailTimerId) {
      global.clearInterval(state.detailTimerId);
      state.detailTimerId = 0;
    }
    if (!state.selectedUserId) return;
    startFounderDetailStream();
  }

  function stopFounderRealtime() {
    if (state.searchTimerId) {
      global.clearTimeout(state.searchTimerId);
      state.searchTimerId = 0;
    }
    ["overviewTimerId", "directoryTimerId", "detailTimerId"].forEach((key) => {
      if (state[key]) {
        global.clearInterval(state[key]);
        state[key] = 0;
      }
    });
    if (state.streamAbortController) {
      state.streamAbortController.abort();
      state.streamAbortController = null;
    }
    if (state.detailStreamAbortController) {
      state.detailStreamAbortController.abort();
      state.detailStreamAbortController = null;
    }
    state.usingOverviewStream = false;
    state.usingDetailStream = false;
  }

  function openFounderUserPanel(userId) {
    const nextId = String(userId || "").trim();
    if (!nextId) return;
    state.selectedUserId = nextId;
    state.selectedUser = null;
    state.detailSignature = "";
    if (!syncFounderUserPanel({ preserveScroll: false })) {
      renderFounderControl();
    }
    startFounderDetailStream();
  }

  function closeFounderUserPanel() {
    state.selectedUserId = "";
    state.selectedUser = null;
    state.detailSignature = "";
    if (state.detailTimerId) {
      global.clearInterval(state.detailTimerId);
      state.detailTimerId = 0;
    }
    if (state.detailStreamAbortController) {
      state.detailStreamAbortController.abort();
      state.detailStreamAbortController = null;
    }
    if (state.pendingDashboardRefresh) {
      state.pendingDashboardRefresh = false;
      renderFounderControl();
      return;
    }
    if (!syncFounderUserPanel({ preserveScroll: false })) {
      renderFounderControl();
    }
  }

  function isViewingOwnProfile() {
    const userId = getCurrentUserId();
    if (!userId) return false;
    if (userId === String(state.currentProfileId || "").trim()) return true;
    if (typeof global.curProfId !== "undefined" && userId === String(global.curProfId || "").trim()) {
      return true;
    }
    return false;
  }

  function isMobileFounderLayout() {
    return !!global.matchMedia?.("(max-width: 640px)")?.matches;
  }

  function getFounderMobileSlot() {
    const profileHeader = document.querySelector(".prof-hdr");
    const avatarWrap = profileHeader?.querySelector(".prof-av-wrap");
    if (!profileHeader || !avatarWrap) return null;

    let slot = profileHeader.querySelector("[data-founder-mobile-slot]");
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "founder-mobile-action-slot";
      slot.dataset.founderMobileSlot = "true";
      avatarWrap.insertAdjacentElement("afterend", slot);
    }
    return slot;
  }

  function cleanupFounderMobileSlot() {
    const slot = document.querySelector("[data-founder-mobile-slot]");
    if (slot && !slot.childElementCount) slot.remove();
  }

  function syncFounderButtonContent(button) {
    if (!button) return;
    const pulse = state.buttonPulse || getStoredButtonPulse() || {};
    const badge = Number(pulse.activeUsers || 0);
    const alertCount = Number(pulse.alertCount || 0);
    button.classList.toggle("has-alert", alertCount > 0);
    button.innerHTML = `
      <span class="founder-entry-copy">
        <strong>Founder Control</strong>
        <small>${escapeHtml(pulse.pulseLabel || "Live founder pulse")}</small>
      </span>
      <span class="founder-entry-metrics">
        <span class="founder-entry-badge">${formatCount(badge)}</span>
        ${alertCount ? `<span class="founder-entry-alert">${formatCount(alertCount)}</span>` : ""}
      </span>
    `;
  }

  function syncFounderButtonPulseLoop(shouldRun) {
    if (!shouldRun) {
      if (state.buttonTimerId) {
        global.clearInterval(state.buttonTimerId);
        state.buttonTimerId = 0;
      }
      return;
    }
    if (state.buttonTimerId) return;
    state.buttonTimerId = global.setInterval(() => {
      refreshFounderButton({ silent: true });
    }, BUTTON_POLL_MS);
  }

  function ensureFounderButton() {
    const prActions = document.getElementById("prActions");
    if (!prActions) return;
    const existing = document.querySelector("[data-founder-control-btn]");
    const shouldShow =
      isFounderOwner() &&
      (isViewingOwnProfile() || isOwnProfileActionArea(prActions));

    if (!shouldShow) {
      existing?.remove();
      cleanupFounderMobileSlot();
      syncFounderButtonPulseLoop(false);
      state.buttonFetchQueued = false;
      return;
    }

    const button = existing || document.createElement("button");
    if (!existing) {
      button.type = "button";
      button.className = "btn btn-p founder-entry-btn";
      button.dataset.founderControlBtn = "true";
      button.onclick = () => {
        if (typeof global.gp === "function") {
          global.gp(PAGE_ID);
        }
      };
    }
    if (!state.buttonPulse) {
      state.buttonPulse = getStoredButtonPulse();
      refreshFounderButton({ silent: true, force: true });
    }
    syncFounderButtonContent(button);

    const mobileTarget =
      isMobileFounderLayout() ? getFounderMobileSlot() || prActions : prActions;
    if (button.parentElement !== mobileTarget) {
      mobileTarget.appendChild(button);
    }
    if (!isMobileFounderLayout()) {
      cleanupFounderMobileSlot();
    }
    syncFounderButtonPulseLoop(true);
  }

  function observeProfileActions() {
    if (state.profileActionsObserver || !document.body) return;
    state.profileActionsObserver = new MutationObserver(() => {
      if (state.buttonSyncRafId) return;
      state.buttonSyncRafId = global.requestAnimationFrame(() => {
        state.buttonSyncRafId = 0;
        ensureFounderButton();
      });
    });
    state.profileActionsObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
    ensureFounderButton();
  }

  function bindFounderLayoutSync() {
    if (state.founderLayoutSyncBound) return;
    state.founderLayoutSyncBound = true;
    const sync = () => ensureFounderButton();
    global.addEventListener("resize", sync, { passive: true });
    global.addEventListener("orientationchange", sync, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) sync();
    });

    try {
      const media = global.matchMedia?.("(max-width: 640px)");
      if (media?.addEventListener) {
        media.addEventListener("change", sync);
      } else if (media?.addListener) {
        media.addListener(sync);
      }
    } catch {}
  }

  function wrapProfileRender() {
    if (typeof global.renderProfile !== "function" || global.renderProfile.__founderWrapped) return;
    const originalRenderProfile = global.renderProfile;
    const wrappedRenderProfile = function wrappedRenderProfile() {
      state.currentProfileId = String(arguments[0] || getCurrentUserId() || "").trim();
      const result = originalRenderProfile.apply(this, arguments);
      ensureFounderButton();
      return result;
    };
    wrappedRenderProfile.__founderWrapped = true;
    global.renderProfile = wrappedRenderProfile;
  }

  function wrapNavigation() {
    if (typeof global.gp !== "function" || global.gp.__founderWrapped) return;
    const originalGp = global.gp;
    const wrappedGp = function wrappedGp(page) {
      if (page === PAGE_ID && !isFounderOwner()) {
        global.MC?.warn?.("Founder access only.");
        return originalGp.call(this, getCurrentUserId() ? "profile" : "home");
      }
      const result = originalGp.apply(this, arguments);
      if (page === PAGE_ID) {
        startFounderRealtime();
      } else {
        stopFounderRealtime();
        closeFounderUserPanel();
      }
      return result;
    };
    wrappedGp.__founderWrapped = true;
    global.gp = wrappedGp;
  }

  function renderFounderControlPage() {
    if (!isFounderOwner()) {
      renderState("locked", "Founder access only", "This control room is hidden from every non-owner account.");
      return;
    }
    loadSavedViews();
    if (state.overview || state.directory) {
      renderFounderControl();
    } else {
      renderState("loading", "Loading founder control room", "Preparing live visibility into user behavior, individual journeys, and platform health...");
    }
    startFounderRealtime();
  }

  global.isFounderOwner = isFounderOwner;
  global.renderFounderControlPage = renderFounderControlPage;

  wrapProfileRender();
  wrapNavigation();
  observeProfileActions();
  bindFounderLayoutSync();
})(window);
