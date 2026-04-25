const express = require("express");
const AnalyticsEvent = require("../models/AnalyticsEvent");
const AppError = require("../utils/appError");
const { optionalAuth } = require("../middleware/auth");
const { assertRateLimit } = require("../utils/requestLimiter");
const { cleanString } = require("../utils/validation");

const router = express.Router();
const ALLOWED_TYPES = new Set([
  "page_view",
  "interaction",
  "error",
  "performance",
  "consent",
]);

function sanitizeMeta(value, depth = 0) {
  if (depth > 3) return undefined;
  if (value == null) return value;
  if (typeof value === "string") {
    return cleanString(value, {
      field: "Analytics meta",
      max: 500,
      preserveNewlines: false,
    });
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeMeta(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .slice(0, 24)
      .reduce((acc, [key, entry]) => {
        const safeKey = cleanString(key, { field: "Analytics meta key", max: 80 });
        if (!safeKey) return acc;
        acc[safeKey] = sanitizeMeta(entry, depth + 1);
        return acc;
      }, {});
  }
  return undefined;
}

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
    if (!ALLOWED_TYPES.has(type)) {
      throw new AppError("Unsupported analytics event type", 400);
    }

    const ip = String(req.ip || "unknown").trim();
    assertRateLimit({
      key: `analytics:${ip}:${type}`,
      limit: 160,
      windowMs: 15 * 60 * 1000,
      message: "Too many analytics events. Please slow down.",
    });

    await AnalyticsEvent.create({
      type,
      name,
      page: cleanString(req.body?.page, { field: "Analytics page", max: 80 }),
      path: cleanString(req.body?.path, { field: "Analytics path", max: 180 }),
      sessionId: cleanString(req.body?.sessionId, {
        field: "Analytics session id",
        max: 120,
      }),
      anonymousId: cleanString(req.body?.anonymousId, {
        field: "Analytics anonymous id",
        max: 120,
      }),
      user: req.user?._id || null,
      meta: sanitizeMeta(req.body?.meta || {}),
    });

    res.status(202).json({ accepted: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
