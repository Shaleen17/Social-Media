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

const reactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { _id: false }
);

const deleteUndoEntrySchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    scope: {
      type: String,
      enum: ["me", "everyone"],
      required: true,
    },
    expiresAt: { type: Date, required: true },
    text: { type: String, default: "" },
    attachments: { type: [attachmentSchema], default: [] },
    replyTo: { type: replyToSchema, default: null },
    forwarded: { type: Boolean, default: false },
    reactions: { type: [reactionSchema], default: [] },
    editedAt: { type: Date, default: null },
    wasPinned: { type: Boolean, default: false },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  clientId: { type: String, default: "" },
  seq: { type: Number, default: 0 },
  text: { type: String, default: "" },
  attachments: { type: [attachmentSchema], default: [] },
  replyTo: { type: replyToSchema, default: null },
  forwarded: { type: Boolean, default: false },
  reactions: { type: [reactionSchema], default: [] },
  starredBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  editedAt: { type: Date, default: null },
  moderationStatus: {
    type: String,
    enum: ["approved", "needs_review"],
    default: "approved",
  },
  moderationFlags: { type: [String], default: [] },
  deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  deletedForEveryone: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  deleteUndoEntries: { type: [deleteUndoEntrySchema], default: [] },
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
    messageSequence: { type: Number, default: 0 },
    pinnedMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    pinnedAt: { type: Date, default: null },
    pinnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
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
conversationSchema.index({ participants: 1, "messages.clientId": 1 });

module.exports = mongoose.model("Conversation", conversationSchema);
