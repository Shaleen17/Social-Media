const express = require("express");
const MandirPost = require("../models/MandirPost");
const { auth, optionalAuth } = require("../middleware/auth");
const {
  cleanMediaUrl,
  cleanString,
  getPagination,
  validateObjectIdParam,
} = require("../utils/validation");

const router = express.Router();

// Valid mandir slugs
const VALID_MANDIRS = [
  "kedarnath",
  "kashi-vishwanath",
  "tirupati",
  "somnath",
  "meenakshi",
  "ram-mandir",
];

function validateMandir(req, res, next) {
  if (!VALID_MANDIRS.includes(req.params.mandirId)) {
    return res.status(404).json({ error: "Mandir not found" });
  }
  next();
}

function timeAgo(date) {
  if (!date) return "";
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return new Date(date).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  });
}

function transformPost(p) {
  return {
    id: p._id || p.id,
    mandirId: p.mandirId,
    uid: p.user?._id || p.user,
    user: p.user,
    txt: p.text,
    img: p.image,
    video: p.video || null,
    mediaType: p.mediaType || (p.video ? "video" : p.image ? "image" : "text"),
    likes: (p.likes || []).map((l) => l.toString()),
    cmts: (p.comments || []).map((c) => ({
      id: c._id,
      uid: c.user?._id || c.user,
      user: c.user,
      txt: c.text,
      t: timeAgo(c.createdAt),
    })),
    t: timeAgo(p.createdAt),
    ts: new Date(p.createdAt).getTime(),
  };
}

// GET /api/mandir/accounts — public list of mandirs
router.get("/accounts", (req, res) => {
  res.json(VALID_MANDIRS);
});

// GET /api/mandir/:mandirId/posts — public viewing
router.get("/:mandirId/posts", validateMandir, optionalAuth, async (req, res) => {
  try {
    const { type } = req.query;
    const { page, limit, skip } = getPagination(req.query, {
      defaultLimit: 30,
      maxLimit: 60,
    });

    // Build filter
    const filter = { mandirId: req.params.mandirId };
    if (type === "video") filter.mediaType = "video";
    else if (type === "image") filter.mediaType = "image";

    const posts = await MandirPost.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "name handle avatar verified mandirId")
      .populate("comments.user", "name handle avatar")
      .lean();

    const total = await MandirPost.countDocuments(filter);

    res.json({
      posts: posts.map(transformPost),
      total,
      page,
      limit,
      hasMore: skip + posts.length < total,
      mandirId: req.params.mandirId,
    });
  } catch (err) {
    console.error("Get mandir posts error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/mandir/:mandirId/posts — authorized posting (mandir admin only)
router.post("/:mandirId/posts", validateMandir, auth, async (req, res, next) => {
  try {
    // Check that the logged-in user is the admin for THIS mandir
    if (req.user.mandirId !== req.params.mandirId) {
      return res.status(403).json({
        error: `You can only post in your assigned mandir community. Your mandir: ${req.user.mandirId || "none"}`,
      });
    }

    const { text, image, video } = req.body;
    const safeText = cleanString(text, { field: "Mandir post text", max: 5000 });
    const safeImage = cleanMediaUrl(image, { field: "Mandir post image", max: 750000 });
    const safeVideo = cleanMediaUrl(video, {
      field: "Mandir post video",
      max: 4096,
      allowData: false,
    });
    if (!safeText && !safeImage && !safeVideo) {
      return res.status(400).json({ error: "Post content required (text, image, or video)" });
    }

    // Determine media type
    let mediaType = "text";
    if (safeVideo) mediaType = "video";
    else if (safeImage) mediaType = "image";

    const post = await MandirPost.create({
      mandirId: req.params.mandirId,
      user: req.user._id,
      text: safeText,
      image: safeImage || null,
      video: safeVideo || null,
      mediaType,
    });

    const populated = await MandirPost.findById(post._id).populate(
      "user",
      "name handle avatar verified mandirId"
    );

    res.status(201).json(transformPost(populated.toJSON()));
  } catch (err) {
    next(err);
  }
});

// PUT /api/mandir/:mandirId/posts/:postId/like — toggle like (any logged-in user)
router.put("/:mandirId/posts/:postId/like", validateMandir, validateObjectIdParam("postId"), auth, async (req, res, next) => {
  try {
    const post = await MandirPost.findOne({
      _id: req.params.postId,
      mandirId: req.params.mandirId,
    });
    if (!post) return res.status(404).json({ error: "Post not found" });

    const idx = post.likes.indexOf(req.user._id);
    if (idx > -1) {
      post.likes.splice(idx, 1);
    } else {
      post.likes.push(req.user._id);
    }

    await post.save();
    res.json({
      likes: post.likes.map((l) => l.toString()),
      liked: post.likes.includes(req.user._id),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/mandir/:mandirId/posts/:postId/comment — add comment (any logged-in user)
router.put("/:mandirId/posts/:postId/comment", validateMandir, validateObjectIdParam("postId"), auth, async (req, res, next) => {
  try {
    const text = cleanString(req.body.text, {
      field: "Comment text",
      max: 1000,
      required: true,
    });

    const post = await MandirPost.findOne({
      _id: req.params.postId,
      mandirId: req.params.mandirId,
    });
    if (!post) return res.status(404).json({ error: "Post not found" });

    post.comments.push({ user: req.user._id, text });
    await post.save();

    const newComment = post.comments[post.comments.length - 1];
    res.json({
      id: newComment._id,
      uid: req.user._id,
      user: {
        _id: req.user._id,
        name: req.user.name,
        handle: req.user.handle,
        avatar: req.user.avatar,
      },
      txt: text,
      t: "Just now",
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/mandir/:mandirId/posts/:postId — delete own post
router.delete("/:mandirId/posts/:postId", validateMandir, validateObjectIdParam("postId"), auth, async (req, res, next) => {
  try {
    const post = await MandirPost.findOne({
      _id: req.params.postId,
      mandirId: req.params.mandirId,
    });
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    await post.deleteOne();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
