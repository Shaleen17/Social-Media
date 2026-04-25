const mongoose = require("mongoose");

const analyticsEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["page_view", "interaction", "error", "performance", "consent"],
      required: true,
    },
    name: { type: String, required: true, trim: true },
    page: { type: String, default: "", trim: true },
    path: { type: String, default: "", trim: true },
    sessionId: { type: String, default: "", trim: true, index: true },
    anonymousId: { type: String, default: "", trim: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 120 },
  },
  { versionKey: false }
);

analyticsEventSchema.index({ type: 1, createdAt: -1 });
analyticsEventSchema.index({ page: 1, createdAt: -1 });
analyticsEventSchema.index({ name: 1, createdAt: -1 });

module.exports = mongoose.model("AnalyticsEvent", analyticsEventSchema);
