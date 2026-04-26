const assert = require("node:assert/strict");
const { test } = require("../helpers/harness");

const {
  buildRedisClientOptions,
  getRedisConfig,
  reconnectStrategy,
} = require("../../services/redisCommon");

function withRedisEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const previous = {};

  keys.forEach((key) => {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value == null) delete process.env[key];
    else process.env[key] = String(value);
  });

  try {
    return fn();
  } finally {
    keys.forEach((key) => {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

test("redis config upgrades redis URL to TLS when REDIS_TLS is true", () => {
  withRedisEnv(
    {
      REDIS_URL: "redis://default:secret@example.redis.local:6379",
      REDIS_TLS: "true",
    },
    () => {
      const config = getRedisConfig();
      const options = buildRedisClientOptions(config);

      assert.equal(config.tls, true);
      assert.equal(
        options.url,
        "rediss://default:secret@example.redis.local:6379"
      );
      assert.equal(options.socket.tls, true);
      assert.equal(options.socket.servername, "example.redis.local");
    }
  );
});

test("redis config downgrades rediss URL when REDIS_TLS is false", () => {
  withRedisEnv(
    {
      REDIS_URL: "rediss://default:secret@example.redis.local:6379",
      REDIS_TLS: "false",
    },
    () => {
      const config = getRedisConfig();
      const options = buildRedisClientOptions(config);

      assert.equal(config.tls, false);
      assert.equal(
        options.url,
        "redis://default:secret@example.redis.local:6379"
      );
      assert.equal("tls" in options.socket, false);
    }
  );
});

test("redis reconnect strategy stops retrying on fatal TLS mismatch", () => {
  const retry = reconnectStrategy(
    1,
    new Error(
      "C0FC0DD12E7D0000:error:0A0000C6:SSL routines:tls_get_more_records:packet length too long"
    )
  );

  assert.ok(retry instanceof Error);
  assert.match(retry.message, /tls\/plain mismatch/i);
});
