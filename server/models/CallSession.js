const mongoose = require("mongoose");

const callSessionSchema = new mongoose.Schema(
  {
    callId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    roomName: {
      type: String,
      required: true,
      trim: true,
    },
    roomUrl: {
      type: String,
      required: true,
      trim: true,
    },
    callerId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    targetId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    withVideo: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["ringing", "accepted", "ended"],
      default: "ringing",
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  {
    versionKey: false,
  }
);

callSessionSchema.index({ callerId: 1, status: 1 });
callSessionSchema.index({ targetId: 1, status: 1 });

module.exports =
  mongoose.models.CallSession ||
  mongoose.model("CallSession", callSessionSchema);
