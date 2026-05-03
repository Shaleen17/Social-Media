const express = require("express");
const crypto = require("crypto");
const cronScheduler = require("../cron/scheduler");
const AppError = require("../utils/appError");
const { createRateLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const cronLimiter = createRateLimiter({
  keyPrefix: "cron",
  limit: Number(process.env.RATE_LIMIT_CRON_MAX || 30),
  windowMs: Number(process.env.RATE_LIMIT_CRON_WINDOW_MS || 15 * 60 * 1000),
  message: "Too many cron requests. Please wait before retrying.",
});

function getCronSecret(req) {
  return (
    req.get("x-cron-secret") ||
    String(req.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
    ""
  );
}

function secretsMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return next(new AppError("Cron secret is not configured", 503));
  }

  if (!secretsMatch(getCronSecret(req), secret)) {
    return next(new AppError("Not authorized", 403));
  }

  return next();
}

function parseRequestedJobNames(req) {
  const pathName = String(req.params.jobName || "").trim();
  if (pathName) return [pathName];

  const rawJobs =
    req.body?.jobs ||
    req.query.jobs ||
    req.body?.job ||
    req.query.job ||
    "";

  if (Array.isArray(rawJobs)) {
    return rawJobs.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(rawJobs || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function runJobs(req, res, next) {
  try {
    const requestedNames = parseRequestedJobNames(req);
    const result = await cronScheduler.runCronJobs(requestedNames, {
      trigger: req.get("x-cron-trigger") || "api",
    });
    const hasErrors = result.results.some((item) => item.status === "error");
    res.status(hasErrors ? 500 : 200).json(result);
  } catch (error) {
    next(error);
  }
}

router.get("/status", cronLimiter, requireCronSecret, async (req, res, next) => {
  try {
    res.json({
      jobs: await cronScheduler.getCronJobsOverview(),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/run/:jobName?", cronLimiter, requireCronSecret, runJobs);
router.post("/run/:jobName?", cronLimiter, requireCronSecret, runJobs);

module.exports = router;
