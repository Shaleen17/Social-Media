const express = require("express");
const MandirPost = require("../models/MandirPost");
const { auth, optionalAuth } = require("../middleware/auth");

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
    const { page = 1, limit = 30 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const posts = await MandirPost.find({ mandirId: req.params.mandirId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("user", "name handle avatar verified mandirId")
      .populate("comments.user", "name handle avatar")
      .lean();

    const total = await MandirPost.countDocuments({ mandirId: req.params.mandirId });

    res.json({
      posts: posts.map(transformPost),
      total,
      mandirId: req.params.mandirId,
    });
  } catch (err) {
    console.error("Get mandir posts error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/mandir/:mandirId/posts — authorized posting (mandir admin only)
router.post("/:mandirId/posts", validateMandir, auth, async (req, res) => {
  try {
    // Check that the logged-in user is the admin for THIS mandir
    if (req.user.mandirId !== req.params.mandirId) {
      return res.status(403).json({
        error: `You can only post in your assigned mandir community. Your mandir: ${req.user.mandirId || "none"}`,
      });
    }

    const { text, image } = req.body;
    if (!text && !image) {
      return res.status(400).json({ error: "Post content required" });
    }

    const post = await MandirPost.create({
      mandirId: req.params.mandirId,
      user: req.user._id,
      text: text || "",
      image: image || null,
    });

    const populated = await MandirPost.findById(post._id).populate(
      "user",
      "name handle avatar verified mandirId"
    );

    res.status(201).json(transformPost(populated.toJSON()));
  } catch (err) {
    console.error("Create mandir post error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/mandir/:mandirId/posts/:postId/like — toggle like (any logged-in user)
router.put("/:mandirId/posts/:postId/like", validateMandir, auth, async (req, res) => {
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
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/mandir/:mandirId/posts/:postId/comment — add comment (any logged-in user)
router.put("/:mandirId/posts/:postId/comment", validateMandir, auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Comment text required" });

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
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/mandir/:mandirId/posts/:postId — delete own post
router.delete("/:mandirId/posts/:postId", validateMandir, auth, async (req, res) => {
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
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
