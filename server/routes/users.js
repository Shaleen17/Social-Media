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

function invalidateUserCaches(namespaces = ["users", "search", "bootstrap", "videos"]) {
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

function toIdString(value) {
  if (!value) return "";
  return (value._id || value.id || value).toString();
}

function pruneObjectIdList(values = [], removedUserId) {
  const removedId = removedUserId ? removedUserId.toString() : "";
  const nextValues = (Array.isArray(values) ? values : []).filter(
    (value) => value && value.toString() !== removedId
  );
  return {
    values: nextValues,
    changed: nextValues.length !== (Array.isArray(values) ? values.length : 0),
  };
}

function getConversationAttachmentLabel(attachment) {
  if (!attachment) return "Attachment";
  switch (attachment.kind) {
    case "image":
      return "Photo";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    default:
      return attachment.name || "Document";
  }
}

function buildConversationMessagePreview(message) {
  if (!message) return "";
  if (message.deletedForEveryone) return "This message was deleted";
  if (message.text) return message.text;
  if (message.attachments?.length) {
    return `Attachment: ${getConversationAttachmentLabel(message.attachments[0])}`;
  }
  return "Message";
}

function sortConversationMessages(messages = []) {
  return [...messages].sort((left, right) => {
    const leftSeq = Number(left?.seq) || 0;
    const rightSeq = Number(right?.seq) || 0;
    if (leftSeq && rightSeq && leftSeq !== rightSeq) {
      return leftSeq - rightSeq;
    }
    return (
      new Date(left?.createdAt || 0).getTime() -
      new Date(right?.createdAt || 0).getTime()
    );
  });
}

function cleanupDeletedUserConversation(conversation, userId, deletedAt) {
  const removedUserId = userId ? userId.toString() : "";
  let changed = false;
  const participantIds = (conversation.participants || []).map((participant) =>
    participant?.toString()
  );
  const removedMessageIds = new Set(
    (conversation.messages || [])
      .filter((message) => message.sender?.toString() === removedUserId)
      .map((message) => toIdString(message))
      .filter(Boolean)
  );

  if (!conversation.isGroup) {
    return {
      deleteConversation:
        participantIds.includes(removedUserId) || removedMessageIds.size > 0,
      changed: false,
      notifyUserIds: participantIds.filter((participantId) => participantId && participantId !== removedUserId),
    };
  }

  const nextParticipants = (conversation.participants || []).filter(
    (participant) => participant && participant.toString() !== removedUserId
  );
  if (nextParticipants.length !== (conversation.participants || []).length) {
    conversation.participants = nextParticipants;
    changed = true;
  }

  if (removedMessageIds.size) {
    conversation.messages = (conversation.messages || []).filter((message) => {
      const keep = message.sender?.toString() !== removedUserId;
      if (!keep) changed = true;
      return keep;
    });
  }

  (conversation.messages || []).forEach((message) => {
    if (
      message.replyTo &&
      (toIdString(message.replyTo.sender) === removedUserId ||
        removedMessageIds.has(toIdString(message.replyTo.messageId)))
    ) {
      message.replyTo = null;
      changed = true;
    }

    if (message.deletedBy?.toString() === removedUserId) {
      message.deletedBy = null;
      changed = true;
    }

    [
      "deliveredTo",
      "readBy",
      "deletedFor",
      "starredBy",
    ].forEach((field) => {
      const pruned = pruneObjectIdList(message[field], removedUserId);
      if (pruned.changed) {
        message[field] = pruned.values;
        changed = true;
      }
    });

    const nextDeleteUndoEntries = (message.deleteUndoEntries || []).filter(
      (entry) => entry?.actor?.toString() !== removedUserId
    );
    if (nextDeleteUndoEntries.length !== (message.deleteUndoEntries || []).length) {
      message.deleteUndoEntries = nextDeleteUndoEntries;
      changed = true;
    }

    const nextReactions = (message.reactions || [])
      .map((reaction) => {
        const prunedUsers = pruneObjectIdList(reaction.users, removedUserId);
        if (prunedUsers.changed) changed = true;
        return {
          emoji: reaction.emoji,
          users: prunedUsers.values,
        };
      })
      .filter((reaction) => reaction.emoji && reaction.users.length);

    if (nextReactions.length !== (message.reactions || []).length) {
      changed = true;
    }
    message.reactions = nextReactions;
  });

  if (
    conversation.pinnedMessageId &&
    removedMessageIds.has(toIdString(conversation.pinnedMessageId))
  ) {
    conversation.pinnedMessageId = null;
    conversation.pinnedAt = null;
    conversation.pinnedBy = null;
    changed = true;
  } else if (conversation.pinnedBy?.toString() === removedUserId) {
    conversation.pinnedBy = null;
    changed = true;
  }

  const latestVisibleMessage = [...sortConversationMessages(conversation.messages || [])]
    .reverse()
    .find((message) => !message.deletedForEveryone);
  const nextLastMessage = latestVisibleMessage
    ? buildConversationMessagePreview(latestVisibleMessage)
    : "";
  const nextLastMessageAt =
    latestVisibleMessage?.createdAt ||
    conversation.updatedAt ||
    deletedAt;

  if ((conversation.lastMessage || "") !== nextLastMessage) {
    conversation.lastMessage = nextLastMessage;
    changed = true;
  }
  if (
    !conversation.lastMessageAt ||
    new Date(conversation.lastMessageAt).getTime() !==
      new Date(nextLastMessageAt).getTime()
  ) {
    conversation.lastMessageAt = nextLastMessageAt;
    changed = true;
  }

  return {
    deleteConversation: !(conversation.participants || []).length,
    changed,
    notifyUserIds: (conversation.participants || [])
      .map((participant) => participant?.toString())
      .filter(Boolean),
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
          .select("name handle avatar bio verified followers")
          .limit(limit)
          .lean();

        return users.map((u) => ({
          id: u._id,
          name: u.name,
          handle: u.handle,
          avatar: u.avatar,
          bio: u.bio,
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

// GET /api/users/all — safe user directory for authenticated discovery only
router.get("/all", auth, async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, {
      defaultLimit: 20,
      maxLimit: 40,
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
          .select("name handle avatar bio verified followers following")
          .limit(limit)
          .lean();

        return users.map((u) => ({
          id: u._id,
          name: u.name,
          handle: u.handle,
          avatar: u.avatar,
          bio: u.bio,
          verified: u.verified,
          followersCount: (u.followers || []).length,
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
          followersCount: (found.followers || []).length,
          followingCount: (found.following || []).length,
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

    const io = req.app.get("io");
    const notifyConversationUserIds = new Set();
    const conversations = await Conversation.find({
      $or: [
        { participants: userId },
        { "messages.sender": userId },
        { "messages.replyTo.sender": userId },
        { "messages.reactions.users": userId },
        { "messages.starredBy": userId },
        { "messages.readBy": userId },
        { "messages.deliveredTo": userId },
        { "messages.deletedFor": userId },
        { "messages.deleteUndoEntries.actor": userId },
        { pinnedBy: userId },
      ],
    });

    for (const conversation of conversations) {
      const cleanup = cleanupDeletedUserConversation(
        conversation,
        userId,
        deletedAt
      );

      cleanup.notifyUserIds.forEach((participantId) => {
        if (participantId && participantId !== userId.toString()) {
          notifyConversationUserIds.add(participantId);
        }
      });

      if (cleanup.deleteConversation) {
        await Conversation.deleteOne({ _id: conversation._id });
        continue;
      }

      if (cleanup.changed) {
        await conversation.save();
      }
    }

    if (io && notifyConversationUserIds.size) {
      notifyConversationUserIds.forEach((participantId) => {
        io.to(participantId).emit("conversationsInvalidated", {
          reason: "participant_removed",
          userId: userId.toString(),
        });
      });
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
