const express = require("express");
const User = require("../models/User");
const Post = require("../models/Post");
const Video = require("../models/Video");
const {
  applyRedisCacheHeader,
  buildRedisCacheKey,
  withRedisJsonCache,
} = require("../services/redisCache");
const { getVisibleAccountStatusFilter } = require("../utils/userVisibility");

const router = express.Router();

const BOOTSTRAP_CACHE_VERSION = "feed-v1";
const MAX_BOOTSTRAP_USERS = Math.min(
  40,
  Math.max(10, Number(process.env.BOOTSTRAP_MAX_USERS) || 20)
);
const MAX_BOOTSTRAP_POSTS = Math.min(
  40,
  Math.max(10, Number(process.env.BOOTSTRAP_MAX_POSTS) || 20)
);
const MAX_BOOTSTRAP_VIDEOS = Math.min(
  40,
  Math.max(10, Number(process.env.BOOTSTRAP_MAX_VIDEOS) || 20)
);
const MAX_BOOTSTRAP_VIDEO_STORIES = Math.min(
  20,
  Math.max(6, Number(process.env.BOOTSTRAP_MAX_VIDEO_STORIES) || 12)
);

function pickProfileExtras(user) {
  return {
    spiritualName: user?.spiritualName || "",
    homeMandir: user?.homeMandir || "",
    favoriteDeity: user?.favoriteDeity || "",
    spiritualPath: user?.spiritualPath || "",
    interests: user?.interests || "",
    spokenLanguages: user?.spokenLanguages || "",
    seva: user?.seva || "",
    yatraWishlist: user?.yatraWishlist || "",
    sankalp: user?.sankalp || "",
  };
}

function timeAgo(date) {
  if (!date) return "";
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return new Date(date).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  });
}

function mapUser(user) {
  return {
    id: user._id,
    name: user.name,
    handle: user.handle,
    avatar: user.avatar,
    bio: user.bio,
    location: user.location || "",
    website: user.website || "",
    ...pickProfileExtras(user),
    verified: user.verified,
    privateAccount: !!user.privateAccount,
    followersCount: (user.followers || []).length,
    followingCount: (user.following || []).length,
    joined: user.joined || "",
  };
}

function mapPost(post) {
  return {
    id: post._id,
    uid: post.user?._id || post.user,
    user: post.user,
    txt: post.text,
    img: post.image,
    ytId: post.ytId,
    likes: (post.likes || []).map((l) => l.toString()),
    cmts: (post.comments || []).map((c) => ({
      id: c._id,
      uid: c.user?._id || c.user,
      user: c.user,
      txt: c.text,
      t: timeAgo(c.createdAt),
    })),
    reposts: (post.reposts || []).map((r) => r.toString()),
    bm: (post.bookmarks || []).map((b) => b.toString()),
    poll: post.poll ? { opts: post.poll.options, votes: post.poll.votes } : null,
    hashtags: post.hashtags || [],
    t: timeAgo(post.createdAt),
    ts: new Date(post.createdAt).getTime(),
  };
}

function mapVideo(video) {
  const pinnedId = video.pinnedComment ? video.pinnedComment.toString() : "";

  return {
    id: video._id,
    uid: video.user?._id || video.user,
    user: video.user,
    title: video.title,
    desc: video.description,
    cat: video.category,
    src: video.src,
    thumb: video.thumbnail,
    likes: (video.likes || []).map((l) => l.toString()),
    dislikes: (video.dislikes || []).map((d) => d.toString()),
    cmts: (video.comments || []).map((c) => ({
      id: c._id,
      uid: c.user?._id || c.user,
      user: c.user
        ? {
            id: c.user._id,
            name: c.user.name,
            handle: c.user.handle,
            avatar: c.user.avatar,
            verified: c.user.verified,
          }
        : null,
      txt: c.text,
      t: timeAgo(c.createdAt),
      pinned: !!pinnedId && c._id.toString() === pinnedId,
      replies: (c.replies || []).map((r) => ({
        id: r._id,
        uid: r.user?._id || r.user,
        user: r.user
          ? {
              id: r.user._id,
              name: r.user.name,
              handle: r.user.handle,
              avatar: r.user.avatar,
              verified: r.user.verified,
            }
          : null,
        txt: r.text,
        t: timeAgo(r.createdAt),
      })),
    })),
    views: video.views,
    dur: video.duration,
    hashtags: video.hashtags || [],
    moderation: video.moderation?.status || "approved",
    ts: new Date(video.createdAt).getTime(),
    live: video.isLive,
    viewers: video.liveViewers,
    started: video.liveStarted,
  };
}

function mapVideoStory(video) {
  return {
    id: video._id,
    uid: video.user?._id,
    user: video.user,
    cap: video.title,
    t: timeAgo(video.createdAt),
    type: "video",
    emo: "",
    src: video.src,
  };
}

router.get("/feed", async (req, res, next) => {
  try {
    const cacheKey = buildRedisCacheKey("bootstrap", BOOTSTRAP_CACHE_VERSION, "feed");
    const { status: cacheStatus, value } = await withRedisJsonCache(
      cacheKey,
      async () => {
        const [users, posts, videos, vidStories] = await Promise.all([
          User.find(getVisibleAccountStatusFilter())
            .sort({ createdAt: -1 })
            .limit(MAX_BOOTSTRAP_USERS)
            .select(
              "name handle avatar bio verified followers following location website joined privateAccount spiritualName homeMandir favoriteDeity spiritualPath interests spokenLanguages seva yatraWishlist sankalp"
            )
            .lean(),
          Post.find({})
            .sort({ createdAt: -1 })
            .limit(MAX_BOOTSTRAP_POSTS)
            .populate("user", "name handle avatar verified privateAccount blockedUsers followers following")
            .populate("comments.user", "name handle avatar")
            .lean(),
          Video.find({})
            .sort({ createdAt: -1 })
            .limit(MAX_BOOTSTRAP_VIDEOS)
            .populate("user", "name handle avatar verified followers following bio privateAccount blockedUsers")
            .populate("comments.user", "name handle avatar verified")
            .populate("comments.replies.user", "name handle avatar verified")
            .lean(),
          Video.find({ isLive: false })
            .sort({ createdAt: -1 })
            .limit(MAX_BOOTSTRAP_VIDEO_STORIES)
            .populate("user", "name handle avatar")
            .lean(),
        ]);

        return {
          users: users.map(mapUser),
          posts: posts.map(mapPost),
          videos: videos.map(mapVideo),
          vidStories: vidStories.map(mapVideoStory),
          meta: {
            users: users.length,
            posts: posts.length,
            videos: videos.length,
            vidStories: vidStories.length,
            generatedAt: new Date().toISOString(),
          },
        };
      },
      { ttlSeconds: 60 }
    );

    applyRedisCacheHeader(res, cacheStatus);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json(value);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
