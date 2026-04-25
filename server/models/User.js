const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    handle: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, minlength: 6, select: false },
    authProvider: {
      type: String,
      enum: ["local", "google", "appwrite"],
      default: "local",
    },
    oauthProvider: {
      type: String,
      default: null,
    },
    googleId: {
      type: String,
      sparse: true,
      index: true,
    },
    appwriteId: {
      type: String,
      sparse: true,
      index: true,
    },
    appwriteSignupCompleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    appwriteSignupCompletedAt: { type: Date, default: null },
    bio: { type: String, default: "" },
    location: { type: String, default: "" },
    website: { type: String, default: "" },
    spiritualName: { type: String, default: "" },
    homeMandir: { type: String, default: "" },
    favoriteDeity: { type: String, default: "" },
    spiritualPath: { type: String, default: "" },
    interests: { type: String, default: "" },
    spokenLanguages: { type: String, default: "" },
    seva: { type: String, default: "" },
    yatraWishlist: { type: String, default: "" },
    sankalp: { type: String, default: "" },
    avatar: { type: String, default: null },
    banner: { type: String, default: null },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    followedMandirs: [{ type: String, trim: true, lowercase: true }],
    followedSants: [{ type: String, trim: true, lowercase: true }],
    privateAccount: { type: Boolean, default: false },
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    notificationSettings: {
      festivalReminders: { type: Boolean, default: true },
      chatMessages: { type: Boolean, default: true },
      communityHighlights: { type: Boolean, default: true },
      donationUpdates: { type: Boolean, default: true },
    },
    verified: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    marketing: {
      emailConsent: { type: Boolean, default: false },
      emailConsentAt: { type: Date, default: null },
      emailConsentSource: { type: String, default: null },
      emailUnsubscribedAt: { type: Date, default: null },
      timezone: { type: String, default: "Asia/Kolkata" },
    },
    passwordResetOtpHash: { type: String, select: false, default: null },
    passwordResetOtpExpiresAt: { type: Date, select: false, default: null },
    passwordResetOtpLastSentAt: { type: Date, select: false, default: null },
    passwordResetOtpAttemptCount: {
      type: Number,
      select: false,
      default: 0,
    },
    passwordResetLastAttemptAt: { type: Date, select: false, default: null },
    sessionVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: "" },
    lastAuthAt: { type: Date, default: null },
    lastSeen: { type: Date, default: Date.now },
    accountStatus: {
      type: String,
      enum: ["active", "deleted"],
      default: "active",
      index: true,
    },
    deletedAt: { type: Date, default: null },
    mandirId: { type: String, default: null },
    joined: { type: String, default: "" },
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    referredUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

// Hash password before save
userSchema.pre("save", async function (next) {
  if (!this.password || !this.isModified("password")) return next();
  if (/^\$2[aby]\$\d{2}\$/.test(this.password)) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

// Set join date on creation
userSchema.pre("save", function (next) {
  if (this.isNew && !this.joined) {
    this.joined = new Date().toLocaleDateString("en", {
      month: "short",
      year: "numeric",
    });
  }
  next();
});

userSchema.index({ createdAt: -1 });
userSchema.index({ lastSeen: -1 });
userSchema.index({ followers: 1 });
userSchema.index({ following: 1 });
userSchema.index({ blockedUsers: 1 });
userSchema.index({
  name: "text",
  handle: "text",
  bio: "text",
  location: "text",
  spiritualName: "text",
  homeMandir: "text",
  favoriteDeity: "text",
  spiritualPath: "text",
  interests: "text",
});

// JSON transform: hide password
userSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.password;
    ret.referralsCount = Array.isArray(ret.referredUsers)
      ? ret.referredUsers.length
      : 0;
    delete ret.referredUsers;
    ret.blockedUsers = Array.isArray(ret.blockedUsers)
      ? ret.blockedUsers.map((item) => item?.toString?.() || item)
      : [];
    ret.id = ret._id;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
