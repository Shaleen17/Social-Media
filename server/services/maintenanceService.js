const Conversation = require("../models/Message");
const Notification = require("../models/Notification");
const User = require("../models/User");
const { computeDeliveryScore } = require("./notificationService");

const PASSWORD_RESET_SELECT_FIELDS =
  "+passwordResetOtpHash +passwordResetOtpExpiresAt +passwordResetOtpLastSentAt +passwordResetOtpAttemptCount +passwordResetLastAttemptAt";

function cleanupUndoEntries(message, nowMs = Date.now()) {
  const entries = Array.isArray(message?.deleteUndoEntries)
    ? message.deleteUndoEntries
    : [];
  const filtered = entries.filter(
    (entry) =>
      entry?.expiresAt && new Date(entry.expiresAt).getTime() > nowMs
  );
  return {
    filtered,
    removedCount: entries.length - filtered.length,
  };
}

async function cleanupExpiredPasswordResetOtps(options = {}) {
  const batchSize = Math.max(
    25,
    Number(options.batchSize || process.env.CRON_AUTH_CLEANUP_BATCH_SIZE) || 200
  );
  const now = new Date();
  let scanned = 0;
  let cleared = 0;

  while (true) {
    const users = await User.find({
      passwordResetOtpExpiresAt: { $ne: null, $lte: now },
    })
      .select(PASSWORD_RESET_SELECT_FIELDS)
      .sort({ passwordResetOtpExpiresAt: 1 })
      .limit(batchSize);

    if (!users.length) break;
    scanned += users.length;

    const operations = users.map((user) => ({
      updateOne: {
        filter: { _id: user._id },
        update: {
          $set: {
            passwordResetOtpHash: null,
            passwordResetOtpExpiresAt: null,
            passwordResetOtpLastSentAt: null,
            passwordResetOtpAttemptCount: 0,
            passwordResetLastAttemptAt: null,
          },
        },
      },
    }));

    if (operations.length) {
      await User.bulkWrite(operations, { ordered: false });
      cleared += operations.length;
    }

    if (users.length < batchSize) break;
  }

  return {
    scanned,
    cleared,
  };
}

async function cleanupExpiredMessageUndoEntries(options = {}) {
  const batchSize = Math.max(
    10,
    Number(options.batchSize || process.env.CRON_MESSAGE_CLEANUP_BATCH_SIZE) || 50
  );
  const nowMs = Date.now();
  let scanned = 0;
  let updated = 0;
  let removedEntries = 0;

  const conversations = await Conversation.find({
    "messages.deleteUndoEntries.0": { $exists: true },
  })
    .select("_id messages")
    .sort({ updatedAt: 1 })
    .limit(batchSize);

  for (const conversation of conversations) {
    scanned += 1;
    let changed = false;

    (conversation.messages || []).forEach((message) => {
      if (!Array.isArray(message.deleteUndoEntries) || !message.deleteUndoEntries.length) {
        return;
      }
      const cleaned = cleanupUndoEntries(message, nowMs);
      if (cleaned.removedCount > 0) {
        message.deleteUndoEntries = cleaned.filtered;
        removedEntries += cleaned.removedCount;
        changed = true;
      }
    });

    if (changed) {
      await conversation.save();
      updated += 1;
    }
  }

  return {
    scanned,
    updated,
    removedEntries,
  };
}

async function refreshUnreadNotificationScores(options = {}) {
  const batchSize = Math.max(
    50,
    Number(options.batchSize || process.env.CRON_NOTIFICATION_BATCH_SIZE) || 250
  );
  const maxAgeDays = Math.max(
    7,
    Number(options.maxAgeDays || process.env.CRON_NOTIFICATION_MAX_AGE_DAYS) || 30
  );
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
  let scanned = 0;
  let updated = 0;
  let cursor = null;

  while (true) {
    const query = {
      read: false,
      lastEventAt: { $gte: cutoff },
    };

    if (cursor) {
      query.$or = [
        { lastEventAt: { $gt: cursor.lastEventAt } },
        {
          lastEventAt: cursor.lastEventAt,
          _id: { $gt: cursor.id },
        },
      ];
    }

    const notifications = await Notification.find(query)
      .select("_id type lastEventAt deliveryScore")
      .sort({ lastEventAt: 1, _id: 1 })
      .limit(batchSize)
      .lean();

    if (!notifications.length) break;
    scanned += notifications.length;

    const operations = notifications
      .map((notification) => {
        const nextScore = computeDeliveryScore(
          notification.type,
          notification.lastEventAt
        );
        if (Number(notification.deliveryScore) === nextScore) {
          return null;
        }
        return {
          updateOne: {
            filter: { _id: notification._id },
            update: {
              $set: { deliveryScore: nextScore },
            },
          },
        };
      })
      .filter(Boolean);

    if (operations.length) {
      await Notification.bulkWrite(operations, { ordered: false });
      updated += operations.length;
    }

    const lastNotification = notifications[notifications.length - 1];
    cursor = {
      id: lastNotification._id,
      lastEventAt: lastNotification.lastEventAt,
    };

    if (notifications.length < batchSize) break;
  }

  return {
    scanned,
    updated,
  };
}

async function trimOldNotifications(options = {}) {
  const retentionDays = Math.max(
    7,
    Number(options.retentionDays || process.env.CRON_NOTIFICATION_RETENTION_DAYS) || 45
  );
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await Notification.deleteMany({
    read: true,
    lastEventAt: { $lt: cutoff },
  });

  return {
    deleted: Number(result.deletedCount) || 0,
    cutoff: cutoff.toISOString(),
  };
}

module.exports = {
  cleanupExpiredMessageUndoEntries,
  cleanupExpiredPasswordResetOtps,
  refreshUnreadNotificationScores,
  trimOldNotifications,
  __testables: {
    cleanupUndoEntries,
  },
};
