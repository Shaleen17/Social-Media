const Notification = require("../models/Notification");
const User = require("../models/User");

function baseImportanceForType(type = "") {
  switch (type) {
    case "message":
      return 95;
    case "mention":
      return 85;
    case "comment":
      return 72;
    case "follow":
      return 58;
    case "repost":
      return 46;
    case "like":
      return 36;
    default:
      return 24;
  }
}

function buildNotificationDedupeKey({
  recipientId,
  senderId,
  type,
  postId,
  convId,
}) {
  const recipient = recipientId ? recipientId.toString() : "";
  const sender = senderId ? senderId.toString() : "";
  const post = postId ? postId.toString() : "";
  const conversation = convId ? convId.toString() : "";

  if (type === "message") {
    return `message:${recipient}:${conversation || sender}`;
  }

  return `${type}:${recipient}:${sender}:${post || "none"}`;
}

function computeDeliveryScore(type, lastEventAt = new Date()) {
  const ageMinutes = Math.max(
    0,
    (Date.now() - new Date(lastEventAt).getTime()) / 60000
  );
  return Math.max(1, baseImportanceForType(type) - Math.floor(ageMinutes / 6));
}

function getPriorityLabel(importance = 0) {
  if (importance >= 85) return "high";
  if (importance >= 55) return "medium";
  return "normal";
}

function mapTypeToPreference(type = "") {
  switch (type) {
    case "message":
      return "chatMessages";
    case "like":
    case "comment":
    case "follow":
    case "repost":
    case "mention":
      return "communityHighlights";
    default:
      return "";
  }
}

async function createRankedNotification({
  recipient,
  sender,
  type,
  text = "",
  post = null,
  convId = "",
  forceNew = false,
}) {
  const recipientId = recipient ? recipient.toString() : "";
  const senderId = sender ? sender.toString() : "";

  if (!recipientId || !senderId || recipientId === senderId) {
    return null;
  }

  const preferenceKey = mapTypeToPreference(type);
  if (preferenceKey) {
    const recipientUser = await User.findById(recipientId)
      .select(`notificationSettings.${preferenceKey}`)
      .lean();
    if (
      recipientUser?.notificationSettings &&
      recipientUser.notificationSettings[preferenceKey] === false
    ) {
      return null;
    }
  }

  const now = new Date();
  const importance = baseImportanceForType(type);
  const deliveryScore = computeDeliveryScore(type, now);
  const dedupeKey = forceNew
    ? ""
    : buildNotificationDedupeKey({
        recipientId,
        senderId,
        type,
        postId: post,
        convId,
      });

  if (dedupeKey) {
    const existing = await Notification.findOne({
      recipient: recipientId,
      dedupeKey,
      read: false,
    });

    if (existing) {
      existing.text = text || existing.text;
      existing.post = post || existing.post;
      existing.convId = convId || existing.convId;
      existing.importance = importance;
      existing.deliveryScore = deliveryScore;
      existing.lastEventAt = now;
      existing.meta = {
        ...(existing.meta?.toObject ? existing.meta.toObject() : existing.meta || {}),
        count: Math.max(1, Number(existing.meta?.count) || 1) + 1,
      };
      await existing.save();
      return existing;
    }
  }

  return Notification.create({
    recipient,
    sender,
    type,
    post,
    convId: convId || null,
    text,
    importance,
    deliveryScore,
    dedupeKey: dedupeKey || null,
    lastEventAt: now,
    meta: { count: 1 },
  });
}

module.exports = {
  baseImportanceForType,
  computeDeliveryScore,
  createRankedNotification,
  getPriorityLabel,
};
