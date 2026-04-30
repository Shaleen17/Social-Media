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
const ALLOWED_REACTIONS = ["❤️", "😂", "🙏", "👍", "🔥"];
const DELETE_UNDO_WINDOW_MS = 5000;
const MESSAGE_LINK_REGEX = /https?:\/\/[^\s<>"')]+/gi;

function hasId(list = [], userId) {
  const uid = userId ? userId.toString() : "";
  return list.some((item) => item && item.toString() === uid);
}

function toIdString(value) {
  if (!value) return "";
  return (value._id || value.id || value).toString();
}

function isActiveParticipantRecord(participant) {
  return !!participant && !!toIdString(participant) && participant.accountStatus !== "deleted";
}

function mapParticipantSummary(participant) {
  return {
    _id: toIdString(participant),
    name: participant?.name || "",
    handle: participant?.handle || "",
    avatar: participant?.avatar || null,
    verified: !!participant?.verified,
    lastSeen: participant?.lastSeen || null,
  };
}

function getConversationParticipantRecords(conv) {
  const records = conv?.$locals?.activeParticipants || conv?.participants || [];
  return records.filter(isActiveParticipantRecord);
}

function getConversationParticipantIds(conv) {
  return getConversationParticipantRecords(conv).map((participant) =>
    toIdString(participant)
  );
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

function cloneReplySnapshot(reply) {
  if (!reply) return null;
  return {
    messageId: reply.messageId,
    sender: reply.sender,
    senderName: reply.senderName || "",
    text: reply.text || "",
    attachmentKind: reply.attachmentKind || "",
    attachmentName: reply.attachmentName || "",
  };
}

function cloneReactionList(reactions = []) {
  return (reactions || [])
    .filter((reaction) => reaction && reaction.emoji)
    .map((reaction) => ({
      emoji: reaction.emoji,
      users: dedupeIds(reaction.users || []),
    }));
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

function serializeReaction(reaction, viewerId) {
  const users = dedupeIds(reaction?.users || []);
  return {
    emoji: reaction?.emoji || "",
    count: users.length,
    reacted: users.includes(viewerId.toString()),
  };
}

function getVisibleMessagesForViewer(conv, viewerId) {
  const viewer = viewerId.toString();
  return sortMessagesByOrder(
    (conv.messages || []).filter(
      (message) => !hasId(message.deletedFor, viewer)
    )
  );
}

function buildPinnedMessageSummary(message) {
  if (!message || message.deletedForEveryone) return null;
  const sender = message.sender || {};
  const firstAttachment = (message.attachments || [])[0];
  return {
    messageId: toIdString(message),
    sender: toIdString(sender),
    senderName: sender.name || "Unknown",
    text: message.text || "",
    attachmentKind: firstAttachment?.kind || "",
    attachmentName: firstAttachment?.name || attachmentLabel(firstAttachment),
    preview: buildMessagePreview(message),
    ts: message.createdAt,
  };
}

function getPinnedMessageForViewer(conv, viewerId) {
  if (!conv?.pinnedMessageId) return null;
  const message = (conv.messages || []).find(
    (item) => toIdString(item) === toIdString(conv.pinnedMessageId)
  );
  if (
    !message ||
    message.deletedForEveryone ||
    hasId(message.deletedFor, viewerId)
  ) {
    return null;
  }
  return buildPinnedMessageSummary(message);
}

function cleanupUndoEntries(message) {
  const now = Date.now();
  message.deleteUndoEntries = (message.deleteUndoEntries || []).filter(
    (entry) => entry?.expiresAt && new Date(entry.expiresAt).getTime() > now
  );
}

function replaceUndoEntry(message, entry) {
  cleanupUndoEntries(message);
  message.deleteUndoEntries = (message.deleteUndoEntries || []).filter(
    (item) =>
      !(
        toIdString(item.actor) === toIdString(entry.actor) &&
        item.scope === entry.scope
      )
  );
  message.deleteUndoEntries.push(entry);
}

function findUndoEntry(message, actorId, scope) {
  cleanupUndoEntries(message);
  return (message.deleteUndoEntries || []).find(
    (entry) =>
      toIdString(entry.actor) === actorId.toString() &&
      entry.scope === scope
  );
}

function removeUndoEntry(message, actorId, scope) {
  message.deleteUndoEntries = (message.deleteUndoEntries || []).filter(
    (entry) =>
      !(
        toIdString(entry.actor) === actorId.toString() &&
        (!scope || entry.scope === scope)
      )
  );
}

function clearPinnedMessageIfNeeded(conv, messageId) {
  if (toIdString(conv.pinnedMessageId) !== toIdString(messageId)) return false;
  conv.pinnedMessageId = null;
  conv.pinnedAt = null;
  conv.pinnedBy = null;
  return true;
}

function getMessageLinks(message) {
  const rawText = message?.text || "";
  const matches = rawText.match(MESSAGE_LINK_REGEX) || [];
  return matches.map((url) => ({
    url,
    label: url,
  }));
}

function filterIdListToAllowedUsers(list = [], allowedIds) {
  const original = dedupeIds(list);
  const filtered = original.filter((id) => allowedIds.has(id));
  return {
    list: filtered,
    changed:
      filtered.length !== original.length ||
      filtered.some((id, index) => id !== original[index]),
  };
}

async function normalizeConversationForActiveUsers(conv, viewerId) {
  if (!conv) return null;

  const viewer = viewerId ? viewerId.toString() : "";
  const originalParticipants = Array.isArray(conv.participants) ? conv.participants : [];
  const activeParticipants = originalParticipants.filter(isActiveParticipantRecord);
  const activeParticipantIds = new Set(
    activeParticipants.map((participant) => toIdString(participant))
  );
  let changed = activeParticipants.length !== originalParticipants.length;

  const nextMessages = [];
  for (const message of conv.messages || []) {
    const senderId = toIdString(message.sender);
    if (!senderId || !activeParticipantIds.has(senderId)) {
      changed = true;
      continue;
    }

    const delivered = filterIdListToAllowedUsers(
      message.deliveredTo || [],
      activeParticipantIds
    );
    if (delivered.changed) {
      message.deliveredTo = delivered.list;
      changed = true;
    }

    const readBy = filterIdListToAllowedUsers(
      message.readBy || [],
      activeParticipantIds
    );
    if (readBy.changed) {
      message.readBy = readBy.list;
      changed = true;
    }

    const deletedFor = filterIdListToAllowedUsers(
      message.deletedFor || [],
      activeParticipantIds
    );
    if (deletedFor.changed) {
      message.deletedFor = deletedFor.list;
      changed = true;
    }

    const starredBy = filterIdListToAllowedUsers(
      message.starredBy || [],
      activeParticipantIds
    );
    if (starredBy.changed) {
      message.starredBy = starredBy.list;
      changed = true;
    }

    const cleanedReactions = (message.reactions || [])
      .map((reaction) => {
        const users = filterIdListToAllowedUsers(
          reaction.users || [],
          activeParticipantIds
        );
        if (users.changed) changed = true;
        return {
          emoji: reaction.emoji,
          users: users.list,
        };
      })
      .filter((reaction) => reaction.emoji && reaction.users.length);
    if (cleanedReactions.length !== (message.reactions || []).length) {
      changed = true;
    }
    message.reactions = cleanedReactions;

    if (
      message.replyTo &&
      !activeParticipantIds.has(toIdString(message.replyTo.sender))
    ) {
      message.replyTo = null;
      changed = true;
    }

    nextMessages.push(message);
  }

  if (nextMessages.length !== (conv.messages || []).length) {
    conv.messages = nextMessages;
  }

  const hasOtherDirectParticipant =
    !conv.isGroup &&
    activeParticipants.some(
      (participant) => toIdString(participant) !== viewer
    );

  if (!conv.isGroup && viewer && !hasOtherDirectParticipant) {
    await Conversation.deleteOne({ _id: conv._id });
    return null;
  }

  if (
    conv.pinnedMessageId &&
    !nextMessages.some(
      (message) => toIdString(message) === toIdString(conv.pinnedMessageId)
    )
  ) {
    conv.pinnedMessageId = null;
    conv.pinnedAt = null;
    conv.pinnedBy = null;
    changed = true;
  }

  const latestVisible = [...sortMessagesByOrder(conv.messages || [])]
    .reverse()
    .find((message) => !message.deletedForEveryone);
  const nextLastMessage = latestVisible ? buildMessagePreview(latestVisible) : "";
  const nextLastMessageAt =
    latestVisible?.createdAt || conv.updatedAt || conv.lastMessageAt || new Date();

  if ((conv.lastMessage || "") !== nextLastMessage) {
    conv.lastMessage = nextLastMessage;
    changed = true;
  }
  if (
    !conv.lastMessageAt ||
    new Date(conv.lastMessageAt).getTime() !==
      new Date(nextLastMessageAt).getTime()
  ) {
    conv.lastMessageAt = nextLastMessageAt;
    changed = true;
  }

  if (changed) {
    conv.participants = activeParticipants.map(
      (participant) => participant._id || participant.id || participant
    );
    await conv.save();
  }

  conv.$locals.activeParticipants = activeParticipants;
  return conv;
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

function mapMessage(message, viewerId, participantIds, pinnedMessageId = null) {
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
    edited: !deleted && !!message.editedAt,
    editedAt: message.editedAt || null,
    starred: !deleted && hasId(message.starredBy, viewerId),
    reactions: deleted ? [] : (message.reactions || []).map((reaction) => serializeReaction(reaction, viewerId)).filter((reaction) => reaction.count > 0),
    isPinned: !deleted && !!pinnedMessageId && toIdString(message) === toIdString(pinnedMessageId),
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
  const participants = getConversationParticipantRecords(conv).map(
    mapParticipantSummary
  );

  const visibleMessages = getVisibleMessagesForViewer(conv, viewer);
  const lastVisible = visibleMessages[visibleMessages.length - 1] || null;
  const other = participants.find((participant) => participant._id !== viewer);

  const unreadCount = visibleMessages.filter((message) => {
    const senderId = toIdString(message.sender);
    return (
      senderId !== viewer &&
      !message.deletedForEveryone &&
      !(message.read || hasId(message.readBy, viewer))
    );
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
    pinnedMessage: getPinnedMessageForViewer(conv, viewerId),
    participants,
  };
}

function mapConversationSummary(conv, viewerId) {
  return {
    id: conv._id.toString(),
    pinnedMessage: getPinnedMessageForViewer(conv, viewerId),
  };
}

function emitConversationUpdated(io, conv, userIds = []) {
  if (!io || !conv || !userIds.length) return;
  userIds.forEach((userId) => {
    io.to(userId.toString()).emit("conversationUpdated", {
      convId: conv._id.toString(),
      conversation: mapConversationSummary(conv, userId),
    });
  });
}

function emitMessageUpdated(io, conv, message, viewerIds = [], conversationParticipantIds = []) {
  if (!io || !conv || !message || !viewerIds.length) return;
  const participantIds = conversationParticipantIds.length
    ? conversationParticipantIds.map((id) => id.toString())
    : (conv.participants || []).map((participant) => participant.toString());
  viewerIds.forEach((participantId) => {
    io.to(participantId.toString()).emit("messageUpdated", {
      convId: conv._id.toString(),
      message: mapMessage(
        message,
        participantId,
        participantIds,
        conv.pinnedMessageId
      ),
    });
  });
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
        participantIds,
        conv.pinnedMessageId
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
    reactions: [],
    starredBy: [],
    editedAt: null,
    moderationStatus: moderation.status,
    moderationFlags: moderation.flags,
    deliveredTo,
    readBy: [],
    deletedFor: [],
    deletedForEveryone: false,
    deleteUndoEntries: [],
    read: false,
  };

  conv.messages.push(message);
  while (conv.messages.length > 200) {
    const removed = conv.messages.shift();
    if (toIdString(removed) === toIdString(conv.pinnedMessageId)) {
      conv.pinnedMessageId = null;
      conv.pinnedAt = null;
      conv.pinnedBy = null;
    }
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
    participantIds,
    conv.pinnedMessageId
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
    participantIds,
    conv.pinnedMessageId
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
      .populate("participants", "name handle avatar verified lastSeen accountStatus")
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(limit);

    const normalizedConversations = (
      await Promise.all(
        conversations.map((conv) =>
          normalizeConversationForActiveUsers(conv, req.user._id)
        )
      )
    ).filter(Boolean);

    res.setHeader("X-Page", String(page));
    res.setHeader("X-Limit", String(limit));
    res.setHeader("X-Has-More", String(normalizedConversations.length === limit));
    res.json(normalizedConversations.map((conv) => mapConversation(conv, req.user._id)));
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
      .populate("participants", "name handle avatar verified lastSeen accountStatus")
      .populate("messages.sender", "name handle avatar");

    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const normalizedConv = await normalizeConversationForActiveUsers(
      conv,
      req.user._id
    );
    if (!normalizedConv) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const participantIds = getConversationParticipantIds(normalizedConv);
    const viewerId = req.user._id.toString();
    const { page, limit } = getPagination(req.query, {
      defaultLimit: 80,
      maxLimit: 120,
    });
    const changedMessageIds = [];
    const senderIds = new Set();

    normalizedConv.messages.forEach((message) => {
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
      await normalizedConv.save();
      await emitMessagesRead(
        req.app.get("io"),
        normalizedConv._id.toString(),
        viewerId,
        Array.from(senderIds),
        changedMessageIds
      );
    }

    const visibleMessages = normalizedConv.messages.filter((message) => !hasId(message.deletedFor, viewerId));
    const orderedMessages = sortMessagesByOrder(visibleMessages);
    const end = Math.max(0, orderedMessages.length - (page - 1) * limit);
    const start = Math.max(0, end - limit);
    const pageMessages = orderedMessages.slice(start, end);

    res.json({
      id: normalizedConv._id.toString(),
      participants: getConversationParticipantRecords(normalizedConv).map(
        mapParticipantSummary
      ),
      isGroup: !!normalizedConv.isGroup,
      groupName: normalizedConv.groupName,
      pinnedMessage: getPinnedMessageForViewer(normalizedConv, viewerId),
      messages: pageMessages.map((message) =>
        mapMessage(message, viewerId, participantIds, normalizedConv.pinnedMessageId)
      ),
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
    const foundUsers = await User.countDocuments({
      _id: { $in: participants },
      accountStatus: { $ne: "deleted" },
    });
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

router.post("/:convId/:messageId/react", validateObjectIdParam("convId"), validateObjectIdParam("messageId"), auth, async (req, res, next) => {
  try {
    const emoji = cleanString(req.body.emoji, {
      field: "Reaction",
      max: 8,
      required: true,
    });
    if (!ALLOWED_REACTIONS.includes(emoji)) {
      return res.status(400).json({ error: "Unsupported reaction" });
    }

    const conv = await Conversation.findOne({
      _id: req.params.convId,
      participants: req.user._id,
    }).populate("messages.sender", "name handle avatar");
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const message = conv.messages.id(req.params.messageId);
    if (!message || message.deletedForEveryone || hasId(message.deletedFor, req.user._id)) {
      return res.status(404).json({ error: "Message not found" });
    }

    const reaction = (message.reactions || []).find((item) => item.emoji === emoji);
    if (reaction) {
      if (hasId(reaction.users, req.user._id)) {
        reaction.users = reaction.users.filter(
          (userId) => userId.toString() !== req.user._id.toString()
        );
      } else {
        reaction.users.push(req.user._id);
      }
    } else {
      message.reactions.push({
        emoji,
        users: [req.user._id],
      });
    }

    message.reactions = (message.reactions || []).filter(
      (item) => (item.users || []).length
    );
    await conv.save();

    const participantIds = (conv.participants || []).map((participant) => participant.toString());
    emitMessageUpdated(req.app.get("io"), conv, message, participantIds, participantIds);

    res.json({
      success: true,
      message: mapMessage(message, req.user._id, participantIds, conv.pinnedMessageId),
    });
  } catch (err) {
    console.error("React to message error:", err);
    next(err);
  }
});

router.post("/:convId/:messageId/star", validateObjectIdParam("convId"), validateObjectIdParam("messageId"), auth, async (req, res, next) => {
  try {
    const conv = await Conversation.findOne({
      _id: req.params.convId,
      participants: req.user._id,
    }).populate("messages.sender", "name handle avatar");
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const message = conv.messages.id(req.params.messageId);
    if (!message || message.deletedForEveryone || hasId(message.deletedFor, req.user._id)) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (hasId(message.starredBy, req.user._id)) {
      message.starredBy = (message.starredBy || []).filter(
        (userId) => userId.toString() !== req.user._id.toString()
      );
    } else {
      message.starredBy.push(req.user._id);
    }

    await conv.save();

    const participantIds = (conv.participants || []).map((participant) => participant.toString());
    emitMessageUpdated(
      req.app.get("io"),
      conv,
      message,
      [req.user._id.toString()],
      participantIds
    );

    res.json({
      success: true,
      message: mapMessage(message, req.user._id, participantIds, conv.pinnedMessageId),
    });
  } catch (err) {
    console.error("Star message error:", err);
    next(err);
  }
});

router.post("/:convId/:messageId/pin", validateObjectIdParam("convId"), validateObjectIdParam("messageId"), auth, async (req, res, next) => {
  try {
    const conv = await Conversation.findOne({
      _id: req.params.convId,
      participants: req.user._id,
    }).populate("messages.sender", "name handle avatar");
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const message = conv.messages.id(req.params.messageId);
    if (!message || message.deletedForEveryone || hasId(message.deletedFor, req.user._id)) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (toIdString(conv.pinnedMessageId) === req.params.messageId) {
      conv.pinnedMessageId = null;
      conv.pinnedAt = null;
      conv.pinnedBy = null;
    } else {
      conv.pinnedMessageId = message._id;
      conv.pinnedAt = new Date();
      conv.pinnedBy = req.user._id;
    }

    await conv.save();

    const participantIds = (conv.participants || []).map((participant) => participant.toString());
    emitConversationUpdated(req.app.get("io"), conv, participantIds);

    res.json({
      success: true,
      pinnedMessage: getPinnedMessageForViewer(conv, req.user._id),
      pinnedMessageId: toIdString(conv.pinnedMessageId),
    });
  } catch (err) {
    console.error("Pin message error:", err);
    next(err);
  }
});

router.post("/:convId/:messageId/edit", validateObjectIdParam("convId"), validateObjectIdParam("messageId"), auth, async (req, res, next) => {
  try {
    const text = cleanString(req.body.text, {
      field: "Message text",
      max: 4000,
    });
    const conv = await Conversation.findOne({
      _id: req.params.convId,
      participants: req.user._id,
    }).populate("messages.sender", "name handle avatar");
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const message = conv.messages.id(req.params.messageId);
    if (!message || message.deletedForEveryone || hasId(message.deletedFor, req.user._id)) {
      return res.status(404).json({ error: "Message not found" });
    }
    if (toIdString(message.sender) !== req.user._id.toString()) {
      return res.status(403).json({ error: "Only the sender can edit this message" });
    }
    if (!text && !(message.attachments || []).length) {
      return res.status(400).json({ error: "Message text cannot be empty" });
    }

    message.text = text;
    message.editedAt = new Date();
    await conv.save();

    const participantIds = (conv.participants || []).map((participant) => participant.toString());
    emitMessageUpdated(req.app.get("io"), conv, message, participantIds, participantIds);

    res.json({
      success: true,
      message: mapMessage(message, req.user._id, participantIds, conv.pinnedMessageId),
    });
  } catch (err) {
    console.error("Edit message error:", err);
    next(err);
  }
});

router.post("/forward/message", auth, async (req, res, next) => {
  try {
    const sourceConvId = req.body.sourceConvId;
    const messageId = req.body.messageId;
    const targetConvIds = dedupeIds(
      Array.isArray(req.body.targetConvIds)
        ? req.body.targetConvIds
        : req.body.targetConvId
          ? [req.body.targetConvId]
          : []
    );

    if (!sourceConvId || !messageId || !targetConvIds.length) {
      return res.status(400).json({ error: "Source, message, and target are required" });
    }
    if (targetConvIds.length > 5) {
      return res.status(400).json({ error: "You can forward to at most 5 chats at once" });
    }
    assertObjectId(sourceConvId, "source conversation id");
    assertObjectId(messageId, "message id");
    targetConvIds.forEach((targetConvId) =>
      assertObjectId(targetConvId, "target conversation id")
    );

    const [sourceConv, targetConvs] = await Promise.all([
      Conversation.findOne({
        _id: sourceConvId,
        participants: req.user._id,
      }).populate("messages.sender", "name handle avatar"),
      Conversation.find({
        _id: { $in: targetConvIds },
        participants: req.user._id,
      }),
    ]);

    if (!sourceConv || targetConvs.length !== targetConvIds.length) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const sourceMessage = sourceConv.messages.id(messageId);
    if (!sourceMessage || sourceMessage.deletedForEveryone || hasId(sourceMessage.deletedFor, req.user._id)) {
      return res.status(404).json({ error: "Message not found" });
    }

    const payloads = [];
    for (const targetConvId of targetConvIds) {
      const targetConv = targetConvs.find(
        (item) => item._id.toString() === targetConvId.toString()
      );
      if (!targetConv) continue;
      const payload = await persistAndEmitMessage(req, targetConv, req.user, {
        text: sourceMessage.text || "",
        attachments: (sourceMessage.attachments || []).map((attachment) =>
          attachment.toObject()
        ),
        replyTo: null,
        forwarded: true,
      });
      payloads.push({
        convId: targetConv._id.toString(),
        message: payload,
      });
    }

    if (payloads.length === 1) {
      return res.json(payloads[0].message);
    }

    res.json({
      forwardedCount: payloads.length,
      messages: payloads,
    });
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
    const participantIds = (conv.participants || []).map((participant) => participant.toString());
    let conversationChanged = false;

    if (scope === "everyone") {
      if (toIdString(message.sender) !== req.user._id.toString()) {
        return res.status(403).json({ error: "Only the sender can delete for everyone" });
      }
      replaceUndoEntry(message, {
        actor: req.user._id,
        scope,
        expiresAt: new Date(Date.now() + DELETE_UNDO_WINDOW_MS),
        text: message.text || "",
        attachments: (message.attachments || []).map(serializeAttachment),
        replyTo: cloneReplySnapshot(message.replyTo),
        forwarded: !!message.forwarded,
        reactions: cloneReactionList(message.reactions),
        editedAt: message.editedAt || null,
        wasPinned: toIdString(conv.pinnedMessageId) === req.params.messageId,
      });
      message.text = "";
      message.attachments = [];
      message.replyTo = null;
      message.forwarded = false;
      message.reactions = [];
      message.editedAt = null;
      message.deletedForEveryone = true;
      message.deletedAt = new Date();
      message.deletedBy = req.user._id;
      conversationChanged = clearPinnedMessageIfNeeded(conv, req.params.messageId);
    } else if (!hasId(message.deletedFor, req.user._id)) {
      message.deletedFor.push(req.user._id);
      replaceUndoEntry(message, {
        actor: req.user._id,
        scope,
        expiresAt: new Date(Date.now() + DELETE_UNDO_WINDOW_MS),
      });
    }

    await conv.save();

    if (scope === "everyone") {
      const io = req.app.get("io");
      emitMessageUpdated(io, conv, message, participantIds, participantIds);
      if (conversationChanged) {
        emitConversationUpdated(io, conv, participantIds);
      }
    }

    res.json({
      success: true,
      scope,
      messageId: req.params.messageId,
      undoExpiresAt: new Date(Date.now() + DELETE_UNDO_WINDOW_MS).toISOString(),
    });
  } catch (err) {
    console.error("Delete message error:", err);
    next(err);
  }
});

router.post("/:convId/:messageId/delete/undo", validateObjectIdParam("convId"), validateObjectIdParam("messageId"), auth, async (req, res, next) => {
  try {
    const scope = req.body.scope === "everyone" ? "everyone" : "me";
    const conv = await Conversation.findOne({
      _id: req.params.convId,
      participants: req.user._id,
    }).populate("messages.sender", "name handle avatar");
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const message = conv.messages.id(req.params.messageId);
    if (!message) return res.status(404).json({ error: "Message not found" });

    const undoEntry = findUndoEntry(message, req.user._id, scope);
    if (!undoEntry) {
      return res.status(410).json({ error: "Undo window has expired" });
    }

    let conversationChanged = false;
    if (scope === "everyone") {
      message.text = undoEntry.text || "";
      message.attachments = undoEntry.attachments || [];
      message.replyTo = undoEntry.replyTo || null;
      message.forwarded = !!undoEntry.forwarded;
      message.reactions = cloneReactionList(undoEntry.reactions);
      message.editedAt = undoEntry.editedAt || null;
      message.deletedForEveryone = false;
      message.deletedAt = null;
      message.deletedBy = null;
      if (undoEntry.wasPinned) {
        conv.pinnedMessageId = message._id;
        conv.pinnedAt = new Date();
        conv.pinnedBy = req.user._id;
        conversationChanged = true;
      }
    } else {
      message.deletedFor = (message.deletedFor || []).filter(
        (userId) => userId.toString() !== req.user._id.toString()
      );
    }

    removeUndoEntry(message, req.user._id, scope);
    await conv.save();

    const participantIds = (conv.participants || []).map((participant) => participant.toString());
    const io = req.app.get("io");
    if (scope === "everyone") {
      emitMessageUpdated(io, conv, message, participantIds, participantIds);
      if (conversationChanged) {
        emitConversationUpdated(io, conv, participantIds);
      }
    } else {
      emitMessageUpdated(io, conv, message, [req.user._id.toString()], participantIds);
    }

    res.json({
      success: true,
      scope,
      message: mapMessage(message, req.user._id, participantIds, conv.pinnedMessageId),
    });
  } catch (err) {
    console.error("Undo delete message error:", err);
    next(err);
  }
});

router.post("/new/:userId", validateObjectIdParam("userId"), auth, async (req, res, next) => {
  try {
    const targetId = req.params.userId;
    if (targetId === req.user._id.toString()) {
      return res.status(400).json({ error: "Cannot message yourself" });
    }
    const targetUser = await User.exists({
      _id: targetId,
      accountStatus: { $ne: "deleted" },
    });
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
