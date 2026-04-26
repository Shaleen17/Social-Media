const express = require("express");
const crypto = require("crypto");
const User = require("../models/User");
const Post = require("../models/Post");
const Story = require("../models/Story");
const Video = require("../models/Video");
const Conversation = require("../models/Message");
const Notification = require("../models/Notification");
const PushSubscription = require("../models/PushSubscription");
const Donation = require("../models/Donation");
const PendingSignup = require("../models/PendingSignup");
const EmailCampaignSubscription = require("../models/EmailCampaignSubscription");
const EmailCampaignDelivery = require("../models/EmailCampaignDelivery");
const { auth, optionalAuth } = require("../middleware/auth");
const { createRankedNotification } = require("../services/notificationService");
const { recordAnalyticsEventSafe } = require("../services/analyticsService");
const {
  applyRedisCacheHeader,
  buildRedisCacheKey,
  invalidateRedisCacheNamespaces,
  withRedisJsonCache,
} = require("../services/redisCache");
const {
  assertObjectId,
  cleanHttpUrl,
  cleanMediaUrl,
  cleanString,
  getPagination,
  validateObjectIdParam,
} = require("../utils/validation");
const { getVisibleAccountStatusFilter } = require("../utils/userVisibility");

const router = express.Router();
const USER_VISIBILITY_CACHE_VERSION = "legacy-active-v1";

function invalidateUserCaches(namespaces = ["users", "search"]) {
  return invalidateRedisCacheNamespaces(namespaces).catch(() => 0);
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];

  return [...new Set(
    values
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  )];
}

function normalizeObjectIdList(values, currentUserId = "") {
  if (!Array.isArray(values)) return [];
  const current = currentUserId ? currentUserId.toString() : "";
  const seen = new Set();
  const output = [];

  values.slice(0, 200).forEach((value) => {
    if (!value) return;
    const id = value.toString();
    if (!id || id === current || seen.has(id)) return;
    assertObjectId(id, "user id");
    seen.add(id);
    output.push(id);
  });

  return output;
}

function sanitizeNotificationSettings(input = {}) {
  const current = input && typeof input === "object" ? input : {};
  const read = (key, fallback = true) =>
    typeof current[key] === "boolean" ? current[key] : fallback;

  return {
    festivalReminders: read("festivalReminders", true),
    chatMessages: read("chatMessages", true),
    communityHighlights: read("communityHighlights", true),
    donationUpdates: read("donationUpdates", true),
  };
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
    const cacheKey = buildRedisCacheKey(
      "users",
      "search",
      USER_VISIBILITY_CACHE_VERSION,
      q.toLowerCase(),
      limit
    );
    const { status: cacheStatus, value } = await withRedisJsonCache(
      cacheKey,
      async () => {
        const users = await User.find({
          ...getVisibleAccountStatusFilter(),
          $or: USER_SEARCH_FIELDS.map((field) => ({
            [field]: { $regex: safeRegex, $options: "i" },
          })),
        })
          .select(`name handle avatar bio location website verified followers privateAccount blockedUsers notificationSettings ${PROFILE_EXTRA_SELECT}`)
          .limit(limit)
          .lean();

        return users.map((u) => ({
          id: u._id,
          name: u.name,
          handle: u.handle,
          avatar: u.avatar,
          bio: u.bio,
          location: u.location || "",
          website: u.website || "",
          ...pickProfileExtras(u),
          privateAccount: !!u.privateAccount,
          blockedUsers: (u.blockedUsers || []).map((item) => item.toString()),
          notificationSettings: sanitizeNotificationSettings(u.notificationSettings),
          verified: u.verified,
          followersCount: (u.followers || []).length,
        }));
      },
      { ttlSeconds: 90 }
    );
    applyRedisCacheHeader(res, cacheStatus);
    res.json(value);
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
    const cacheKey = buildRedisCacheKey(
      "users",
      "all",
      USER_VISIBILITY_CACHE_VERSION,
      page,
      limit
    );
    const { status: cacheStatus, value } = await withRedisJsonCache(
      cacheKey,
      async () => {
        const users = await User.find(getVisibleAccountStatusFilter())
          .sort({ createdAt: -1 })
          .skip(skip)
          .select(`name handle avatar bio verified followers following followedMandirs followedSants location website joined privateAccount blockedUsers notificationSettings ${PROFILE_EXTRA_SELECT}`)
          .limit(limit)
          .lean();

        return users.map((u) => ({
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
          privateAccount: !!u.privateAccount,
          blockedUsers: (u.blockedUsers || []).map((item) => item.toString()),
          notificationSettings: sanitizeNotificationSettings(u.notificationSettings),
          joined: u.joined || "",
        }));
      },
      { ttlSeconds: 120 }
    );

    applyRedisCacheHeader(res, cacheStatus);
    res.setHeader("X-Page", String(page));
    res.setHeader("X-Limit", String(limit));
    res.setHeader("X-Has-More", String(value.length === limit));
    res.json(value);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id — get profile
router.get("/:id([0-9a-fA-F]{24})", validateObjectIdParam("id"), optionalAuth, async (req, res, next) => {
  try {
    const cacheKey = buildRedisCacheKey("users", "profile", req.params.id);
    const { status: cacheStatus, value: user } = await withRedisJsonCache(
      cacheKey,
      async () => {
        const found = await User.findById(req.params.id)
          .select("-password")
          .lean();
        if (!found) return null;

        const postsCount = await Post.countDocuments({ user: found._id });

        return {
          id: found._id,
          name: found.name,
          handle: found.handle,
          email: found.email,
          bio: found.bio,
          location: found.location,
          website: found.website,
          ...pickProfileExtras(found),
          avatar: found.avatar,
          banner: found.banner,
          verified: found.verified,
          joined: found.joined,
          followers: (found.followers || []).map((f) => f.toString()),
          following: (found.following || []).map((f) => f.toString()),
          followedMandirs: normalizeStringList(found.followedMandirs),
          followedSants: normalizeStringList(found.followedSants),
          privateAccount: !!found.privateAccount,
          blockedUsers: (found.blockedUsers || []).map((item) => item.toString()),
          notificationSettings: sanitizeNotificationSettings(found.notificationSettings),
          postsCount,
        };
      },
      { ttlSeconds: 120 }
    );
    applyRedisCacheHeader(res, cacheStatus);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id — update profile
router.get("/account/export", auth, async (req, res, next) => {
  try {
    const userId = req.user._id;
    const [
      user,
      posts,
      videos,
      stories,
      notifications,
      subscriptions,
      donations,
      emailSubscription,
      emailDeliveries,
      conversations,
    ] = await Promise.all([
      User.findById(userId).select("-password").lean(),
      Post.find({ user: userId }).sort({ createdAt: -1 }).lean(),
      Video.find({ user: userId }).sort({ createdAt: -1 }).lean(),
      Story.find({ user: userId }).sort({ createdAt: -1 }).lean(),
      Notification.find({
        $or: [{ recipient: userId }, { sender: userId }],
      })
        .sort({ createdAt: -1 })
        .lean(),
      PushSubscription.find({ user: userId }).sort({ createdAt: -1 }).lean(),
      Donation.find({ user: userId }).sort({ createdAt: -1 }).lean(),
      EmailCampaignSubscription.findOne({ user: userId }).lean(),
      EmailCampaignDelivery.find({ user: userId }).sort({ createdAt: -1 }).lean(),
      Conversation.find({ participants: userId }).sort({ updatedAt: -1 }).lean(),
    ]);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="tirth-sutra-data-export-${userId.toString()}.json"`
    );
    res.json({
      exportedAt: new Date().toISOString(),
      user,
      posts,
      videos,
      stories,
      notifications,
      pushSubscriptions: subscriptions,
      donations,
      emailCampaign: {
        subscription: emailSubscription,
        deliveries: emailDeliveries,
      },
      conversations: (conversations || []).map((conversation) => ({
        id: conversation._id,
        isGroup: !!conversation.isGroup,
        groupName: conversation.groupName || "",
        participants: (conversation.participants || []).map((item) =>
          item.toString()
        ),
        messages: (conversation.messages || [])
          .filter((message) => message.sender?.toString() === userId.toString())
          .map((message) => ({
            id: message._id,
            text: message.text || "",
            clientId: message.clientId || "",
            seq: Number(message.seq) || 0,
            createdAt: message.createdAt,
            deletedForEveryone: !!message.deletedForEveryone,
            attachments: message.attachments || [],
            replyTo: message.replyTo || null,
          })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/account", auth, async (req, res, next) => {
  try {
    const confirmation = cleanString(req.body?.confirmation, {
      field: "Deletion confirmation",
      max: 32,
      required: true,
    });
    if (confirmation !== "DELETE") {
      return res
        .status(400)
        .json({ error: 'Type "DELETE" in the confirmation field to continue.' });
    }

    const userId = req.user._id;
    const deletedAt = new Date();

    await Promise.all([
      Post.deleteMany({ user: userId }),
      Video.deleteMany({ user: userId }),
      Story.deleteMany({ user: userId }),
      PushSubscription.deleteMany({ user: userId }),
      Notification.deleteMany({
        $or: [{ recipient: userId }, { sender: userId }],
      }),
      PendingSignup.deleteMany({
        $or: [{ email: req.user.email }, { referredBy: userId }],
      }),
      EmailCampaignDelivery.deleteMany({ user: userId }),
      EmailCampaignSubscription.deleteMany({ user: userId }),
      Donation.updateMany(
        { user: userId },
        {
          $set: {
            donorName: "Deleted User",
            donorEmail: "",
            donorContact: "",
            user: null,
          },
        }
      ),
      User.updateMany(
        {},
        {
          $pull: {
            followers: userId,
            following: userId,
            blockedUsers: userId,
          },
        }
      ),
    ]);

    const conversations = await Conversation.find({ "messages.sender": userId });
    for (const conversation of conversations) {
      let changed = false;
      (conversation.messages || []).forEach((message) => {
        if (message.sender?.toString() !== userId.toString()) return;
        message.text = "";
        message.attachments = [];
        message.replyTo = null;
        message.forwarded = false;
        message.deletedForEveryone = true;
        message.deletedAt = deletedAt;
        message.deletedBy = userId;
        changed = true;
      });
      if (changed) {
        await conversation.save();
      }
    }

    const user = await User.findById(userId).select("+password");
    if (!user) {
      return res.json({ success: true, deleted: true });
    }

    user.name = "Deleted User";
    user.handle = `deleted_${userId.toString().slice(-8)}`;
    user.email = `deleted+${userId.toString()}@example.invalid`;
    user.password = crypto.randomBytes(24).toString("hex");
    user.authProvider = "local";
    user.oauthProvider = null;
    user.googleId = null;
    user.appwriteId = null;
    user.appwriteSignupCompleted = false;
    user.appwriteSignupCompletedAt = null;
    user.bio = "";
    user.location = "";
    user.website = "";
    user.spiritualName = "";
    user.homeMandir = "";
    user.favoriteDeity = "";
    user.spiritualPath = "";
    user.interests = "";
    user.spokenLanguages = "";
    user.seva = "";
    user.yatraWishlist = "";
    user.sankalp = "";
    user.avatar = null;
    user.banner = null;
    user.followers = [];
    user.following = [];
    user.followedMandirs = [];
    user.followedSants = [];
    user.privateAccount = true;
    user.blockedUsers = [];
    user.notificationSettings = sanitizeNotificationSettings({
      festivalReminders: false,
      chatMessages: false,
      communityHighlights: false,
      donationUpdates: false,
    });
    user.verified = false;
    user.emailVerified = false;
    user.marketing = {
      emailConsent: false,
      emailConsentAt: null,
      emailConsentSource: null,
      emailUnsubscribedAt: deletedAt,
      timezone: "Asia/Kolkata",
    };
    user.sessionVersion = (Number(user.sessionVersion) || 0) + 1;
    user.accountStatus = "deleted";
    user.deletedAt = deletedAt;
    user.lastAuthAt = deletedAt;
    user.lastSeen = deletedAt;
    user.referredUsers = [];
    user.referralCode = null;
    user.referredBy = null;
    await user.save();
    invalidateUserCaches(["users", "search", "posts", "videos"]);

    res.json({
      success: true,
      deleted: true,
      deletedAt: deletedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.put("/:id([0-9a-fA-F]{24})", validateObjectIdParam("id"), auth, async (req, res, next) => {
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
      privateAccount,
      blockedUsers,
      notificationSettings,
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
    if (privateAccount !== undefined) {
      updates.privateAccount = !!privateAccount;
    }
    if (blockedUsers !== undefined) {
      updates.blockedUsers = normalizeObjectIdList(
        blockedUsers,
        req.user._id.toString()
      );
    }
    if (notificationSettings !== undefined) {
      updates.notificationSettings = sanitizeNotificationSettings(
        notificationSettings
      );
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
    }).select("-password");

    invalidateUserCaches();
    res.json(user.toJSON());
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id/follow — toggle follow
router.put("/:id([0-9a-fA-F]{24})/follow", validateObjectIdParam("id"), auth, async (req, res, next) => {
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
      await createRankedNotification({
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
    invalidateUserCaches();
    await recordAnalyticsEventSafe({
      req,
      type: "interaction",
      name: isFollowing ? "user_unfollowed" : "user_followed",
      page: "profile",
      path: `/users/${targetId}`,
      user: req.user._id,
      meta: {
        targetUserId: targetId,
        targetHandle: targetUser.handle || "",
      },
    });

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
router.get("/:id([0-9a-fA-F]{24})/followers", validateObjectIdParam("id"), async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, {
      defaultLimit: 50,
      maxLimit: 100,
    });
    const cacheKey = buildRedisCacheKey("users", "followers", req.params.id, page, limit);
    const { status: cacheStatus, value } = await withRedisJsonCache(
      cacheKey,
      async () => {
        const user = await User.findById(req.params.id)
          .populate("followers", "name handle avatar verified")
          .lean();
        if (!user) return null;
        return {
          total: (user.followers || []).length,
          followers: (user.followers || []).slice(skip, skip + limit).map((f) => ({
            id: f._id,
            name: f.name,
            handle: f.handle,
            avatar: f.avatar,
            verified: f.verified,
          })),
        };
      },
      { ttlSeconds: 120 }
    );
    applyRedisCacheHeader(res, cacheStatus);
    if (!value) return res.status(404).json({ error: "User not found" });
    res.setHeader("X-Page", String(page));
    res.setHeader("X-Limit", String(limit));
    res.setHeader("X-Has-More", String(value.total > skip + limit));
    res.json(value.followers);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id/following — get following list
router.get("/:id([0-9a-fA-F]{24})/following", validateObjectIdParam("id"), async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, {
      defaultLimit: 50,
      maxLimit: 100,
    });
    const cacheKey = buildRedisCacheKey("users", "following", req.params.id, page, limit);
    const { status: cacheStatus, value } = await withRedisJsonCache(
      cacheKey,
      async () => {
        const user = await User.findById(req.params.id)
          .populate("following", "name handle avatar verified")
          .lean();
        if (!user) return null;
        return {
          total: (user.following || []).length,
          following: (user.following || []).slice(skip, skip + limit).map((f) => ({
            id: f._id,
            name: f.name,
            handle: f.handle,
            avatar: f.avatar,
            verified: f.verified,
          })),
        };
      },
      { ttlSeconds: 120 }
    );
    applyRedisCacheHeader(res, cacheStatus);
    if (!value) return res.status(404).json({ error: "User not found" });
    res.setHeader("X-Page", String(page));
    res.setHeader("X-Limit", String(limit));
    res.setHeader("X-Has-More", String(value.total > skip + limit));
    res.json(value.following);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
