const express = require("express");
const Conversation = require("../models/Message");
const User = require("../models/User");
const { auth } = require("../middleware/auth");
const { createRankedNotification } = require("../services/notificationService");
const { recordAnalyticsEventSafe } = require("../services/analyticsService");
const { moderateTextContent } = require("../utils/contentFeatures");
const { sendPushToUsers } = require("../utils/push");
const {
  assertObjectId,
  cleanMediaUrl,
  cleanString,
  cleanStringArray,
  getPagination,
  validateObjectIdParam,
} = require("../utils/validation");

const router = express.Router();

function hasId(list = [], userId) {
  const uid = userId ? userId.toString() : "";
  return list.some((item) => item && item.toString() === uid);
}

function toIdString(value) {
  if (!value) return "";
  return (value._id || value.id || value).toString();
}

function dedupeIds(list = []) {
  return Array.from(new Set(list.map((item) => item && item.toString()).filter(Boolean)));
}

function getAttachmentKind(mimeType = "", explicitKind = "") {
  if (["image", "video", "audio", "document"].includes(explicitKind)) return explicitKind;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

function sanitizeAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments)) return [];
  return rawAttachments
    .slice(0, 5)
    .filter((item) => item && item.url)
    .map((item) => ({
      kind: getAttachmentKind(cleanString(item.mimeType, { field: "Attachment mime type", max: 120 }), cleanString(item.kind, { field: "Attachment kind", max: 20 })),
      url: cleanMediaUrl(item.url, {
        field: "Attachment URL",
        max: 4096,
        allowData: false,
        required: true,
      }),
      name: cleanString(item.name, { field: "Attachment name", max: 180 }),
      mimeType: cleanString(item.mimeType, { field: "Attachment mime type", max: 120 }),
      size: Math.max(0, Math.min(Number(item.size) || 0, 25 * 1024 * 1024)),
      duration: item.duration != null ? Number(item.duration) || null : null,
    }));
}

function sanitizeReply(reply) {
  if (!reply || !reply.messageId || !reply.sender) return null;
  assertObjectId(reply.messageId, "reply message id");
  assertObjectId(reply.sender, "reply sender id");
  return {
    messageId: reply.messageId,
    sender: reply.sender,
    senderName: cleanString(reply.senderName, { field: "Reply sender name", max: 80 }),
    text: cleanString(reply.text, { field: "Reply text", max: 280 }),
    attachmentKind: cleanString(reply.attachmentKind, { field: "Reply attachment kind", max: 20 }),
    attachmentName: cleanString(reply.attachmentName, { field: "Reply attachment name", max: 120 }),
  };
}

function attachmentLabel(attachment) {
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

function buildMessagePreview(message) {
  if (!message) return "";
  if (message.deletedForEveryone) return "This message was deleted";
  if (message.text) return message.text;
  if (message.attachments?.length) return `📎 ${attachmentLabel(message.attachments[0])}`;
  return "Message";
}

function buildReplySnapshot(message) {
  if (!message || message.deletedForEveryone) return null;
  const sender = message.sender || {};
  const firstAttachment = (message.attachments || [])[0];
  return {
    messageId: message._id,
    sender: sender._id || sender,
    senderName: sender.name || message.replyTo?.senderName || "Unknown",
    text: message.text || "",
    attachmentKind: firstAttachment?.kind || "",
    attachmentName: firstAttachment?.name || attachmentLabel(firstAttachment),
  };
}

function serializeAttachment(attachment) {
  return {
    kind: attachment.kind,
    url: attachment.url,
    name: attachment.name || "",
    mimeType: attachment.mimeType || "",
    size: attachment.size || 0,
    duration: attachment.duration ?? null,
  };
}

async function getOnlineRecipientIds(socketState, recipientIds = []) {
  if (!socketState?.isOnline || !recipientIds.length) return [];

  const onlineRecipientIds = await Promise.all(
    recipientIds.map(async (recipientId) => {
      try {
        return (await socketState.isOnline(recipientId)) ? recipientId : "";
      } catch {
        return "";
      }
    })
  );

  return onlineRecipientIds.filter(Boolean);
}

function sortMessagesByOrder(messages = []) {
  return [...messages].sort((left, right) => {
    const leftSeq = Number(left?.seq) || 0;
    const rightSeq = Number(right?.seq) || 0;
    if (leftSeq && rightSeq && leftSeq !== rightSeq) {
      return leftSeq - rightSeq;
    }
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });
}

function mapMessage(message, viewerId, participantIds) {
  const sender = message.sender || {};
  const senderId = toIdString(sender);
  const allRecipients = participantIds.filter((id) => id !== senderId);
  const deliveredCount = dedupeIds((message.deliveredTo || []).filter((id) => allRecipients.includes(id.toString()))).length;
  const readCount = dedupeIds((message.readBy || []).filter((id) => allRecipients.includes(id.toString()))).length;
  const isMe = senderId === viewerId.toString();

  let status = "";
  if (isMe) {
    status =
      allRecipients.length > 0 && readCount >= allRecipients.length
        ? "read"
        : deliveredCount > 0
          ? "delivered"
          : "sent";
  }

  const deleted = !!message.deletedForEveryone;
  return {
    id: toIdString(message),
    clientId: message.clientId || "",
    seq: Number(message.seq) || 0,
    from: senderId,
    sender: sender._id
      ? {
          _id: senderId,
          name: sender.name || "",
          handle: sender.handle || "",
          avatar: sender.avatar || null,
        }
      : { _id: senderId },
    txt: deleted ? "This message was deleted" : message.text || "",
    ts: message.createdAt,
    t: timeAgo(message.createdAt),
    read: status === "read",
    delivered: status === "read" || status === "delivered",
    status,
    isMe,
    deleted,
    forwarded: !deleted && !!message.forwarded,
    attachments: deleted ? [] : (message.attachments || []).map(serializeAttachment),
    replyTo:
      deleted || !message.replyTo
        ? null
        : {
            messageId: toIdString(message.replyTo.messageId),
            sender: toIdString(message.replyTo.sender),
            senderName: message.replyTo.senderName || "",
            text: message.replyTo.text || "",
            attachmentKind: message.replyTo.attachmentKind || "",
            attachmentName: message.replyTo.attachmentName || "",
          },
  };
}

function mapConversation(conv, viewerId) {
  const viewer = viewerId.toString();
  const participants = (conv.participants || []).map((participant) => ({
    _id: toIdString(participant),
    name: participant.name || "",
    handle: participant.handle || "",
    avatar: participant.avatar || null,
    verified: !!participant.verified,
    lastSeen: participant.lastSeen || null,
  }));

  const visibleMessages = sortMessagesByOrder((conv.messages || []).filter(
    (message) => !hasId(message.deletedFor, viewer)
  ));
  const lastVisible = visibleMessages[visibleMessages.length - 1] || null;
  const other = participants.find((participant) => participant._id !== viewer);

  const unreadCount = visibleMessages.filter((message) => {
    const senderId = toIdString(message.sender);
    return senderId !== viewer && !(message.read || hasId(message.readBy, viewer));
  }).length;

  return {
    id: toIdString(conv),
    uid: other?._id || "",
    user: conv.isGroup ? null : other || null,
    isGroup: !!conv.isGroup,
    groupName: conv.groupName,
    groupAvatar: conv.groupAvatar,
    lastMessage: buildMessagePreview(lastVisible),
    lastMessageTime: lastVisible?.createdAt || conv.lastMessageAt || null,
    unreadCount,
    participants,
  };
}

async function emitMessagesRead(io, convId, viewerId, senderIds, messageIds) {
  if (!io || !senderIds.length || !messageIds.length) return;
  senderIds.forEach((senderId) => {
    io.to(senderId).emit("messagesRead", {
      convId,
      userId: viewerId,
      messageIds,
    });
  });
}

async function persistAndEmitMessage(req, conv, senderUser, options) {
  const text = options.text || "";
  const attachments = sanitizeAttachments(options.attachments);
  const replyTo = sanitizeReply(options.replyTo);
  const forwarded = !!options.forwarded;
  const clientId =
    cleanString(options.clientId, {
      field: "Message client id",
      max: 80,
    }) || "";
  const senderId = senderUser._id.toString();
  const participantIds = (conv.participants || []).map((participant) => participant.toString());
  const recipientIds = participantIds.filter((id) => id !== senderId);
  const socketState = req.app.get("socketState");
  const deliveredTo = await getOnlineRecipientIds(socketState, recipientIds);
  const moderation = moderateTextContent([
    text,
    replyTo?.text || "",
    ...attachments.map((attachment) => attachment.name || ""),
  ]);

  if (clientId) {
    const existing = (conv.messages || []).find(
      (message) =>
        message.clientId === clientId &&
        toIdString(message.sender) === senderId
    );

    if (existing) {
      return mapMessage(
        {
          ...existing.toObject(),
          sender: {
            _id: senderUser._id,
            name: senderUser.name,
            handle: senderUser.handle,
            avatar: senderUser.avatar,
          },
        },
        senderId,
        participantIds
      );
    }
  }

  conv.messageSequence = (Number(conv.messageSequence) || 0) + 1;

  const message = {
    sender: senderUser._id,
    clientId,
    seq: conv.messageSequence,
    text,
    attachments,
    replyTo,
    forwarded,
    moderationStatus: moderation.status,
    moderationFlags: moderation.flags,
    deliveredTo,
    readBy: [],
    deletedFor: [],
    deletedForEveryone: false,
    read: false,
  };

  conv.messages.push(message);
  while (conv.messages.length > 200) {
    conv.messages.shift();
  }
  conv.lastMessage = buildMessagePreview(message);
  conv.lastMessageAt = new Date();
  await conv.save();

  const newMessage = conv.messages[conv.messages.length - 1];
  const io = req.app.get("io");
  const preview = buildMessagePreview(newMessage);
  const payloadForRecipients = mapMessage(
    {
      ...newMessage.toObject(),
      sender: {
        _id: senderUser._id,
        name: senderUser.name,
        handle: senderUser.handle,
        avatar: senderUser.avatar,
      },
    },
    recipientIds[0] || senderId,
    participantIds
  );

  if (recipientIds.length) {
    await Promise.all(
      recipientIds.map((recipientId) =>
        createRankedNotification({
          recipient: recipientId,
          sender: senderUser._id,
          type: "message",
          convId: conv._id.toString(),
          text: conv.isGroup
            ? `${senderUser.name} sent a message in ${conv.groupName || "your group"}`
            : "sent you a message",
        })
      )
    );
  }

  if (io) {
    recipientIds.forEach((recipientId) => {
      io.to(recipientId).emit("newMessage", {
        convId: conv._id.toString(),
        message: payloadForRecipients,
      });
      io.to(recipientId).emit("messageNotification", {
        convId: conv._id.toString(),
        from: {
          _id: senderId,
          name: senderUser.name,
          handle: senderUser.handle,
          avatar: senderUser.avatar,
        },
        text: preview,
      });
      io.to(recipientId).emit("notification", {
        type: "message",
        from: senderId,
        sender: {
          _id: senderId,
          name: senderUser.name,
          handle: senderUser.handle,
          avatar: senderUser.avatar,
        },
        txt: conv.isGroup
          ? `${senderUser.name} sent a message in ${conv.groupName || "your group"}`
          : "sent you a message",
        t: "Just now",
        unread: true,
      });
      });
  }

  const deliveredSet = new Set(deliveredTo);
  const pushRecipientIds = recipientIds.filter((id) => !deliveredSet.has(id));
  await sendPushToUsers(pushRecipientIds, {
    title: conv.isGroup ? conv.groupName || "New group message" : senderUser.name,
    body: preview.length > 120 ? preview.slice(0, 117) + "..." : preview,
    icon: senderUser.avatar || "/Brand_Logo.jpg",
    badge: "/Brand_Logo.jpg",
    tag: `chat-${conv._id}`,
    data: {
      type: "chat-message",
      convId: conv._id.toString(),
      senderId,
      url: `/?openChat=${encodeURIComponent(conv._id.toString())}`,
    },
  });

  await recordAnalyticsEventSafe({
    req,
    type: "interaction",
    name: "chat_message_sent",
    page: "chats",
    path: `/messages/${conv._id}`,
    user: senderUser._id,
    meta: {
      convId: conv._id.toString(),
      isGroup: !!conv.isGroup,
      recipientCount: recipientIds.length,
      preview: preview.slice(0, 140),
      forwarded,
      hasAttachments: attachments.length > 0,
      moderationStatus: moderation.status,
    },
  });

  return mapMessage(
    {
      ...newMessage.toObject(),
      sender: {
        _id: senderUser._id,
        name: senderUser.name,
        handle: senderUser.handle,
        avatar: senderUser.avatar,
      },
    },
    senderId,
    participantIds
  );
}

router.get("/", auth, async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query, {
      defaultLimit: 30,
      maxLimit: 60,
    });
    const conversations = await Conversation.find({
      participants: req.user._id,
    })
      .populate("participants", "name handle avatar verified lastSeen")
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(limit);

    res.setHeader("X-Page", String(page));
    res.setHeader("X-Limit", String(limit));
    res.setHeader("X-Has-More", String(conversations.length === limit));
    res.json(conversations.map((conv) => mapConversation(conv, req.user._id)));
  } catch (err) {
    console.error("Get conversations error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:convId", validateObjectIdParam("convId"), auth, async (req, res) => {
  try {
    const conv = await Conversation.findOne({
      _id: req.params.convId,
      participants: req.user._id,
    })
      .populate("participants", "name handle avatar verified lastSeen")
      .populate("messages.sender", "name handle avatar");

    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const participantIds = (conv.participants || []).map((participant) => toIdString(participant));
    const viewerId = req.user._id.toString();
    const { page, limit } = getPagination(req.query, {
      defaultLimit: 80,
      maxLimit: 120,
    });
    const changedMessageIds = [];
    const senderIds = new Set();

    conv.messages.forEach((message) => {
      const senderId = toIdString(message.sender);
      if (
        senderId !== viewerId &&
        !message.deletedForEveryone &&
        !hasId(message.deletedFor, viewerId)
      ) {
        let changed = false;
        if (!hasId(message.deliveredTo, viewerId)) {
          message.deliveredTo.push(req.user._id);
          changed = true;
        }
        if (!hasId(message.readBy, viewerId)) {
          message.readBy.push(req.user._id);
          changed = true;
        }
        if (!message.read) {
          message.read = true;
          changed = true;
        }
        if (changed) {
          changedMessageIds.push(toIdString(message));
          senderIds.add(senderId);
        }
      }
    });

    if (changedMessageIds.length) {
      await conv.save();
      await emitMessagesRead(
        req.app.get("io"),
        conv._id.toString(),
        viewerId,
        Array.from(senderIds),
        changedMessageIds
      );
    }

    const visibleMessages = conv.messages.filter((message) => !hasId(message.deletedFor, viewerId));
    const orderedMessages = sortMessagesByOrder(visibleMessages);
    const end = Math.max(0, orderedMessages.length - (page - 1) * limit);
    const start = Math.max(0, end - limit);
    const pageMessages = orderedMessages.slice(start, end);

    res.json({
      id: conv._id.toString(),
      participants: (conv.participants || []).map((participant) => ({
        _id: toIdString(participant),
        name: participant.name || "",
        handle: participant.handle || "",
        avatar: participant.avatar || null,
        verified: !!participant.verified,
        lastSeen: participant.lastSeen || null,
      })),
      isGroup: !!conv.isGroup,
      groupName: conv.groupName,
      messages: pageMessages.map((message) => mapMessage(message, viewerId, participantIds)),
      pagination: {
        page,
        limit,
        total: orderedMessages.length,
        hasMore: start > 0,
      },
    });
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/group", auth, async (req, res, next) => {
  try {
    const name = cleanString(req.body.name, {
      field: "Group name",
      max: 80,
      required: true,
    });
    const participants = cleanStringArray(req.body.participants, {
      maxItems: 20,
      maxLength: 40,
    }).filter((participant) => participant !== req.user._id.toString());

    if (!participants.length) {
      return res.status(400).json({ error: "At least one participant is required" });
    }

    participants.forEach((participant) => assertObjectId(participant, "participant id"));
    const foundUsers = await User.countDocuments({ _id: { $in: participants } });
    if (foundUsers !== participants.length) {
      return res.status(400).json({ error: "One or more participants are invalid" });
    }

    const conv = await Conversation.create({
      participants: [req.user._id, ...participants],
      isGroup: true,
      groupName: name,
      messages: [],
    });

    await recordAnalyticsEventSafe({
      req,
      type: "interaction",
      name: "group_created",
      page: "chats",
      path: `/messages/${conv._id}`,
      user: req.user._id,
      meta: {
        convId: conv._id.toString(),
        name,
        participantCount: participants.length + 1,
      },
    });

    res.status(201).json({ id: conv._id });
  } catch (err) {
    next(err);
  }
});

router.post("/:convId", validateObjectIdParam("convId"), auth, async (req, res, next) => {
  try {
    const text = cleanString(req.body.text, { field: "Message text", max: 4000 });
    const attachments = sanitizeAttachments(req.body.attachments);
    const replyTo = sanitizeReply(req.body.replyTo);
    const forwarded = !!req.body.forwarded;
    const clientId = cleanString(req.body.clientId, {
      field: "Message client id",
      max: 80,
    });

    if (!text && !attachments.length) {
      return res.status(400).json({ error: "Message text or attachment required" });
    }

    const conv = await Conversation.findOne({
      _id: req.params.convId,
      participants: req.user._id,
    });
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const payload = await persistAndEmitMessage(req, conv, req.user, {
      text,
      attachments,
      replyTo,
      forwarded,
      clientId,
    });

    res.json(payload);
  } catch (err) {
    console.error("Send message error:", err);
    next(err);
  }
});

router.post("/forward/message", auth, async (req, res, next) => {
  try {
    const { sourceConvId, messageId, targetConvId } = req.body;
    if (!sourceConvId || !messageId || !targetConvId) {
      return res.status(400).json({ error: "Source, message, and target are required" });
    }
    assertObjectId(sourceConvId, "source conversation id");
    assertObjectId(messageId, "message id");
    assertObjectId(targetConvId, "target conversation id");

    const [sourceConv, targetConv] = await Promise.all([
      Conversation.findOne({
        _id: sourceConvId,
        participants: req.user._id,
      }).populate("messages.sender", "name handle avatar"),
      Conversation.findOne({
        _id: targetConvId,
        participants: req.user._id,
      }),
    ]);

    if (!sourceConv || !targetConv) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const sourceMessage = sourceConv.messages.id(messageId);
    if (!sourceMessage || sourceMessage.deletedForEveryone || hasId(sourceMessage.deletedFor, req.user._id)) {
      return res.status(404).json({ error: "Message not found" });
    }

    const payload = await persistAndEmitMessage(req, targetConv, req.user, {
      text: sourceMessage.text || "",
      attachments: (sourceMessage.attachments || []).map((attachment) => attachment.toObject()),
      replyTo: null,
      forwarded: true,
    });

    res.json(payload);
  } catch (err) {
    console.error("Forward message error:", err);
    next(err);
  }
});

router.post("/:convId/:messageId/delete", validateObjectIdParam("convId"), validateObjectIdParam("messageId"), auth, async (req, res, next) => {
  try {
    const scope = req.body.scope === "everyone" ? "everyone" : "me";
    const conv = await Conversation.findOne({
      _id: req.params.convId,
      participants: req.user._id,
    })
      .populate("messages.sender", "name handle avatar");

    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const message = conv.messages.id(req.params.messageId);
    if (!message) return res.status(404).json({ error: "Message not found" });

    if (scope === "everyone") {
      if (toIdString(message.sender) !== req.user._id.toString()) {
        return res.status(403).json({ error: "Only the sender can delete for everyone" });
      }
      message.text = "";
      message.attachments = [];
      message.replyTo = null;
      message.forwarded = false;
      message.deletedForEveryone = true;
      message.deletedAt = new Date();
      message.deletedBy = req.user._id;
    } else if (!hasId(message.deletedFor, req.user._id)) {
      message.deletedFor.push(req.user._id);
    }

    await conv.save();

    if (scope === "everyone") {
      const io = req.app.get("io");
      const participantIds = (conv.participants || []).map((participant) => participant.toString());
      if (io) {
        participantIds.forEach((participantId) => {
          io.to(participantId).emit("messageUpdated", {
            convId: conv._id.toString(),
            message: mapMessage(message, participantId, participantIds),
          });
        });
      }
    }

    res.json({
      success: true,
      scope,
      messageId: req.params.messageId,
    });
  } catch (err) {
    console.error("Delete message error:", err);
    next(err);
  }
});

router.post("/new/:userId", validateObjectIdParam("userId"), auth, async (req, res, next) => {
  try {
    const targetId = req.params.userId;
    if (targetId === req.user._id.toString()) {
      return res.status(400).json({ error: "Cannot message yourself" });
    }
    const targetUser = await User.exists({ _id: targetId });
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    let conv = await Conversation.findOne({
      participants: { $all: [req.user._id, targetId] },
      isGroup: false,
    });

    if (conv) {
      return res.json({ id: conv._id, existing: true });
    }

    conv = await Conversation.create({
      participants: [req.user._id, targetId],
      messages: [],
      isGroup: false,
    });

    const target = await User.findById(targetId).select("handle").lean();
    await recordAnalyticsEventSafe({
      req,
      type: "interaction",
      name: "conversation_started",
      page: "chats",
      path: `/messages/${conv._id}`,
      user: req.user._id,
      meta: {
        convId: conv._id.toString(),
        targetUserId: targetId,
        targetHandle: target?.handle || "",
      },
    });

    res.status(201).json({ id: conv._id, existing: false });
  } catch (err) {
    console.error("Start conversation error:", err);
    next(err);
  }
});

function timeAgo(date) {
  if (!date) return "";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  if (seconds < 604800) return Math.floor(seconds / 86400) + "d ago";
  return new Date(date).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  });
}

module.exports = router;
