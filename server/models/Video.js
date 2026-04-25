const mongoose = require("mongoose");

const videoReplySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const videoCommentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true },
  replies: [videoReplySchema],
  createdAt: { type: Date, default: Date.now },
});

const videoSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    category: {
      type: String,
      enum: [
        "Spiritual",
        "Pilgrimage",
        "Discourse",
        "Bhajan",
        "Aarti",
        "Meditation",
        "Katha",
        "Other",
      ],
      default: "Spiritual",
    },
    src: { type: String, required: true },
    thumbnail: { type: String, default: null },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    comments: [videoCommentSchema],
    pinnedComment: { type: mongoose.Schema.Types.ObjectId, default: null },
    views: { type: Number, default: 0 },
    duration: { type: String, default: "0:00" },
    isLive: { type: Boolean, default: false },
    liveViewers: { type: Number, default: 0 },
    liveStarted: { type: String, default: null },
    hashtags: [{ type: String, lowercase: true, trim: true }],
    searchText: { type: String, default: "" },
    moderation: {
      status: {
        type: String,
        enum: ["approved", "needs_review"],
        default: "approved",
      },
      flags: [{ type: String }],
      score: { type: Number, default: 0 },
      reviewedAt: { type: Date, default: Date.now },
    },
    processing: {
      status: {
        type: String,
        enum: ["ready", "processing", "needs_review"],
        default: "ready",
      },
      profile: { type: String, default: "standard" },
      optimizedAt: { type: Date, default: Date.now },
    },
  },
  { timestamps: true }
);

videoSchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    return ret;
  },
});

videoSchema.index({ createdAt: -1 });
videoSchema.index({ user: 1, createdAt: -1 });
videoSchema.index({ category: 1, createdAt: -1 });
videoSchema.index({ isLive: 1, createdAt: -1 });
videoSchema.index({ likes: 1 });
videoSchema.index({ "comments.user": 1 });
videoSchema.index({ hashtags: 1, createdAt: -1 });
videoSchema.index({ searchText: "text" });

module.exports = mongoose.model("Video", videoSchema);
