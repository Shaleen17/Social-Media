const mongoose = require("mongoose");

const pendingSignupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    handle: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true },
    otpHash: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },
    otpLastSentAt: { type: Date, default: null },
    otpSendCount: { type: Number, default: 0 },
    otpAttemptCount: { type: Number, default: 0 },
    lastOtpAttemptAt: { type: Date, default: null },
    createdFromIp: { type: String, default: null },
    lastRequestIp: { type: String, default: null },
    userAgent: { type: String, default: null },
    marketingEmailConsent: { type: Boolean, default: false },
    marketingConsentAt: { type: Date, default: null },
    marketingConsentSource: { type: String, default: null },
    marketingTimezone: { type: String, default: "Asia/Kolkata", trim: true },
    referralCodeUsed: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    pendingExpiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

pendingSignupSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    delete ret.otpHash;
    ret.id = ret._id;
    return ret;
  },
});

module.exports = mongoose.model("PendingSignup", pendingSignupSchema);
