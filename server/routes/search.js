const express = require("express");
const Post = require("../models/Post");
const User = require("../models/User");
const Video = require("../models/Video");
const { optionalAuth } = require("../middleware/auth");
const {
  applyRedisCacheHeader,
  buildRedisCacheKey,
  withRedisJsonCache,
} = require("../services/redisCache");
const { cleanString, getPagination } = require("../utils/validation");
const {
  buildSearchText,
  extractHashtags,
  normalizeHashtagTag,
} = require("../utils/contentFeatures");
const { getVisibleAccountStatusFilter } = require("../utils/userVisibility");

const router = express.Router();
const SEARCH_VISIBILITY_CACHE_VERSION = "legacy-active-v1";

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreMatch(query, fields = []) {
  const tokens = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const haystack = buildSearchText(fields).toLowerCase();

  return tokens.reduce((score, token) => {
    if (!token || !haystack) return score;
    if (haystack === token) return score + 60;
    if (haystack.startsWith(token)) return score + 24;
    if (haystack.includes(`#${token}`)) return score + 20;
    if (haystack.includes(token)) return score + 10;
    return score;
  }, 0);
}

function timeAgo(date) {
  if (!date) return "";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  if (seconds < 604800) return Math.floor(seconds / 86400) + "d ago";
  return new Date(date).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  });
}

function mapUser(user) {
  return {
    id: user._id,
    name: user.name,
    handle: user.handle,
    avatar: user.avatar,
    bio: user.bio || "",
    location: user.location || "",
    website: user.website || "",
    spiritualName: user.spiritualName || "",
    homeMandir: user.homeMandir || "",
    favoriteDeity: user.favoriteDeity || "",
    spiritualPath: user.spiritualPath || "",
    interests: user.interests || "",
    spokenLanguages: user.spokenLanguages || "",
    seva: user.seva || "",
    yatraWishlist: user.yatraWishlist || "",
    sankalp: user.sankalp || "",
    verified: !!user.verified,
    followersCount: Array.isArray(user.followers) ? user.followers.length : 0,
  };
}

function mapPost(post) {
  return {
    id: post._id,
    uid: post.user?._id || post.user,
    user: post.user,
    txt: post.text,
    img: post.image,
    ytId: post.ytId,
    likes: (post.likes || []).map((item) => item.toString()),
    cmts: (post.comments || []).map((comment) => ({
      id: comment._id,
      uid: comment.user?._id || comment.user,
      user: comment.user,
      txt: comment.text,
      t: timeAgo(comment.createdAt),
    })),
    reposts: (post.reposts || []).map((item) => item.toString()),
    bm: (post.bookmarks || []).map((item) => item.toString()),
    hashtags: post.hashtags || extractHashtags(post.text || ""),
    poll: post.poll ? { opts: post.poll.options, votes: post.poll.votes } : null,
    t: timeAgo(post.createdAt),
    ts: new Date(post.createdAt).getTime(),
  };
}

function mapVideo(video) {
  return {
    id: video._id,
    uid: video.user?._id || video.user,
    user: video.user,
    title: video.title,
    desc: video.description,
    cat: video.category,
    src: video.src,
    thumb: video.thumbnail,
    likes: (video.likes || []).map((item) => item.toString()),
    dislikes: (video.dislikes || []).map((item) => item.toString()),
    cmts: [],
    hashtags: video.hashtags || extractHashtags(video.title || "", video.description || ""),
    views: video.views || 0,
    dur: video.duration || "0:00",
    ts: new Date(video.createdAt).getTime(),
    live: !!video.isLive,
    viewers: video.liveViewers || 0,
    started: video.liveStarted || "",
  };
}

function aggregateHashtags(query, posts = [], videos = [], limit = 12) {
  const counts = new Map();
  const normalizedQuery = String(query || "").trim().toLowerCase();

  const addTag = (tag, category) => {
    const normalized = normalizeHashtagTag(tag);
    if (!normalized) return;
    if (
      normalizedQuery &&
      !normalized.toLowerCase().includes(normalizedQuery.replace(/^#/, ""))
    ) {
      return;
    }

    const current = counts.get(normalized) || {
      tag: normalized,
      category,
      count: 0,
      countLabel: "",
    };
    current.count += 1;
    current.countLabel = `${current.count} mention${current.count === 1 ? "" : "s"}`;
    counts.set(normalized, current);
  };

  posts.forEach((post) => {
    (post.hashtags || extractHashtags(post.text || "")).forEach((tag) =>
      addTag(tag, "Post Hashtag")
    );
  });
  videos.forEach((video) => {
    (
      video.hashtags ||
      extractHashtags(video.title || "", video.description || "")
    ).forEach((tag) => addTag(tag, "Video Hashtag"));
  });

  return Array.from(counts.values())
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
    .slice(0, limit);
}

const APPROVED_CONTENT_FILTER = {
  $or: [
    { "moderation.status": { $exists: false } },
    { "moderation.status": "approved" },
  ],
};

router.get("/", optionalAuth, async (req, res, next) => {
  try {
    const q = cleanString(req.query.q, { field: "Search query", max: 100 });
    const tab = cleanString(req.query.tab, { field: "Search tab", max: 24 });
    const { limit } = getPagination(req.query, {
      defaultLimit: 12,
      maxLimit: 24,
    });

    if (!q) {
      return res.json({
        query: "",
        tab: tab || "all",
        users: [],
        posts: [],
        videos: [],
        hashtags: [],
      });
    }

    const cacheKey = buildRedisCacheKey(
      "search",
      "full",
      SEARCH_VISIBILITY_CACHE_VERSION,
      q.toLowerCase(),
      tab || "all",
      limit
    );
    const { status: cacheStatus, value } = await withRedisJsonCache(
      cacheKey,
      async () => {
        const safeRegex = new RegExp(escapeRegex(q), "i");
        const userQuery =
          tab && tab !== "all" && tab !== "users"
            ? Promise.resolve([])
            : User.find({
                ...getVisibleAccountStatusFilter(),
                $or: [
                  { name: safeRegex },
                  { handle: safeRegex },
                  { bio: safeRegex },
                  { location: safeRegex },
                  { spiritualName: safeRegex },
                  { homeMandir: safeRegex },
                  { favoriteDeity: safeRegex },
                  { spiritualPath: safeRegex },
                  { interests: safeRegex },
                ],
              })
                .select(
                  "name handle avatar bio location website verified followers spiritualName homeMandir favoriteDeity spiritualPath interests spokenLanguages seva yatraWishlist sankalp"
                )
                .limit(limit * 2)
                .lean();

        const postQuery =
          tab && tab !== "all" && tab !== "posts" && tab !== "tags"
            ? Promise.resolve([])
            : Post.find({
                $and: [
                  APPROVED_CONTENT_FILTER,
                  {
                    $or: [
                      { text: safeRegex },
                      { hashtags: safeRegex },
                      { searchText: safeRegex },
                    ],
                  },
                ],
              })
                .populate("user", "name handle avatar verified")
                .populate("comments.user", "name handle avatar")
                .sort({ createdAt: -1 })
                .limit(limit * 2)
                .lean();

        const videoQuery =
          tab && !["all", "reels", "bhajans", "topics", "tags"].includes(tab)
            ? Promise.resolve([])
            : Video.find({
                $and: [
                  APPROVED_CONTENT_FILTER,
                  {
                    $or: [
                      { title: safeRegex },
                      { description: safeRegex },
                      { category: safeRegex },
                      { hashtags: safeRegex },
                      { searchText: safeRegex },
                    ],
                  },
                ],
              })
                .populate("user", "name handle avatar verified")
                .sort({ createdAt: -1 })
                .limit(limit * 2)
                .lean();

        const [users, posts, videos] = await Promise.all([
          userQuery,
          postQuery,
          videoQuery,
        ]);

        const rankedUsers = users
          .map((user) => ({
            score: scoreMatch(q, [
              user.name,
              user.handle,
              user.bio,
              user.location,
              user.spiritualName,
              user.homeMandir,
              user.favoriteDeity,
              user.spiritualPath,
              user.interests,
            ]),
            value: mapUser(user),
          }))
          .sort((left, right) => right.score - left.score || left.value.name.localeCompare(right.value.name))
          .slice(0, limit)
          .map((item) => item.value);

        const rankedPosts = posts
          .map((post) => ({
            score: scoreMatch(q, [post.text, ...(post.hashtags || [])]),
            value: mapPost(post),
          }))
          .sort((left, right) => right.score - left.score || right.value.ts - left.value.ts)
          .slice(0, limit)
          .map((item) => item.value);

        const rankedVideos = videos
          .map((video) => ({
            score: scoreMatch(q, [
              video.title,
              video.description,
              video.category,
              ...(video.hashtags || []),
            ]),
            value: mapVideo(video),
          }))
          .sort((left, right) => right.score - left.score || right.value.ts - left.value.ts)
          .slice(0, limit)
          .map((item) => item.value);

        return {
          query: q,
          tab: tab || "all",
          users: rankedUsers,
          posts: rankedPosts,
          videos: rankedVideos,
          hashtags: aggregateHashtags(q, posts, videos, Math.max(8, limit)),
        };
      },
      { ttlSeconds: 45 }
    );

    applyRedisCacheHeader(res, cacheStatus);
    res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
    res.json(value);
  } catch (err) {
    next(err);
  }
});

router.get("/hashtags/trending", optionalAuth, async (req, res, next) => {
  try {
    const { limit } = getPagination(req.query, {
      defaultLimit: 18,
      maxLimit: 40,
    });
    const cacheKey = buildRedisCacheKey("search", "hashtags", "trending", limit);
    const { status: cacheStatus, value } = await withRedisJsonCache(
      cacheKey,
      async () => {
        const [posts, videos] = await Promise.all([
          Post.find(APPROVED_CONTENT_FILTER)
            .sort({ createdAt: -1 })
            .limit(250)
            .select("text hashtags")
            .lean(),
          Video.find(APPROVED_CONTENT_FILTER)
            .sort({ createdAt: -1 })
            .limit(250)
            .select("title description hashtags")
            .lean(),
        ]);
        return aggregateHashtags("", posts, videos, limit);
      },
      { ttlSeconds: 120 }
    );

    applyRedisCacheHeader(res, cacheStatus);
    res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
    res.json(value);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
