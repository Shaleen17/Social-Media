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
    password: { type: String, required: true, minlength: 6 },
    bio: { type: String, default: "" },
    location: { type: String, default: "" },
    website: { type: String, default: "" },
    avatar: { type: String, default: null },
    banner: { type: String, default: null },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    verified: { type: Boolean, default: false },
    mandirId: { type: String, default: null },
    joined: { type: String, default: "" },
  },
  { timestamps: true }
);

// Hash password before save
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidate) {
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
