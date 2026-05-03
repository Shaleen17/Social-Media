const {
  processDueEmailCampaignDeliveries,
} = require("../../services/emailCampaignService");

module.exports = {
  name: "process-email-campaign-queue",
  description:
    "Send due marketing email deliveries in small batches with retry-safe handoff.",
  scheduleHint: "*/5 * * * *",
  enabledEnvVar: "CRON_EMAIL_CAMPAIGN_QUEUE_ENABLED",
  lockTtlMs: 10 * 60 * 1000,
  retryCount: 0,
  async run() {
    return processDueEmailCampaignDeliveries();
  },
};
