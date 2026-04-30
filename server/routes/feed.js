const express = require("express");
const Post = require("../models/Post");
const { optionalAuth } = require("../middleware/auth");
const { cleanString, getPagination } = require("../utils/validation");

const router = express.Router();
const MAX_SMART_FEED_SAMPLE = 240;
const APPROVED_CONTENT_FILTER = {
  $or: [
    { "moderation.status": { $exists: false } },
    { "moderation.status": "approved" },
  ],
};

function timeAgo(date) {
  if (!date) return "";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(date).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  });
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
    poll: post.poll ? { opts: post.poll.options, votes: post.poll.votes } : null,
    hashtags: post.hashtags || [],
    t: timeAgo(post.createdAt),
    ts: new Date(post.createdAt).getTime(),
  };
}

function normalizeFeedView(value = "", isAuthenticated = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "following") {
    return isAuthenticated ? "following" : "latest";
  }
  if (normalized === "trending") return "trending";
  if (normalized === "latest") return "latest";
  if (normalized === "foryou") return isAuthenticated ? "smart" : "latest";
  return isAuthenticated ? "smart" : "latest";
}

function extractInterestTokens(user) {
  if (!user) return [];

  const tokens = [
    user.interests,
    user.favoriteDeity,
    user.homeMandir,
    user.spiritualPath,
    user.spiritualName,
    ...(Array.isArray(user.followedMandirs) ? user.followedMandirs : []),
    ...(Array.isArray(user.followedSants) ? user.followedSants : []),
  ]
    .flatMap((value) =>
      String(value || "")
        .toLowerCase()
        .split(/[^a-z0-9#]+/i)
        .map((item) => item.trim())
        .filter((item) => item.length >= 3)
    )
    .slice(0, 40);

  return Array.from(new Set(tokens));
}

function buildSmartFeedScore(post, user, tokens) {
  const followingIds = new Set(
    (Array.isArray(user?.following) ? user.following : []).map((item) =>
      item?.toString?.() || String(item || "")
    )
  );
  const authorId = (post.user?._id || post.user || "").toString();
  const textHaystack = [
    post.text,
    ...(Array.isArray(post.hashtags) ? post.hashtags : []),
  ]
    .join(" ")
    .toLowerCase();
  const interestMatches = tokens.reduce(
    (count, token) => count + (token && textHaystack.includes(token) ? 1 : 0),
    0
  );
  const hasVideo = !!post.ytId;
  const hasImage = !!post.image;
  const ageHours = Math.max(
    0,
    (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60)
  );
  const freshnessBoost = Math.max(0, 72 - ageHours);
  const engagementBoost =
    (post.likes?.length || 0) * 3 +
    (post.reposts?.length || 0) * 4 +
    (post.comments?.length || 0) * 2;
  const followedAuthorBoost = followingIds.has(authorId) ? 90 : 0;
  const selfBoost =
    authorId && authorId === (user?._id?.toString?.() || user?.id || "")
      ? 24
      : 0;
  const mediaAffinityBoost =
    /\b(video|reel|bhajan|katha|pravachan)\b/i.test(String(user?.interests || "")) &&
    (hasVideo || hasImage)
      ? 16
      : 0;

  return (
    followedAuthorBoost +
    selfBoost +
    freshnessBoost +
    engagementBoost +
    interestMatches * 22 +
    mediaAffinityBoost +
    (hasVideo ? 8 : 0) +
    (hasImage ? 4 : 0)
  );
}

router.get("/home", optionalAuth, async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, {
      defaultLimit: 20,
      maxLimit: 20,
    });
    const view = normalizeFeedView(
      cleanString(req.query.view || req.query.tab, {
        field: "Feed view",
        max: 24,
      }),
      !!req.user
    );

    const baseQuery = { ...APPROVED_CONTENT_FILTER };
    const userId = req.user?._id?.toString?.() || "";

    if (view === "following" && req.user) {
      const following = Array.isArray(req.user.following)
        ? req.user.following.map((item) => item.toString())
        : [];
      baseQuery.user = { $in: Array.from(new Set([...following, userId])).filter(Boolean) };
    }

    const populateQuery = Post.find(baseQuery)
      .sort({ createdAt: -1 })
      .populate("user", "name handle avatar verified")
      .populate("comments.user", "name handle avatar");

    let mapped = [];
    let hasMore = false;

    if (view === "smart" || view === "trending") {
      const sampleSize = Math.min(
        MAX_SMART_FEED_SAMPLE,
        Math.max(limit * 6, 80)
      );
      const candidates = await populateQuery.limit(sampleSize).lean();
      const tokens = extractInterestTokens(req.user);
      const ranked = candidates
        .map((post) => ({
          score:
            view === "trending"
              ? (post.likes?.length || 0) * 3 +
                (post.reposts?.length || 0) * 4 +
                (post.comments?.length || 0) * 2 +
                Math.max(
                  0,
                  48 -
                    (Date.now() - new Date(post.createdAt).getTime()) /
                      (1000 * 60 * 60)
                )
              : buildSmartFeedScore(post, req.user, tokens),
          post,
        }))
        .sort(
          (left, right) =>
            right.score - left.score ||
            new Date(right.post.createdAt).getTime() -
              new Date(left.post.createdAt).getTime()
        );

      const paged = ranked.slice(skip, skip + limit).map((entry) => entry.post);
      mapped = paged.map(mapPost);
      hasMore = ranked.length > skip + limit;
    } else {
      const posts = await populateQuery.skip(skip).limit(limit + 1).lean();
      hasMore = posts.length > limit;
      mapped = posts.slice(0, limit).map(mapPost);
    }

    res.setHeader("X-Page", String(page));
    res.setHeader("X-Limit", String(limit));
    res.setHeader("X-Has-More", String(hasMore));
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json(mapped);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
