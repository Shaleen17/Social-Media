const express = require("express");
const User = require("../models/User");
const Post = require("../models/Post");
const Notification = require("../models/Notification");
const { auth, optionalAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/users/search?q=query
router.get("/search", optionalAuth, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json([]);

    const users = await User.find({
      $or: [
        { name: { $regex: q, $options: "i" } },
        { handle: { $regex: q, $options: "i" } },
      ],
    })
      .select("name handle avatar bio verified followers")
      .limit(20)
      .lean();

    res.json(
      users.map((u) => ({
        id: u._id,
        name: u.name,
        handle: u.handle,
        avatar: u.avatar,
        bio: u.bio,
        verified: u.verified,
        followersCount: (u.followers || []).length,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/users/all — list all users (for suggestions)
router.get("/all", optionalAuth, async (req, res) => {
  try {
    const users = await User.find()
      .select("name handle avatar bio verified followers following")
      .limit(50)
      .lean();

    res.json(
      users.map((u) => ({
        id: u._id,
        name: u.name,
        handle: u.handle,
        avatar: u.avatar,
        bio: u.bio,
        verified: u.verified,
        followers: (u.followers || []).map((f) => f.toString()),
        following: (u.following || []).map((f) => f.toString()),
        joined: u.joined || "",
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/users/:id — get profile
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password")
      .lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    // Get user's posts
    const posts = await Post.find({ user: user._id })
      .sort({ createdAt: -1 })
      .populate("user", "name handle avatar verified")
      .populate("comments.user", "name handle avatar")
      .lean();

    res.json({
      id: user._id,
      name: user.name,
      handle: user.handle,
      email: user.email,
      bio: user.bio,
      location: user.location,
      website: user.website,
      avatar: user.avatar,
      banner: user.banner,
      verified: user.verified,
      joined: user.joined,
      followers: (user.followers || []).map((f) => f.toString()),
      following: (user.following || []).map((f) => f.toString()),
      postsCount: posts.length,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/users/:id — update profile
router.put("/:id", auth, async (req, res) => {
  try {
    if (req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const { name, bio, location, website, avatar, banner } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (bio !== undefined) updates.bio = bio;
    if (location !== undefined) updates.location = location;
    if (website !== undefined) updates.website = website;
    if (avatar !== undefined) updates.avatar = avatar;
    if (banner !== undefined) updates.banner = banner;

    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
    }).select("-password");

    res.json(user.toJSON());
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/users/:id/follow — toggle follow
router.put("/:id/follow", auth, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (req.user._id.toString() === targetId) {
      return res.status(400).json({ error: "Cannot follow yourself" });
    }

    const targetUser = await User.findById(targetId);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    const me = await User.findById(req.user._id);
    const isFollowing = me.following.includes(targetId);

    if (isFollowing) {
      // Unfollow
      me.following = me.following.filter((f) => f.toString() !== targetId);
      targetUser.followers = targetUser.followers.filter(
        (f) => f.toString() !== req.user._id.toString()
      );
    } else {
      // Follow
      me.following.push(targetId);
      targetUser.followers.push(req.user._id);

      // Create notification
      await Notification.create({
        recipient: targetId,
        sender: req.user._id,
        type: "follow",
        text: "started following you",
      });
      const io = req.app.get("io");
      if (io) {
        io.to(targetId).emit("notification", {
          type: "follow",
          from: req.user._id,
        });
      }
    }

    await me.save();
    await targetUser.save();

    res.json({
      following: !isFollowing,
      myFollowing: me.following.map((f) => f.toString()),
      targetFollowers: targetUser.followers.map((f) => f.toString()),
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/users/:id/followers — get followers list
router.get("/:id/followers", async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate("followers", "name handle avatar verified")
      .lean();
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(
      (user.followers || []).map((f) => ({
        id: f._id,
        name: f.name,
        handle: f.handle,
        avatar: f.avatar,
        verified: f.verified,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/users/:id/following — get following list
router.get("/:id/following", async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate("following", "name handle avatar verified")
      .lean();
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(
      (user.following || []).map((f) => ({
        id: f._id,
        name: f.name,
        handle: f.handle,
        avatar: f.avatar,
        verified: f.verified,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
