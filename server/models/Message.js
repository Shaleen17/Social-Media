const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["image", "video", "audio", "document"],
      required: true,
    },
    url: { type: String, required: true },
    name: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    duration: { type: Number, default: null },
  },
  { _id: false }
);

const replyToSchema = new mongoose.Schema(
  {
    messageId: { type: mongoose.Schema.Types.ObjectId, required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    senderName: { type: String, default: "" },
    text: { type: String, default: "" },
    attachmentKind: { type: String, default: "" },
    attachmentName: { type: String, default: "" },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, default: "" },
  attachments: { type: [attachmentSchema], default: [] },
  replyTo: { type: replyToSchema, default: null },
  forwarded: { type: Boolean, default: false },
  deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  deletedForEveryone: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const conversationSchema = new mongoose.Schema(
  {
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    messages: [messageSchema],
    isGroup: { type: Boolean, default: false },
    groupName: { type: String, default: null },
    groupAvatar: { type: String, default: null },
    lastMessage: { type: String, default: "" },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

conversationSchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    return ret;
  },
});

conversationSchema.index({ participants: 1, lastMessageAt: -1 });
conversationSchema.index({ lastMessageAt: -1 });
conversationSchema.index({ "messages.sender": 1 });

module.exports = mongoose.model("Conversation", conversationSchema);
