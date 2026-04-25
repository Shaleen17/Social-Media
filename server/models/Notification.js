const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["like", "comment", "follow", "repost", "mention", "message"],
      required: true,
    },
    post: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },
    convId: { type: String, default: null },
    text: { type: String, default: "" },
    read: { type: Boolean, default: false },
    importance: { type: Number, default: 20 },
    deliveryScore: { type: Number, default: 20 },
    dedupeKey: { type: String, default: null },
    lastEventAt: { type: Date, default: Date.now },
    meta: {
      count: { type: Number, default: 1 },
    },
  },
  { timestamps: true }
);

notificationSchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    return ret;
  },
});

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
notificationSchema.index({ sender: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, read: 1, deliveryScore: -1, lastEventAt: -1 });
notificationSchema.index({ recipient: 1, dedupeKey: 1, read: 1 });

module.exports = mongoose.model("Notification", notificationSchema);
