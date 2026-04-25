const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const pollSchema = new mongoose.Schema({
  options: [{ type: String }],
  votes: [{ type: String }], // format: "userId:optionIndex"
});

const postSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, default: "" },
    image: { type: String, default: null },
    ytId: { type: String, default: null },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    comments: [commentSchema],
    reposts: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    poll: { type: pollSchema, default: null },
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
  },
  { timestamps: true }
);

postSchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    return ret;
  },
});

postSchema.index({ createdAt: -1 });
postSchema.index({ user: 1, createdAt: -1 });
postSchema.index({ likes: 1 });
postSchema.index({ bookmarks: 1, createdAt: -1 });
postSchema.index({ "comments.user": 1 });
postSchema.index({ hashtags: 1, createdAt: -1 });
postSchema.index({ searchText: "text" });

module.exports = mongoose.model("Post", postSchema);
