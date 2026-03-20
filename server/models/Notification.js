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
    text: { type: String, default: "" },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    return ret;
  },
});

module.exports = mongoose.model("Notification", notificationSchema);
