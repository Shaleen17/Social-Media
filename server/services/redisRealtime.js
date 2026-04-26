const { createAdapter } = require("@socket.io/redis-adapter");
const { createClient } = require("redis");
const RedisPresenceStore = require("./redisPresence");
const { log } = require("../utils/logger");
const {
  attachRedisLogging,
  buildRedisClientOptions,
  describeRedisConfigIssue,
  getRedisConfig,
  safeQuit,
} = require("./redisCommon");

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
    const hint = describeRedisConfigIssue(error);

    log("warn", "Redis realtime unavailable, using local socket state only", {
      error: error.message,
      ...(hint ? { hint } : {}),
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
