const {
  cleanupExpiredMessageUndoEntries,
  cleanupExpiredPasswordResetOtps,
} = require("../../services/maintenanceService");

module.exports = {
  name: "cleanup-auth-and-messages",
  description:
    "Clear expired password reset OTP artifacts and remove stale chat delete-undo payloads.",
  scheduleHint: "0 * * * *",
  enabledEnvVar: "CRON_AUTH_AND_MESSAGE_CLEANUP_ENABLED",
  lockTtlMs: 10 * 60 * 1000,
  retryCount: 0,
  async run() {
    const [passwordResets, messageUndo] = await Promise.all([
      cleanupExpiredPasswordResetOtps(),
      cleanupExpiredMessageUndoEntries(),
    ]);

    return {
      passwordResets,
      messageUndo,
    };
  },
};
