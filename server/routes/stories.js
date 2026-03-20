const express = require("express");
const Story = require("../models/Story");
const { auth, optionalAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/stories — list active (non-expired) stories
router.get("/", optionalAuth, async (req, res) => {
  try {
    const stories = await Story.find({
      expiresAt: { $gt: new Date() },
    })
      .populate("user", "name handle avatar")
      .sort({ createdAt: -1 })
      .lean();

    const result = stories.map((s) => ({
      id: s._id,
      uid: s.user?._id || s.user,
      user: s.user,
      type: s.type,
      src: s.src,
      cap: s.caption,
      emo: s.emoji,
      t: timeAgo(s.createdAt),
      viewed: req.user
        ? (s.viewers || []).some(
            (v) => v.toString() === req.user._id.toString()
          )
        : false,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/stories — create story
router.post("/", auth, async (req, res) => {
  try {
    const { type, src, caption, emoji } = req.body;
    if (!src) return res.status(400).json({ error: "Story source required" });

    const story = await Story.create({
      user: req.user._id,
      type: type || "image",
      src,
      caption: caption || "",
      emoji: emoji || "",
    });

    res.status(201).json({
      id: story._id,
      uid: req.user._id,
      type: story.type,
      src: story.src,
      cap: story.caption,
      emo: story.emoji,
      t: "Just now",
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/stories/:id/view — mark story as viewed
router.put("/:id/view", auth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ error: "Story not found" });

    if (!story.viewers.includes(req.user._id)) {
      story.viewers.push(req.user._id);
      await story.save();
    }

    res.json({ viewed: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

function timeAgo(date) {
  if (!date) return "";
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}

module.exports = router;
