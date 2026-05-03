const {
  reconcilePendingDonations,
} = require("../../services/paymentService");

module.exports = {
  name: "reconcile-donations",
  description:
    "Refresh recent Razorpay donation orders so captured payments show up even if a client verification flow was missed.",
  scheduleHint: "*/10 * * * *",
  enabledEnvVar: "CRON_DONATION_RECONCILIATION_ENABLED",
  lockTtlMs: 10 * 60 * 1000,
  retryCount: 1,
  async run() {
    return reconcilePendingDonations();
  },
};
