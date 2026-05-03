const Post = require("../models/Post");
const Video = require("../models/Video");
const {
  buildRedisCacheKey,
  readRedisJsonCache,
  writeRedisJsonCache,
} = require("./redisCache");

const APPROVED_CONTENT_FILTER = {
  $or: [
    { "moderation.status": { $exists: false } },
    { "moderation.status": "approved" },
  ],
};

const SNAPSHOT_VERSION = "v1";
const DEFAULT_CANDIDATE_LIMIT = Math.min(
  500,
  Math.max(120, Number(process.env.CRON_DISCOVERY_CANDIDATE_LIMIT) || 320)
);
const DEFAULT_SNAPSHOT_LIMIT = Math.min(
  400,
  Math.max(80, Number(process.env.CRON_DISCOVERY_SNAPSHOT_LIMIT) || 220)
);
const SNAPSHOT_TTL_SECONDS = Math.max(
  120,
  Number(process.env.CRON_DISCOVERY_SNAPSHOT_TTL_SECONDS) || 15 * 60
);

function getPostTrendingSnapshotKey() {
  return buildRedisCacheKey(
    "cron",
    "discovery",
    SNAPSHOT_VERSION,
    "posts",
    "trending"
  );
}

function getVideoFeedSnapshotKey() {
  return buildRedisCacheKey(
    "cron",
    "discovery",
    SNAPSHOT_VERSION,
    "videos",
    "feed"
  );
}

function ageHoursFrom(dateValue, nowMs = Date.now()) {
  return Math.max(0, (nowMs - new Date(dateValue).getTime()) / (1000 * 60 * 60));
}

function buildTrendingPostScore(post, nowMs = Date.now()) {
  const likes = Array.isArray(post?.likes) ? post.likes.length : 0;
  const reposts = Array.isArray(post?.reposts) ? post.reposts.length : 0;
  const comments = Array.isArray(post?.comments) ? post.comments.length : 0;
  const freshness = Math.max(0, 48 - ageHoursFrom(post?.createdAt, nowMs));
  const mediaBoost = post?.ytId ? 8 : post?.image ? 4 : 0;
  return likes * 3 + reposts * 4 + comments * 2 + freshness + mediaBoost;
}

function buildVideoFeedScore(video, nowMs = Date.now()) {
  const likes = Array.isArray(video?.likes) ? video.likes.length : 0;
  const comments = Array.isArray(video?.comments) ? video.comments.length : 0;
  const views = Math.max(0, Number(video?.views) || 0);
  const freshness = Math.max(0, 72 - ageHoursFrom(video?.createdAt, nowMs));
  const viewBoost = Math.log10(views + 1) * 28;
  const livePenalty = video?.isLive ? -1000 : 0;
  return Math.round(viewBoost + likes * 4 + comments * 3 + freshness * 1.4 + livePenalty);
}

function createSnapshotPayload(type, ids, meta = {}) {
  return {
    type,
    version: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    ids,
    ...meta,
  };
}

async function buildTrendingPostSnapshot(options = {}) {
  const candidateLimit = Math.max(
    80,
    Number(options.candidateLimit) || DEFAULT_CANDIDATE_LIMIT
  );
  const snapshotLimit = Math.max(
    40,
    Number(options.snapshotLimit) || DEFAULT_SNAPSHOT_LIMIT
  );
  const nowMs = Date.now();

  const posts = await Post.find(APPROVED_CONTENT_FILTER)
    .sort({ createdAt: -1 })
    .limit(candidateLimit)
    .select("_id likes reposts comments createdAt image ytId")
    .lean();

  const ids = posts
    .map((post) => ({
      id: post._id.toString(),
      score: buildTrendingPostScore(post, nowMs),
      createdAt: post.createdAt,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    )
    .slice(0, snapshotLimit)
    .map((item) => item.id);

  return createSnapshotPayload("post-trending", ids, {
    candidateCount: posts.length,
    snapshotLimit,
  });
}

async function buildVideoFeedSnapshot(options = {}) {
  const candidateLimit = Math.max(
    80,
    Number(options.candidateLimit) || DEFAULT_CANDIDATE_LIMIT
  );
  const snapshotLimit = Math.max(
    40,
    Number(options.snapshotLimit) || DEFAULT_SNAPSHOT_LIMIT
  );
  const nowMs = Date.now();

  const videos = await Video.find({
    ...APPROVED_CONTENT_FILTER,
    isLive: { $ne: true },
  })
    .sort({ createdAt: -1 })
    .limit(candidateLimit)
    .select("_id likes comments views createdAt isLive")
    .lean();

  const ids = videos
    .map((video) => ({
      id: video._id.toString(),
      score: buildVideoFeedScore(video, nowMs),
      createdAt: video.createdAt,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    )
    .slice(0, snapshotLimit)
    .map((item) => item.id);

  return createSnapshotPayload("video-feed", ids, {
    candidateCount: videos.length,
    snapshotLimit,
  });
}

async function saveTrendingPostSnapshot(snapshot, ttlSeconds = SNAPSHOT_TTL_SECONDS) {
  return writeRedisJsonCache(getPostTrendingSnapshotKey(), snapshot, ttlSeconds);
}

async function saveVideoFeedSnapshot(snapshot, ttlSeconds = SNAPSHOT_TTL_SECONDS) {
  return writeRedisJsonCache(getVideoFeedSnapshotKey(), snapshot, ttlSeconds);
}

async function getTrendingPostSnapshot() {
  const cached = await readRedisJsonCache(getPostTrendingSnapshotKey());
  return cached.found ? cached.value : null;
}

async function getVideoFeedSnapshot() {
  const cached = await readRedisJsonCache(getVideoFeedSnapshotKey());
  return cached.found ? cached.value : null;
}

async function refreshDiscoverySnapshots(options = {}) {
  const [postSnapshot, videoSnapshot] = await Promise.all([
    buildTrendingPostSnapshot(options),
    buildVideoFeedSnapshot(options),
  ]);

  const [postsSaved, videosSaved] = await Promise.all([
    saveTrendingPostSnapshot(postSnapshot, options.ttlSeconds),
    saveVideoFeedSnapshot(videoSnapshot, options.ttlSeconds),
  ]);

  return {
    postsSaved,
    videosSaved,
    postIds: postSnapshot.ids.length,
    videoIds: videoSnapshot.ids.length,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  SNAPSHOT_TTL_SECONDS,
  buildTrendingPostScore,
  buildVideoFeedScore,
  buildTrendingPostSnapshot,
  buildVideoFeedSnapshot,
  getPostTrendingSnapshotKey,
  getTrendingPostSnapshot,
  getVideoFeedSnapshot,
  getVideoFeedSnapshotKey,
  refreshDiscoverySnapshots,
  saveTrendingPostSnapshot,
  saveVideoFeedSnapshot,
  __testables: {
    ageHoursFrom,
    createSnapshotPayload,
  },
};
