require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const connectDB = require("./config/db");
const setupSocket = require("./socket/chat");
const AppError = require("./utils/appError");
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

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

// ─── Allowed origins for CORS ───
const ALLOWED_ORIGINS = [
  "http://localhost:5000",
  "http://localhost:3000",
  "http://127.0.0.1:5000",
  process.env.FRONTEND_URL, // optional: set in .env for production
  process.env.RENDER_EXTERNAL_URL,
].filter(Boolean);

// Socket.io
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

// Make io accessible in routes
app.set("io", io);

// Setup Socket.io handlers
app.set("socketState", setupSocket(io));

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Middleware
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, same-origin)
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // In dev, allow all; tighten in production
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

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

app.use("/api/auth", authRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/users", userRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/stories", storyRoutes);
app.use("/api/videos", videoRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/push-subscriptions", pushSubscriptionRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/mandir", mandirRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/translate", translationRoutes);
app.use("/api/support", supportRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    email: isEmailDeliveryConfigured() ? "configured" : "NOT_CONFIGURED",
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

  if (statusCode >= 500) {
    console.error("Server error:", err);
  }

  res.status(statusCode).json({
    error: err.message || "Internal server error",
    ...(err.details ? { details: err.details } : {}),
  });
});

// Connect DB (Mongoose handles connection pooling automatically)
connectDB().catch(console.error);

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
    }, 15 * 60 * 1000); // 15 minutes
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
