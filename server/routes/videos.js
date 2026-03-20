const express = require("express");
const Video = require("../models/Video");
const { auth, optionalAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/videos — list videos
router.get("/", optionalAuth, async (req, res) => {
  try {
    const { category, tab, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    let query = {};

    if (category && category !== "All") {
      query.category = category;
    }

    if (tab === "live") {
      query.isLive = true;
    }

    const videos = await Video.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("user", "name handle avatar verified")
      .lean();

    const result = videos.map((v) => ({
      id: v._id,
      uid: v.user?._id || v.user,
      user: v.user,
      title: v.title,
      desc: v.description,
      cat: v.category,
      src: v.src,
      thumb: v.thumbnail,
      likes: (v.likes || []).map((l) => l.toString()),
      cmts: (v.comments || []).map((c) => ({
        uid: c.user,
        txt: c.text,
        t: timeAgo(c.createdAt),
      })),
      views: v.views,
      dur: v.duration,
      ts: new Date(v.createdAt).getTime(),
      live: v.isLive,
      viewers: v.liveViewers,
      started: v.liveStarted,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/videos/stories — video stories for Tirth Tube
router.get("/stories", optionalAuth, async (req, res) => {
  try {
    // Return recent short videos as "stories"
    const videos = await Video.find({ isLive: false })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("user", "name handle avatar")
      .lean();

    res.json(
      videos.map((v) => ({
        id: v._id,
        uid: v.user?._id,
        user: v.user,
        cap: v.title,
        t: timeAgo(v.createdAt),
        type: "video",
        emo: "",
        src: v.src,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/videos — upload/create video
router.post("/", auth, async (req, res) => {
  try {
    const { title, description, category, src, thumbnail, duration } = req.body;
    if (!title || !src) {
      return res
        .status(400)
        .json({ error: "Title and video source required" });
    }

    const video = await Video.create({
      user: req.user._id,
      title,
      description: description || "",
      category: category || "Spiritual",
      src,
      thumbnail: thumbnail || null,
      duration: duration || "0:00",
    });

    res.status(201).json({
      id: video._id,
      uid: req.user._id,
      title: video.title,
      desc: video.description,
      cat: video.category,
      src: video.src,
      thumb: video.thumbnail,
      likes: [],
      cmts: [],
      views: 0,
      dur: video.duration,
      ts: Date.now(),
      live: false,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/videos/:id/like — toggle video like
router.put("/:id/like", auth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });

    const idx = video.likes.indexOf(req.user._id);
    if (idx > -1) {
      video.likes.splice(idx, 1);
    } else {
      video.likes.push(req.user._id);
    }

    await video.save();
    res.json({
      likes: video.likes.map((l) => l.toString()),
      liked: video.likes.includes(req.user._id),
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/videos/:id/comment
router.put("/:id/comment", auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Comment text required" });

    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });

    video.comments.push({ user: req.user._id, text });
    await video.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/videos/:id/view — increment view count
router.put("/:id/view", async (req, res) => {
  try {
    await Video.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/videos/live — start live stream
router.post("/live", auth, async (req, res) => {
  try {
    const { title, src, viewers } = req.body;
    if (!title) return res.status(400).json({ error: "Title required" });

    const video = await Video.create({
      user: req.user._id,
      title,
      src: src || "",
      isLive: true,
      liveViewers: viewers || 0,
      liveStarted: "Just now",
      category: "Spiritual",
    });

    res.status(201).json({ id: video._id });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

function timeAgo(date) {
  if (!date) return "";
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

module.exports = router;
