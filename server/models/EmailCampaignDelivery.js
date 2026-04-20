const mongoose = require("mongoose");

const emailCampaignDeliverySchema = new mongoose.Schema(
  {
    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmailCampaignSubscription",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, default: "", trim: true },
    campaignKey: {
      type: String,
      required: true,
      default: "tirth-sutra-journey-v1",
      index: true,
    },
    contentKey: { type: String, required: true },
    contentIndex: { type: Number, required: true },
    weekNumber: { type: Number, required: true },
    weekTitle: { type: String, default: "" },
    sequenceInWeek: { type: Number, required: true },
    journeyStage: {
      type: String,
      enum: ["Inspiration", "Knowledge", "Action"],
      required: true,
    },
    category: { type: String, default: "spiritual-journey", index: true },
    subject: { type: String, required: true },
    previewText: { type: String, default: "" },
    paragraphs: [{ type: String }],
    bullets: [{ type: String }],
    ctaLabel: { type: String, default: "Explore Tirth Sutra" },
    ctaUrl: { type: String, default: "" },
    scheduledFor: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ["scheduled", "sending", "sent", "failed", "skipped", "cancelled"],
      default: "scheduled",
      index: true,
    },
    trackingToken: { type: String, required: true, index: true },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    openedAt: { type: Date, default: null },
    clickedAt: { type: Date, default: null },
    openCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    messageId: { type: String, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

emailCampaignDeliverySchema.index(
  { subscription: 1, contentKey: 1 },
  { unique: true }
);
emailCampaignDeliverySchema.index({ status: 1, scheduledFor: 1 });
emailCampaignDeliverySchema.index({ campaignKey: 1, weekNumber: 1 });

emailCampaignDeliverySchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret.trackingToken;
    return ret;
  },
});

module.exports = mongoose.model(
  "EmailCampaignDelivery",
  emailCampaignDeliverySchema
);
