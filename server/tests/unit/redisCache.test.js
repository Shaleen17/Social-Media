const assert = require("node:assert/strict");
const { test } = require("../helpers/harness");

const redisCache = require("../../services/redisCache");

test("redis cache builds stable cache keys", () => {
  assert.equal(
    redisCache.buildRedisCacheKey("search", "full", "Ganga Aarti", 12),
    "tirthsutra:cache:search:full:Ganga%20Aarti:12"
  );
});

test("redis cache falls back to MongoDB loader path when Redis is unavailable", async () => {
  let calls = 0;
  const result = await redisCache.withRedisJsonCache(
    "tirthsutra:cache:test:key",
    async () => {
      calls += 1;
      return { ok: true };
    }
  );

  assert.equal(result.status, "OFF");
  assert.deepEqual(result.value, { ok: true });
  assert.equal(calls, 1);
});
