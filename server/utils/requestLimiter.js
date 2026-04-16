const AppError = require("./appError");

const requestWindows = new Map();

function purgeExpiredWindows(now) {
  if (requestWindows.size < 5000) {
    return;
  }

  for (const [key, entry] of requestWindows.entries()) {
    if (!entry || entry.resetAt <= now) {
      requestWindows.delete(key);
    }
  }
}

function assertRateLimit({ key, limit, windowMs, message }) {
  if (!key || !limit || !windowMs) {
    return;
  }

  const now = Date.now();
  purgeExpiredWindows(now);

  const current = requestWindows.get(key);
  if (!current || current.resetAt <= now) {
    requestWindows.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return;
  }

  if (current.count >= limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((current.resetAt - now) / 1000)
    );

    throw new AppError(
      message || "Too many requests. Please try again shortly.",
      429,
      { retryAfterSeconds }
    );
  }

  current.count += 1;
  requestWindows.set(key, current);
}

module.exports = {
  assertRateLimit,
};
