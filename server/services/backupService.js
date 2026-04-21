const fs = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const User = require("../models/User");
const Post = require("../models/Post");
const Video = require("../models/Video");
const Conversation = require("../models/Message");
const Notification = require("../models/Notification");
const Story = require("../models/Story");
const MandirPost = require("../models/MandirPost");
const PushSubscription = require("../models/PushSubscription");
const Donation = require("../models/Donation");
const EmailCampaignSubscription = require("../models/EmailCampaignSubscription");
const EmailCampaignDelivery = require("../models/EmailCampaignDelivery");
const { log } = require("../utils/logger");

const BACKUP_DIR = process.env.DB_BACKUP_DIR || path.join(__dirname, "..", "backups");
const BACKUP_RETENTION = Number(process.env.DB_BACKUP_RETENTION || 10);

const COLLECTIONS = [
  ["users", User],
  ["posts", Post],
  ["videos", Video],
  ["conversations", Conversation],
  ["notifications", Notification],
  ["stories", Story],
  ["mandirPosts", MandirPost],
  ["pushSubscriptions", PushSubscription],
  ["donations", Donation],
  ["emailCampaignSubscriptions", EmailCampaignSubscription],
  ["emailCampaignDeliveries", EmailCampaignDelivery],
];

let lastBackup = null;
let backupInProgress = false;

async function getCollectionData(model, name) {
  const query = model.find({}).lean();
  if (name === "users") {
    query.select("-password -passwordResetOtpHash -passwordResetOtpExpiresAt -passwordResetOtpLastSentAt -passwordResetOtpAttemptCount -passwordResetLastAttemptAt");
  }
  return query.exec();
}

async function pruneOldBackups() {
  if (!BACKUP_RETENTION || BACKUP_RETENTION < 1) return;
  const files = (await fs.readdir(BACKUP_DIR).catch(() => []))
    .filter((file) => /^backup-.*\.json\.gz$/.test(file))
    .sort()
    .reverse();

  await Promise.all(
    files.slice(BACKUP_RETENTION).map((file) => fs.unlink(path.join(BACKUP_DIR, file)).catch(() => {}))
  );
}

async function createDatabaseBackup(reason = "manual") {
  if (backupInProgress) {
    return {
      inProgress: true,
      lastBackup,
    };
  }

  backupInProgress = true;
  const startedAt = new Date();

  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });

    const collections = {};
    for (const [name, model] of COLLECTIONS) {
      collections[name] = await getCollectionData(model, name);
    }

    const payload = {
      app: "tirth-sutra",
      reason,
      createdAt: startedAt.toISOString(),
      collections,
    };

    const fileName = `backup-${startedAt.toISOString().replace(/[:.]/g, "-")}.json.gz`;
    const filePath = path.join(BACKUP_DIR, fileName);
    const buffer = zlib.gzipSync(Buffer.from(JSON.stringify(payload)));
    await fs.writeFile(filePath, buffer);
    await pruneOldBackups();

    lastBackup = {
      fileName,
      filePath,
      createdAt: startedAt.toISOString(),
      size: buffer.length,
      collectionCounts: Object.fromEntries(
        Object.entries(collections).map(([name, rows]) => [name, rows.length])
      ),
    };

    log("info", "Database backup completed", {
      fileName,
      size: buffer.length,
      reason,
    });

    return lastBackup;
  } finally {
    backupInProgress = false;
  }
}

function getBackupStatus() {
  return {
    backupInProgress,
    lastBackup,
    backupDir: BACKUP_DIR,
    retention: BACKUP_RETENTION,
  };
}

function scheduleDatabaseBackups() {
  const enabled = String(process.env.DB_BACKUP_ENABLED || "false").toLowerCase() === "true";
  const intervalHours = Number(process.env.DB_BACKUP_INTERVAL_HOURS || 24);

  if (!enabled || process.env.VERCEL || !intervalHours || intervalHours <= 0) {
    return;
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;
  setInterval(() => {
    createDatabaseBackup("scheduled").catch((error) => {
      log("error", "Scheduled database backup failed", { error: error.message });
    });
  }, intervalMs);
}

module.exports = {
  createDatabaseBackup,
  getBackupStatus,
  scheduleDatabaseBackups,
};
