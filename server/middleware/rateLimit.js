const { assertRateLimit } = require("../utils/requestLimiter");

function getClientKey(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwardedFor || req.ip || req.socket?.remoteAddress || "unknown";
}

function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const limit = options.limit || 300;
  const keyPrefix = options.keyPrefix || "route";
  const message = options.message || "Too many requests. Please try again shortly.";
  const keyGenerator = options.keyGenerator || getClientKey;
  const skip = options.skip || (() => false);

  return (req, res, next) => {
    try {
      if (skip(req)) return next();
      const clientKey = keyGenerator(req);
      assertRateLimit({
        key: `${keyPrefix}:${clientKey}`,
        limit,
        windowMs,
        message,
      });
      next();
    } catch (error) {
      if (error.details?.retryAfterSeconds) {
        res.setHeader("Retry-After", String(error.details.retryAfterSeconds));
      }
      next(error);
    }
  };
}

const apiLimiter = createRateLimiter({
  keyPrefix: "api",
  limit: Number(process.env.RATE_LIMIT_API_MAX || 900),
  windowMs: Number(process.env.RATE_LIMIT_API_WINDOW_MS || 15 * 60 * 1000),
});

const authLimiter = createRateLimiter({
  keyPrefix: "auth",
  limit: Number(process.env.RATE_LIMIT_AUTH_MAX || 80),
  windowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS || 15 * 60 * 1000),
  message: "Too many auth requests. Please wait and try again.",
});

const writeLimiter = createRateLimiter({
  keyPrefix: "write",
  limit: Number(process.env.RATE_LIMIT_WRITE_MAX || 180),
  windowMs: Number(process.env.RATE_LIMIT_WRITE_WINDOW_MS || 10 * 60 * 1000),
  message: "Too many actions. Please slow down for a moment.",
  skip: (req) => ["GET", "HEAD", "OPTIONS"].includes(req.method),
});

const uploadLimiter = createRateLimiter({
  keyPrefix: "upload",
  limit: Number(process.env.RATE_LIMIT_UPLOAD_MAX || 40),
  windowMs: Number(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS || 60 * 60 * 1000),
  message: "Too many uploads. Please try again later.",
});

module.exports = {
  apiLimiter,
  authLimiter,
  createRateLimiter,
  getClientKey,
  uploadLimiter,
  writeLimiter,
};
