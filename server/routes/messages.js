const express = require("express");
const Conversation = require("../models/Message");
const Notification = require("../models/Notification");
const { auth } = require("../middleware/auth");
const { sendPushToUsers } = require("../utils/push");

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
  if (explicitKind) return explicitKind;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

function sanitizeAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments)) return [];
  return rawAttachments
    .filter((item) => item && item.url)
    .map((item) => ({
      kind: getAttachmentKind(item.mimeType || "", item.kind || ""),
      url: item.url,
      name: item.name || "",
      mimeType: item.mimeType || "",
      size: Number(item.size) || 0,
      duration: item.duration != null ? Number(item.duration) || null : null,
    }));
}

function sanitizeReply(reply) {
  if (!reply || !reply.messageId || !reply.sender) return null;
  return {
    messageId: reply.messageId,
    sender: reply.sender,
    senderName: reply.senderName || "",
    text: reply.text || "",
    attachmentKind: reply.attachmentKind || "",
    attachmentName: reply.attachmentName || "",
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

  const visibleMessages = (conv.messages || []).filter(
    (message) => !hasId(message.deletedFor, viewer)
  );
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
  const senderId = senderUser._id.toString();
  const participantIds = (conv.participants || []).map((participant) => participant.toString());
  const recipientIds = participantIds.filter((id) => id !== senderId);
  const socketState = req.app.get("socketState");
  const deliveredTo = recipientIds.filter((id) => socketState?.isOnline(id));

  const message = {
    sender: senderUser._id,
    text,
    attachments,
    replyTo,
    forwarded,
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
    await Notification.insertMany(
      recipientIds.map((recipientId) => ({
        recipient: recipientId,
        sender: senderUser._id,
        type: "message",
        text: conv.isGroup
          ? `${senderUser.name} sent a message in ${conv.groupName || "your group"}`
          : "sent you a message",
      }))
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

  await sendPushToUsers(recipientIds, {
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
    const conversations = await Conversation.find({
      participants: req.user._id,
    })
      .populate("participants", "name handle avatar verified lastSeen")
      .sort({ lastMessageAt: -1 });

    res.json(conversations.map((conv) => mapConversation(conv, req.user._id)));
  } catch (err) {
    console.error("Get conversations error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:convId", auth, async (req, res) => {
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
      messages: conv.messages
        .filter((message) => !hasId(message.deletedFor, viewerId))
        .map((message) => mapMessage(message, viewerId, participantIds)),
    });
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:convId", auth, async (req, res) => {
  try {
    const text = (req.body.text || "").trim();
    const attachments = sanitizeAttachments(req.body.attachments);
    const replyTo = sanitizeReply(req.body.replyTo);
    const forwarded = !!req.body.forwarded;

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
    });

    res.json(payload);
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/forward/message", auth, async (req, res) => {
  try {
    const { sourceConvId, messageId, targetConvId } = req.body;
    if (!sourceConvId || !messageId || !targetConvId) {
      return res.status(400).json({ error: "Source, message, and target are required" });
    }

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
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:convId/:messageId/delete", auth, async (req, res) => {
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
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/new/:userId", auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (targetId === req.user._id.toString()) {
      return res.status(400).json({ error: "Cannot message yourself" });
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

    res.status(201).json({ id: conv._id, existing: false });
  } catch (err) {
    console.error("Start conversation error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/group", auth, async (req, res) => {
  try {
    const { name, participants } = req.body;
    if (!name || !participants || participants.length < 1) {
      return res.status(400).json({ error: "Group name and participants required" });
    }

    const allParticipants = [
      req.user._id,
      ...participants.filter((participant) => participant !== req.user._id.toString()),
    ];

    const conv = await Conversation.create({
      participants: allParticipants,
      isGroup: true,
      groupName: name,
      messages: [],
    });

    res.status(201).json({ id: conv._id });
  } catch (err) {
    console.error("Create group error:", err);
    res.status(500).json({ error: "Server error" });
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
