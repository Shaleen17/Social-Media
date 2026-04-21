const mongoose = require("mongoose");

const mandirCommentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const mandirPostSchema = new mongoose.Schema(
  {
    mandirId: { type: String, required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, default: "" },
    image: { type: String, default: null },
    video: { type: String, default: null },
    mediaType: {
      type: String,
      enum: ["text", "image", "video"],
      default: "text",
    },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    comments: [mandirCommentSchema],
  },
  { timestamps: true }
);

mandirPostSchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    return ret;
  },
});

mandirPostSchema.index({ mandirId: 1, createdAt: -1 });
mandirPostSchema.index({ mandirId: 1, mediaType: 1, createdAt: -1 });
mandirPostSchema.index({ user: 1, createdAt: -1 });
mandirPostSchema.index({ likes: 1 });

module.exports = mongoose.model("MandirPost", mandirPostSchema);
