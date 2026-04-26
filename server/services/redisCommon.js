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

function getRedisConfig() {
  const url = String(process.env.REDIS_URL || "").trim();
  const host = String(process.env.REDIS_HOST || "").trim();
  const username = String(process.env.REDIS_USERNAME || "").trim();
  const password = String(process.env.REDIS_PASSWORD || "").trim();
  const db = String(process.env.REDIS_DB || "").trim();
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
    tls: parseBoolean(process.env.REDIS_TLS, url.startsWith("rediss://")),
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

function reconnectStrategy(retries) {
  return Math.min(5000, 250 + retries * 250);
}

function buildRedisClientOptions(config) {
  if (config.url) {
    return {
      url: config.url,
      socket: {
        reconnectStrategy,
      },
    };
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
  client.on("error", (error) => {
    log("warn", "Redis client error", {
      client: name,
      error: error.message,
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
  getRedisConfig,
  parseBoolean,
  parseNumber,
  safeQuit,
};
