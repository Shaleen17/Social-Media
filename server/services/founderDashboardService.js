const AnalyticsEvent = require("../models/AnalyticsEvent");
const User = require("../models/User");
const Post = require("../models/Post");
const Video = require("../models/Video");
const Conversation = require("../models/Message");
const { getMonitoringSnapshot } = require("./monitoringService");

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_WINDOW_MS = 15 * 60 * 1000;
const SESSION_WINDOW_MS = 48 * 60 * 60 * 1000;
const TREND_WINDOW_MS = 7 * DAY_MS;
const ANOMALY_WINDOW_MS = 30 * 60 * 1000;
const ACTIVITY_STREAM_LIMIT = 28;
const ACTIVE_SESSION_LIMIT = 12;
const SERIES_DAYS = 14;
const FEATURE_PAGES = [
  "home",
  "mandir",
  "mandirCommunity",
  "video",
  "reels",
  "search",
  "notifs",
  "chats",
  "profile",
];

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
  about: "About",
  authenticBrands: "Authentic Brands",
  language: "Language",
  helpSupport: "Help & Support",
  settingsPrivacy: "Settings & Privacy",
  founderControl: "Founder Control",
};

const FUNNEL_STEP_DEFINITIONS = {
  home: {
    label: "Home",
    match(entry) {
      return entry.kind === "page" && entry.page === "home";
    },
  },
  mandir_community: {
    label: "Mandir Community",
    match(entry) {
      return entry.kind === "page" && entry.page === "mandirCommunity";
    },
  },
  tirth_tube: {
    label: "Tirth Tube",
    match(entry) {
      return entry.kind === "page" && entry.page === "video";
    },
  },
  search: {
    label: "Search",
    match(entry) {
      return entry.kind === "page" && entry.page === "search";
    },
  },
  profile: {
    label: "Profile",
    match(entry) {
      return entry.kind === "page" && entry.page === "profile";
    },
  },
  chats: {
    label: "Chats",
    match(entry) {
      return entry.kind === "page" && entry.page === "chats";
    },
  },
  video_started: {
    label: "Video started",
    match(entry) {
      return entry.kind === "event" && entry.name === "video_started";
    },
  },
  video_completed: {
    label: "Video completed",
    match(entry) {
      return entry.kind === "event" && entry.name === "video_completed";
    },
  },
  chat_opened: {
    label: "Chat opened",
    match(entry) {
      return entry.kind === "event" && entry.name === "chat_opened";
    },
  },
  chat_message_sent: {
    label: "Message sent",
    match(entry) {
      return entry.kind === "event" && entry.name === "chat_message_sent";
    },
  },
  post_liked: {
    label: "Post liked",
    match(entry) {
      return entry.kind === "event" && entry.name === "post_liked";
    },
  },
  post_commented: {
    label: "Post commented",
    match(entry) {
      return entry.kind === "event" && entry.name === "post_commented";
    },
  },
  user_followed: {
    label: "User followed",
    match(entry) {
      return entry.kind === "event" && entry.name === "user_followed";
    },
  },
  auth_signup_verified: {
    label: "Sign-up verified",
    match(entry) {
      return entry.kind === "event" && entry.name === "auth_signup_verified";
    },
  },
};

const DEFAULT_FUNNEL_PRESETS = [
  {
    key: "home_to_video_complete",
    label: "Home -> Tirth Tube -> Completion",
    description: "How many seekers move from Home into a finished Tirth Tube watch.",
    steps: ["home", "tirth_tube", "video_started", "video_completed"],
  },
  {
    key: "mandir_to_follow",
    label: "Mandir -> Profile -> Follow",
    description: "Pilgrimage from community discovery into a relationship action.",
    steps: ["home", "mandir_community", "profile", "user_followed"],
  },
  {
    key: "chat_activation",
    label: "Home -> Chats -> First Message",
    description: "How many visitors open chats and cross into active conversation.",
    steps: ["home", "chats", "chat_opened", "chat_message_sent"],
  },
  {
    key: "search_to_follow",
    label: "Search -> Profile -> Follow",
    description: "How search journeys turn into meaningful connection.",
    steps: ["search", "profile", "user_followed"],
  },
];

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
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

function toIdString(value) {
  return String(value?._id || value?.id || value || "").trim();
}

function toDateValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function durationMinutes(from, to) {
  const start = toDateValue(from);
  const end = toDateValue(to);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function percentage(value, total, precision = 1) {
  if (!total) return 0;
  const result = (Number(value) / Number(total)) * 100;
  return Number(result.toFixed(precision));
}

function humanizeEventName(name = "") {
  return String(name || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
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

function compactText(value = "", maxLength = 140) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function sessionKeyFromEvent(event) {
  return (
    String(event?.sessionId || "").trim() ||
    String(event?.anonymousId || "").trim() ||
    toIdString(event?.user) ||
    toIdString(event?._id)
  );
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

function actorFromEvent(event) {
  const user = event?.user && typeof event.user === "object" ? event.user : null;
  if (user) {
    return {
      id: toIdString(user),
      label: user.name || user.handle || "User",
      handle: user.handle ? `@${user.handle}` : "",
      avatar: user.avatar || "",
      isGuest: false,
      createdAt: user.createdAt || null,
    };
  }

  const anonSource = String(event?.anonymousId || event?.sessionId || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(-6);

  return {
    id: sessionKeyFromEvent(event),
    label: anonSource ? `Guest ${anonSource}` : "Guest visitor",
    handle: "",
    avatar: "",
    isGuest: true,
    createdAt: null,
  };
}

function mapDistribution(rows = [], total = 0) {
  return rows
    .filter((row) => row && row._id !== null && row._id !== "")
    .map((row) => ({
      label: String(row._id || "Unknown"),
      count: Number(row.count) || 0,
      share: percentage(Number(row.count) || 0, total || 0),
    }));
}

function fillDailySeries(rows = [], days = SERIES_DAYS, now = new Date()) {
  const counts = new Map(
    rows.map((row) => [String(row._id || row.date), Number(row.count) || 0])
  );
  const series = [];
  const start = startOfDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  for (let index = 0; index < days; index += 1) {
    const day = new Date(start.getTime() + index * DAY_MS);
    const key = day.toISOString().slice(0, 10);
    series.push({
      date: key,
      count: counts.get(key) || 0,
      label: day.toLocaleDateString("en", {
        month: "short",
        day: "numeric",
      }),
    });
  }
  return series;
}

function buildSessionSummaries(events = [], liveSince = new Date()) {
  const orderedEvents = [...events].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
  const sessions = new Map();

  orderedEvents.forEach((event) => {
    const key = sessionKeyFromEvent(event);
    if (!key) return;
    const createdAt = toDateValue(event.createdAt);
    if (!createdAt) return;
    const currentPage = pageFromEvent(event);
    const context = event.meta?.context || {};
    const actor = actorFromEvent(event);
    const existing =
      sessions.get(key) ||
      {
        key,
        actor,
        startedAt: createdAt,
        lastSeenAt: createdAt,
        entryPage: currentPage,
        currentPage,
        eventCount: 0,
        deviceType: context.deviceType || "unknown",
        browser: context.browser || "Unknown",
        country: context.country || "Unknown",
      };

    existing.lastSeenAt = createdAt;
    existing.currentPage = currentPage;
    existing.eventCount += 1;
    if (!existing.entryPage) existing.entryPage = currentPage;
    if (actor?.createdAt && !existing.actor?.createdAt) {
      existing.actor.createdAt = actor.createdAt;
    }
    if (!existing.deviceType && context.deviceType) existing.deviceType = context.deviceType;
    if (!existing.browser && context.browser) existing.browser = context.browser;
    if (!existing.country && context.country) existing.country = context.country;
    sessions.set(key, existing);
  });

  const allSessions = Array.from(sessions.values()).map((session) => ({
    ...session,
    durationMinutes: durationMinutes(session.startedAt, session.lastSeenAt),
    isLive: toDateValue(session.lastSeenAt)?.getTime() >= liveSince.getTime(),
  }));

  const liveSessions = allSessions
    .filter((session) => session.isLive)
    .sort(
      (left, right) =>
        new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime()
    );

  return {
    allSessions,
    liveSessions,
  };
}

function buildActivityStream(events = []) {
  const ignoredNames = new Set(["session_heartbeat", "page_duration"]);

  return events
    .filter((event) => !ignoredNames.has(String(event.name || "")))
    .slice(0, ACTIVITY_STREAM_LIMIT)
    .map((event) => {
      const actor = actorFromEvent(event);
      const meta = event.meta || {};
      const page = pageFromEvent(event);
      let title = humanizeEventName(event.name);
      let detail = "";
      let icon = "wave";

      switch (event.name) {
        case "initial_page_view":
        case "virtual_page_view":
          title = `Viewed ${formatPageLabel(page)}`;
          detail = meta.path || event.path || "";
          icon = "eye";
          break;
        case "page_transition":
          title = `Moved from ${formatPageLabel(meta.fromPage)} to ${formatPageLabel(meta.toPage)}`;
          detail = "Navigation flow";
          icon = "path";
          break;
        case "auth_login":
          title = "Signed in";
          detail = meta.provider ? `Provider: ${meta.provider}` : "Account session started";
          icon = "login";
          break;
        case "auth_signup_verified":
          title = "Joined and verified";
          detail = "New account entered the sangha";
          icon = "spark";
          break;
        case "auth_logout":
          title = "Signed out";
          detail = "Session ended";
          icon = "moon";
          break;
        case "post_created":
          title = "Created a post";
          detail = meta.preview || compactText(meta.text || "", 90);
          icon = "post";
          break;
        case "post_liked":
          title = "Liked a post";
          detail = meta.postId ? `Post ${String(meta.postId).slice(-6)}` : "Engagement";
          icon = "heart";
          break;
        case "post_commented":
          title = "Commented on a post";
          detail = compactText(meta.preview || meta.comment || "", 90);
          icon = "comment";
          break;
        case "post_reposted":
          title = "Shared a post";
          detail = meta.postId ? `Post ${String(meta.postId).slice(-6)}` : "Engagement";
          icon = "repost";
          break;
        case "video_uploaded":
          title = "Uploaded a video";
          detail = compactText(meta.title || "", 90);
          icon = "video";
          break;
        case "video_started":
          title = "Started watching a video";
          detail = compactText(meta.videoTitle || meta.videoId || "", 90);
          icon = "play";
          break;
        case "video_completed":
          title = "Completed a video";
          detail = compactText(meta.videoTitle || meta.videoId || "", 90);
          icon = "play";
          break;
        case "chat_message_sent":
          title = "Sent a chat message";
          detail = compactText(meta.preview || "", 90);
          icon = "chat";
          break;
        case "conversation_started":
          title = "Started a conversation";
          detail = meta.targetHandle ? `With @${meta.targetHandle}` : "New direct message";
          icon = "chat";
          break;
        case "group_created":
          title = "Created a group chat";
          detail = meta.name || "New group conversation";
          icon = "group";
          break;
        case "user_followed":
          title = "Started following someone";
          detail = meta.targetHandle ? `Following @${meta.targetHandle}` : "Follower graph changed";
          icon = "follow";
          break;
        case "largest_contentful_paint":
          title = "Experienced slow page load";
          detail = meta.value ? `LCP ${meta.value}ms` : "Performance event";
          icon = "bolt";
          break;
        default:
          if (event.type === "error") {
            title = "Hit an error";
            detail = compactText(meta.message || event.name || "Client error", 110);
            icon = "alert";
          } else {
            detail = compactText(meta.preview || meta.message || meta.path || "", 110);
          }
          break;
      }

      return {
        id: toIdString(event),
        ts: event.createdAt,
        ageLabel: formatRelativeTime(event.createdAt),
        page,
        title,
        detail,
        icon,
        actor,
      };
    });
}

function buildRecommendations(input) {
  const recommendations = [];

  const topPage = input.pageAnalytics.byPage[0];
  if (topPage && topPage.avgDurationSeconds >= 45) {
    recommendations.push(
      `${formatPageLabel(topPage.page)} is holding attention best right now. Consider reusing its content pattern elsewhere.`
    );
  }

  const dropOff = input.journey.dropOffPages[0];
  if (dropOff && dropOff.count >= 3) {
    recommendations.push(
      `${formatPageLabel(dropOff.page)} is the strongest drop-off point. Review that page's clarity, load speed, and first visible action.`
    );
  }

  const ignoredFeature = input.userBehavior.ignoredFeatures[0];
  if (ignoredFeature && ignoredFeature.visits <= 3) {
    recommendations.push(
      `${formatPageLabel(ignoredFeature.page)} is getting very little attention. It may need stronger entry points or simpler positioning.`
    );
  }

  if (input.health.avgLcpMs && input.health.avgLcpMs > 2500) {
    recommendations.push(
      "Average load performance is slipping above 2.5s LCP. Prioritize media weight and the slowest routes before adding heavier UI."
    );
  }

  const trendingTag = input.trending.hashtags[0];
  if (trendingTag) {
    recommendations.push(
      `${trendingTag.tag} is the strongest rising topic. Surface it in discovery, prompts, or community calls to action.`
    );
  }

  const errorSpike = input.health.recentErrors[0];
  if (errorSpike) {
    recommendations.push(
      `Recent platform errors are still appearing on ${errorSpike.path || "the app shell"}. Fixing this flow will likely improve trust quickly.`
    );
  }

  return recommendations.slice(0, 4);
}

function bucketHourBand(hour) {
  const value = Number(hour);
  if (!Number.isFinite(value) || value < 0) return "Varied";
  if (value >= 4 && value <= 8) return "Morning";
  if (value >= 9 && value <= 15) return "Daytime";
  if (value >= 16 && value <= 21) return "Evening";
  return "Night";
}

function percentageChange(current = 0, previous = 0, precision = 1) {
  const left = Number(current) || 0;
  const right = Number(previous) || 0;
  if (!right) {
    return left > 0 ? 100 : 0;
  }
  return Number((((left - right) / right) * 100).toFixed(precision));
}

function buildWindowMetrics(events = [], from, to) {
  const start = toDateValue(from);
  const end = toDateValue(to);
  if (!start || !end) {
    return {
      pageViews: 0,
      videoStarts: 0,
      videoCompletions: 0,
      chatMessages: 0,
      follows: 0,
      signups: 0,
      errors: 0,
      exits: 0,
    };
  }

  const rows = events.filter((event) => {
    const createdAt = toDateValue(event.createdAt);
    return createdAt && createdAt >= start && createdAt < end;
  });

  return {
    pageViews: rows.filter((event) => event.type === "page_view").length,
    videoStarts: rows.filter((event) => String(event.name) === "video_started").length,
    videoCompletions: rows.filter((event) => String(event.name) === "video_completed").length,
    chatMessages: rows.filter((event) => String(event.name) === "chat_message_sent").length,
    follows: rows.filter((event) => String(event.name) === "user_followed").length,
    signups: rows.filter((event) => String(event.name) === "auth_signup_verified").length,
    errors: rows.filter((event) => event.type === "error").length,
    exits: rows.filter((event) =>
      ["session_exit", "session_hidden"].includes(String(event.name || ""))
    ).length,
  };
}

function buildAnomalyCard({
  severity = "watch",
  title = "",
  summary = "",
  metric = "",
  current = 0,
  previous = 0,
  nextMove = "",
}) {
  return {
    severity,
    title,
    summary,
    metric,
    current: Number(current) || 0,
    previous: Number(previous) || 0,
    deltaPercent: percentageChange(current, previous),
    nextMove,
  };
}

function buildSessionEventMap(events = []) {
  const ordered = [...events].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
  const sessionMap = new Map();

  ordered.forEach((event) => {
    const key = sessionKeyFromEvent(event);
    if (!key) return;
    if (!sessionMap.has(key)) {
      sessionMap.set(key, []);
    }
    sessionMap.get(key).push(event);
  });

  return sessionMap;
}

function mapFunnelEntries(events = []) {
  const entries = [];
  const seenPageKeys = new Set();

  events.forEach((event) => {
    const page = pageFromEvent(event);
    const name = String(event?.name || "").trim();
    const createdAt = event.createdAt;

    if (event.type === "page_view" && page && page !== "unknown") {
      const pageKey = `page:${page}:${createdAt}`;
      if (!seenPageKeys.has(pageKey)) {
        seenPageKeys.add(pageKey);
        entries.push({
          kind: "page",
          page,
          ts: createdAt,
        });
      }
    }

    if (name === "page_transition") {
      const toPage = String(event?.meta?.toPage || page || "").trim();
      if (toPage) {
        entries.push({
          kind: "page",
          page: toPage,
          ts: createdAt,
        });
      }
    }

    if (name) {
      entries.push({
        kind: "event",
        name,
        page,
        ts: createdAt,
      });
    }
  });

  return entries;
}

function getFunnelStepCatalog() {
  return Object.entries(FUNNEL_STEP_DEFINITIONS).map(([key, value]) => ({
    key,
    label: value.label,
  }));
}

function normalizeFunnelSteps(steps = []) {
  return steps
    .map((step) => String(step || "").trim())
    .filter((step) => !!FUNNEL_STEP_DEFINITIONS[step])
    .slice(0, 5);
}

function buildFunnelSnapshot({
  sessionEventMap = new Map(),
  steps = [],
  label = "Custom funnel",
  description = "",
  key = "custom",
} = {}) {
  const normalizedSteps = normalizeFunnelSteps(steps);
  const sessionEntries = Array.from(sessionEventMap.values()).map(mapFunnelEntries);
  const totalSessions = sessionEntries.length;
  let remainingEntries = sessionEntries;

  const stageCounts = normalizedSteps.map((step) => {
    const definition = FUNNEL_STEP_DEFINITIONS[step];
    const nextRemaining = [];
    let matched = 0;

    remainingEntries.forEach((entries) => {
      const hitIndex = entries.findIndex((entry) => definition.match(entry));
      if (hitIndex >= 0) {
        matched += 1;
        nextRemaining.push(entries.slice(hitIndex + 1));
      }
    });

    remainingEntries = nextRemaining;
    return {
      key: step,
      label: definition.label,
      count: matched,
      conversionFromStart: percentage(matched, totalSessions || 0),
    };
  });

  const dropOffs = stageCounts.slice(1).map((stage, index) => ({
    from: stageCounts[index].label,
    to: stage.label,
    lost: Math.max(0, (stageCounts[index].count || 0) - (stage.count || 0)),
  }));

  const topDrop = [...dropOffs].sort((left, right) => right.lost - left.lost)[0] || null;

  return {
    key,
    label,
    description,
    steps: stageCounts,
    totalSessions,
    completionCount: stageCounts[stageCounts.length - 1]?.count || 0,
    completionRate: percentage(
      stageCounts[stageCounts.length - 1]?.count || 0,
      totalSessions || 0
    ),
    topDrop,
  };
}

function buildCohortComparisons({
  recentEvents = [],
  live = {},
  context = {},
  repeatVsNew = {},
} = {}) {
  const timeBandMap = recentEvents.reduce((map, event) => {
    const band = bucketHourBand(event?.meta?.localHour);
    map.set(band, (map.get(band) || 0) + 1);
    return map;
  }, new Map());

  const userBehaviorMap = new Map();
  recentEvents.forEach((event) => {
    const userKey = toIdString(event.user) || sessionKeyFromEvent(event);
    if (!userKey) return;
    const current =
      userBehaviorMap.get(userKey) || {
        creations: 0,
        social: 0,
        video: 0,
      };
    const name = String(event?.name || "");
    if (["post_created", "video_uploaded", "group_created"].includes(name)) current.creations += 1;
    if (["chat_message_sent", "post_commented", "user_followed"].includes(name)) current.social += 1;
    if (["video_started", "video_completed", "video_progress"].includes(name)) current.video += 1;
    userBehaviorMap.set(userKey, current);
  });

  const behaviorSegments = Array.from(userBehaviorMap.values()).reduce(
    (acc, row) => {
      if (row.creations >= 1) acc.contributors += 1;
      else if (row.social >= 2) acc.social += 1;
      else if (row.video >= 2) acc.watchers += 1;
      else acc.observers += 1;
      return acc;
    },
    {
      contributors: 0,
      social: 0,
      watchers: 0,
      observers: 0,
    }
  );

  return {
    audienceMix: [
      {
        label: "Returning users",
        count: Number(repeatVsNew.returningUsers) || 0,
      },
      {
        label: "New users",
        count: Number(repeatVsNew.newUsers) || 0,
      },
      {
        label: "Online signed-in",
        count: Number(live.onlineSignedInUsers) || 0,
      },
      {
        label: "Live guests",
        count: Math.max(0, (Number(live.activePeople) || 0) - (Number(live.onlineSignedInUsers) || 0)),
      },
    ],
    devices: Array.isArray(context.devices) ? context.devices.slice(0, 4) : [],
    timeBands: Array.from(timeBandMap.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count),
    behaviorSegments: [
      { label: "Contributors", count: behaviorSegments.contributors },
      { label: "Social engagers", count: behaviorSegments.social },
      { label: "Video-first seekers", count: behaviorSegments.watchers },
      { label: "Silent observers", count: behaviorSegments.observers },
    ],
  };
}

function buildAnomalies({
  recentEvents = [],
  pageAnalytics = {},
  journey = {},
  live = {},
  health = {},
} = {}) {
  const now = new Date();
  const currentWindowStart = new Date(now.getTime() - ANOMALY_WINDOW_MS);
  const previousWindowStart = new Date(now.getTime() - ANOMALY_WINDOW_MS * 2);
  const currentMetrics = buildWindowMetrics(recentEvents, currentWindowStart, now);
  const previousMetrics = buildWindowMetrics(recentEvents, previousWindowStart, currentWindowStart);

  const alerts = [];
  const pushIf = (condition, card) => {
    if (condition) alerts.push(card);
  };

  pushIf(
    currentMetrics.errors >= Math.max(2, previousMetrics.errors + 1),
    buildAnomalyCard({
      severity: "high",
      title: "Error pulse is rising",
      summary: "Client-side errors increased in the most recent live window.",
      metric: "Errors",
      current: currentMetrics.errors,
      previous: previousMetrics.errors,
      nextMove: "Inspect the freshest broken path before behavior shifts compound.",
    })
  );

  pushIf(
    currentMetrics.exits >= Math.max(3, previousMetrics.exits + 2),
    buildAnomalyCard({
      severity: "high",
      title: "Drop-off spike detected",
      summary: "More sessions are ending abruptly in the latest activity window.",
      metric: "Session exits",
      current: currentMetrics.exits,
      previous: previousMetrics.exits,
      nextMove: "Check the top exit page and the first visible action there.",
    })
  );

  pushIf(
    health.avgLcpMs > 2500,
    buildAnomalyCard({
      severity: "watch",
      title: "Load speed is slipping",
      summary: "The average Largest Contentful Paint is above the healthy range.",
      metric: "Average LCP",
      current: health.avgLcpMs,
      previous: 2500,
      nextMove: "Reduce media weight and simplify the heaviest landing surfaces first.",
    })
  );

  const topDropOff = Array.isArray(journey.dropOffPages) ? journey.dropOffPages[0] : null;
  if (topDropOff && Number(topDropOff.count || 0) >= 4) {
    alerts.push(
      buildAnomalyCard({
        severity: "watch",
        title: "Repeated friction hotspot",
        summary: `${topDropOff.label || topDropOff.page} is absorbing the strongest exit pressure.`,
        metric: "Drop-offs",
        current: topDropOff.count,
        previous: 0,
        nextMove: "Audit clarity, CTA prominence, and perceived load on that page.",
      })
    );
  }

  pushIf(
    currentMetrics.videoStarts > 0 &&
      currentMetrics.videoCompletions <= Math.floor(currentMetrics.videoStarts / 3),
    buildAnomalyCard({
      severity: "watch",
      title: "Video completion is thinning",
      summary: "Many seekers start videos, but far fewer stay to completion.",
      metric: "Video completions",
      current: currentMetrics.videoCompletions,
      previous: currentMetrics.videoStarts,
      nextMove: "Tighten the first 10 seconds and move the clearest value promise higher.",
    })
  );

  pushIf(
    Number(live.activeSessions) === 0 && Number(live.visitorsToday) > 0,
    buildAnomalyCard({
      severity: "watch",
      title: "No live sessions right now",
      summary: "Today has activity, but the current live window is unusually quiet.",
      metric: "Live sessions",
      current: live.activeSessions,
      previous: 1,
      nextMove: "Check whether the current daypart normally shows low activity or if a delivery path is broken.",
    })
  );

  return alerts.slice(0, 6);
}

function buildReleaseImpact({ recentEvents = [], growth = {}, health = {}, live = {} } = {}) {
  const now = new Date();
  const current24Start = new Date(now.getTime() - DAY_MS);
  const previous24Start = new Date(now.getTime() - 2 * DAY_MS);
  const current24 = buildWindowMetrics(recentEvents, current24Start, now);
  const previous24 = buildWindowMetrics(recentEvents, previous24Start, current24Start);

  const metrics = [
    ["Page views", current24.pageViews, previous24.pageViews],
    ["Video starts", current24.videoStarts, previous24.videoStarts],
    ["Video completions", current24.videoCompletions, previous24.videoCompletions],
    ["Chat messages", current24.chatMessages, previous24.chatMessages],
    ["New signups", current24.signups, previous24.signups],
    ["Errors", current24.errors, previous24.errors],
  ].map(([label, current, previous]) => ({
    label,
    current,
    previous,
    deltaPercent: percentageChange(current, previous),
    direction:
      current > previous ? "up" : current < previous ? "down" : "flat",
  }));

  return {
    label: "Last 24h vs previous 24h",
    releaseHealth:
      health.avgLcpMs > 2500 || current24.errors > previous24.errors
        ? "Watch closely"
        : "Stable",
    activeNow: Number(live.activeSessions) || 0,
    metrics,
    summary:
      metrics.find((metric) => Math.abs(metric.deltaPercent) >= 20 && metric.label !== "Errors")
        ?.label || "No major behavior swing yet",
  };
}

function buildDecisionEngine({
  anomalies = [],
  funnels = {},
  recommendations = [],
  trending = {},
  health = {},
  cohorts = {},
} = {}) {
  const decisions = [];

  anomalies.forEach((item) => {
    decisions.push({
      severity: item.severity,
      title: item.title,
      evidence: `${item.metric}: ${item.current} now vs ${item.previous} before (${item.deltaPercent}%).`,
      action: item.nextMove,
    });
  });

  const weakestFunnel = Array.isArray(funnels.presets)
    ? [...funnels.presets].sort((left, right) => left.completionRate - right.completionRate)[0]
    : null;
  if (weakestFunnel) {
    decisions.push({
      severity: "watch",
      title: `${weakestFunnel.label} is leaking`,
      evidence: `${weakestFunnel.completionRate}% of tracked sessions complete this path.`,
      action: weakestFunnel.topDrop
        ? `Reduce friction between ${weakestFunnel.topDrop.from} and ${weakestFunnel.topDrop.to}.`
        : "Inspect this journey step-by-step and simplify the clearest break point.",
    });
  }

  const strongestTrend = Array.isArray(trending.hashtags) ? trending.hashtags[0] : null;
  if (strongestTrend) {
    decisions.push({
      severity: "opportunity",
      title: `${strongestTrend.tag} is pulling attention`,
      evidence: `${strongestTrend.count} recent hashtag mentions across content.`,
      action: "Lift this theme higher in discovery surfaces and relevant calls to action.",
    });
  }

  const topBehavior = Array.isArray(cohorts.behaviorSegments)
    ? [...cohorts.behaviorSegments].sort((left, right) => right.count - left.count)[0]
    : null;
  if (topBehavior) {
    decisions.push({
      severity: "info",
      title: `${topBehavior.label} lead current activity`,
      evidence: `${topBehavior.count} recently active seekers fit this behavior pattern.`,
      action: "Tune onboarding and prompts for the largest active segment first.",
    });
  }

  if (health.avgLcpMs > 2500) {
    decisions.push({
      severity: "high",
      title: "Performance is shaping behavior",
      evidence: `Average LCP is ${health.avgLcpMs}ms.`,
      action: "Prioritize page weight and route responsiveness before adding more interface load.",
    });
  }

  recommendations.forEach((item) => {
    decisions.push({
      severity: "info",
      title: "Founder next move",
      evidence: compactText(item, 120),
      action: "Use this signal as the next product review starting point.",
    });
  });

  return decisions.slice(0, 8);
}

function buildFounderBadge({ live = {}, anomalies = [], trending = {}, decisionEngine = [] } = {}) {
  const strongestTrend = Array.isArray(trending.hashtags) ? trending.hashtags[0] : null;
  const topDecision = Array.isArray(decisionEngine) ? decisionEngine[0] : null;
  const highAlerts = anomalies.filter((item) => item.severity === "high").length;

  return {
    activeUsers: Number(live.activePeople) || 0,
    alertCount: anomalies.length,
    highAlertCount: highAlerts,
    status: highAlerts ? "alert" : anomalies.length ? "watch" : "calm",
    pulseLabel: strongestTrend?.tag || topDecision?.title || "Founder pulse steady",
  };
}

async function getFounderButtonPulse({ app } = {}) {
  const now = new Date();
  const liveSince = new Date(now.getTime() - LIVE_WINDOW_MS);
  const recentSince = new Date(now.getTime() - ANOMALY_WINDOW_MS * 2);
  const socketState = app?.get?.("socketState");
  const onlineUserIds = socketState?.getOnlineUserIds
    ? await socketState.getOnlineUserIds().catch(() => [])
    : [];

  const [recentEvents, trendingRows] = await Promise.all([
    AnalyticsEvent.find({ createdAt: { $gte: recentSince } })
      .sort({ createdAt: -1 })
      .limit(600)
      .select("type name page meta sessionId anonymousId user createdAt")
      .lean(),
    Post.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
          hashtags: { $exists: true, $ne: [] },
          "moderation.status": { $ne: "needs_review" },
        },
      },
      { $unwind: "$hashtags" },
      { $group: { _id: "$hashtags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]),
  ]);

  const { liveSessions } = buildSessionSummaries(recentEvents, liveSince);
  const livePeopleKeys = new Set(
    liveSessions.map((session) => (session.actor?.isGuest ? session.key : session.actor.id))
  );
  const anomalies = buildAnomalies({
    recentEvents,
    live: {
      activePeople: livePeopleKeys.size,
      activeSessions: liveSessions.length,
      onlineSignedInUsers: Array.isArray(onlineUserIds) ? onlineUserIds.length : 0,
      visitorsToday: 0,
    },
    health: { avgLcpMs: 0 },
    pageAnalytics: {},
    journey: {},
  });

  return buildFounderBadge({
    live: {
      activePeople: livePeopleKeys.size,
      onlineSignedInUsers: Array.isArray(onlineUserIds) ? onlineUserIds.length : 0,
    },
    anomalies,
    trending: {
      hashtags: trendingRows.map((row) => ({ tag: row._id, count: row.count })),
    },
    decisionEngine: [],
  });
}

async function getFounderFunnel({ steps = [], since = null } = {}) {
  const safeSteps = normalizeFunnelSteps(steps);
  const from = since ? toDateValue(since) : new Date(Date.now() - 7 * DAY_MS);
  const events = await AnalyticsEvent.find({
    createdAt: { $gte: from || new Date(Date.now() - 7 * DAY_MS) },
  })
    .sort({ createdAt: 1 })
    .select("type name page meta sessionId anonymousId user createdAt")
    .lean();

  return buildFunnelSnapshot({
    sessionEventMap: buildSessionEventMap(events),
    steps: safeSteps.length ? safeSteps : DEFAULT_FUNNEL_PRESETS[0].steps,
    label: "Custom funnel",
    description: "Founder-built funnel from live event flow.",
    key: "custom",
  });
}

async function getFounderOverview({ app } = {}) {
  const now = new Date();
  const liveSince = new Date(now.getTime() - LIVE_WINDOW_MS);
  const sessionSince = new Date(now.getTime() - SESSION_WINDOW_MS);
  const todayStart = startOfDay(now);
  const weekSince = new Date(now.getTime() - TREND_WINDOW_MS);
  const monthSince = new Date(now.getTime() - 30 * DAY_MS);
  const previousMonthSince = new Date(now.getTime() - 60 * DAY_MS);

  const socketState = app?.get?.("socketState");
  const onlineUserIds = socketState?.getOnlineUserIds
    ? await socketState.getOnlineUserIds().catch(() => [])
    : [];

  const [
    recentEvents,
    pageAnalyticsFacet,
    growthFacet,
    signupSeriesRows,
    contextFacet,
    trendingHashtags,
    topPosts,
    topVideos,
    postTotals,
    videoTotals,
    messageFacet,
    moderationFacet,
    newUsersToday,
    newUsersWeek,
  ] = await Promise.all([
    AnalyticsEvent.find({ createdAt: { $gte: sessionSince } })
      .sort({ createdAt: -1 })
      .limit(2000)
      .populate("user", "name handle avatar email createdAt")
      .lean(),
    AnalyticsEvent.aggregate([
      { $match: { createdAt: { $gte: weekSince } } },
      {
        $facet: {
          visits: [
            { $match: { type: "page_view" } },
            { $group: { _id: "$page", visits: { $sum: 1 } } },
          ],
          durations: [
            { $match: { type: "interaction", name: "page_duration" } },
            {
              $group: {
                _id: {
                  $ifNull: [
                    "$page",
                    { $ifNull: ["$meta.page", "unknown"] },
                  ],
                },
                totalMs: {
                  $sum: {
                    $convert: {
                      input: "$meta.durationMs",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                },
                avgMs: {
                  $avg: {
                    $convert: {
                      input: "$meta.durationMs",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                },
                samples: { $sum: 1 },
              },
            },
          ],
          entries: [
            { $match: { type: "page_view", name: "initial_page_view" } },
            { $group: { _id: "$page", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          exits: [
            {
              $match: {
                type: "interaction",
                name: { $in: ["session_hidden", "session_exit"] },
              },
            },
            {
              $group: {
                _id: {
                  $ifNull: [
                    "$page",
                    { $ifNull: ["$meta.page", "unknown"] },
                  ],
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
          ],
          transitions: [
            { $match: { type: "interaction", name: "page_transition" } },
            {
              $group: {
                _id: {
                  from: "$meta.fromPage",
                  to: "$meta.toPage",
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 12 },
          ],
        },
      },
    ]),
    AnalyticsEvent.aggregate([
      {
        $match: {
          createdAt: { $gte: previousMonthSince },
          user: { $ne: null },
        },
      },
      {
        $facet: {
          dau: [
            { $match: { createdAt: { $gte: todayStart } } },
            { $group: { _id: "$user" } },
            { $count: "count" },
          ],
          wau: [
            { $match: { createdAt: { $gte: new Date(now.getTime() - 7 * DAY_MS) } } },
            { $group: { _id: "$user" } },
            { $count: "count" },
          ],
          mau: [
            { $match: { createdAt: { $gte: monthSince } } },
            { $group: { _id: "$user" } },
            { $count: "count" },
          ],
          currentUsers: [
            { $match: { createdAt: { $gte: monthSince } } },
            { $group: { _id: "$user" } },
          ],
          previousUsers: [
            {
              $match: {
                createdAt: { $gte: previousMonthSince, $lt: monthSince },
              },
            },
            { $group: { _id: "$user" } },
          ],
          dailyActive: [
            {
              $group: {
                _id: {
                  date: {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$createdAt",
                    },
                  },
                  user: "$user",
                },
              },
            },
            {
              $group: {
                _id: "$_id.date",
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]),
    User.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(now.getTime() - SERIES_DAYS * DAY_MS) },
          accountStatus: "active",
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    AnalyticsEvent.aggregate([
      { $match: { createdAt: { $gte: weekSince } } },
      {
        $facet: {
          devices: [
            { $match: { type: "page_view" } },
            {
              $group: {
                _id: { $ifNull: ["$meta.context.deviceType", "Unknown"] },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 6 },
          ],
          browsers: [
            { $match: { type: "page_view" } },
            {
              $group: {
                _id: { $ifNull: ["$meta.context.browser", "Unknown"] },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 6 },
          ],
          countries: [
            { $match: { type: "page_view" } },
            {
              $group: {
                _id: { $ifNull: ["$meta.context.country", "Unknown"] },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 6 },
          ],
          hours: [
            { $match: { type: "page_view" } },
            {
              $group: {
                _id: { $ifNull: ["$meta.localHour", -1] },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 6 },
          ],
          performance: [
            { $match: { type: "performance" } },
            {
              $group: {
                _id: "$name",
                avgValue: {
                  $avg: {
                    $convert: {
                      input: "$meta.value",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]),
    Promise.all([
      Post.aggregate([
        {
          $match: {
            createdAt: { $gte: weekSince },
            hashtags: { $exists: true, $ne: [] },
            "moderation.status": { $ne: "needs_review" },
          },
        },
        { $unwind: "$hashtags" },
        { $group: { _id: "$hashtags", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
      ]),
      Video.aggregate([
        {
          $match: {
            createdAt: { $gte: weekSince },
            hashtags: { $exists: true, $ne: [] },
            "moderation.status": { $ne: "needs_review" },
          },
        },
        { $unwind: "$hashtags" },
        { $group: { _id: "$hashtags", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
      ]),
    ]).then(([postTags, videoTags]) => {
      const combined = new Map();
      [...postTags, ...videoTags].forEach((item) => {
        const key = String(item._id || "").trim();
        if (!key) return;
        combined.set(key, (combined.get(key) || 0) + (Number(item.count) || 0));
      });
      return Array.from(combined.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 8);
    }),
    Post.aggregate([
      {
        $match: {
          "moderation.status": { $ne: "needs_review" },
        },
      },
      {
        $addFields: {
          likesCount: { $size: { $ifNull: ["$likes", []] } },
          commentsCount: { $size: { $ifNull: ["$comments", []] } },
          repostsCount: { $size: { $ifNull: ["$reposts", []] } },
        },
      },
      {
        $addFields: {
          engagementScore: {
            $add: ["$likesCount", "$commentsCount", "$repostsCount"],
          },
        },
      },
      { $sort: { engagementScore: -1, createdAt: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "userDoc",
        },
      },
      {
        $project: {
          text: 1,
          hashtags: 1,
          createdAt: 1,
          likesCount: 1,
          commentsCount: 1,
          repostsCount: 1,
          engagementScore: 1,
          user: {
            $let: {
              vars: { firstUser: { $arrayElemAt: ["$userDoc", 0] } },
              in: {
                _id: "$$firstUser._id",
                name: "$$firstUser.name",
                handle: "$$firstUser.handle",
                avatar: "$$firstUser.avatar",
              },
            },
          },
        },
      },
    ]),
    Video.aggregate([
      {
        $match: {
          "moderation.status": { $ne: "needs_review" },
        },
      },
      {
        $addFields: {
          likesCount: { $size: { $ifNull: ["$likes", []] } },
          commentsCount: { $size: { $ifNull: ["$comments", []] } },
        },
      },
      {
        $addFields: {
          engagementScore: {
            $add: ["$likesCount", "$commentsCount", { $ifNull: ["$views", 0] }],
          },
        },
      },
      { $sort: { engagementScore: -1, createdAt: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "userDoc",
        },
      },
      {
        $project: {
          title: 1,
          category: 1,
          views: 1,
          hashtags: 1,
          createdAt: 1,
          likesCount: 1,
          commentsCount: 1,
          engagementScore: 1,
          user: {
            $let: {
              vars: { firstUser: { $arrayElemAt: ["$userDoc", 0] } },
              in: {
                _id: "$$firstUser._id",
                name: "$$firstUser.name",
                handle: "$$firstUser.handle",
                avatar: "$$firstUser.avatar",
              },
            },
          },
        },
      },
    ]),
    Post.aggregate([
      {
        $group: {
          _id: null,
          totalPosts: { $sum: 1 },
          likes: { $sum: { $size: { $ifNull: ["$likes", []] } } },
          comments: { $sum: { $size: { $ifNull: ["$comments", []] } } },
          reposts: { $sum: { $size: { $ifNull: ["$reposts", []] } } },
        },
      },
    ]),
    Video.aggregate([
      {
        $group: {
          _id: null,
          totalVideos: { $sum: 1 },
          totalViews: { $sum: { $ifNull: ["$views", 0] } },
          liveNow: {
            $sum: {
              $cond: [{ $eq: ["$isLive", true] }, 1, 0],
            },
          },
        },
      },
    ]),
    Conversation.aggregate([
      {
        $facet: {
          messagesToday: [
            { $unwind: "$messages" },
            {
              $match: {
                "messages.createdAt": { $gte: todayStart },
                "messages.deletedForEveryone": { $ne: true },
              },
            },
            { $count: "count" },
          ],
          activeConversations: [
            { $match: { lastMessageAt: { $gte: todayStart } } },
            { $count: "count" },
          ],
          reviewMessages: [
            { $unwind: "$messages" },
            { $match: { "messages.moderationStatus": "needs_review" } },
            { $count: "count" },
          ],
        },
      },
    ]),
    Promise.all([
      Post.countDocuments({ "moderation.status": "needs_review" }),
      Video.countDocuments({ "moderation.status": "needs_review" }),
    ]),
    User.countDocuments({
      createdAt: { $gte: todayStart },
      accountStatus: "active",
    }),
    User.countDocuments({
      createdAt: { $gte: weekSince },
      accountStatus: "active",
    }),
  ]);

  const pageAnalyticsData = pageAnalyticsFacet[0] || {};
  const growthData = growthFacet[0] || {};
  const contextData = contextFacet[0] || {};
  const messageData = messageFacet[0] || {};
  const postTotalRow = postTotals[0] || {};
  const videoTotalRow = videoTotals[0] || {};
  const monitoring = getMonitoringSnapshot();

  const { liveSessions } = buildSessionSummaries(recentEvents, liveSince);
  const todayEvents = recentEvents.filter(
    (event) => new Date(event.createdAt).getTime() >= todayStart.getTime()
  );
  const todayVisitorKeys = new Set(todayEvents.map(sessionKeyFromEvent).filter(Boolean));
  const todayUserIds = new Set(todayEvents.map((event) => toIdString(event.user)).filter(Boolean));
  const livePeopleKeys = new Set(
    liveSessions.map((session) =>
      session.actor?.isGuest ? session.key : session.actor.id
    )
  );
  const recentLogins = todayEvents
    .filter((event) => ["auth_login", "auth_signup_verified"].includes(String(event.name)))
    .slice(0, 8)
    .map((event) => ({
      ts: event.createdAt,
      ageLabel: formatRelativeTime(event.createdAt),
      actor: actorFromEvent(event),
      provider: event.meta?.provider || "local",
      name: event.name,
    }));

  const currentActiveUserIds = new Set(
    (growthData.currentUsers || []).map((row) => toIdString(row._id))
  );
  const previousActiveUserIds = new Set(
    (growthData.previousUsers || []).map((row) => toIdString(row._id))
  );
  let retainedUsers = 0;
  currentActiveUserIds.forEach((userId) => {
    if (previousActiveUserIds.has(userId)) retainedUsers += 1;
  });

  const todayActiveUsers = await User.find({
    _id: { $in: Array.from(todayUserIds) },
  })
    .select("createdAt")
    .lean();

  const repeatVsNew = todayActiveUsers.reduce(
    (acc, user) => {
      const createdAt = toDateValue(user.createdAt);
      if (createdAt && createdAt.getTime() >= now.getTime() - 7 * DAY_MS) {
        acc.newUsers += 1;
      } else {
        acc.returningUsers += 1;
      }
      return acc;
    },
    { newUsers: 0, returningUsers: 0 }
  );

  const pageVisitMap = new Map(
    (pageAnalyticsData.visits || []).map((row) => [String(row._id || "unknown"), Number(row.visits) || 0])
  );
  const pageDurationMap = new Map(
    (pageAnalyticsData.durations || []).map((row) => [
      String(row._id || "unknown"),
      {
        totalMs: Number(row.totalMs) || 0,
        avgMs: Number(row.avgMs) || 0,
        samples: Number(row.samples) || 0,
      },
    ])
  );
  const entryMap = new Map(
    (pageAnalyticsData.entries || []).map((row) => [String(row._id || "unknown"), Number(row.count) || 0])
  );
  const exitMap = new Map(
    (pageAnalyticsData.exits || []).map((row) => [String(row._id || "unknown"), Number(row.count) || 0])
  );

  const pageKeys = new Set([
    ...pageVisitMap.keys(),
    ...pageDurationMap.keys(),
    ...entryMap.keys(),
    ...exitMap.keys(),
  ]);

  const byPage = Array.from(pageKeys)
    .filter((page) => page && page !== "unknown")
    .map((page) => {
      const visitCount = pageVisitMap.get(page) || 0;
      const duration = pageDurationMap.get(page) || {
        totalMs: 0,
        avgMs: 0,
        samples: 0,
      };
      return {
        page,
        label: formatPageLabel(page),
        visits: visitCount,
        entries: entryMap.get(page) || 0,
        exits: exitMap.get(page) || 0,
        totalDurationMinutes: Number((duration.totalMs / 60000).toFixed(1)),
        avgDurationSeconds: Number((duration.avgMs / 1000).toFixed(1)),
        durationSamples: duration.samples,
      };
    })
    .sort((left, right) => right.visits - left.visits || right.avgDurationSeconds - left.avgDurationSeconds);

  const risingPages = Array.from(pageVisitMap.entries())
    .map(([page, visits]) => ({
      page,
      label: formatPageLabel(page),
      visits,
    }))
    .sort((left, right) => right.visits - left.visits)
    .slice(0, 4);

  const entryPages = Array.from(entryMap.entries())
    .map(([page, count]) => ({ page, label: formatPageLabel(page), count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);

  const exitPages = Array.from(exitMap.entries())
    .map(([page, count]) => ({ page, label: formatPageLabel(page), count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);

  const topTransitions = (pageAnalyticsData.transitions || []).map((row) => ({
    from: String(row._id?.from || "unknown"),
    to: String(row._id?.to || "unknown"),
    fromLabel: formatPageLabel(row._id?.from || "unknown"),
    toLabel: formatPageLabel(row._id?.to || "unknown"),
    count: Number(row.count) || 0,
  }));

  const userBehavior = {
    activeSessions: liveSessions.slice(0, ACTIVE_SESSION_LIMIT).map((session) => ({
      key: session.key,
      actor: session.actor,
      currentPage: session.currentPage,
      currentPageLabel: formatPageLabel(session.currentPage),
      entryPage: session.entryPage,
      entryPageLabel: formatPageLabel(session.entryPage),
      durationMinutes: session.durationMinutes,
      lastSeenAt: session.lastSeenAt,
      lastSeenLabel: formatRelativeTime(session.lastSeenAt),
      deviceType: session.deviceType || "unknown",
      browser: session.browser || "Unknown",
      country: session.country || "Unknown",
      eventCount: session.eventCount,
    })),
    recentLogins,
    repeatVsNew,
    ignoredFeatures: FEATURE_PAGES.map((page) => ({
      page,
      label: formatPageLabel(page),
      visits: pageVisitMap.get(page) || 0,
    }))
      .sort((left, right) => left.visits - right.visits)
      .slice(0, 4),
  };

  const pageAnalytics = {
    byPage: byPage.slice(0, 10),
    mostEngaging: [...byPage]
      .sort((left, right) => right.avgDurationSeconds - left.avgDurationSeconds)
      .slice(0, 6),
    entryPages,
    exitPages,
  };

  const journey = {
    topTransitions,
    dropOffPages: exitPages,
    risingPages,
  };

  const growth = {
    dailyActiveUsers: Number(growthData.dau?.[0]?.count) || 0,
    weeklyActiveUsers: Number(growthData.wau?.[0]?.count) || 0,
    monthlyActiveUsers: Number(growthData.mau?.[0]?.count) || 0,
    retentionRate: percentage(retainedUsers, previousActiveUserIds.size || 0),
    signupSeries: fillDailySeries(signupSeriesRows, SERIES_DAYS, now),
    activeSeries: fillDailySeries(growthData.dailyActive || [], SERIES_DAYS, now),
    newUsersToday,
    newUsersWeek,
  };

  const totalPageViews = (contextData.devices || []).reduce(
    (sum, row) => sum + (Number(row.count) || 0),
    0
  );
  const context = {
    devices: mapDistribution(contextData.devices, totalPageViews),
    browsers: mapDistribution(contextData.browsers, totalPageViews),
    countries: mapDistribution(contextData.countries, totalPageViews),
    peakHours: (contextData.hours || [])
      .filter((row) => Number(row._id) >= 0)
      .map((row) => ({
        hour: Number(row._id),
        label: `${String(Number(row._id)).padStart(2, "0")}:00`,
        count: Number(row.count) || 0,
      }))
      .sort((left, right) => right.count - left.count),
  };

  const performanceMap = new Map(
    (contextData.performance || []).map((row) => [String(row._id || ""), row])
  );
  const avgLcpMs = Math.round(Number(performanceMap.get("largest_contentful_paint")?.avgValue) || 0);
  const avgCls = Number(
    (Number(performanceMap.get("layout_shift")?.avgValue) || 0).toFixed(4)
  );
  const avgPageLoadMs = Math.round(Number(performanceMap.get("page_load_time")?.avgValue) || 0);

  const messageSummary = {
    messagesToday: Number(messageData.messagesToday?.[0]?.count) || 0,
    activeConversationsToday: Number(messageData.activeConversations?.[0]?.count) || 0,
    reviewMessages: Number(messageData.reviewMessages?.[0]?.count) || 0,
  };

  const content = {
    totals: {
      posts: Number(postTotalRow.totalPosts) || 0,
      postLikes: Number(postTotalRow.likes) || 0,
      postComments: Number(postTotalRow.comments) || 0,
      postShares: Number(postTotalRow.reposts) || 0,
      videos: Number(videoTotalRow.totalVideos) || 0,
      videoViews: Number(videoTotalRow.totalViews) || 0,
      liveStreamsNow: Number(videoTotalRow.liveNow) || 0,
      messagesToday: messageSummary.messagesToday,
      activeConversationsToday: messageSummary.activeConversationsToday,
    },
    topPosts: topPosts.map((post) => ({
      id: toIdString(post._id),
      user: {
        id: toIdString(post.user?._id),
        name: post.user?.name || "Unknown",
        handle: post.user?.handle || "",
        avatar: post.user?.avatar || "",
      },
      preview: compactText(post.text || "", 110),
      hashtags: (post.hashtags || []).slice(0, 4),
      createdAt: post.createdAt,
      ageLabel: formatRelativeTime(post.createdAt),
      engagementScore: Number(post.engagementScore) || 0,
      likes: Number(post.likesCount) || 0,
      comments: Number(post.commentsCount) || 0,
      shares: Number(post.repostsCount) || 0,
    })),
    topVideos: topVideos.map((video) => ({
      id: toIdString(video._id),
      user: {
        id: toIdString(video.user?._id),
        name: video.user?.name || "Unknown",
        handle: video.user?.handle || "",
        avatar: video.user?.avatar || "",
      },
      title: video.title || "Untitled video",
      category: video.category || "Other",
      hashtags: (video.hashtags || []).slice(0, 4),
      createdAt: video.createdAt,
      ageLabel: formatRelativeTime(video.createdAt),
      engagementScore: Number(video.engagementScore) || 0,
      views: Number(video.views) || 0,
      likes: Number(video.likesCount) || 0,
      comments: Number(video.commentsCount) || 0,
    })),
  };

  const trending = {
    hashtags: trendingHashtags.map((item) => ({
      tag: item.tag,
      count: item.count,
      label: `${item.count} mentions`,
    })),
    themes: risingPages.map((item) => ({
      label: item.label,
      page: item.page,
      count: item.visits,
    })),
  };

  const health = {
    avgLcpMs,
    avgCls,
    avgPageLoadMs,
    monitoring: {
      uptimeSeconds: Number(monitoring.uptimeSeconds) || 0,
      totalRequests: Number(monitoring.totalRequests) || 0,
      totalApiRequests: Number(monitoring.totalApiRequests) || 0,
      totalErrors: Number(monitoring.totalErrors) || 0,
    },
    slowRoutes: [...(monitoring.routeStats || [])]
      .sort((left, right) => Number(right.avgMs || 0) - Number(left.avgMs || 0))
      .slice(0, 6)
      .map((route) => ({
        route: route.route,
        avgMs: Number(route.avgMs) || 0,
        maxMs: Number(route.maxMs) || 0,
        errors: Number(route.errors) || 0,
        count: Number(route.count) || 0,
      })),
    recentErrors: (monitoring.recentErrors || []).slice(0, 6).map((error) => ({
      ts: error.ts,
      ageLabel: formatRelativeTime(error.ts),
      message: compactText(error.message || "Server error", 130),
      path: error.path || "",
      statusCode: Number(error.statusCode) || 500,
    })),
    moderationQueue: {
      posts: Number(moderationFacet?.[0]) || 0,
      videos: Number(moderationFacet?.[1]) || 0,
      messages: messageSummary.reviewMessages,
    },
  };

  const live = {
    activePeople: livePeopleKeys.size,
    activeSessions: liveSessions.length,
    onlineSignedInUsers: Array.isArray(onlineUserIds) ? onlineUserIds.length : 0,
    visitorsToday: todayVisitorKeys.size,
    signedInUsersToday: todayUserIds.size,
    newUsersToday,
    newUsersWeek,
    liveWindowMinutes: Math.round(LIVE_WINDOW_MS / 60000),
  };

  const sessionEventMap = buildSessionEventMap(recentEvents);
  const funnelPresets = DEFAULT_FUNNEL_PRESETS.map((preset) =>
    buildFunnelSnapshot({
      sessionEventMap,
      steps: preset.steps,
      label: preset.label,
      description: preset.description,
      key: preset.key,
    })
  );

  const overview = {
    generatedAt: now.toISOString(),
    live,
    activityStream: buildActivityStream(recentEvents),
    userBehavior,
    pageAnalytics,
    journey,
    content,
    growth,
    trending,
    context,
    health,
  };

  overview.recommendations = buildRecommendations(overview);
  overview.anomalies = buildAnomalies({
    recentEvents,
    pageAnalytics,
    journey,
    live,
    health,
  });
  overview.cohorts = buildCohortComparisons({
    recentEvents,
    live,
    context,
    repeatVsNew,
  });
  overview.funnels = {
    presets: funnelPresets,
    stepCatalog: getFunnelStepCatalog(),
    selectedKey: DEFAULT_FUNNEL_PRESETS[0].key,
  };
  overview.releaseImpact = buildReleaseImpact({
    recentEvents,
    growth,
    health,
    live,
  });
  overview.decisionEngine = buildDecisionEngine({
    anomalies: overview.anomalies,
    funnels: overview.funnels,
    recommendations: overview.recommendations,
    trending,
    health,
    cohorts: overview.cohorts,
  });
  overview.founderBadge = buildFounderBadge({
    live,
    anomalies: overview.anomalies,
    trending,
    decisionEngine: overview.decisionEngine,
  });
  overview.savedViewPresets = [
    {
      id: "live-seekers",
      label: "Live seekers",
      description: "Prioritize live activity, alerts, and current user motion.",
      userSort: "active",
      funnelKey: "chat_activation",
      releaseWindow: "24h",
    },
    {
      id: "growth-watch",
      label: "Growth watch",
      description: "Keep growth pulse, signup motion, and release shifts in view.",
      userSort: "newest",
      funnelKey: "home_to_video_complete",
      releaseWindow: "24h",
    },
    {
      id: "friction-radar",
      label: "Friction radar",
      description: "Focus on anomalies, drop-offs, and weakest journeys.",
      userSort: "engaged",
      funnelKey: "mandir_to_follow",
      releaseWindow: "24h",
    },
    {
      id: "tirth-tube",
      label: "Tirth Tube",
      description: "Track watch starts, completions, and channel follow-through.",
      userSort: "engaged",
      funnelKey: "home_to_video_complete",
      releaseWindow: "24h",
    },
  ];
  overview.streamMeta = {
    mode: "ndjson",
    dashboardIntervalMs: 12000,
    detailIntervalMs: 7000,
  };

  return overview;
}

module.exports = {
  getFounderOverview,
  getFounderButtonPulse,
  getFounderFunnel,
  __testables: {
    buildAnomalyCard,
    buildAnomalies,
    buildCohortComparisons,
    buildDecisionEngine,
    buildFunnelSnapshot,
    buildFounderBadge,
    buildReleaseImpact,
    buildSessionEventMap,
    normalizeFunnelSteps,
  },
};
