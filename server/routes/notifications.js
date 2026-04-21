const express = require("express");
const Notification = require("../models/Notification");
const { auth } = require("../middleware/auth");
const { getPagination } = require("../utils/validation");

const router = express.Router();

// GET /api/notifications — list user's notifications
router.get("/", auth, async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, {
      defaultLimit: 50,
      maxLimit: 100,
    });
    const notifs = await Notification.find({ recipient: req.user._id })
      .populate("sender", "name handle avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
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

    res.setHeader("X-Page", String(page));
    res.setHeader("X-Limit", String(limit));
    res.setHeader("X-Has-More", String(result.length === limit));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PUT /api/notifications/read — mark all as read
router.put("/read", auth, async (req, res, next) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, read: false },
      { read: true }
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/unread-count
router.get("/unread-count", auth, async (req, res, next) => {
  try {
    const count = await Notification.countDocuments({
      recipient: req.user._id,
      read: false,
    });
    res.json({ count });
  } catch (err) {
    next(err);
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
