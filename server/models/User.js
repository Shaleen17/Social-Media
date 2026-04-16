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
      enum: ["local", "google"],
      default: "local",
    },
    googleId: {
      type: String,
      sparse: true,
      index: true,
    },
    bio: { type: String, default: "" },
    location: { type: String, default: "" },
    website: { type: String, default: "" },
    avatar: { type: String, default: null },
    banner: { type: String, default: null },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    followedMandirs: [{ type: String, trim: true, lowercase: true }],
    followedSants: [{ type: String, trim: true, lowercase: true }],
    verified: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    mandirId: { type: String, default: null },
    joined: { type: String, default: "" },
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

// JSON transform: hide password
userSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.password;
    ret.id = ret._id;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
