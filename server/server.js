require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const setupSocket = require("./socket/chat");
const { initializeRedisRealtime } = require("./services/redisRealtime");
const AppError = require("./utils/appError");
const securityHeaders = require("./middleware/securityHeaders");
const { csrfCookieBootstrap, csrfProtection } = require("./middleware/csrf");
const {
  apiLimiter,
  authLimiter,
  uploadLimiter,
  writeLimiter,
} = require("./middleware/rateLimit");
const { log, logError, requestLogger } = require("./utils/logger");
const {
  getMonitoringSnapshot,
  monitoringMiddleware,
  recordError,
} = require("./services/monitoringService");
const { scheduleDatabaseBackups } = require("./services/backupService");
const {
  verifyEmailTransport,
  isEmailDeliveryConfigured,
  assertEmailDeliveryConfigured,
  shouldVerifyBeforeSend,
} = require("./utils/sendEmail");

// ─── Validate Required Environment Variables ───
const REQUIRED_ENV = [
  "MONGODB_URI",
  "JWT_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error("\n❌ Missing required environment variables:");
  missing.forEach((key) => console.error(`   • ${key}`));
  console.error(
    "\n   Copy server/.env.example to server/.env and fill in your credentials.\n"
  );
  process.exit(1);
}

// Route imports
const authRoutes = require("./routes/auth");
const {
  forgotPassword,
  resetPassword,
} = require("./controllers/authController");
const postRoutes = require("./routes/posts");
const userRoutes = require("./routes/users");
const messageRoutes = require("./routes/messages");
const storyRoutes = require("./routes/stories");
const videoRoutes = require("./routes/videos");
const notificationRoutes = require("./routes/notifications");
const pushSubscriptionRoutes = require("./routes/pushSubscriptions");
const uploadRoutes = require("./routes/upload");
const mandirRoutes = require("./routes/mandir");
const paymentRoutes = require("./routes/payments");
const translationRoutes = require("./routes/translation");
const supportRoutes = require("./routes/support");
const emailCampaignRoutes = require("./routes/emailCampaign");
const adminRoutes = require("./routes/admin");
const searchRoutes = require("./routes/search");
const analyticsRoutes = require("./routes/analytics");
const { startEmailCampaignWorker } = require("./services/emailCampaignService");

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

// ─── Allowed origins for CORS ───
const ALLOWED_ORIGINS = [
  "http://localhost:5000",
  "http://localhost:3000",
  "http://127.0.0.1:5000",
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL, // optional: set in .env for production
  process.env.SERVER_URL,
  process.env.RENDER_EXTERNAL_URL,
].filter(Boolean);
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return !IS_PRODUCTION;
}

// Socket.io
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      callback(null, isOriginAllowed(origin));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  },
});

// Make io accessible in routes
app.set("io", io);

// Setup Socket.io handlers
const socketState = setupSocket(io);
app.set("socketState", socketState);
initializeRedisRealtime(io, socketState).catch((error) =>
  log("warn", "Redis realtime bootstrap failed", {
    error: error.message,
  })
);

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Middleware
app.use(securityHeaders);
app.use(monitoringMiddleware);
app.use(requestLogger);
app.use(
  cors({
    origin: function (origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new AppError("Origin is not allowed by CORS", 403));
      }
    },
    credentials: true,
    exposedHeaders: ["x-csrf-token", "x-page", "x-limit", "x-has-more"],
  })
);
app.use("/api", apiLimiter);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "10mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENCODED_BODY_LIMIT || "2mb" }));
app.use(csrfCookieBootstrap);
app.use(csrfProtection);

// Serve static files from public/ directory
app.use(
  express.static(path.join(__dirname, "..", "public"), {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (/sw\.js$/i.test(filePath) || /\.html$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.setHeader("Surrogate-Control", "no-store");
      } else if (
        /\.(js|css|png|jpg|jpeg|gif|webp|avif|svg|ico|woff2?|ttf|mp4|webmanifest)$/i.test(
          filePath
        )
      ) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  })
);

// API routes
// Register reset endpoints directly as deployment-safe aliases. The auth router
// still owns the full auth surface, but these keep reset working if a deployed
// platform serves the main server file before the router bundle is refreshed.
app.post("/api/auth/forgot-password", forgotPassword);
app.post("/api/auth/password/forgot", forgotPassword);
app.post("/api/auth/reset-password", resetPassword);
app.post("/api/auth/password/reset", resetPassword);

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/posts", writeLimiter, postRoutes);
app.use("/api/users", writeLimiter, userRoutes);
app.use("/api/messages", writeLimiter, messageRoutes);
app.use("/api/stories", writeLimiter, storyRoutes);
app.use("/api/videos", writeLimiter, videoRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/push-subscriptions", writeLimiter, pushSubscriptionRoutes);
app.use("/api/upload", uploadLimiter, uploadRoutes);
app.use("/api/mandir", writeLimiter, mandirRoutes);
app.use("/api/payments", writeLimiter, paymentRoutes);
app.use("/api/translate", writeLimiter, translationRoutes);
app.use("/api/support", writeLimiter, supportRoutes);
app.use("/api/email-campaign", emailCampaignRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/analytics", analyticsRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    dbState: mongoose.connection.readyState,
    memory: process.memoryUsage(),
    email: isEmailDeliveryConfigured() ? "configured" : "NOT_CONFIGURED",
  });
});

app.get("/api/health/ready", (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  res.status(dbReady ? 200 : 503).json({
    status: dbReady ? "ready" : "not_ready",
    dbState: mongoose.connection.readyState,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health/metrics", (req, res) => {
  const snapshot = getMonitoringSnapshot();
  res.json({
    status: "ok",
    startedAt: snapshot.startedAt,
    uptimeSeconds: snapshot.uptimeSeconds,
    memory: snapshot.memory,
    totalRequests: snapshot.totalRequests,
    totalApiRequests: snapshot.totalApiRequests,
    totalErrors: snapshot.totalErrors,
    statusCounts: snapshot.statusCounts,
  });
});

// Email SMTP diagnostic endpoint — visit this URL on Render to instantly check if email works
// URL: https://tirth-sutra-backend.onrender.com/api/health/email
app.get("/api/health/email", async (req, res) => {
  if (!isEmailDeliveryConfigured()) {
    const missing = ["SMTP_HOST","SMTP_PORT","SMTP_SECURE","SMTP_USER","SMTP_PASS","EMAIL_FROM"]
      .filter((k) => !process.env[k]);
    return res.status(503).json({
      status: "error",
      message: "SMTP is NOT configured. OTP emails will fail.",
      missingEnvVars: missing,
      fix: "Add these environment variables in your Render dashboard under Environment tab.",
    });
  }
  try {
    await verifyEmailTransport();
    res.json({
      status: "ok",
      message: "SMTP connection verified. OTP emails should work.",
      smtpHost: process.env.SMTP_HOST,
      smtpPort: process.env.SMTP_PORT,
      smtpUser: process.env.SMTP_USER,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "SMTP credentials are set but the connection FAILED.",
      error: err.message,
      smtpHost: process.env.SMTP_HOST,
      smtpUser: process.env.SMTP_USER,
      fix: "Check that SMTP_PASS is a valid Gmail App Password (16 chars, no spaces). Ensure 2-Step Verification is ON for the Gmail account.",
    });
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

// Catch-all: serve index.html for SPA
app.get("*", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Error handling middleware
app.use((err, req, res, next) => {
  const statusCode =
    err instanceof AppError ? err.statusCode : err.statusCode || 500;

  recordError(err, req);
  logError(err, req);

  res.status(statusCode).json({
    error:
      statusCode >= 500 && process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message || "Internal server error",
    ...(err.details ? { details: err.details } : {}),
  });
});

// Connect DB (Mongoose handles connection pooling automatically)
connectDB()
  .then(() => {
    startEmailCampaignWorker();
    scheduleDatabaseBackups();
  })
  .catch((error) => log("error", "Database startup failed", { error: error.message }));

const PORT = process.env.PORT || 5000;
const SHOULD_VERIFY_SMTP_ON_STARTUP =
  String(process.env.SMTP_VERIFY_ON_STARTUP || "false").toLowerCase() === "true";

// Only start the server listening if NOT running on Vercel
if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`
🕉  Tirth Sutra Server Running
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Port:     ${PORT}
   Mode:     ${process.env.NODE_ENV || "development"}
   API:      http://localhost:${PORT}/api
   App:      http://localhost:${PORT}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);

    // KEEP-ALIVE PING: Prevent Render free tier from sleeping
    // Render sleeps after 15 mins of inactivity. Ping it every 14 mins.
    const RENDER_URL = process.env.RENDER_EXTERNAL_URL || "https://tirth-sutra-backend.onrender.com";
    setInterval(() => {
      try {
        fetch(`${RENDER_URL}/api/health`)
          .then(res => console.log(`[Keep-Alive] Ping status: ${res.status}`))
          .catch(err => console.error(`[Keep-Alive] Ping network error:`, err.message));
      } catch (err) {
        console.error(`[Keep-Alive] Ping setup error:`, err.message);
      }
    }, 13 * 60 * 1000); // 13 min -- keeps Render free tier awake
  });

  // Verify SMTP on startup only when explicitly enabled in env.
  if (isEmailDeliveryConfigured()) {
    if (SHOULD_VERIFY_SMTP_ON_STARTUP) {
      console.log("📧 SMTP configured — verifying connection on startup...");
      verifyEmailTransport()
        .then(() => {
          console.log("✅ SMTP ready — OTP emails will be delivered.");
        })
        .catch((err) => {
          console.error(
            "❌ SMTP startup check FAILED — OTP emails will NOT be delivered.\n" +
            "   Error:", err.message, "\n" +
            "   Fix: Check SMTP_USER / SMTP_PASS in Render Environment Variables.\n" +
            "   Gmail requires a 16-char App Password (Google Account → Security → App Passwords)."
          );
        });
    } else {
      console.log(
        `SMTP startup verification skipped (SMTP_VERIFY_ON_STARTUP=false). ` +
        `Per-send verification is ${shouldVerifyBeforeSend() ? "enabled" : "disabled"}.`
      );
    }
  } else {
    console.error(
      "❌ SMTP is NOT configured — OTP emails will NOT be delivered.\n" +
      "   Missing: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM\n" +
      "   Fix: Add these in your Render dashboard → Environment tab."
    );
  }
}

// Export the Express API for Vercel Serverless
module.exports = app;
