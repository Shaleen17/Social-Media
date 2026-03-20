const express = require("express");
const Notification = require("../models/Notification");
const { auth } = require("../middleware/auth");

const router = express.Router();

// GET /api/notifications — list user's notifications
router.get("/", auth, async (req, res) => {
  try {
    const notifs = await Notification.find({ recipient: req.user._id })
      .populate("sender", "name handle avatar")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const result = notifs.map((n) => ({
      id: n._id,
      type: n.type,
      from: n.sender?._id || n.sender,
      sender: n.sender,
      pid: n.post,
      txt: n.text,
      t: timeAgo(n.createdAt),
      unread: !n.read,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/notifications/read — mark all as read
router.put("/read", auth, async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, read: false },
      { read: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/notifications/unread-count
router.get("/unread-count", auth, async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      recipient: req.user._id,
      read: false,
    });
    res.json({ count });
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
