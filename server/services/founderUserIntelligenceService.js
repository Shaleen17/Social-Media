const AnalyticsEvent = require("../models/AnalyticsEvent");
const User = require("../models/User");
const Post = require("../models/Post");
const Video = require("../models/Video");
const Conversation = require("../models/Message");
const AppError = require("../utils/appError");

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_WINDOW_MS = 90 * 1000;
const DETAIL_HISTORY_DAYS = 30;
const DIRECTORY_ACTIVITY_DAYS = 7;
const RECENT_ACTIVITY_LIMIT = 36;
const TIMELINE_LIMIT = 80;
const LIVE_FEED_LIMIT = 16;

const PAGE_LABELS = {
  home: "Home",
  mandir: "Mandir",
  mandirCommunity: "Mandir Community",
  santAll: "Sant Discovery",
  santProfile: "Sant Profile",
  video: "Tirth Tube",
  reels: "Reels",
  search: "Search",
  notifs: "Notifications",
  bookmarks: "Bookmarks",
  inviteFriends: "Invite Friends",
  profile: "Profile",
  chats: "Chats",
  messages: "Messages",
  founderControl: "Founder Control",
};

function toIdString(value) {
  return String(value?._id || value?.id || value || "").trim();
}

function toDateValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function compactText(value = "", maxLength = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function formatRelativeTime(dateValue) {
  const date = toDateValue(dateValue);
  if (!date) return "";
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return "Just now";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

function humanizeEventName(name = "") {
  return String(name || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatPageLabel(page = "") {
  const key = String(page || "").trim();
  if (!key) return "Unknown";
  if (PAGE_LABELS[key]) return PAGE_LABELS[key];
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function pageFromEvent(event) {
  return (
    String(event?.page || "").trim() ||
    String(event?.meta?.page || "").trim() ||
    String(event?.meta?.toPage || "").trim() ||
    String(event?.meta?.currentPage || "").trim() ||
    "unknown"
  );
}

function durationSeconds(from, to) {
  const start = toDateValue(from);
  const end = toDateValue(to);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

function durationMinutes(from, to) {
  return Math.round(durationSeconds(from, to) / 60);
}

function average(values = [], precision = 1) {
  const safe = values.map(Number).filter((value) => Number.isFinite(value));
  if (!safe.length) return 0;
  const sum = safe.reduce((total, value) => total + value, 0);
  return Number((sum / safe.length).toFixed(precision));
}

function escapeRegex(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskEmail(email = "") {
  const raw = String(email || "").trim().toLowerCase();
  if (!raw.includes("@")) return "";
  const [local, domain] = raw.split("@");
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

function sessionKeyFromEvent(event) {
  return (
    String(event?.sessionId || "").trim() ||
    String(event?.anonymousId || "").trim() ||
    `user:${toIdString(event?.user)}`
  );
}

function getEventContext(event) {
  return event?.meta?.context && typeof event.meta.context === "object"
    ? event.meta.context
    : {};
}

function getPrimaryTagLabel(key = "") {
  const normalized = String(key || "").trim().toLowerCase();
  const labels = {
    bhajan: "Bhajan Oriented",
    temple: "Temple Explorer",
    knowledge: "Knowledge Seeker",
    reels: "Reels Heavy",
    community: "Community Minded",
    chat: "Social Engager",
  };
  return labels[normalized] || humanizeEventName(normalized || "General");
}

function getUsageBand(hour = -1) {
  const value = Number(hour);
  if (!Number.isFinite(value) || value < 0) return "Varied usage";
  if (value >= 4 && value <= 8) return "Morning bhakti user";
  if (value >= 9 && value <= 15) return "Daytime explorer";
  if (value >= 16 && value <= 21) return "Evening devotee";
  return "Night seeker";
}

function normalizeCategory(category = "") {
  const value = String(category || "").trim().toLowerCase();
  if (!value) return "";
  if (value.includes("bhajan") || value.includes("aarti")) return "bhajan";
  if (value.includes("discourse") || value.includes("katha") || value.includes("meditation")) {
    return "knowledge";
  }
  if (value.includes("pilgrimage") || value.includes("temple")) return "temple";
  return value;
}

function normalizeContentSignals(row = {}) {
  const tags = Array.isArray(row.hashtags) ? row.hashtags : [];
  const title = String(row.title || row.text || "").toLowerCase();
  const category = normalizeCategory(row.category || "");
  const signals = new Set();

  if (category === "bhajan" || title.includes("bhajan") || title.includes("aarti")) {
    signals.add("bhajan");
  }
  if (
    category === "knowledge" ||
    title.includes("katha") ||
    title.includes("discourse") ||
    title.includes("gita")
  ) {
    signals.add("knowledge");
  }
  if (
    category === "temple" ||
    title.includes("mandir") ||
    title.includes("yatra") ||
    title.includes("kedarnath")
  ) {
    signals.add("temple");
  }
  tags.forEach((tag) => {
    const value = String(tag || "").toLowerCase();
    if (value.includes("bhajan") || value.includes("aarti")) signals.add("bhajan");
    if (value.includes("temple") || value.includes("mandir") || value.includes("yatra")) {
      signals.add("temple");
    }
    if (value.includes("gita") || value.includes("katha") || value.includes("dharma")) {
      signals.add("knowledge");
    }
  });

  return Array.from(signals);
}

function inferInterestWeightsFromEvent(event, weights) {
  const page = pageFromEvent(event);
  const name = String(event?.name || "").trim().toLowerCase();
  const meta = event?.meta || {};
  const category = normalizeCategory(meta.videoCategory || meta.category || "");
  const title = String(meta.videoTitle || meta.title || "").toLowerCase();
  const isBhajan = category === "bhajan" || title.includes("bhajan") || title.includes("aarti");
  const isKnowledge =
    category === "knowledge" || title.includes("katha") || title.includes("discourse");
  const isTemple = category === "temple" || title.includes("mandir") || title.includes("yatra");

  if (page === "mandir" || page === "mandirCommunity") {
    weights.temple += 3;
    weights.community += 1;
  }
  if (page === "video") weights.knowledge += 1;
  if (page === "reels") weights.reels += 3;
  if (page === "chats" || page === "messages") weights.chat += 3;
  if (page === "home" || page === "profile") weights.community += 1;

  if (name === "chat_message_sent" || name === "conversation_started" || name === "group_created") {
    weights.chat += 4;
    weights.community += 1;
  }
  if (name === "post_created" || name === "post_commented" || name === "post_liked") {
    weights.community += 3;
  }
  if (name === "video_started" || name === "video_completed" || name === "video_progress") {
    weights.reels += meta.page === "reels" ? 3 : 1;
    if (isBhajan) weights.bhajan += 2;
    else if (isTemple) weights.temple += 2;
    else if (isKnowledge) weights.knowledge += 3;
    else weights.knowledge += 2;
  }

  if (isBhajan) {
    weights.bhajan += 4;
  }
  if (isKnowledge) {
    weights.knowledge += 4;
  }
  if (isTemple) {
    weights.temple += 4;
  }
}

function inferInterestWeightsFromContent(rows = [], weights = {}) {
  rows.forEach((row) => {
    normalizeContentSignals(row).forEach((signal) => {
      if (Object.prototype.hasOwnProperty.call(weights, signal)) {
        weights[signal] += 3;
      }
    });
  });
}

function buildSessionSummaries(events = []) {
  const ordered = [...events].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
  const sessions = new Map();

  ordered.forEach((event) => {
    const key = sessionKeyFromEvent(event);
    if (!key) return;
    const createdAt = toDateValue(event.createdAt);
    if (!createdAt) return;

    const context = getEventContext(event);
    const page = pageFromEvent(event);
    const existing =
      sessions.get(key) ||
      {
        key,
        startedAt: createdAt,
        lastSeenAt: createdAt,
        currentPage: page,
        entryPage: page,
        steps: [],
        events: [],
        deviceType: context.deviceType || "unknown",
        browser: context.browser || "Unknown",
        country: context.country || "Unknown",
      };

    existing.lastSeenAt = createdAt;
    existing.currentPage = page;
    existing.events.push(event);
    if (!existing.deviceType && context.deviceType) existing.deviceType = context.deviceType;
    if (!existing.browser && context.browser) existing.browser = context.browser;
    if (!existing.country && context.country) existing.country = context.country;

    const lastStep = existing.steps[existing.steps.length - 1];
    const nextStep =
      !lastStep || lastStep.page !== page
        ? {
            page,
            label: formatPageLabel(page),
            enteredAt: createdAt,
            endedAt: createdAt,
            eventCount: 0,
            names: [],
          }
        : lastStep;

    nextStep.endedAt = createdAt;
    nextStep.eventCount += 1;
    if (event.name && !nextStep.names.includes(event.name)) {
      nextStep.names.push(event.name);
    }

    if (!lastStep || lastStep.page !== page) {
      existing.steps.push(nextStep);
    }

    sessions.set(key, existing);
  });

  return Array.from(sessions.values())
    .map((session) => ({
      ...session,
      durationSeconds: durationSeconds(session.startedAt, session.lastSeenAt),
      durationMinutes: durationMinutes(session.startedAt, session.lastSeenAt),
      pagesVisited: Array.from(new Set(session.steps.map((step) => step.page))).filter(Boolean),
    }))
    .sort(
      (left, right) =>
        new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime()
    );
}

function mapEventToTimeline(event) {
  const page = pageFromEvent(event);
  const meta = event?.meta || {};
  const name = String(event?.name || "").trim();
  const base = {
    id: toIdString(event),
    ts: event.createdAt,
    ageLabel: formatRelativeTime(event.createdAt),
    page,
    pageLabel: formatPageLabel(page),
    name,
    label: humanizeEventName(name),
    detail: "",
    icon: "wave",
  };

  switch (name) {
    case "initial_page_view":
    case "virtual_page_view":
      return {
        ...base,
        label: `Viewed ${formatPageLabel(page)}`,
        detail: meta.path || event.path || "",
        icon: "eye",
      };
    case "page_transition":
      return {
        ...base,
        label: `Moved to ${formatPageLabel(meta.toPage || page)}`,
        detail: meta.fromPage ? `From ${formatPageLabel(meta.fromPage)}` : "Navigation flow",
        icon: "path",
      };
    case "page_duration":
      return {
        ...base,
        label: `Stayed on ${formatPageLabel(meta.page || page)}`,
        detail: meta.durationMs ? `${Math.round(Number(meta.durationMs) / 1000)}s dwell time` : "",
        icon: "clock",
      };
    case "search_used":
      return {
        ...base,
        label: "Used search",
        detail: meta.queryLength ? `${meta.queryLength} character query` : "Discovery behavior",
        icon: "search",
      };
    case "chat_opened":
      return {
        ...base,
        label: "Opened a chat",
        detail: meta.conversationType === "group" ? "Group conversation" : "Direct message view",
        icon: "chat",
      };
    case "chat_typing":
      return {
        ...base,
        label: "Started typing in chat",
        detail: meta.conversationType === "group" ? "Group reply draft" : "Direct message draft",
        icon: "pen",
      };
    case "chat_message_sent":
      return {
        ...base,
        label: "Sent a chat message",
        detail: meta.isGroup ? "Group conversation" : "Direct conversation",
        icon: "chat",
      };
    case "video_started":
      return {
        ...base,
        label: "Started watching a video",
        detail: compactText(meta.videoTitle || "Tirth Tube content", 90),
        icon: "play",
      };
    case "video_progress":
      return {
        ...base,
        label: `Reached ${meta.milestone || 0}% of a video`,
        detail: compactText(meta.videoTitle || "Tirth Tube content", 90),
        icon: "play",
      };
    case "video_completed":
      return {
        ...base,
        label: "Completed a video",
        detail: compactText(meta.videoTitle || "Tirth Tube content", 90),
        icon: "play",
      };
    case "video_paused":
      return {
        ...base,
        label: "Paused a video",
        detail: meta.pauseSeconds ? `Pause of ${meta.pauseSeconds}s` : "Paused playback",
        icon: "pause",
      };
    case "video_replay":
      return {
        ...base,
        label: "Replayed part of a video",
        detail: meta.videoTitle ? compactText(meta.videoTitle, 90) : "Repeat watch signal",
        icon: "repeat",
      };
    case "post_created":
      return {
        ...base,
        label: "Created a public post",
        detail: compactText(meta.preview || "", 95),
        icon: "post",
      };
    case "post_liked":
    case "post_unliked":
      return {
        ...base,
        label: name === "post_liked" ? "Liked a post" : "Removed a like",
        detail: "Feed engagement",
        icon: "heart",
      };
    case "post_commented":
      return {
        ...base,
        label: "Commented on a post",
        detail: "Public engagement",
        icon: "comment",
      };
    case "user_followed":
    case "user_unfollowed":
      return {
        ...base,
        label: name === "user_followed" ? "Followed a user" : "Unfollowed a user",
        detail: "Relationship graph changed",
        icon: "follow",
      };
    case "session_idle":
      return {
        ...base,
        label: "Became idle",
        detail: meta.idleSeconds ? `Inactive for ${meta.idleSeconds}s` : "Attention paused",
        icon: "pause",
      };
    case "session_resumed":
      return {
        ...base,
        label: "Returned to activity",
        detail: "Session became active again",
        icon: "spark",
      };
    case "scroll_activity":
      return {
        ...base,
        label: `Scrolled ${formatPageLabel(page)}`,
        detail: meta.maxScrollDepth ? `${meta.maxScrollDepth}% depth reached` : "Scroll engagement",
        icon: "scroll",
      };
    case "attention_pause":
      return {
        ...base,
        label: "Paused on content",
        detail: meta.pauseSeconds ? `${meta.pauseSeconds}s attention pause` : "High dwell moment",
        icon: "focus",
      };
    case "hover_interest":
      return {
        ...base,
        label: "Hovered with intent",
        detail: meta.targetLabel ? compactText(meta.targetLabel, 80) : "Interest signal",
        icon: "focus",
      };
    default:
      return {
        ...base,
        detail: compactText(meta.path || meta.message || "", 100),
      };
  }
}

function buildUserTimeline(events = []) {
  return events
    .filter((event) => !["session_heartbeat"].includes(String(event?.name || "")))
    .slice(0, TIMELINE_LIMIT)
    .map(mapEventToTimeline);
}

function buildLiveFeed(events = []) {
  return events
    .filter((event) => !["session_heartbeat", "page_duration"].includes(String(event?.name || "")))
    .slice(0, LIVE_FEED_LIMIT)
    .map(mapEventToTimeline);
}

function deriveCurrentAction(event, { isOnline = false } = {}) {
  if (!event) {
    return isOnline ? "Active on the platform" : "Offline";
  }

  const meta = event.meta || {};
  switch (String(event.name || "")) {
    case "chat_typing":
      return "Typing a message";
    case "chat_opened":
      return "Reading a conversation";
    case "video_playback_heartbeat":
    case "video_started":
      return `Watching ${compactText(meta.videoTitle || "video content", 48)}`;
    case "video_paused":
      return "Paused on a video";
    case "scroll_activity":
      return `Scrolling ${formatPageLabel(pageFromEvent(event))}`;
    case "attention_pause":
      return `Paused on ${formatPageLabel(pageFromEvent(event))}`;
    case "session_idle":
      return "Idle";
    case "search_used":
      return "Exploring through search";
    case "page_transition":
    case "virtual_page_view":
    case "initial_page_view":
      return `Viewing ${formatPageLabel(pageFromEvent(event))}`;
    default:
      return humanizeEventName(event.name || "Active");
  }
}

function buildLiveState({ user, events, sessions, isOnline }) {
  const latestEvent = events[0] || null;
  const latestSession = sessions[0] || null;
  const now = Date.now();
  const latestAt = toDateValue(latestEvent?.createdAt);
  const activeWithinWindow = latestAt ? now - latestAt.getTime() <= LIVE_WINDOW_MS : false;
  const currentPage = latestSession?.currentPage || pageFromEvent(latestEvent);
  const currentStep = latestSession?.steps?.[latestSession.steps.length - 1] || null;
  const recentNames = new Set(
    events
      .slice(0, 12)
      .map((event) => String(event?.name || "").trim())
      .filter(Boolean)
  );

  return {
    online: !!isOnline || activeWithinWindow,
    idle: recentNames.has("session_idle") && !recentNames.has("session_resumed"),
    currentPage,
    currentPageLabel: formatPageLabel(currentPage),
    currentAction: deriveCurrentAction(latestEvent, { isOnline }),
    sessionDurationMinutes: latestSession?.durationMinutes || 0,
    lastActivityAt: latestEvent?.createdAt || user?.lastSeen || user?.updatedAt || null,
    lastActivityLabel: formatRelativeTime(
      latestEvent?.createdAt || user?.lastSeen || user?.updatedAt || null
    ),
    stepDurationSeconds: currentStep
      ? durationSeconds(currentStep.enteredAt, currentStep.endedAt)
      : 0,
    deviceType: latestSession?.deviceType || getEventContext(latestEvent).deviceType || "unknown",
    browser: latestSession?.browser || getEventContext(latestEvent).browser || "Unknown",
    country: latestSession?.country || getEventContext(latestEvent).country || "Unknown",
    typing: events.some((event) => {
      if (String(event?.name || "") !== "chat_typing") return false;
      const createdAt = toDateValue(event.createdAt);
      return createdAt ? now - createdAt.getTime() <= 30 * 1000 : false;
    }),
    watchingVideo: events.some((event) => {
      const name = String(event?.name || "");
      if (!["video_playback_heartbeat", "video_started", "video_progress"].includes(name)) {
        return false;
      }
      const createdAt = toDateValue(event.createdAt);
      return createdAt ? now - createdAt.getTime() <= 35 * 1000 : false;
    }),
    liveFeed: buildLiveFeed(events),
  };
}

function computeStepEngagement(step) {
  const names = Array.isArray(step?.names) ? step.names : [];
  let score = Math.min(20, Number(step?.eventCount || 0) * 4);
  if (names.includes("scroll_activity")) score += 10;
  if (names.includes("chat_opened")) score += 12;
  if (names.includes("video_started")) score += 12;
  if (names.includes("video_completed")) score += 16;
  if (names.includes("post_liked") || names.includes("post_commented")) score += 10;
  return Math.min(100, score);
}

function buildJourneyView(sessions = []) {
  const primary = sessions[0] || null;
  if (!primary) {
    return {
      currentPath: [],
      transitions: [],
      dropSignals: [],
    };
  }

  const currentPath = primary.steps.map((step) => ({
    page: step.page,
    label: step.label,
    enteredAt: step.enteredAt,
    durationSeconds: durationSeconds(step.enteredAt, step.endedAt),
    engagementScore: computeStepEngagement(step),
  }));

  const transitions = currentPath.slice(1).map((step, index) => ({
    from: currentPath[index].page,
    fromLabel: currentPath[index].label,
    to: step.page,
    toLabel: step.label,
    durationSeconds: currentPath[index].durationSeconds,
  }));

  const dropSignals = currentPath
    .filter((step) => step.durationSeconds <= 8)
    .map((step) => ({
      page: step.page,
      label: step.label,
      reason: "Short dwell time suggests a possible drop-off point",
      durationSeconds: step.durationSeconds,
    }))
    .slice(0, 4);

  return {
    currentPath,
    transitions,
    dropSignals,
  };
}

function buildMicroBehavior(events = []) {
  const scrollEvents = events.filter((event) => String(event?.name || "") === "scroll_activity");
  const pauseEvents = events.filter((event) => String(event?.name || "") === "attention_pause");
  const hoverEvents = events.filter((event) => String(event?.name || "") === "hover_interest");
  const replayEvents = events.filter((event) => String(event?.name || "") === "video_replay");
  const videoPauseEvents = events.filter((event) => String(event?.name || "") === "video_paused");

  const maxScrollDepth = Math.max(
    0,
    ...scrollEvents.map((event) => Number(event?.meta?.maxScrollDepth || event?.meta?.currentScrollDepth || 0))
  );
  const avgScrollSpeed = average(
    scrollEvents.map((event) => Number(event?.meta?.scrollSpeed || 0)).filter(Boolean),
    1
  );
  const avgPauseSeconds = average(
    pauseEvents.map((event) => Number(event?.meta?.pauseSeconds || 0)).filter(Boolean),
    1
  );
  const longestPauseSeconds = Math.max(
    0,
    ...pauseEvents.map((event) => Number(event?.meta?.pauseSeconds || 0))
  );

  const hoverTargets = Array.from(
    hoverEvents.reduce((map, event) => {
      const label = compactText(event?.meta?.targetLabel || event?.meta?.targetId || "", 60);
      if (!label) return map;
      map.set(label, (map.get(label) || 0) + 1);
      return map;
    }, new Map())
  )
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);

  const attentionHotspots = Array.from(
    pauseEvents.reduce((map, event) => {
      const page = pageFromEvent(event);
      const current = map.get(page) || { page, label: formatPageLabel(page), pauses: 0, seconds: 0 };
      current.pauses += 1;
      current.seconds += Number(event?.meta?.pauseSeconds || 0);
      map.set(page, current);
      return map;
    }, new Map())
  )
    .map(([, value]) => value)
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, 4);

  return {
    maxScrollDepth,
    avgScrollSpeed,
    avgPauseSeconds,
    longestPauseSeconds,
    replayCount: replayEvents.length,
    videoPauseCount: videoPauseEvents.length,
    hoverTargets,
    attentionHotspots,
    signals: [
      maxScrollDepth >= 75 ? "Deep scrolling suggests strong attention." : "",
      avgPauseSeconds >= 8 ? "Long pauses indicate reflective or careful reading moments." : "",
      replayEvents.length >= 2 ? "Replay behavior suggests especially meaningful video moments." : "",
    ].filter(Boolean),
  };
}

function buildInterestProfile({ events = [], authoredPosts = [], authoredVideos = [] }) {
  const weights = {
    bhajan: 0,
    temple: 0,
    knowledge: 0,
    reels: 0,
    community: 0,
    chat: 0,
  };

  events.forEach((event) => inferInterestWeightsFromEvent(event, weights));
  inferInterestWeightsFromContent(authoredPosts, weights);
  inferInterestWeightsFromContent(authoredVideos, weights);

  const ranked = Object.entries(weights)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([key, score]) => ({
      key,
      label: getPrimaryTagLabel(key),
      score,
    }));

  const hourlyCounts = events.reduce((map, event) => {
    const hour = Number(event?.meta?.localHour);
    if (!Number.isFinite(hour)) return map;
    map.set(hour, (map.get(hour) || 0) + 1);
    return map;
  }, new Map());

  const peakHour = Array.from(hourlyCounts.entries())
    .sort((left, right) => right[1] - left[1])[0]?.[0];

  const pageViewCount = events.filter((event) => String(event?.type || "") === "page_view").length;
  const interactionCount = events.filter((event) => String(event?.type || "") === "interaction").length;
  const creationCount = events.filter((event) =>
    ["post_created", "video_uploaded", "group_created"].includes(String(event?.name || ""))
  ).length;
  const socialCount = events.filter((event) =>
    ["chat_message_sent", "conversation_started", "user_followed", "post_commented"].includes(
      String(event?.name || "")
    )
  ).length;

  let behaviorType = "Silent observer";
  if (creationCount >= 2) {
    behaviorType = "Active contributor";
  } else if (socialCount >= 3) {
    behaviorType = "Social engager";
  } else if (interactionCount >= Math.max(3, Math.round(pageViewCount * 0.35))) {
    behaviorType = "Spiritual explorer";
  }

  return {
    topInterests: ranked.slice(0, 4),
    usageBand: getUsageBand(peakHour),
    peakHour: Number.isFinite(peakHour)
      ? `${String(peakHour).padStart(2, "0")}:00`
      : "",
    behaviorType,
  };
}

function buildUserContext(events = []) {
  const counters = {
    devices: new Map(),
    browsers: new Map(),
    countries: new Map(),
  };

  events.forEach((event) => {
    const context = getEventContext(event);
    [["devices", context.deviceType], ["browsers", context.browser], ["countries", context.country]].forEach(
      ([bucket, value]) => {
        const label = String(value || "Unknown").trim() || "Unknown";
        counters[bucket].set(label, (counters[bucket].get(label) || 0) + 1);
      }
    );
  });

  return {
    devices: Array.from(counters.devices.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 4),
    browsers: Array.from(counters.browsers.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 4),
    countries: Array.from(counters.countries.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 4),
  };
}

function computeEngagementScore({
  sessions = [],
  events = [],
  messageCount = 0,
  authoredPosts = 0,
  authoredVideos = 0,
}) {
  const activeDays = new Set(
    events
      .map((event) => {
        const date = toDateValue(event.createdAt);
        return date ? date.toISOString().slice(0, 10) : "";
      })
      .filter(Boolean)
  ).size;
  const avgSessionMinutes = average(sessions.map((session) => session.durationMinutes), 1);
  const meaningfulActions = events.filter((event) =>
    [
      "post_created",
      "post_liked",
      "post_commented",
      "chat_message_sent",
      "video_completed",
      "user_followed",
      "group_created",
    ].includes(String(event?.name || ""))
  ).length;
  const completionSignals = events.filter((event) =>
    ["video_completed", "post_created", "video_uploaded"].includes(String(event?.name || ""))
  ).length;

  let score = 0;
  score += Math.min(24, activeDays * 4);
  score += Math.min(18, avgSessionMinutes * 1.4);
  score += Math.min(22, meaningfulActions * 2.2);
  score += Math.min(14, completionSignals * 3);
  score += Math.min(12, Number(messageCount || 0) * 1.5);
  score += Math.min(10, (Number(authoredPosts || 0) + Number(authoredVideos || 0)) * 2);

  const normalizedScore = Math.min(100, Math.round(score));
  let label = "At-risk visitor";
  if (normalizedScore >= 75) label = "High devotion user";
  else if (normalizedScore >= 50) label = "Steady seeker";
  else if (normalizedScore >= 30) label = "Casual explorer";

  return {
    score: normalizedScore,
    label,
    activeDays,
    avgSessionMinutes,
    meaningfulActions,
  };
}

function detectFriction({ events = [], sessions = [] }) {
  const findings = [];
  const videoStarts = events.filter((event) => String(event?.name || "") === "video_started").length;
  const videoCompletes = events.filter((event) => String(event?.name || "") === "video_completed").length;
  const chatOpened = events.filter((event) => String(event?.name || "") === "chat_opened").length;
  const messagesSent = events.filter((event) => String(event?.name || "") === "chat_message_sent").length;
  const shortSteps = sessions
    .flatMap((session) => session.steps || [])
    .filter(
      (step) =>
        durationSeconds(step.enteredAt, step.endedAt) > 0 &&
        durationSeconds(step.enteredAt, step.endedAt) <= 8
    );

  if (videoStarts >= 3 && videoCompletes <= Math.floor(videoStarts / 3)) {
    findings.push("The user often starts videos but leaves before completion.");
  }
  if (chatOpened >= 3 && messagesSent === 0) {
    findings.push("The user opens chat flows but rarely sends a message.");
  }
  const topShortPage = shortSteps.reduce((map, step) => {
    map.set(step.page, (map.get(step.page) || 0) + 1);
    return map;
  }, new Map());
  const dropPage = Array.from(topShortPage.entries()).sort((left, right) => right[1] - left[1])[0];
  if (dropPage) {
    findings.push(
      `Short visits cluster around ${formatPageLabel(dropPage[0])}. That page may be losing attention quickly.`
    );
  }

  return findings.slice(0, 4);
}

function detectPatterns({ sessions = [], events = [] }) {
  const hourCounts = sessions.reduce((map, session) => {
    const date = toDateValue(session.startedAt);
    if (!date) return map;
    map.set(date.getHours(), (map.get(date.getHours()) || 0) + 1);
    return map;
  }, new Map());
  const peakHour = Array.from(hourCounts.entries()).sort((left, right) => right[1] - left[1])[0];

  const transitionCounts = new Map();
  sessions.forEach((session) => {
    const path = (session.steps || []).map((step) => step.page).filter(Boolean);
    for (let index = 0; index < path.length - 1; index += 1) {
      const key = `${path[index]}->${path[index + 1]}`;
      transitionCounts.set(key, (transitionCounts.get(key) || 0) + 1);
    }
  });
  const topTransition = Array.from(transitionCounts.entries())
    .sort((left, right) => right[1] - left[1])[0];

  const activeDays = new Set(
    events
      .map((event) => {
        const date = toDateValue(event.createdAt);
        return date ? date.toISOString().slice(0, 10) : "";
      })
      .filter(Boolean)
  ).size;

  return {
    activeDays,
    averageSessionMinutes: average(sessions.map((session) => session.durationMinutes), 1),
    peakUsageLabel:
      peakHour && Number.isFinite(peakHour[0])
        ? `${String(peakHour[0]).padStart(2, "0")}:00 habit`
        : "No clear habit yet",
    repeatTransition: topTransition
      ? {
          key: topTransition[0],
          label: topTransition[0]
            .split("->")
            .map((page) => formatPageLabel(page))
            .join(" -> "),
          count: topTransition[1],
        }
      : null,
  };
}

function buildPredictions({ liveState, interestProfile, friction, patterns, engagement }) {
  const predictions = [];
  const topInterest = interestProfile.topInterests[0]?.label || "meaningful community content";
  if (liveState.currentPage === "home") {
    predictions.push(`Likely next move: explore ${topInterest.toLowerCase()} next.`);
  } else if (liveState.currentPage) {
    predictions.push(
      `Likely next move: continue from ${liveState.currentPageLabel} into a related discovery step.`
    );
  }
  predictions.push(`Best retention bet: show more ${topInterest.toLowerCase()} with a clear next action.`);
  if (friction.length) {
    predictions.push("Retention risk is elevated until the main drop-off point is simplified.");
  } else if (engagement.score >= 65) {
    predictions.push("This user is likely to return if fresh relevant content appears in their strongest interest area.");
  }
  if (patterns.repeatTransition) {
    predictions.push(`Repeat habit: ${patterns.repeatTransition.label} is a recurring path for this user.`);
  }
  return predictions.slice(0, 4);
}

function buildSegmentTags({ interestProfile, engagement, friction, messageCount = 0, authoredPosts = 0 }) {
  const tags = new Set();
  const topInterestKey = interestProfile.topInterests[0]?.key || "";

  if (topInterestKey === "knowledge") tags.add("Spiritual Learner");
  if (topInterestKey === "temple") tags.add("Temple Explorer");
  if (topInterestKey === "bhajan") tags.add("Devotional User");
  if (messageCount >= 3) tags.add("Social Engager");
  if (authoredPosts >= 2) tags.add("Contributor");
  if (engagement.score >= 70) tags.add("Returning Seeker");
  if (interestProfile.behaviorType === "Silent observer") tags.add("Silent Observer");
  if (friction.length >= 2 && engagement.score < 40) tags.add("At-Risk New User");

  if (!tags.size) tags.add("Spiritual Explorer");
  return Array.from(tags).slice(0, 5);
}

function buildContentSnapshot({ postsSummary = {}, videosSummary = {}, messageCount = 0, conversationCount = 0 }) {
  return {
    postsCreated: Number(postsSummary.postsCreated) || 0,
    postEngagementReceived: Number(postsSummary.postEngagementReceived) || 0,
    videosCreated: Number(videosSummary.videosCreated) || 0,
    videoViewsReceived: Number(videosSummary.videoViewsReceived) || 0,
    messagesSent: Number(messageCount) || 0,
    conversationsJoined: Number(conversationCount) || 0,
    topPostHashtags: postsSummary.topHashtags || [],
    topVideoThemes: videosSummary.topCategories || [],
  };
}

async function getConversationSnapshot(userId) {
  const [conversationCount, messageAggregate] = await Promise.all([
    Conversation.countDocuments({ participants: userId }),
    Conversation.aggregate([
      { $match: { participants: userId } },
      { $unwind: "$messages" },
      {
        $match: {
          "messages.sender": userId,
          "messages.deletedForEveryone": { $ne: true },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  return {
    conversationCount,
    messageCount: Number(messageAggregate?.[0]?.count) || 0,
  };
}

async function getAuthoredContentSnapshot(userId) {
  const [postRows, videoRows] = await Promise.all([
    Post.find({ user: userId, "moderation.status": { $ne: "needs_review" } })
      .select("text hashtags likes comments reposts createdAt")
      .sort({ createdAt: -1 })
      .limit(60)
      .lean(),
    Video.find({ user: userId, "moderation.status": { $ne: "needs_review" } })
      .select("title category hashtags views likes comments createdAt")
      .sort({ createdAt: -1 })
      .limit(60)
      .lean(),
  ]);

  const postsSummary = {
    postsCreated: postRows.length,
    postEngagementReceived: postRows.reduce(
      (total, row) =>
        total +
        (Array.isArray(row.likes) ? row.likes.length : 0) +
        (Array.isArray(row.comments) ? row.comments.length : 0) +
        (Array.isArray(row.reposts) ? row.reposts.length : 0),
      0
    ),
    topHashtags: Array.from(
      postRows.reduce((map, row) => {
        (row.hashtags || []).forEach((tag) => {
          const key = String(tag || "").trim().toLowerCase();
          if (!key) return;
          map.set(key, (map.get(key) || 0) + 1);
        });
        return map;
      }, new Map())
    )
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5),
  };

  const videosSummary = {
    videosCreated: videoRows.length,
    videoViewsReceived: videoRows.reduce((total, row) => total + (Number(row.views) || 0), 0),
    topCategories: Array.from(
      videoRows.reduce((map, row) => {
        const key = String(row.category || "Other").trim();
        map.set(key, (map.get(key) || 0) + 1);
        return map;
      }, new Map())
    )
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5),
  };

  return {
    postsSummary,
    videosSummary,
    authoredPosts: postRows,
    authoredVideos: videoRows,
  };
}

async function getFounderUserDirectory({
  app,
  page = 1,
  limit = 18,
  q = "",
  sort = "active",
} = {}) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(40, Math.max(1, Number.parseInt(limit, 10) || 18));
  const safeQuery = String(q || "").trim();
  const safeSort = ["active", "engaged", "newest"].includes(String(sort || ""))
    ? String(sort)
    : "active";
  const filter = {
    accountStatus: { $ne: "deleted" },
  };

  if (safeQuery) {
    const pattern = new RegExp(escapeRegex(safeQuery), "i");
    filter.$or = [
      { name: pattern },
      { handle: pattern },
      { email: pattern },
      { bio: pattern },
    ];
  }

  const sortOrder =
    safeSort === "newest"
      ? { createdAt: -1, lastSeen: -1 }
      : { lastSeen: -1, createdAt: -1 };

  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .select("name handle email avatar bio followers following createdAt lastSeen verified")
      .sort(sortOrder)
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
  ]);

  const userIds = users.map((user) => user._id);
  const activitySince = new Date(Date.now() - DIRECTORY_ACTIVITY_DAYS * DAY_MS);
  const socketState = app?.get?.("socketState");
  const onlineUserIds = socketState?.getOnlineUserIds
    ? await socketState.getOnlineUserIds().catch(() => [])
    : [];
  const onlineSet = new Set((onlineUserIds || []).map(String));

  const [eventSummaryRows, postCounts, videoCounts, messageCounts] = await Promise.all([
    AnalyticsEvent.aggregate([
      {
        $match: {
          user: { $in: userIds },
          createdAt: { $gte: activitySince },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$user",
          lastEventAt: { $first: "$createdAt" },
          lastPage: {
            $first: {
              $ifNull: [
                "$page",
                { $ifNull: ["$meta.page", { $ifNull: ["$meta.toPage", "unknown"] }] },
              ],
            },
          },
          lastName: { $first: "$name" },
          lastLocalHour: { $first: "$meta.localHour" },
          deviceType: { $first: "$meta.context.deviceType" },
          browser: { $first: "$meta.context.browser" },
          country: { $first: "$meta.context.country" },
          totalEvents: { $sum: 1 },
          interactions: {
            $sum: {
              $cond: [{ $eq: ["$type", "interaction"] }, 1, 0],
            },
          },
          pageViews: {
            $sum: {
              $cond: [{ $eq: ["$type", "page_view"] }, 1, 0],
            },
          },
          activeDays: {
            $addToSet: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
          },
        },
      },
    ]),
    Post.aggregate([
      { $match: { user: { $in: userIds }, "moderation.status": { $ne: "needs_review" } } },
      { $group: { _id: "$user", count: { $sum: 1 } } },
    ]),
    Video.aggregate([
      { $match: { user: { $in: userIds }, "moderation.status": { $ne: "needs_review" } } },
      { $group: { _id: "$user", count: { $sum: 1 } } },
    ]),
    AnalyticsEvent.aggregate([
      {
        $match: {
          user: { $in: userIds },
          createdAt: { $gte: activitySince },
          name: "chat_message_sent",
        },
      },
      { $group: { _id: "$user", count: { $sum: 1 } } },
    ]),
  ]);

  const eventMap = new Map(eventSummaryRows.map((row) => [toIdString(row._id), row]));
  const postMap = new Map(postCounts.map((row) => [toIdString(row._id), Number(row.count) || 0]));
  const videoMap = new Map(videoCounts.map((row) => [toIdString(row._id), Number(row.count) || 0]));
  const messageMap = new Map(messageCounts.map((row) => [toIdString(row._id), Number(row.count) || 0]));

  const items = users
    .map((user) => {
      const id = toIdString(user._id);
      const summary = eventMap.get(id) || {};
      const syntheticEvents = Array.from({ length: Number(summary.totalEvents) || 0 }).map(() => ({
        createdAt: summary.lastEventAt || user.lastSeen || user.createdAt,
        name: "activity",
      }));
      const score = computeEngagementScore({
        sessions: [],
        events: syntheticEvents,
        messageCount: messageMap.get(id) || 0,
        authoredPosts: postMap.get(id) || 0,
        authoredVideos: videoMap.get(id) || 0,
      });

      return {
        id,
        name: user.name || "Unknown",
        handle: user.handle || "",
        maskedEmail: maskEmail(user.email),
        avatar: user.avatar || "",
        bio: compactText(user.bio || "", 110),
        verified: !!user.verified,
        online: onlineSet.has(id),
        createdAt: user.createdAt,
        joinedLabel: formatRelativeTime(user.createdAt),
        lastSeenAt: summary.lastEventAt || user.lastSeen || user.updatedAt || null,
        lastSeenLabel: formatRelativeTime(summary.lastEventAt || user.lastSeen || user.updatedAt || null),
        currentPage: String(summary.lastPage || "").trim(),
        currentPageLabel: formatPageLabel(summary.lastPage || ""),
        activityLabel: deriveCurrentAction(
          {
            name: summary.lastName || "",
            page: summary.lastPage || "",
            createdAt: summary.lastEventAt || user.lastSeen,
          },
          { isOnline: onlineSet.has(id) }
        ),
        engagementScore: score.score,
        engagementLabel: score.label,
        activeDays: Array.isArray(summary.activeDays) ? summary.activeDays.length : 0,
        messageCount: messageMap.get(id) || 0,
        postsCreated: postMap.get(id) || 0,
        videosCreated: videoMap.get(id) || 0,
        followersCount: Array.isArray(user.followers) ? user.followers.length : 0,
        followingCount: Array.isArray(user.following) ? user.following.length : 0,
        deviceType: summary.deviceType || "unknown",
        browser: summary.browser || "Unknown",
        country: summary.country || "Unknown",
        usageBand: getUsageBand(summary.lastLocalHour),
      };
    })
    .sort((left, right) => {
      if (safeSort === "engaged") {
        return (
          right.engagementScore - left.engagementScore ||
          Number(right.online) - Number(left.online)
        );
      }
      if (safeSort === "newest") {
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      }
      return (
        Number(right.online) - Number(left.online) ||
        new Date(right.lastSeenAt || 0).getTime() - new Date(left.lastSeenAt || 0).getTime()
      );
    });

  return {
    page: safePage,
    limit: safeLimit,
    total,
    hasMore: safePage * safeLimit < total,
    items,
  };
}

async function getFounderUserIntelligence({ app, userId } = {}) {
  const user = await User.findOne({
    _id: userId,
    accountStatus: { $ne: "deleted" },
  })
    .select(
      "name handle email avatar banner bio createdAt lastSeen followers following verified location spiritualName homeMandir favoriteDeity spokenLanguages"
    )
    .lean();

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const activitySince = new Date(Date.now() - DETAIL_HISTORY_DAYS * DAY_MS);
  const socketState = app?.get?.("socketState");
  const isOnline = socketState?.isOnline
    ? await socketState.isOnline(userId).catch(() => false)
    : false;

  const [events, contentSnapshot, conversationSnapshot] = await Promise.all([
    AnalyticsEvent.find({
      user: userId,
      createdAt: { $gte: activitySince },
    })
      .sort({ createdAt: -1 })
      .limit(2400)
      .lean(),
    getAuthoredContentSnapshot(userId),
    getConversationSnapshot(userId),
  ]);

  const sessions = buildSessionSummaries(events);
  const liveState = buildLiveState({ user, events, sessions, isOnline });
  const journey = buildJourneyView(sessions);
  const microBehavior = buildMicroBehavior(events);
  const interestProfile = buildInterestProfile({
    events,
    authoredPosts: contentSnapshot.authoredPosts,
    authoredVideos: contentSnapshot.authoredVideos,
  });
  const context = buildUserContext(events);
  const engagement = computeEngagementScore({
    sessions,
    events,
    messageCount: conversationSnapshot.messageCount,
    authoredPosts: contentSnapshot.postsSummary.postsCreated,
    authoredVideos: contentSnapshot.videosSummary.videosCreated,
  });
  const friction = detectFriction({ events, sessions });
  const patterns = detectPatterns({ sessions, events });
  const segmentTags = buildSegmentTags({
    interestProfile,
    engagement,
    friction,
    messageCount: conversationSnapshot.messageCount,
    authoredPosts: contentSnapshot.postsSummary.postsCreated,
  });
  const predictions = buildPredictions({
    liveState,
    interestProfile,
    friction,
    patterns,
    engagement,
  });

  const content = buildContentSnapshot({
    postsSummary: contentSnapshot.postsSummary,
    videosSummary: contentSnapshot.videosSummary,
    messageCount: conversationSnapshot.messageCount,
    conversationCount: conversationSnapshot.conversationCount,
  });

  return {
    generatedAt: new Date().toISOString(),
    user: {
      id: toIdString(user._id),
      name: user.name || "Unknown",
      handle: user.handle || "",
      avatar: user.avatar || "",
      banner: user.banner || "",
      bio: compactText(user.bio || "", 220),
      maskedEmail: maskEmail(user.email),
      createdAt: user.createdAt,
      joinedLabel: formatRelativeTime(user.createdAt),
      verified: !!user.verified,
      location: compactText(user.location || "", 60),
      spiritualName: compactText(user.spiritualName || "", 60),
      homeMandir: compactText(user.homeMandir || "", 60),
      favoriteDeity: compactText(user.favoriteDeity || "", 60),
      spokenLanguages: compactText(user.spokenLanguages || "", 80),
      followersCount: Array.isArray(user.followers) ? user.followers.length : 0,
      followingCount: Array.isArray(user.following) ? user.following.length : 0,
    },
    liveState,
    journey,
    microBehavior,
    interestProfile,
    engagement,
    friction,
    patterns,
    predictions,
    segmentTags,
    context,
    content,
    sessions: sessions.slice(0, 10).map((session) => ({
      key: session.key,
      startedAt: session.startedAt,
      lastSeenAt: session.lastSeenAt,
      durationMinutes: session.durationMinutes,
      currentPage: session.currentPage,
      currentPageLabel: formatPageLabel(session.currentPage),
      entryPage: session.entryPage,
      entryPageLabel: formatPageLabel(session.entryPage),
      deviceType: session.deviceType,
      browser: session.browser,
      country: session.country,
    })),
    liveFeed: liveState.liveFeed,
    timeline: buildUserTimeline(events),
    recentActivityCount: Math.min(events.length, RECENT_ACTIVITY_LIMIT),
  };
}

module.exports = {
  getFounderUserDirectory,
  getFounderUserIntelligence,
  __testables: {
    buildSegmentTags,
    buildPredictions,
    computeEngagementScore,
    detectFriction,
    detectPatterns,
    buildInterestProfile,
    buildMicroBehavior,
    buildJourneyView,
    getUsageBand,
  },
};
