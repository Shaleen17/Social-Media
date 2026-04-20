const mongoose = require("mongoose");

const emailCampaignSubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
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
    status: {
      type: String,
      enum: ["active", "paused", "completed", "unsubscribed", "bounced"],
      default: "active",
      index: true,
    },
    timezone: { type: String, default: "Asia/Kolkata", trim: true },
    consent: {
      given: { type: Boolean, default: false },
      givenAt: { type: Date, default: null },
      source: { type: String, default: "signup", trim: true },
      ip: { type: String, default: null },
      userAgent: { type: String, default: null },
    },
    startedAt: { type: Date, default: Date.now },
    endsAt: { type: Date, default: null },
    unsubscribedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    unsubscribeToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    preferencesToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    emailsScheduledCount: { type: Number, default: 0 },
    emailsSentCount: { type: Number, default: 0 },
    openCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    bounceCount: { type: Number, default: 0 },
    lastEmailSentAt: { type: Date, default: null },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

emailCampaignSubscriptionSchema.index({ campaignKey: 1, status: 1 });
emailCampaignSubscriptionSchema.index({ status: 1, startedAt: 1 });

emailCampaignSubscriptionSchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret.unsubscribeToken;
    delete ret.preferencesToken;
    return ret;
  },
});

module.exports = mongoose.model(
  "EmailCampaignSubscription",
  emailCampaignSubscriptionSchema
);
