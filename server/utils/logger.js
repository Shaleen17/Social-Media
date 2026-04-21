const fs = require("fs");
const path = require("path");

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, "..", "logs");
const WRITE_FILE_LOGS =
  !process.env.VERCEL &&
  String(process.env.FILE_LOGS_ENABLED || "true").toLowerCase() !== "false";

function safeHeaders(req) {
  const headers = { ...(req.headers || {}) };
  delete headers.authorization;
  delete headers.cookie;
  delete headers["x-api-key"];
  return headers;
}

function writeFileLog(entry) {
  if (!WRITE_FILE_LOGS) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    fs.appendFile(
      path.join(LOG_DIR, `${day}.log`),
      JSON.stringify(entry) + "\n",
      () => {}
    );
  } catch {
    // Console logging below still works if the filesystem is read-only.
  }
}

function log(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  writeFileLog(entry);

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function logError(error, req, extra = {}) {
  log("error", error.message || "Server error", {
    stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
    statusCode: error.statusCode || 500,
    path: req?.originalUrl,
    method: req?.method,
    ip: req?.ip,
    userId: req?.user?._id?.toString(),
    headers: req ? safeHeaders(req) : undefined,
    ...extra,
  });
}

function requestLogger(req, res, next) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const shouldLog =
      req.originalUrl?.startsWith("/api/") &&
      (res.statusCode >= 400 || durationMs > Number(process.env.SLOW_REQUEST_MS || 1200));

    if (!shouldLog) return;

    log(res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info", "HTTP request", {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      userId: req.user?._id?.toString(),
    });
  });

  next();
}

module.exports = {
  log,
  logError,
  requestLogger,
};
