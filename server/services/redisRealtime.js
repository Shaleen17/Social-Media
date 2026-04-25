const { createAdapter } = require("@socket.io/redis-adapter");
const { createClient } = require("redis");
const RedisPresenceStore = require("./redisPresence");
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

async function initializeRedisRealtime(io, socketState) {
  const config = getRedisConfig();
  if (!config.enabled) {
    log("info", "Redis realtime disabled", {
      reason: "REDIS_ENABLED is false and no Redis connection is configured",
    });
    return { enabled: false, adapterEnabled: false, presenceEnabled: false };
  }

  if (!config.url && !config.host) {
    log("warn", "Redis realtime skipped", {
      reason: "Set REDIS_URL or REDIS_HOST to enable Redis pub/sub",
    });
    return { enabled: false, adapterEnabled: false, presenceEnabled: false };
  }

  const clientOptions = buildRedisClientOptions(config);
  const pubClient = createClient(clientOptions);
  const subClient = pubClient.duplicate();
  const presenceClient = pubClient.duplicate();

  attachRedisLogging(pubClient, "socket-pub");
  attachRedisLogging(subClient, "socket-sub");
  attachRedisLogging(presenceClient, "presence");

  try {
    await Promise.all([
      pubClient.connect(),
      subClient.connect(),
      presenceClient.connect(),
    ]);

    io.adapter(createAdapter(pubClient, subClient));
    socketState.attachRedisPresence(
      new RedisPresenceStore(presenceClient, {
        keyPrefix: config.keyPrefix,
        ttlSeconds: config.presenceTtlSeconds,
      })
    );

    log("info", "Redis realtime enabled", {
      adapterEnabled: true,
      presenceEnabled: true,
      keyPrefix: config.keyPrefix,
      presenceTtlSeconds: config.presenceTtlSeconds,
      tls: config.tls,
    });

    return {
      enabled: true,
      adapterEnabled: true,
      presenceEnabled: true,
      clients: {
        pubClient,
        subClient,
        presenceClient,
      },
    };
  } catch (error) {
    socketState.attachRedisPresence(null);
    await Promise.all([
      safeQuit(pubClient),
      safeQuit(subClient),
      safeQuit(presenceClient),
    ]);

    log("warn", "Redis realtime unavailable, using local socket state only", {
      error: error.message,
    });

    return {
      enabled: false,
      adapterEnabled: false,
      presenceEnabled: false,
      error,
    };
  }
}

module.exports = {
  initializeRedisRealtime,
};
