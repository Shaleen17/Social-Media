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
const { isDailyConfigured, getDailyPublicConfig } = require("./services/dailyCallService");
const {
  getRedisCacheState,
  initializeRedisCache,
} = require("./services/redisCache");
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
  getEmailDeliveryProvider,
  getEffectiveEmailDeliveryProvider,
  getEmailConfigurationDiagnostics,
  getEmailConfigurationFixMessage,
  getEmailTransportSettings,
  isBrevoSmtpUnauthorizedIpError,
  shouldVerifyBeforeSend,
} = require("./utils/sendEmail");

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const CALLING_PROVIDER = String(process.env.CALLING_PROVIDER || "daily").toLowerCase();
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const LEGAL_STATIC_PAGES = Object.freeze({
  "/privacy-policy": "privacy-policy",
  "/terms-and-conditions": "terms-and-conditions",
  "/refund-cancellation-policy": "refund-cancellation-policy",
  "/donation-policy": "donation-policy",
  "/shipping-delivery-policy": "shipping-delivery-policy",
});

function setNoStoreHtmlHeaders(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

// ─── Validate Required Environment Variables ───
const REQUIRED_ENV = [
  "MONGODB_URI",
  "JWT_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  ...(IS_PRODUCTION && CALLING_PROVIDER === "daily"
    ? ["DAILY_API_KEY", "DAILY_DOMAIN"]
    : []),
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
const founderRoutes = require("./routes/founder");
const bootstrapRoutes = require("./routes/bootstrap");
const feedRoutes = require("./routes/feed");
const cronRoutes = require("./routes/cron");
const callRoutes = require("./routes/calls");
const { startEmailCampaignWorker } = require("./services/emailCampaignService");
const { startInlineCronScheduler } = require("./cron/scheduler");

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
initializeRedisCache().catch((error) =>
  log("warn", "Redis cache bootstrap failed", {
    error: error.message,
  })
);
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

Object.entries(LEGAL_STATIC_PAGES).forEach(([routePath, directoryName]) => {
  app.get(routePath, (req, res) => {
    setNoStoreHtmlHeaders(res);
    res.sendFile(path.join(PUBLIC_DIR, directoryName, "index.html"));
  });
});

// Serve static files from public/ directory
app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (/sw\.js$/i.test(filePath) || /\.html$/i.test(filePath)) {
        setNoStoreHtmlHeaders(res);
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
app.use("/api/founder", founderRoutes);
app.use("/api/bootstrap", bootstrapRoutes);
app.use("/api/feed", feedRoutes);
app.use("/api/cron", cronRoutes);
app.use("/api/calls", writeLimiter, callRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    dbState: mongoose.connection.readyState,
    memory: process.memoryUsage(),
    redisCache: getRedisCacheState(),
    email: isEmailDeliveryConfigured() ? "configured" : "NOT_CONFIGURED",
  });
});

app.get("/api/health/ready", (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  res.status(dbReady ? 200 : 503).json({
    status: dbReady ? "ready" : "not_ready",
    dbState: mongoose.connection.readyState,
    redisCache: getRedisCacheState(),
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

// Email delivery diagnostic endpoint — useful locally and in production to instantly check if OTP email works
// URL: https://tirth-sutra-backend.onrender.com/api/health/email
app.get("/api/health/email", async (req, res) => {
  const configuredProvider = getEmailDeliveryProvider();
  const provider = getEffectiveEmailDeliveryProvider();
  const diagnostics = getEmailConfigurationDiagnostics(provider);
  const { family, host, port } = getEmailTransportSettings();

  if (!diagnostics.configured) {
    return res.status(503).json({
      status: "error",
      provider,
      message: `Email delivery is not configured for ${provider}. OTP emails will fail.`,
      missingEnvVars: diagnostics.missing,
      selection: diagnostics.selection,
      fix: getEmailConfigurationFixMessage(provider),
    });
  }

  try {
    const verification = await verifyEmailTransport();
    const verifiedProvider = verification?.provider || provider;
    return res.json({
      status: "ok",
      provider: verifiedProvider,
      configuredProvider,
      selection: diagnostics.selection,
      fallback: !!verification?.fallback,
      failedProvider: verification?.failedProvider || null,
      message:
        verification?.fallback
          ? "Brevo API failed, but the configured SMTP fallback verified. OTP emails should work through SMTP."
          : verifiedProvider === "brevo"
          ? "Brevo API verified. OTP emails should work."
          : "SMTP connection verified. OTP emails should work.",
    });
  } catch (err) {
    const providerMessage = String(
      err.details?.providerMessage || err.rawErrorMessage || err.message || ""
    );
    const isBrevoSmtpHost = /smtp-relay\.brevo\.com/i.test(String(host || ""));
    const isBrevoSmtpUnauthorizedIp =
      provider === "smtp" &&
      isBrevoSmtpUnauthorizedIpError(
        { message: providerMessage || err.message || "" },
        host,
      );
    const isSmtpNetworkUnreachable =
      provider === "smtp" && /ENETUNREACH|EHOSTUNREACH/i.test(providerMessage);

    return res.status(500).json({
      status: "error",
      provider,
      message:
        provider === "brevo"
          ? "Brevo API verification failed."
          : "SMTP verification failed.",
      missingEnvVars: diagnostics.missing,
      ...(provider === "brevo" ? { brevoApiVerified: false } : {}),
      ...(provider === "smtp"
        ? { smtpFamily: family || "auto", smtpUnauthorizedIp: isBrevoSmtpUnauthorizedIp }
        : {}),
      rawErrorCode: err.code || "UNKNOWN",
      rawErrorMessage: err.message,
      providerMessage: providerMessage || null,
      responseStatus: err.responseStatus || err.details?.responseStatus || null,
      rawErrorResponse: err.responseBody || err.details?.responseBody || null,
      diagnosis:
        provider === "brevo"
          ? err.code === "EAUTH"
            ? "Brevo rejected the API key. The BREVO_API_KEY may be invalid, revoked, or entered incorrectly."
            : err.code === "ECONNECTION" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND"
              ? "Cannot reach the Brevo API from this server."
              : err.code === "EBREVO"
                ? "Brevo rejected the request. The sender email may not be verified, or the payload may be invalid."
                : "Unexpected Brevo error. Check the response payload for details."
          : err.code === "EAUTH"
            ? isBrevoSmtpUnauthorizedIp
              ? "Brevo SMTP rejected this server IP address. Add the IP to Brevo's authorized IP list, or switch to a valid BREVO_API_KEY."
              : isBrevoSmtpHost
                ? "Brevo SMTP rejected the login. Check the SMTP login/password, and verify that Brevo has not restricted this IP."
                : "Gmail rejected the password. The App Password may be wrong or 2-Step Verification may be off."
          : err.code === "ECONNECTION" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND"
              ? `Cannot reach ${host} from this server. The hosting provider may be blocking outgoing SMTP on port ${port}.`
              : err.code === "ESOCKET"
                ? isSmtpNetworkUnreachable
                  ? `Cannot reach ${host} over the selected network family (${family || "auto"}). Try SMTP_FAMILY=4 to force IPv4.`
                  : "TLS/SSL handshake failed. Try SMTP_SECURE=true with SMTP_PORT=465."
                : "Unexpected SMTP error. Check rawErrorCode and rawErrorMessage for details.",
      fix:
        provider === "brevo"
          ? "Check BREVO_API_KEY, EMAIL_FROM, and EMAIL_FROM_NAME. EMAIL_FROM must be a Brevo-verified sender."
          : isBrevoSmtpUnauthorizedIp
            ? "Authorize this machine/server IP in Brevo Security settings, or switch production to EMAIL_DELIVERY_PROVIDER=brevo with a valid BREVO_API_KEY."
            : isBrevoSmtpHost
              ? "Check the Brevo SMTP login/password and confirm this IP is allowed in Brevo."
              : "Check that SMTP_PASS is a valid Gmail App Password and ensure the hosting provider allows outbound SMTP.",
    });
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

// Catch-all: serve index.html for SPA
app.get("*", (req, res) => {
  setNoStoreHtmlHeaders(res);
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// Error handling middleware
app.use((err, req, res, next) => {
  const statusCode =
    err instanceof AppError ? err.statusCode : err.statusCode || 500;

  recordError(err, req);
  logError(err, req);

  const shouldExposeMessage =
    err instanceof AppError ||
    statusCode < 500 ||
    process.env.NODE_ENV !== "production";

  res.status(statusCode).json({
    error: shouldExposeMessage
      ? err.message || "Internal server error"
      : "Internal server error",
    ...(err.details ? { details: err.details } : {}),
  });
});

// Connect DB (Mongoose handles connection pooling automatically)
connectDB()
  .then(() => {
    startEmailCampaignWorker();
    startInlineCronScheduler();
    scheduleDatabaseBackups();
  })
  .catch((error) => log("error", "Database startup failed", { error: error.message }));

const PORT = process.env.PORT || 5000;
const SHOULD_VERIFY_EMAIL_ON_STARTUP =
  String(process.env.SMTP_VERIFY_ON_STARTUP || "false").toLowerCase() === "true";

// Only start the server listening if NOT running on Vercel
if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    const dailyReady = isDailyConfigured();
    console.log(`
🕉  Tirth Sutra Server Running
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Port:     ${PORT}
   Mode:     ${process.env.NODE_ENV || "development"}
   API:      http://localhost:${PORT}/api
   App:      http://localhost:${PORT}
   Calls:    ${dailyReady ? "✅ Daily.co configured" : "❌ NOT configured — calls will fail"}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
    if (!dailyReady) {
      console.error(
        "❌ Voice/video calling is NOT configured.\n" +
        "   Missing: DAILY_API_KEY and/or DAILY_DOMAIN in .env\n" +
        "   Fix: Add DAILY_API_KEY and DAILY_DOMAIN from https://dashboard.daily.co/developers"
      );
    }

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

  // Verify email delivery on startup only when explicitly enabled in env.
  if (isEmailDeliveryConfigured()) {
    const configuredEmailProvider = getEmailDeliveryProvider();
    const emailProvider = getEffectiveEmailDeliveryProvider();
    const providerLabel = emailProvider === "brevo" ? "Brevo API" : "SMTP";

    if (SHOULD_VERIFY_EMAIL_ON_STARTUP) {
      console.log(
        `Active email provider: ${providerLabel}` +
        (configuredEmailProvider !== emailProvider
          ? ` (configured provider ${configuredEmailProvider} is falling back to ${emailProvider})`
          : "")
      );
      console.log(`📧 ${providerLabel} configured — verifying connection on startup...`);
      verifyEmailTransport()
        .then(() => {
          console.log(`✅ ${providerLabel} ready — OTP emails will be delivered.`);
        })
        .catch((err) => {
          console.error(
            `❌ ${providerLabel} startup check FAILED — OTP emails will NOT be delivered.\n` +
            "   Error:", err.message, "\n" +
            `   Fix: ${getEmailConfigurationFixMessage(emailProvider)}\n` +
            "   Brevo SMTP may require the current IP to be authorized."
          );
        });
    } else {
      console.log(
        `Email delivery startup verification skipped (SMTP_VERIFY_ON_STARTUP=false). ` +
        `Active provider: ${emailProvider}. ` +
        `Per-send verification is ${shouldVerifyBeforeSend() ? "enabled" : "disabled"}.`
      );
    }
  } else {
    const diagnostics = getEmailConfigurationDiagnostics();
    console.error(
      `❌ Email delivery is NOT configured for ${diagnostics.provider} — OTP emails will NOT be delivered.\n` +
      `   Missing: ${diagnostics.missing.join(", ")}\n` +
      `   Fix: ${getEmailConfigurationFixMessage(diagnostics.provider)}`
    );
  }
}

// Export the Express API for Vercel Serverless
module.exports = app;
