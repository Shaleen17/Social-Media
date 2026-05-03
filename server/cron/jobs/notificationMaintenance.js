const {
  refreshUnreadNotificationScores,
  trimOldNotifications,
} = require("../../services/maintenanceService");

module.exports = {
  name: "notification-maintenance",
  description:
    "Refresh unread notification ranking and prune old read notification history.",
  scheduleHint: "*/15 * * * *",
  enabledEnvVar: "CRON_NOTIFICATION_MAINTENANCE_ENABLED",
  lockTtlMs: 10 * 60 * 1000,
  retryCount: 0,
  async run() {
    const [scores, trimmed] = await Promise.all([
      refreshUnreadNotificationScores(),
      trimOldNotifications(),
    ]);

    return {
      ...scores,
      trimmed,
    };
  },
};
