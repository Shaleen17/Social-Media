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
  const OVERVIEW_POLL_MS = 10000;
  const DIRECTORY_POLL_MS = 12000;
  const DETAIL_POLL_MS = 6000;

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

  function compactText(value, maxLength = 120) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
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

  function getRoot() {
    return document.getElementById(ROOT_ID);
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
                  .map(
                    (user) => `
                      <button class="founder-user-item founder-click-card" type="button" data-founder-open="${escapeHtml(user.id)}">
                        <div class="founder-user-item-main">
                          <div class="founder-avatar-badge">${escapeHtml((user.name || "U").slice(0, 2).toUpperCase())}</div>
                          <div class="founder-user-copy">
                            <strong>${escapeHtml(user.name || "Unknown")}</strong>
                            <span>@${escapeHtml(user.handle || "")}</span>
                            <small>${escapeHtml(user.activityLabel || user.currentPageLabel || "No live activity yet")}</small>
                          </div>
                        </div>
                        <div class="founder-user-meta">
                          <div class="founder-user-status ${user.online ? "is-online" : "is-offline"}">${user.online ? "Live now" : escapeHtml(user.lastSeenLabel || "Inactive")}</div>
                          <small>${formatCount(user.engagementScore)} score · ${escapeHtml(user.usageBand || "Varied usage")}</small>
                        </div>
                      </button>
                    `
                  )
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
            </section>
          </div>
        </aside>
      </section>
    `;
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

      ${renderFounderUserPanel()}
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
      }
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
    if (options.initial && !state.overview && !state.directory) {
      renderState("loading", "Loading founder control room", "Gathering live user, content, growth, and health signals...");
    }
    const requestId = ++state.latestOverviewRequestId;
    try {
      const snapshot = await fetchFounderOverview();
      if (requestId !== state.latestOverviewRequestId) return;
      state.overview = snapshot;
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
      renderFounderControl();
    } catch {}
  }

  async function refreshFounderUserIntelligence(options = {}) {
    if (!isFounderOwner() || !state.selectedUserId) return;
    const requestId = ++state.latestDetailRequestId;
    if (options.force) {
      state.selectedUser = null;
      renderFounderControl();
    }
    try {
      const snapshot = await fetchFounderUserIntelligence(state.selectedUserId);
      if (requestId !== state.latestDetailRequestId) return;
      state.selectedUser = snapshot;
      renderFounderControl();
    } catch (error) {
      if (requestId !== state.latestDetailRequestId) return;
      if (error?.status === 404) {
        closeFounderUserPanel();
      }
    }
  }

  function startFounderRealtime() {
    stopFounderRealtime();
    refreshFounderOverview({ initial: true });
    refreshFounderUsers({ initial: true });
    state.overviewTimerId = global.setInterval(() => {
      refreshFounderOverview();
    }, OVERVIEW_POLL_MS);
    state.directoryTimerId = global.setInterval(() => {
      refreshFounderUsers();
    }, DIRECTORY_POLL_MS);
    syncFounderDetailPolling();
  }

  function syncFounderDetailPolling() {
    if (state.detailTimerId) {
      global.clearInterval(state.detailTimerId);
      state.detailTimerId = 0;
    }
    if (!state.selectedUserId) return;
    refreshFounderUserIntelligence();
    state.detailTimerId = global.setInterval(() => {
      refreshFounderUserIntelligence();
    }, DETAIL_POLL_MS);
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
  }

  function openFounderUserPanel(userId) {
    const nextId = String(userId || "").trim();
    if (!nextId) return;
    state.selectedUserId = nextId;
    state.selectedUser = null;
    renderFounderControl();
    syncFounderDetailPolling();
  }

  function closeFounderUserPanel() {
    state.selectedUserId = "";
    state.selectedUser = null;
    if (state.detailTimerId) {
      global.clearInterval(state.detailTimerId);
      state.detailTimerId = 0;
    }
    renderFounderControl();
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
      return;
    }

    const button = existing || document.createElement("button");
    if (!existing) {
      button.type = "button";
      button.className = "btn btn-p founder-entry-btn";
      button.dataset.founderControlBtn = "true";
      button.textContent = "Founder Control";
      button.onclick = () => {
        if (typeof global.gp === "function") {
          global.gp(PAGE_ID);
        }
      };
    }

    const mobileTarget =
      isMobileFounderLayout() ? getFounderMobileSlot() || prActions : prActions;
    if (button.parentElement !== mobileTarget) {
      mobileTarget.appendChild(button);
    }
    if (!isMobileFounderLayout()) {
      cleanupFounderMobileSlot();
    }
  }

  function observeProfileActions() {
    if (state.profileActionsObserver || !document.body) return;
    state.profileActionsObserver = new MutationObserver(() => {
      ensureFounderButton();
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
