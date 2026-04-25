const express = require("express");
const mongoose = require("mongoose");
const AppError = require("../utils/appError");
const AnalyticsEvent = require("../models/AnalyticsEvent");
const Post = require("../models/Post");
const Video = require("../models/Video");
const Conversation = require("../models/Message");
const {
  createDatabaseBackup,
  getBackupStatus,
} = require("../services/backupService");
const { getMonitoringSnapshot } = require("../services/monitoringService");
const { getPagination } = require("../utils/validation");

const router = express.Router();

function requireAdminKey(envName) {
  return (req, res, next) => {
    const key = process.env[envName];
    const provided =
      req.get("x-admin-key") ||
      req.get("x-backup-key") ||
      req.get("x-monitoring-key") ||
      String(req.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
      req.query.key;

    if (!key || provided !== key) {
      return next(new AppError("Not authorized", 403));
    }

    next();
  };
}

router.get("/monitoring", requireAdminKey("MONITORING_ADMIN_KEY"), (req, res) => {
  res.json({
    status: "ok",
    dbState: mongoose.connection.readyState,
    ...getMonitoringSnapshot(),
  });
});

router.get(
  "/analytics/summary",
  requireAdminKey("MONITORING_ADMIN_KEY"),
  async (req, res, next) => {
    try {
      const since = new Date(
        Date.now() - Math.max(1, Number(req.query.days) || 7) * 24 * 60 * 60 * 1000
      );
      const [totals, topPages, topErrors] = await Promise.all([
        AnalyticsEvent.aggregate([
          { $match: { createdAt: { $gte: since } } },
          { $group: { _id: "$type", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        AnalyticsEvent.aggregate([
          { $match: { type: "page_view", createdAt: { $gte: since } } },
          { $group: { _id: "$page", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 12 },
        ]),
        AnalyticsEvent.find({
          type: "error",
          createdAt: { $gte: since },
        })
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
      ]);

      res.json({
        since: since.toISOString(),
        totals,
        topPages,
        recentErrors: topErrors,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/moderation/queue",
  requireAdminKey("MONITORING_ADMIN_KEY"),
  async (req, res, next) => {
    try {
      const { limit } = getPagination(req.query, {
        defaultLimit: 20,
        maxLimit: 60,
      });
      const [posts, videos, conversations] = await Promise.all([
        Post.find({ "moderation.status": "needs_review" })
          .sort({ "moderation.score": -1, createdAt: -1 })
          .limit(limit)
          .populate("user", "name handle avatar")
          .lean(),
        Video.find({ "moderation.status": "needs_review" })
          .sort({ "moderation.score": -1, createdAt: -1 })
          .limit(limit)
          .populate("user", "name handle avatar")
          .lean(),
        Conversation.find({ "messages.moderationStatus": "needs_review" })
          .sort({ updatedAt: -1 })
          .limit(limit)
          .populate("participants", "name handle avatar")
          .populate("messages.sender", "name handle avatar")
          .lean(),
      ]);

      const messages = conversations.flatMap((conversation) =>
        (conversation.messages || [])
          .filter((message) => message.moderationStatus === "needs_review")
          .map((message) => ({
            kind: "message",
            id: message._id,
            conversationId: conversation._id,
            sender: message.sender,
            text: message.text || "",
            flags: message.moderationFlags || [],
            createdAt: message.createdAt,
          }))
      );

      res.json({
        posts: posts.map((post) => ({
          kind: "post",
          id: post._id,
          text: post.text,
          flags: post.moderation?.flags || [],
          score: post.moderation?.score || 0,
          user: post.user,
          createdAt: post.createdAt,
        })),
        videos: videos.map((video) => ({
          kind: "video",
          id: video._id,
          title: video.title,
          description: video.description,
          flags: video.moderation?.flags || [],
          score: video.moderation?.score || 0,
          user: video.user,
          createdAt: video.createdAt,
        })),
        messages: messages.slice(0, limit),
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get("/backup/status", requireAdminKey("BACKUP_ADMIN_KEY"), (req, res) => {
  res.json(getBackupStatus());
});

router.post("/backup", requireAdminKey("BACKUP_ADMIN_KEY"), async (req, res, next) => {
  try {
    const result = await createDatabaseBackup("manual");
    res.json({
      success: true,
      backup: result,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
