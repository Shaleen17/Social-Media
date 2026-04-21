const express = require("express");
const Post = require("../models/Post");
const Notification = require("../models/Notification");
const { auth, optionalAuth } = require("../middleware/auth");
const {
  cleanMediaUrl,
  cleanString,
  cleanStringArray,
  getPagination,
  validateObjectIdParam,
} = require("../utils/validation");

const router = express.Router();

// GET /api/posts — list posts
router.get("/", optionalAuth, async (req, res, next) => {
  try {
    const { tab } = req.query;
    const { page, limit, skip } = getPagination(req.query, {
      defaultLimit: 20,
      maxLimit: 50,
    });
    let query = {};

    if (tab === "following" && req.user) {
      const following = req.user.following || [];
      query = { user: { $in: [...following, req.user._id] } };
    }

    let sort = { createdAt: -1 };
    if (tab === "trending") {
      // Sort by engagement (likes + reposts count)
      // We'll do this in-memory for simplicity
    }

    let posts = await Post.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("user", "name handle avatar verified")
      .populate("comments.user", "name handle avatar")
      .lean();

    if (tab === "trending") {
      posts.sort(
        (a, b) =>
          b.likes.length +
          b.reposts.length -
          (a.likes.length + a.reposts.length)
      );
    }

    // Transform for frontend compatibility
    const result = posts.map((p) => ({
      id: p._id,
      uid: p.user?._id || p.user,
      user: p.user,
      txt: p.text,
      img: p.image,
      ytId: p.ytId,
      likes: p.likes.map((l) => l.toString()),
      cmts: (p.comments || []).map((c) => ({
        id: c._id,
        uid: c.user?._id || c.user,
        user: c.user,
        txt: c.text,
        t: timeAgo(c.createdAt),
      })),
      reposts: p.reposts.map((r) => r.toString()),
      bm: p.bookmarks.map((b) => b.toString()),
      poll: p.poll
        ? { opts: p.poll.options, votes: p.poll.votes }
        : null,
      t: timeAgo(p.createdAt),
      ts: new Date(p.createdAt).getTime(),
    }));

    res.setHeader("X-Page", String(page));
    res.setHeader("X-Limit", String(limit));
    res.setHeader("X-Has-More", String(result.length === limit));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/posts/:id — get single post
router.get("/:id", validateObjectIdParam("id"), optionalAuth, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate("user", "name handle avatar verified")
      .populate("comments.user", "name handle avatar");
    if (!post) return res.status(404).json({ error: "Post not found" });

    res.json(transformPost(post.toJSON()));
  } catch (err) {
    next(err);
  }
});

// POST /api/posts — create post
router.post("/", auth, async (req, res, next) => {
  try {
    const { text, image, ytId, poll } = req.body;
    const safeText = cleanString(text, { field: "Post text", max: 5000 });
    const safeImage = cleanMediaUrl(image, { field: "Post image", max: 750000 });
    const safeYtId = cleanString(ytId, { field: "YouTube video id", max: 80 });

    if (!safeText && !safeImage && !safeYtId) {
      return res.status(400).json({ error: "Post content required" });
    }

    const postData = {
      user: req.user._id,
      text: safeText,
      image: safeImage || null,
      ytId: safeYtId || null,
    };

    if (poll && poll.opts && poll.opts.length >= 2) {
      const options = cleanStringArray(poll.opts, {
        maxItems: 6,
        maxLength: 120,
      });
      if (options.length >= 2) {
        postData.poll = { options, votes: [] };
      }
    }

    const post = await Post.create(postData);
    const populated = await Post.findById(post._id)
      .populate("user", "name handle avatar verified");

    res.status(201).json(transformPost(populated.toJSON()));
  } catch (err) {
    next(err);
  }
});

// PUT /api/posts/:id/like — toggle like
router.put("/:id/like", validateObjectIdParam("id"), auth, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const idx = post.likes.indexOf(req.user._id);
    if (idx > -1) {
      post.likes.splice(idx, 1);
    } else {
      post.likes.push(req.user._id);
      // Create notification
      if (post.user.toString() !== req.user._id.toString()) {
        await Notification.create({
          recipient: post.user,
          sender: req.user._id,
          type: "like",
          post: post._id,
          text: "gave a Pranam to your post",
        });
        // Emit via socket if available
        const io = req.app.get("io");
        if (io) {
          io.to(post.user.toString()).emit("notification", {
            type: "like",
            from: req.user._id,
          });
        }
      }
    }

    await post.save();
    res.json({
      likes: post.likes.map((l) => l.toString()),
      liked: post.likes.includes(req.user._id),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/posts/:id/comment — add comment
router.put("/:id/comment", validateObjectIdParam("id"), auth, async (req, res, next) => {
  try {
    const text = cleanString(req.body.text, {
      field: "Comment text",
      max: 1000,
      required: true,
    });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const comment = { user: req.user._id, text };
    post.comments.push(comment);
    await post.save();

    // Create notification
    if (post.user.toString() !== req.user._id.toString()) {
      await Notification.create({
        recipient: post.user,
        sender: req.user._id,
        type: "comment",
        post: post._id,
        text: "commented on your post",
      });
      const io = req.app.get("io");
      if (io) {
        io.to(post.user.toString()).emit("notification", {
          type: "comment",
          from: req.user._id,
        });
      }
    }

    const newComment = post.comments[post.comments.length - 1];
    res.json({
      id: newComment._id,
      uid: req.user._id,
      user: { _id: req.user._id, name: req.user.name, handle: req.user.handle, avatar: req.user.avatar },
      txt: text,
      t: "Just now",
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/posts/:id/repost — toggle repost
router.put("/:id/repost", validateObjectIdParam("id"), auth, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const idx = post.reposts.indexOf(req.user._id);
    if (idx > -1) {
      post.reposts.splice(idx, 1);
    } else {
      post.reposts.push(req.user._id);
      if (post.user.toString() !== req.user._id.toString()) {
        await Notification.create({
          recipient: post.user,
          sender: req.user._id,
          type: "repost",
          post: post._id,
          text: "reposted your post",
        });
        const io = req.app.get("io");
        if (io) {
          io.to(post.user.toString()).emit("notification", {
            type: "repost",
            from: req.user._id,
          });
        }
      }
    }

    await post.save();
    res.json({
      reposts: post.reposts.map((r) => r.toString()),
      reposted: post.reposts.includes(req.user._id),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/posts/:id/bookmark — toggle bookmark
router.put("/:id/bookmark", validateObjectIdParam("id"), auth, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const idx = post.bookmarks.indexOf(req.user._id);
    if (idx > -1) {
      post.bookmarks.splice(idx, 1);
    } else {
      post.bookmarks.push(req.user._id);
    }

    await post.save();
    res.json({
      bookmarks: post.bookmarks.map((b) => b.toString()),
      bookmarked: post.bookmarks.includes(req.user._id),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/posts/:id/vote — cast poll vote
router.put("/:id/vote", validateObjectIdParam("id"), auth, async (req, res, next) => {
  try {
    const option = Number.parseInt(req.body.option, 10);
    const post = await Post.findById(req.params.id);
    if (!post || !post.poll) return res.status(404).json({ error: "Poll not found" });
    if (!Number.isInteger(option) || option < 0 || option >= post.poll.options.length) {
      return res.status(400).json({ error: "Invalid poll option" });
    }

    const userId = req.user._id.toString();
    const alreadyVoted = post.poll.votes.find((v) =>
      v.startsWith(userId + ":")
    );
    if (alreadyVoted) {
      return res.status(400).json({ error: "Already voted" });
    }

    post.poll.votes.push(`${userId}:${option}`);
    post.markModified("poll");
    await post.save();

    res.json({ poll: { opts: post.poll.options, votes: post.poll.votes } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/posts/:id
router.delete("/:id", validateObjectIdParam("id"), auth, async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    await post.deleteOne();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/posts/bookmarked/me — get user's bookmarked posts
router.get("/bookmarked/me", auth, async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, {
      defaultLimit: 20,
      maxLimit: 50,
    });
    const posts = await Post.find({ bookmarks: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "name handle avatar verified")
      .populate("comments.user", "name handle avatar")
      .lean();

    res.setHeader("X-Page", String(page));
    res.setHeader("X-Limit", String(limit));
    res.setHeader("X-Has-More", String(posts.length === limit));
    res.json(posts.map(transformPostLean));
  } catch (err) {
    next(err);
  }
});

// Helper: transform post to frontend format
function transformPost(p) {
  return {
    id: p._id || p.id,
    uid: p.user?._id || p.user,
    user: p.user,
    txt: p.text,
    img: p.image,
    ytId: p.ytId,
    likes: (p.likes || []).map((l) => l.toString()),
    cmts: (p.comments || []).map((c) => ({
      id: c._id,
      uid: c.user?._id || c.user,
      user: c.user,
      txt: c.text,
      t: timeAgo(c.createdAt),
    })),
    reposts: (p.reposts || []).map((r) => r.toString()),
    bm: (p.bookmarks || []).map((b) => b.toString()),
    poll: p.poll ? { opts: p.poll.options, votes: p.poll.votes } : null,
    t: timeAgo(p.createdAt),
    ts: new Date(p.createdAt).getTime(),
  };
}

function transformPostLean(p) {
  return {
    id: p._id,
    uid: p.user?._id || p.user,
    user: p.user,
    txt: p.text,
    img: p.image,
    ytId: p.ytId,
    likes: (p.likes || []).map((l) => l.toString()),
    cmts: (p.comments || []).map((c) => ({
      id: c._id,
      uid: c.user?._id || c.user,
      user: c.user,
      txt: c.text,
      t: timeAgo(c.createdAt),
    })),
    reposts: (p.reposts || []).map((r) => r.toString()),
    bm: (p.bookmarks || []).map((b) => b.toString()),
    poll: p.poll ? { opts: p.poll.options, votes: p.poll.votes } : null,
    t: timeAgo(p.createdAt),
    ts: new Date(p.createdAt).getTime(),
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

module.exports = router;
