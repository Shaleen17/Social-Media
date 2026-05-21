const mongoose = require("mongoose");
const { setDefaultResultOrder } = require("dns");
const { Resolver } = require("dns");

// ─── Fix: ISP/router DNS blocks MongoDB Atlas SRV lookups ───────────────────
// Force Node.js to use Cloudflare (1.1.1.1) + Google (8.8.8.8) DNS directly,
// bypassing the local router DNS that intercepts and refuses SRV queries for
// _mongodb._tcp.cluster0.*.mongodb.net (ECONNREFUSED on querySrv).
try {
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1:53", "8.8.8.8:53", "1.0.0.1:53"]);
  // Override the default resolver used by dns.lookup / dns.resolve*
  const dns = require("dns");
  dns.setDefaultResultOrder("ipv4first");
  dns.setServers(["1.1.1.1", "8.8.8.8", "1.0.0.1"]);
} catch (_) {
  // Non-fatal: older Node versions may not support setServers on global dns
}

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 10),
      minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE || 1),
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 10000),
      family: 4, // Force IPv4 to avoid IPv6 DNS resolution issues
    });
    console.log(`✅ MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
