const { createClient } = require("redis");
const { log } = require("../utils/logger");
const {
  attachRedisLogging,
  buildRedisClientOptions,
  describeRedisConfigIssue,
  getRedisConfig,
  safeQuit,
} = require("./redisCommon");

let cacheClient = null;
let cacheInitPromise = null;
let cacheState = {
  enabled: false,
  configured: false,
  connected: false,
  keyPrefix: String(process.env.REDIS_KEY_PREFIX || "tirthsutra").trim(),
  defaultTtlSeconds: Math.max(
    15,
    Number(process.env.REDIS_CACHE_DEFAULT_TTL_SECONDS) || 120
  ),
  reason: "not_initialized",
};

function normalizeCacheKeyPart(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "_";
  return encodeURIComponent(normalized);
}

function getNamespaceBase(namespace) {
  const keyPrefix = cacheState.keyPrefix || getRedisConfig().keyPrefix;
  return `${keyPrefix}:cache:${normalizeCacheKeyPart(namespace)}`;
}

function buildRedisCacheKey(namespace, ...parts) {
  const flattened = parts.flat();
  const safeParts = flattened.map((part) => normalizeCacheKeyPart(part));
  const base = getNamespaceBase(namespace);
  return safeParts.length ? `${base}:${safeParts.join(":")}` : base;
}

function buildScanResult(reply) {
  if (!reply) return { cursor: "0", keys: [] };
  if (Array.isArray(reply)) {
    return {
      cursor: String(reply[0] || "0"),
      keys: Array.isArray(reply[1]) ? reply[1] : [],
    };
  }
  return {
    cursor: String(reply.cursor || "0"),
    keys: Array.isArray(reply.keys) ? reply.keys : [],
  };
}

function getRedisCacheState() {
  return {
    ...cacheState,
    connected: !!cacheClient?.isOpen && !!cacheState.connected,
  };
}

function isRedisCacheReady() {
  return !!cacheClient?.isOpen && !!cacheState.connected;
}

async function initializeRedisCache() {
  if (isRedisCacheReady()) {
    return getRedisCacheState();
  }
  if (cacheInitPromise) {
    return cacheInitPromise;
  }

  const config = getRedisConfig();
  const configured = Boolean(config.url || config.host);

  cacheState = {
    ...cacheState,
    enabled: !!config.cacheEnabled,
    configured,
    connected: false,
    keyPrefix: config.keyPrefix,
    defaultTtlSeconds: config.cacheDefaultTtlSeconds,
    reason: "initializing",
  };

  if (!config.enabled || !config.cacheEnabled) {
    cacheState = {
      ...cacheState,
      enabled: false,
      connected: false,
      reason: "redis_cache_disabled",
    };
    log("info", "Redis cache disabled", {
      reason: "REDIS_CACHE_ENABLED is false or Redis is not enabled",
    });
    return getRedisCacheState();
  }

  if (!configured) {
    cacheState = {
      ...cacheState,
      connected: false,
      reason: "redis_connection_not_configured",
    };
    log("warn", "Redis cache skipped", {
      reason: "Set REDIS_URL or REDIS_HOST to enable Redis cache",
    });
    return getRedisCacheState();
  }

  const client = createClient(buildRedisClientOptions(config));
  attachRedisLogging(client, "cache");

  cacheInitPromise = (async () => {
    try {
      await client.connect();
      cacheClient = client;
      cacheState = {
        ...cacheState,
        enabled: true,
        configured: true,
        connected: true,
        reason: "ready",
      };
      log("info", "Redis cache enabled", {
        keyPrefix: config.keyPrefix,
        defaultTtlSeconds: config.cacheDefaultTtlSeconds,
      });
      return getRedisCacheState();
    } catch (error) {
      cacheClient = null;
      cacheState = {
        ...cacheState,
        enabled: true,
        configured: true,
        connected: false,
        reason: "connection_failed",
      };
      await safeQuit(client);
      const hint = describeRedisConfigIssue(error);
      log("warn", "Redis cache unavailable, using MongoDB reads only", {
        error: error.message,
        ...(hint ? { hint } : {}),
      });
      return getRedisCacheState();
    } finally {
      cacheInitPromise = null;
    }
  })();

  return cacheInitPromise;
}

async function readRedisJsonCache(key) {
  if (!isRedisCacheReady()) {
    return { found: false, value: null };
  }

  try {
    const raw = await cacheClient.get(key);
    if (raw == null) {
      return { found: false, value: null };
    }
    return { found: true, value: JSON.parse(raw) };
  } catch (error) {
    log("warn", "Redis cache read failed", {
      key,
      error: error.message,
    });
    return { found: false, value: null };
  }
}

async function writeRedisJsonCache(key, value, ttlSeconds) {
  if (!isRedisCacheReady()) return false;

  try {
    await cacheClient.set(key, JSON.stringify(value), {
      EX: Math.max(
        15,
        Number(ttlSeconds) || getRedisCacheState().defaultTtlSeconds || 120
      ),
    });
    return true;
  } catch (error) {
    log("warn", "Redis cache write failed", {
      key,
      error: error.message,
    });
    return false;
  }
}

async function withRedisJsonCache(key, loadValue, options = {}) {
  const requestedTtl = Number(options.ttlSeconds);
  const ttlSeconds =
    Number.isFinite(requestedTtl) && requestedTtl > 0
      ? Math.max(15, requestedTtl)
      : getRedisCacheState().defaultTtlSeconds || 120;

  if (options.bypass || !isRedisCacheReady()) {
    return {
      status: options.bypass ? "BYPASS" : "OFF",
      value: await loadValue(),
    };
  }

  const cached = await readRedisJsonCache(key);
  if (cached.found) {
    return {
      status: "HIT",
      value: cached.value,
    };
  }

  const value = await loadValue();
  await writeRedisJsonCache(key, value, ttlSeconds);
  return {
    status: "MISS",
    value,
  };
}

function applyRedisCacheHeader(res, status) {
  if (!res || typeof res.setHeader !== "function") return;
  res.setHeader("X-Redis-Cache", status || "OFF");
}

async function scanRedisKeys(pattern) {
  if (!isRedisCacheReady()) return [];

  const found = [];
  let cursor = "0";

  do {
    const reply = buildScanResult(
      await cacheClient.scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      })
    );
    cursor = reply.cursor;
    if (reply.keys.length) {
      found.push(...reply.keys);
    }
  } while (cursor !== "0");

  return found;
}

async function invalidateRedisCacheNamespaces(namespaces = []) {
  if (!isRedisCacheReady()) return 0;

  const uniqueNamespaces = [...new Set(
    (Array.isArray(namespaces) ? namespaces : [namespaces])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];

  let deletedKeys = 0;

  for (const namespace of uniqueNamespaces) {
    const keys = await scanRedisKeys(`${getNamespaceBase(namespace)}:*`);
    if (!keys.length) continue;
    try {
      deletedKeys += await cacheClient.del(...keys);
    } catch (error) {
      log("warn", "Redis cache invalidation failed", {
        namespace,
        error: error.message,
      });
    }
  }

  return deletedKeys;
}

module.exports = {
  applyRedisCacheHeader,
  buildRedisCacheKey,
  getRedisCacheState,
  initializeRedisCache,
  invalidateRedisCacheNamespaces,
  isRedisCacheReady,
  withRedisJsonCache,
};
