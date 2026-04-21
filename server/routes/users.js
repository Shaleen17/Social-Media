const express = require("express");
const User = require("../models/User");
const Post = require("../models/Post");
const Notification = require("../models/Notification");
const { auth, optionalAuth } = require("../middleware/auth");
const {
  cleanHttpUrl,
  cleanMediaUrl,
  cleanString,
  getPagination,
  validateObjectIdParam,
} = require("../utils/validation");

const router = express.Router();

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];

  return [...new Set(
    values
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  )];
}

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PROFILE_EXTRA_FIELDS = [
  "spiritualName",
  "homeMandir",
  "favoriteDeity",
  "spiritualPath",
  "interests",
  "spokenLanguages",
  "seva",
  "yatraWishlist",
  "sankalp",
];

const PROFILE_EXTRA_SELECT = PROFILE_EXTRA_FIELDS.join(" ");
const USER_SEARCH_FIELDS = [
  "name",
  "handle",
  "bio",
  "location",
  "website",
  ...PROFILE_EXTRA_FIELDS,
];

function pickProfileExtras(user) {
  return PROFILE_EXTRA_FIELDS.reduce((acc, field) => {
    acc[field] = user?.[field] || "";
    return acc;
  }, {});
}

function applyProfileExtraUpdates(body, updates) {
  PROFILE_EXTRA_FIELDS.forEach((field) => {
    if (body[field] !== undefined) {
      updates[field] = cleanString(body[field], { field, max: 240 });
    }
  });
}

// GET /api/users/search?q=query
router.get("/search", optionalAuth, async (req, res, next) => {
  try {
    const q = cleanString(req.query.q, { field: "Search query", max: 80 });
    if (!q) return res.json([]);
    const safeRegex = escapeRegex(q);
    const { limit } = getPagination(req.query, { defaultLimit: 20, maxLimit: 50 });

    const users = await User.find({
      $or: USER_SEARCH_FIELDS.map((field) => ({
        [field]: { $regex: safeRegex, $options: "i" },
      })),
    })
      .select(`name handle avatar bio location website verified followers ${PROFILE_EXTRA_SELECT}`)
      .limit(limit)
      .lean();

    res.json(
      users.map((u) => ({
        id: u._id,
        name: u.name,
        handle: u.handle,
        avatar: u.avatar,
        bio: u.bio,
        location: u.location || "",
        website: u.website || "",
        ...pickProfileExtras(u),
        verified: u.verified,
        followersCount: (u.followers || []).length,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/users/all — list all users (for suggestions)
router.get("/all", optionalAuth, async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, {
      defaultLimit: 100,
      maxLimit: 100,
    });
    const users = await User.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .select(`name handle avatar bio verified followers following followedMandirs followedSants location website joined ${PROFILE_EXTRA_SELECT}`)
      .limit(limit)
      .lean();

    res.setHeader("X-Page", String(page));
    res.setHeader("X-Limit", String(limit));
    res.setHeader("X-Has-More", String(users.length === limit));
    res.json(
      users.map((u) => ({
        id: u._id,
        name: u.name,
        handle: u.handle,
        avatar: u.avatar,
        bio: u.bio,
        location: u.location || "",
        website: u.website || "",
        ...pickProfileExtras(u),
        verified: u.verified,
        followers: (u.followers || []).map((f) => f.toString()),
        following: (u.following || []).map((f) => f.toString()),
        followedMandirs: normalizeStringList(u.followedMandirs),
        followedSants: normalizeStringList(u.followedSants),
        joined: u.joined || "",
      }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id — get profile
router.get("/:id", validateObjectIdParam("id"), optionalAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password")
      .lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    const postsCount = await Post.countDocuments({ user: user._id });

    res.json({
      id: user._id,
      name: user.name,
      handle: user.handle,
      email: user.email,
      bio: user.bio,
      location: user.location,
      website: user.website,
      ...pickProfileExtras(user),
      avatar: user.avatar,
      banner: user.banner,
      verified: user.verified,
      joined: user.joined,
      followers: (user.followers || []).map((f) => f.toString()),
      following: (user.following || []).map((f) => f.toString()),
      followedMandirs: normalizeStringList(user.followedMandirs),
      followedSants: normalizeStringList(user.followedSants),
      postsCount,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id — update profile
router.put("/:id", validateObjectIdParam("id"), auth, async (req, res, next) => {
  try {
    if (req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const {
      name,
      bio,
      location,
      website,
      avatar,
      banner,
      followedMandirs,
      followedSants,
    } = req.body;
    const updates = {};
    if (name !== undefined) {
      updates.name = cleanString(name, { field: "Name", max: 80, required: true });
    }
    if (bio !== undefined) updates.bio = cleanString(bio, { field: "Bio", max: 500 });
    if (location !== undefined) {
      updates.location = cleanString(location, { field: "Location", max: 120 });
    }
    if (website !== undefined) updates.website = cleanHttpUrl(website, { field: "Website" });
    applyProfileExtraUpdates(req.body, updates);
    if (avatar !== undefined) {
      updates.avatar = cleanMediaUrl(avatar, { field: "Avatar", max: 750000 });
    }
    if (banner !== undefined) {
      updates.banner = cleanMediaUrl(banner, { field: "Banner", max: 1500000 });
    }
    if (followedMandirs !== undefined) {
      updates.followedMandirs = normalizeStringList(followedMandirs);
    }
    if (followedSants !== undefined) {
      updates.followedSants = normalizeStringList(followedSants);
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
    }).select("-password");

    res.json(user.toJSON());
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id/follow — toggle follow
router.put("/:id/follow", validateObjectIdParam("id"), auth, async (req, res, next) => {
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
    next(err);
  }
});

// GET /api/users/:id/followers — get followers list
router.get("/:id/followers", validateObjectIdParam("id"), async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, {
      defaultLimit: 50,
      maxLimit: 100,
    });
    const user = await User.findById(req.params.id)
      .populate("followers", "name handle avatar verified")
      .lean();
    if (!user) return res.status(404).json({ error: "User not found" });
    const followers = (user.followers || []).slice(skip, skip + limit);
    res.setHeader("X-Page", String(page));
    res.setHeader("X-Limit", String(limit));
    res.setHeader("X-Has-More", String((user.followers || []).length > skip + limit));
    res.json(
      followers.map((f) => ({
        id: f._id,
        name: f.name,
        handle: f.handle,
        avatar: f.avatar,
        verified: f.verified,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id/following — get following list
router.get("/:id/following", validateObjectIdParam("id"), async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, {
      defaultLimit: 50,
      maxLimit: 100,
    });
    const user = await User.findById(req.params.id)
      .populate("following", "name handle avatar verified")
      .lean();
    if (!user) return res.status(404).json({ error: "User not found" });
    const following = (user.following || []).slice(skip, skip + limit);
    res.setHeader("X-Page", String(page));
    res.setHeader("X-Limit", String(limit));
    res.setHeader("X-Has-More", String((user.following || []).length > skip + limit));
    res.json(
      following.map((f) => ({
        id: f._id,
        name: f.name,
        handle: f.handle,
        avatar: f.avatar,
        verified: f.verified,
      }))
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
