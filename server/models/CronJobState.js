const mongoose = require("mongoose");

const cronJobStateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    running: { type: Boolean, default: false },
    lockToken: { type: String, default: null },
    lockedAt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null, index: true },
    lastStatus: {
      type: String,
      enum: ["idle", "running", "success", "error", "skipped"],
      default: "idle",
    },
    lastTrigger: { type: String, default: "" },
    lastStartedAt: { type: Date, default: null },
    lastFinishedAt: { type: Date, default: null },
    lastDurationMs: { type: Number, default: 0 },
    lastSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastError: { type: String, default: "" },
    runCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

cronJobStateSchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    return ret;
  },
});

module.exports = mongoose.model("CronJobState", cronJobStateSchema);
