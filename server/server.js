require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const connectDB = require("./config/db");
const setupSocket = require("./socket/chat");

// Route imports
const authRoutes = require("./routes/auth");
const postRoutes = require("./routes/posts");
const userRoutes = require("./routes/users");
const messageRoutes = require("./routes/messages");
const storyRoutes = require("./routes/stories");
const videoRoutes = require("./routes/videos");
const notificationRoutes = require("./routes/notifications");
const uploadRoutes = require("./routes/upload");

const app = express();
const server = http.createServer(app);

// Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

// Make io accessible in routes
app.set("io", io);

// Setup Socket.io handlers
setupSocket(io);

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Serve static files from public/ directory
app.use(express.static(path.join(__dirname, "..", "public")));

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/users", userRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/stories", storyRoutes);
app.use("/api/videos", videoRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/upload", uploadRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Catch-all: serve index.html for SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Connect DB (Mongoose handles connection pooling automatically)
connectDB().catch(console.error);

const PORT = process.env.PORT || 5000;

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
}

// Export the Express API for Vercel Serverless
module.exports = app;
