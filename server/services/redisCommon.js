const { log } = require("../utils/logger");

function parseBoolean(value, defaultValue = false) {
  if (value == null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseNumber(value, fallback, minimum = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

function normalizeRedisUrl(url, tls) {
  const raw = String(url || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "redis:" || parsed.protocol === "rediss:") {
      parsed.protocol = tls ? "rediss:" : "redis:";
      return parsed.toString();
    }
  } catch {}

  return raw;
}

function getRedisConfig() {
  const url = String(process.env.REDIS_URL || "").trim();
  const host = String(process.env.REDIS_HOST || "").trim();
  const username = String(process.env.REDIS_USERNAME || "").trim();
  const password = String(process.env.REDIS_PASSWORD || "").trim();
  const db = String(process.env.REDIS_DB || "").trim();
  const tlsExplicit = process.env.REDIS_TLS != null && process.env.REDIS_TLS !== "";
  const tls = parseBoolean(process.env.REDIS_TLS, url.startsWith("rediss://"));
  const enabled = parseBoolean(
    process.env.REDIS_ENABLED,
    Boolean(url || host)
  );

  return {
    enabled,
    url,
    host,
    port: parseNumber(process.env.REDIS_PORT, 6379, 1),
    username,
    password,
    db: db === "" ? null : parseNumber(db, 0, 0),
    tls,
    tlsExplicit,
    keyPrefix: String(process.env.REDIS_KEY_PREFIX || "tirthsutra").trim(),
    presenceTtlSeconds: parseNumber(
      process.env.REDIS_PRESENCE_TTL_SECONDS,
      90,
      30
    ),
    cacheEnabled: enabled && parseBoolean(process.env.REDIS_CACHE_ENABLED, true),
    cacheDefaultTtlSeconds: parseNumber(
      process.env.REDIS_CACHE_DEFAULT_TTL_SECONDS,
      120,
      15
    ),
  };
}

function describeRedisConfigIssue(error) {
  const message = String(error?.message || error || "");
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("tls_get_more_records:packet length too long") ||
    lowerMessage.includes("wrong version number") ||
    lowerMessage.includes("unknown protocol")
  ) {
    return "Redis TLS/plain mismatch. Check REDIS_URL and REDIS_TLS so the endpoint protocol matches the Redis port.";
  }

  if (
    lowerMessage.includes("self-signed certificate") ||
    lowerMessage.includes("certificate has expired") ||
    lowerMessage.includes("no alternative certificate subject name")
  ) {
    return "Redis TLS certificate validation failed. Check the Redis host, certificate chain, and REDIS_TLS settings.";
  }

  if (
    lowerMessage.includes("wrongpass") ||
    lowerMessage.includes("invalid username-password pair") ||
    lowerMessage.includes("noauth authentication required") ||
    lowerMessage.includes("client sent auth, but no password is set")
  ) {
    return "Redis authentication is misconfigured. Check REDIS_USERNAME and REDIS_PASSWORD.";
  }

  if (lowerMessage.includes("invalid url")) {
    return "Redis connection URL is invalid. Check REDIS_URL formatting.";
  }

  return "";
}

function isRedisFatalConnectionError(error) {
  return Boolean(describeRedisConfigIssue(error));
}

function reconnectStrategy(retries, cause) {
  if (isRedisFatalConnectionError(cause)) {
    return new Error(describeRedisConfigIssue(cause));
  }

  return Math.min(5000, 250 + retries * 250);
}

function buildRedisClientOptions(config) {
  const normalizedUrl = normalizeRedisUrl(config.url, config.tls);

  if (config.url) {
    const options = {
      url: normalizedUrl,
      socket: {
        reconnectStrategy,
      },
    };

    try {
      const parsed = new URL(normalizedUrl);
      if (config.tls) {
        options.socket.tls = true;
        options.socket.servername = parsed.hostname;
      }
    } catch {}

    return options;
  }

  const socket = {
    host: config.host,
    port: config.port,
    reconnectStrategy,
  };

  if (config.tls) {
    socket.tls = true;
    socket.servername = config.host;
  }

  const options = { socket };

  if (config.username) options.username = config.username;
  if (config.password) options.password = config.password;
  if (config.db != null) options.database = config.db;

  return options;
}

function attachRedisLogging(client, name) {
  let lastLoggedMessage = "";
  let lastLoggedAt = 0;

  client.on("error", (error) => {
    const message = String(error?.message || error || "");
    const now = Date.now();

    if (message && message === lastLoggedMessage && now - lastLoggedAt < 30000) {
      return;
    }

    lastLoggedMessage = message;
    lastLoggedAt = now;

    const hint = describeRedisConfigIssue(error);

    log("warn", "Redis client error", {
      client: name,
      error: message,
      ...(hint ? { hint } : {}),
    });
  });
}

async function safeQuit(client) {
  if (!client?.isOpen) return;
  try {
    await client.quit();
  } catch {
    try {
      await client.disconnect();
    } catch {}
  }
}

module.exports = {
  attachRedisLogging,
  buildRedisClientOptions,
  describeRedisConfigIssue,
  getRedisConfig,
  isRedisFatalConnectionError,
  normalizeRedisUrl,
  parseBoolean,
  parseNumber,
  reconnectStrategy,
  safeQuit,
};
