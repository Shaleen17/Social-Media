const {
  refreshDiscoverySnapshots,
} = require("../../services/discoverySnapshotService");

module.exports = {
  name: "refresh-discovery-snapshots",
  description:
    "Precompute ranked discovery snapshots for trending posts and the Tirth Tube video feed.",
  scheduleHint: "*/5 * * * *",
  enabledEnvVar: "CRON_DISCOVERY_SNAPSHOTS_ENABLED",
  lockTtlMs: 5 * 60 * 1000,
  retryCount: 1,
  async run() {
    return refreshDiscoverySnapshots();
  },
};
