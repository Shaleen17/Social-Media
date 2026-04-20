const mongoose = require("mongoose");
const {
  requestPasswordReset,
  resetPasswordWithOtp,
} = require("../server/services/authService");

let mongoConnectionPromise = null;

function setJsonHeaders(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Content-Type", "application/json");
}

async function connectDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!process.env.MONGODB_URI) {
    const error = new Error(
      "Password reset is not configured on this deployment. Add MONGODB_URI and SMTP environment variables."
    );
    error.statusCode = 503;
    throw error;
  }

  if (!mongoConnectionPromise) {
    mongoConnectionPromise = mongoose.connect(process.env.MONGODB_URI);
  }

  return mongoConnectionPromise;
}

function getRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function getRequestContext(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();

  return {
    ip: forwardedFor || req.socket?.remoteAddress || "unknown",
    userAgent: req.headers["user-agent"] || "",
  };
}

function sendError(res, error) {
  const statusCode = error.statusCode || error.status || 500;
  if (statusCode >= 500) {
    console.error("Password reset API error:", error);
  }

  res.status(statusCode).json({
    error: error.message || "Internal server error",
    ...(error.details ? { details: error.details } : {}),
  });
}

function createPasswordResetHandler(action) {
  return async function passwordResetHandler(req, res) {
    setJsonHeaders(req, res);

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      await connectDatabase();
      const payload = getRequestBody(req);
      const context = getRequestContext(req);
      const result =
        action === "reset"
          ? await resetPasswordWithOtp(payload, context)
          : await requestPasswordReset(payload, context);

      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  };
}

module.exports = {
  createPasswordResetHandler,
};
