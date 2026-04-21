const express = require("express");
const mongoose = require("mongoose");
const AppError = require("../utils/appError");
const {
  createDatabaseBackup,
  getBackupStatus,
} = require("../services/backupService");
const { getMonitoringSnapshot } = require("../services/monitoringService");

const router = express.Router();

function requireAdminKey(envName) {
  return (req, res, next) => {
    const key = process.env[envName];
    const provided =
      req.get("x-admin-key") ||
      req.get("x-backup-key") ||
      req.get("x-monitoring-key") ||
      String(req.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
      req.query.key;

    if (!key || provided !== key) {
      return next(new AppError("Not authorized", 403));
    }

    next();
  };
}

router.get("/monitoring", requireAdminKey("MONITORING_ADMIN_KEY"), (req, res) => {
  res.json({
    status: "ok",
    dbState: mongoose.connection.readyState,
    ...getMonitoringSnapshot(),
  });
});

router.get("/backup/status", requireAdminKey("BACKUP_ADMIN_KEY"), (req, res) => {
  res.json(getBackupStatus());
});

router.post("/backup", requireAdminKey("BACKUP_ADMIN_KEY"), async (req, res, next) => {
  try {
    const result = await createDatabaseBackup("manual");
    res.json({
      success: true,
      backup: result,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
