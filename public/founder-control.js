(function initFounderControl(global) {
  "use strict";

  const FOUNDER_OWNER_EMAILS = [
    "tirthsutra@gmail.com",
    "tirthsutra@gemail.com",
  ];
  const PAGE_ID = "founderControl";
  const ROOT_ID = "pgFounderControl";
  const POLL_INTERVAL_MS = 10000;
  let pollTimerId = 0;
  let latestRequestId = 0;
  let latestSnapshot = null;
  let currentProfileId = "";

  function getCurrentUser() {
    return global.CU || global.API?.getStoredUser?.() || null;
  }

  function getCurrentUserId() {
    const user = getCurrentUser();
    return String(user?.id || user?._id || "").trim();
  }

  function isFounderOwner(user = getCurrentUser()) {
    const email = String(user?.email || "").trim().toLowerCase();
    return !!email && FOUNDER_OWNER_EMAILS.includes(email);
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
    if (minutes >= 60) {
      return `${(minutes / 60).toFixed(1)}h`;
    }
    return `${minutes}m`;
  }

  function formatPercent(value) {
    return `${Number(value || 0).toFixed(1)}%`;
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

  async function fetchFounderOverview() {
    const token = global.API?.getToken?.() || "";
    const response = await fetch(`${getBackendBase()}/api/founder/overview`, {
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
      const error = new Error(data.error || "Could not load founder control room.");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function getRoot() {
    return document.getElementById(ROOT_ID);
  }

  function ensureRootShell() {
    const root = getRoot();
    if (!root) return null;
    root.classList.add("founder-control-page");
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

  function renderStatCards(snapshot) {
    const cards = [
      ["Live people", snapshot.live?.activePeople, "Within the live activity window"],
      ["Live sessions", snapshot.live?.activeSessions, "Browser sessions active now"],
      ["Online signed-in", snapshot.live?.onlineSignedInUsers, "Socket-connected devotees"],
      ["Visitors today", snapshot.live?.visitorsToday, "Unique active journeys today"],
      ["Signed-in today", snapshot.live?.signedInUsersToday, "Authenticated users today"],
      ["New users today", snapshot.live?.newUsersToday, "Fresh signups since midnight"],
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

  function renderFounderControl(snapshot) {
    const root = ensureRootShell();
    if (!root) return;
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
          <h1>Digital Darshan of user behavior</h1>
          <p>Real-time visibility into journeys, engagement, growth, friction, and platform health so every product decision stays purposeful.</p>
        </div>
        <div class="founder-live-pill">
          <span></span>
          Live refresh every ${formatCount(snapshot.live?.liveWindowMinutes || 15)} minutes window
          <small>Updated ${escapeHtml(new Date(snapshot.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }))}</small>
        </div>
      </section>

      <section class="founder-stat-grid">${renderStatCards(snapshot)}</section>

      <section class="founder-grid founder-grid-2">
        <article class="founder-card">
          <div class="founder-card-head"><h2>Live Activity Stream</h2><span>${formatCount(activity.length)} signals</span></div>
          <div class="founder-activity-list">
            ${activity
              .map(
                (item) => `
                  <div class="founder-activity-item">
                    <div class="founder-activity-copy">
                      <strong>${escapeHtml(item.actor?.label || "Visitor")}</strong>
                      <span>${escapeHtml(item.title || "Activity")}</span>
                      <small>${escapeHtml(item.detail || item.page || "")}</small>
                    </div>
                    <time>${escapeHtml(item.ageLabel || "")}</time>
                  </div>
                `
              )
              .join("") || '<div class="founder-empty">No recent activity yet.</div>'}
          </div>
        </article>

        <article class="founder-card">
          <div class="founder-card-head"><h2>Active User Sessions</h2><span>${formatCount(sessions.length)} live now</span></div>
          <div class="founder-session-list">
            ${sessions
              .map(
                (session) => `
                  <div class="founder-session-item">
                    <strong>${escapeHtml(session.actor?.label || "Visitor")}</strong>
                    <span>${escapeHtml(session.currentPageLabel || session.currentPage || "")}</span>
                    <small>${escapeHtml(session.deviceType || "device")} · ${escapeHtml(session.browser || "browser")} · ${escapeHtml(session.country || "Unknown")}</small>
                    <time>${escapeHtml(formatDurationMinutes(session.durationMinutes))}</time>
                  </div>
                `
              )
              .join("") || '<div class="founder-empty">No live sessions in the current window.</div>'}
          </div>
        </article>
      </section>

      <section class="founder-grid founder-grid-3">
        <article class="founder-card">
          <div class="founder-card-head"><h2>Page Engagement</h2><span>Time and visits</span></div>
          ${renderMiniBars(pageRows.slice(0, 6), "visits")}
        </article>
        <article class="founder-card">
          <div class="founder-card-head"><h2>Top Drop-Off Pages</h2><span>Where journeys stop</span></div>
          ${renderMiniBars(snapshot.journey?.dropOffPages || [], "count")}
        </article>
        <article class="founder-card">
          <div class="founder-card-head"><h2>Trending Hashtags</h2><span>What is rising now</span></div>
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
          <div class="founder-card-head"><h2>System Health</h2><span>Speed and errors</span></div>
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
          <div class="founder-card-head"><h2>User Context</h2><span>Devices, browsers, regions</span></div>
          <h3>Devices</h3>
          ${renderMiniBars(snapshot.context?.devices || [], "count")}
          <h3>Countries</h3>
          ${renderMiniBars(snapshot.context?.countries || [], "count")}
        </article>
        <article class="founder-card founder-card-vision">
          <div class="founder-card-head"><h2>Decision Support</h2><span>What to improve next</span></div>
          <div class="founder-recommendations">
            ${recommendations
              .map((item) => `<div class="founder-recommendation">${escapeHtml(item)}</div>`)
              .join("") || '<div class="founder-empty">Insights will appear once activity accumulates.</div>'}
          </div>
        </article>
      </section>
    `;
  }

  async function refreshFounderOverview(options = {}) {
    if (!isFounderOwner()) {
      renderState("locked", "Founder access only", "This control room is visible only to the founder account.");
      return;
    }
    if (options.initial && !latestSnapshot) {
      renderState("loading", "Loading founder control room", "Gathering live user, content, growth, and health signals...");
    }
    const requestId = ++latestRequestId;
    try {
      const snapshot = await fetchFounderOverview();
      if (requestId !== latestRequestId) return;
      latestSnapshot = snapshot;
      renderFounderControl(snapshot);
    } catch (error) {
      if (requestId !== latestRequestId) return;
      if (error?.status === 403) {
        stopFounderPolling();
        renderState("locked", "Founder access only", "This page is hidden for all non-owner accounts.");
        return;
      }
      renderState("error", "Live founder feed is unavailable", error?.message || "Please try again in a moment.");
    }
  }

  function startFounderPolling() {
    stopFounderPolling();
    refreshFounderOverview({ initial: true });
    pollTimerId = global.setInterval(() => {
      refreshFounderOverview();
    }, POLL_INTERVAL_MS);
  }

  function stopFounderPolling() {
    if (!pollTimerId) return;
    global.clearInterval(pollTimerId);
    pollTimerId = 0;
  }

  function ensureFounderButton() {
    const prActions = document.getElementById("prActions");
    if (!prActions) return;
    const existing = prActions.querySelector("[data-founder-control-btn]");
    const shouldShow =
      isFounderOwner() &&
      !!getCurrentUserId() &&
      getCurrentUserId() === String(currentProfileId || "").trim();

    if (!shouldShow) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-p founder-entry-btn";
    button.dataset.founderControlBtn = "true";
    button.textContent = "Founder Control";
    button.onclick = () => {
      if (typeof global.gp === "function") {
        global.gp(PAGE_ID);
      }
    };
    prActions.appendChild(button);
  }

  function wrapProfileRender() {
    if (typeof global.renderProfile !== "function" || global.renderProfile.__founderWrapped) return;
    const originalRenderProfile = global.renderProfile;
    const wrappedRenderProfile = function wrappedRenderProfile() {
      currentProfileId = String(arguments[0] || getCurrentUserId() || "").trim();
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
        startFounderPolling();
      } else {
        stopFounderPolling();
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
    if (latestSnapshot) {
      renderFounderControl(latestSnapshot);
    } else {
      renderState("loading", "Loading founder control room", "Preparing live visibility into user behavior and platform health...");
    }
    startFounderPolling();
  }

  global.isFounderOwner = isFounderOwner;
  global.renderFounderControlPage = renderFounderControlPage;

  wrapProfileRender();
  wrapNavigation();
})(window);
