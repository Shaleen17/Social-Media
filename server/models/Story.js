const mongoose = require("mongoose");

const storySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["image", "video"], default: "image" },
    src: { type: String, required: true },
    caption: { type: String, default: "" },
    emoji: { type: String, default: "" },
    viewers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 },
    },
  },
  { timestamps: true }
);

storySchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    return ret;
  },
});

module.exports = mongoose.model("Story", storySchema);
