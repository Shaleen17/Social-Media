const AnalyticsEvent = require("../models/AnalyticsEvent");
const User = require("../models/User");
const Post = require("../models/Post");
const Video = require("../models/Video");
const Conversation = require("../models/Message");
const { getMonitoringSnapshot } = require("./monitoringService");

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_WINDOW_MS = 15 * 60 * 1000;
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
const TREND_WINDOW_MS = 7 * DAY_MS;
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

  return overview;
}

module.exports = {
  getFounderOverview,
};
