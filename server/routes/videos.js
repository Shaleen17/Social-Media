const express = require("express");
const Video = require("../models/Video");
const { auth, optionalAuth } = require("../middleware/auth");
const { recordAnalyticsEventSafe } = require("../services/analyticsService");
const {
  applyRedisCacheHeader,
  buildRedisCacheKey,
  invalidateRedisCacheNamespaces,
  withRedisJsonCache,
} = require("../services/redisCache");
const {
  buildSearchText,
  moderateTextContent,
} = require("../utils/contentFeatures");
const {
  cleanEnum,
  cleanMediaUrl,
  cleanString,
  getPagination,
  validateObjectIdParam,
} = require("../utils/validation");

const router = express.Router();

function invalidateVideoCaches(namespaces = ["videos", "search", "bootstrap"]) {
  return invalidateRedisCacheNamespaces(namespaces).catch(() => 0);
}

function timeAgo(date) {
  if (!date) return "";
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

function mapVideo(v) {
  const pinnedId = v.pinnedComment ? v.pinnedComment.toString() : "";

  return {
    id: v._id,
    uid: v.user?._id || v.user,
    user: v.user,
    title: v.title,
    desc: v.description,
    cat: v.category,
    src: v.src,
    thumb: v.thumbnail,
    likes: (v.likes || []).map((l) => l.toString()),
    dislikes: (v.dislikes || []).map((d) => d.toString()),
    cmts: (v.comments || []).map((c) => ({
      id: c._id,
      uid: c.user?._id || c.user,
      user: c.user
        ? {
            id: c.user._id,
            name: c.user.name,
            handle: c.user.handle,
            avatar: c.user.avatar,
            verified: c.user.verified,
          }
        : null,
      txt: c.text,
      t: timeAgo(c.createdAt),
      pinned: !!pinnedId && c._id.toString() === pinnedId,
      replies: (c.replies || []).map((r) => ({
        id: r._id,
        uid: r.user?._id || r.user,
        user: r.user
          ? {
              id: r.user._id,
              name: r.user.name,
              handle: r.user.handle,
              avatar: r.user.avatar,
              verified: r.user.verified,
            }
          : null,
        txt: r.text,
        t: timeAgo(r.createdAt),
      })),
    })),
    views: v.views,
    dur: v.duration,
    hashtags: v.hashtags || [],
    moderation: v.moderation?.status || "approved",
    ts: new Date(v.createdAt).getTime(),
    live: v.isLive,
    viewers: v.liveViewers,
    started: v.liveStarted,
  };
}

// GET /api/videos - list videos
router.get("/", optionalAuth, async (req, res) => {
  try {
    const { category, tab } = req.query;
    const { page, limit, skip } = getPagination(req.query, {
      defaultLimit: 20,
      maxLimit: 50,
    });
    const query = {};

    if (category && category !== "All") {
      query.category = category;
    }

    if (tab === "live") {
      query.isLive = true;
    }

    const cacheKey = buildRedisCacheKey(
      "videos",
      "list",
      category || "All",
      tab || "feed",
      page,
      limit
    );
    const { status: cacheStatus, value: videos } = await withRedisJsonCache(
      cacheKey,
      async () => {
        const found = await Video.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("user", "name handle avatar verified followers following bio")
          .populate("comments.user", "name handle avatar verified")
          .populate("comments.replies.user", "name handle avatar verified")
          .lean();
        return found.map(mapVideo);
      },
      { ttlSeconds: tab === "live" ? 30 : 60 }
    );

    applyRedisCacheHeader(res, cacheStatus);
    res.setHeader("X-Page", String(page));
    res.setHeader("X-Limit", String(limit));
    res.setHeader("X-Has-More", String(videos.length === limit));
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/videos/stories - video stories for Tirth Tube
router.get("/stories", optionalAuth, async (req, res) => {
  try {
    const cacheKey = buildRedisCacheKey("videos", "stories");
    const { status: cacheStatus, value } = await withRedisJsonCache(
      cacheKey,
      async () => {
        const videos = await Video.find({ isLive: false })
          .sort({ createdAt: -1 })
          .limit(10)
          .populate("user", "name handle avatar")
          .lean();

        return videos.map((v) => ({
          id: v._id,
          uid: v.user?._id,
          user: v.user,
          cap: v.title,
          t: timeAgo(v.createdAt),
          type: "video",
          emo: "",
          src: v.src,
        }));
      },
      { ttlSeconds: 90 }
    );
    applyRedisCacheHeader(res, cacheStatus);
    res.json(value);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/videos/:id - get single video
router.get("/:id", validateObjectIdParam("id"), optionalAuth, async (req, res, next) => {
  try {
    const cacheKey = buildRedisCacheKey("videos", "detail", req.params.id);
    const { status: cacheStatus, value: video } = await withRedisJsonCache(
      cacheKey,
      async () => {
        const found = await Video.findById(req.params.id)
          .populate("user", "name handle avatar verified followers following bio")
          .populate("comments.user", "name handle avatar verified")
          .populate("comments.replies.user", "name handle avatar verified");
        return found ? mapVideo(found) : null;
      },
      { ttlSeconds: 90 }
    );

    applyRedisCacheHeader(res, cacheStatus);
    if (!video) return res.status(404).json({ error: "Video not found" });

    res.json(video);
  } catch (err) {
    next(err);
  }
});

// POST /api/videos - upload/create video
router.post("/", auth, async (req, res, next) => {
  try {
    const { title, description, category, src, thumbnail, duration } = req.body;
    const safeTitle = cleanString(title, {
      field: "Video title",
      max: 140,
      required: true,
    });
    const safeSrc = cleanMediaUrl(src, {
      field: "Video source",
      max: 4096,
      allowData: false,
      required: true,
    });
    const safeThumbnail = cleanMediaUrl(thumbnail, {
      field: "Video thumbnail",
      max: 750000,
    });
    if (!safeTitle || !safeSrc) {
      return res.status(400).json({ error: "Title and video source required" });
    }
    const moderation = moderateTextContent([
      safeTitle,
      cleanString(description, { field: "Video description", max: 5000 }),
    ]);
    const safeDescription = cleanString(description, {
      field: "Video description",
      max: 5000,
    });

    const video = await Video.create({
      user: req.user._id,
      title: safeTitle,
      description: safeDescription,
      category: cleanEnum(category, ["Spiritual", "Pilgrimage", "Discourse", "Bhajan", "Aarti", "Meditation", "Katha", "Other"], "Spiritual"),
      src: safeSrc,
      thumbnail: safeThumbnail || null,
      duration: cleanString(duration, { field: "Video duration", max: 20 }) || "0:00",
      hashtags: moderation.hashtags,
      searchText: buildSearchText(safeTitle, safeDescription, moderation.hashtags.join(" ")),
      moderation: {
        status: moderation.status,
        flags: moderation.flags,
        score: moderation.score,
        reviewedAt: moderation.reviewedAt,
      },
      processing: {
        status: moderation.status === "needs_review" ? "needs_review" : "ready",
        profile: "adaptive-ready",
        optimizedAt: new Date(),
      },
    });

    await recordAnalyticsEventSafe({
      req,
      type: "interaction",
      name: "video_uploaded",
      page: "video",
      path: `/videos/${video._id}`,
      user: req.user._id,
      meta: {
        videoId: video._id.toString(),
        title: video.title,
        category: video.category,
        moderationStatus: video.moderation?.status || "approved",
        hashtags: (video.hashtags || []).slice(0, 8),
      },
    });

    invalidateVideoCaches();
    res.status(201).json({
      id: video._id,
      uid: req.user._id,
      title: video.title,
      desc: video.description,
      cat: video.category,
      src: video.src,
      thumb: video.thumbnail,
      likes: [],
      dislikes: [],
      cmts: [],
      views: 0,
      dur: video.duration,
      hashtags: video.hashtags || [],
      moderation: video.moderation?.status || "approved",
      ts: Date.now(),
      live: false,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/videos/:id/like - toggle video like
router.put("/:id/like", validateObjectIdParam("id"), auth, async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });

    const userId = req.user._id.toString();
    const existingLike = video.likes.findIndex((l) => l.toString() === userId);

    if (existingLike > -1) {
      video.likes.splice(existingLike, 1);
    } else {
      video.likes.push(req.user._id);
      video.dislikes = video.dislikes.filter((d) => d.toString() !== userId);
    }

    await video.save();
    invalidateVideoCaches();
    await recordAnalyticsEventSafe({
      req,
      type: "interaction",
      name: existingLike > -1 ? "video_unliked" : "video_liked",
      page: "video",
      path: `/videos/${video._id}`,
      user: req.user._id,
      meta: {
        videoId: video._id.toString(),
        ownerId: video.user.toString(),
      },
    });
    res.json({
      likes: video.likes.map((l) => l.toString()),
      dislikes: video.dislikes.map((d) => d.toString()),
      liked: video.likes.some((l) => l.toString() === userId),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/videos/:id/dislike - toggle video dislike
router.put("/:id/dislike", validateObjectIdParam("id"), auth, async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });

    const userId = req.user._id.toString();
    const existingDislike = video.dislikes.findIndex(
      (d) => d.toString() === userId
    );

    if (existingDislike > -1) {
      video.dislikes.splice(existingDislike, 1);
    } else {
      video.dislikes.push(req.user._id);
      video.likes = video.likes.filter((l) => l.toString() !== userId);
    }

    await video.save();
    invalidateVideoCaches();
    res.json({
      likes: video.likes.map((l) => l.toString()),
      dislikes: video.dislikes.map((d) => d.toString()),
      disliked: video.dislikes.some((d) => d.toString() === userId),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/videos/:id/comment - add top-level comment
router.put("/:id/comment", validateObjectIdParam("id"), auth, async (req, res, next) => {
  try {
    const text = cleanString(req.body.text, {
      field: "Comment text",
      max: 1000,
      required: true,
    });

    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });

    video.comments.push({ user: req.user._id, text });
    await video.save();
    invalidateVideoCaches();
    await recordAnalyticsEventSafe({
      req,
      type: "interaction",
      name: "video_commented",
      page: "video",
      path: `/videos/${video._id}`,
      user: req.user._id,
      meta: {
        videoId: video._id.toString(),
        ownerId: video.user.toString(),
        preview: text.slice(0, 140),
      },
    });

    const comment = video.comments[video.comments.length - 1];
    res.json({
      id: comment._id,
      uid: req.user._id,
      user: {
        id: req.user._id,
        name: req.user.name,
        handle: req.user.handle,
        avatar: req.user.avatar,
        verified: req.user.verified,
      },
      txt: comment.text,
      t: "Just now",
      pinned: false,
      replies: [],
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/videos/:id/comment/:commentId/reply - add reply to a comment
router.put("/:id/comment/:commentId/reply", validateObjectIdParam("id"), validateObjectIdParam("commentId"), auth, async (req, res, next) => {
  try {
    const text = cleanString(req.body.text, {
      field: "Reply text",
      max: 1000,
      required: true,
    });

    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });

    const comment = video.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    comment.replies.push({ user: req.user._id, text });
    await video.save();
    invalidateVideoCaches();

    const reply = comment.replies[comment.replies.length - 1];
    res.json({
      id: reply._id,
      uid: req.user._id,
      user: {
        id: req.user._id,
        name: req.user.name,
        handle: req.user.handle,
        avatar: req.user.avatar,
        verified: req.user.verified,
      },
      txt: reply.text,
      t: "Just now",
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/videos/:id/comment/:commentId/pin - pin or unpin comment
router.put("/:id/comment/:commentId/pin", validateObjectIdParam("id"), validateObjectIdParam("commentId"), auth, async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (video.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Only the uploader can pin comments" });
    }

    const comment = video.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    const currentPinnedId = video.pinnedComment ? video.pinnedComment.toString() : "";
    video.pinnedComment =
      currentPinnedId === comment._id.toString() ? null : comment._id;
    await video.save();
    invalidateVideoCaches();

    res.json({
      pinnedCommentId: video.pinnedComment ? video.pinnedComment.toString() : null,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/videos/:id/view - increment view count
router.put("/:id/view", validateObjectIdParam("id"), async (req, res, next) => {
  try {
    await Video.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });
    invalidateVideoCaches();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/videos/live - start live stream
router.post("/live", auth, async (req, res, next) => {
  try {
    const { title, src, viewers } = req.body;
    const safeTitle = cleanString(title, {
      field: "Live stream title",
      max: 140,
      required: true,
    });
    const safeSrc = src
      ? cleanMediaUrl(src, {
          field: "Live stream source",
          max: 4096,
          allowData: false,
        })
      : "";
    const safeViewers = Math.max(0, Math.min(Number(viewers) || 0, 100000));

    const video = await Video.create({
      user: req.user._id,
      title: safeTitle,
      src: safeSrc,
      isLive: true,
      liveViewers: safeViewers,
      liveStarted: "Just now",
      category: "Spiritual",
    });

    await recordAnalyticsEventSafe({
      req,
      type: "interaction",
      name: "live_stream_started",
      page: "video",
      path: `/videos/${video._id}`,
      user: req.user._id,
      meta: {
        videoId: video._id.toString(),
        title: safeTitle,
        viewers: safeViewers,
      },
    });

    invalidateVideoCaches();
    res.status(201).json({ id: video._id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
