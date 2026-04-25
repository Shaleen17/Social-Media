const express = require("express");
const AppError = require("../utils/appError");
const { optionalAuth } = require("../middleware/auth");
const {
  ALLOWED_ANALYTICS_TYPES,
  recordAnalyticsEvent,
} = require("../services/analyticsService");
const { assertRateLimit } = require("../utils/requestLimiter");
const { cleanString } = require("../utils/validation");

const router = express.Router();

router.post("/events", optionalAuth, async (req, res, next) => {
  try {
    const type = cleanString(req.body?.type, {
      field: "Analytics event type",
      max: 40,
      required: true,
    });
    const name = cleanString(req.body?.name, {
      field: "Analytics event name",
      max: 120,
      required: true,
    });
    if (!ALLOWED_ANALYTICS_TYPES.has(type)) {
      throw new AppError("Unsupported analytics event type", 400);
    }

    const ip = String(req.ip || "unknown").trim();
    assertRateLimit({
      key: `analytics:${ip}:${type}`,
      limit: 160,
      windowMs: 15 * 60 * 1000,
      message: "Too many analytics events. Please slow down.",
    });

    await recordAnalyticsEvent({
      req,
      type,
      name,
      page: req.body?.page,
      path: req.body?.path,
      sessionId: req.body?.sessionId,
      anonymousId: req.body?.anonymousId,
      user: req.user?._id || null,
      meta: req.body?.meta || {},
    });

    res.status(202).json({ accepted: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
