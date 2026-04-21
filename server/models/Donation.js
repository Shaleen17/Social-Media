const mongoose = require("mongoose");

const donationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    purpose: {
      type: String,
      default: "Mandir Community",
      trim: true,
    },
    campaignKey: {
      type: String,
      default: "annadanam-seva",
      trim: true,
      lowercase: true,
      index: true,
    },
    donorName: {
      type: String,
      default: "",
      trim: true,
    },
    donorEmail: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
      index: true,
    },
    donorContact: {
      type: String,
      default: "",
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    currency: {
      type: String,
      default: "INR",
      uppercase: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["created", "authorized", "captured", "failed"],
      default: "created",
      index: true,
    },
    orderId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    orderStatus: {
      type: String,
      default: "created",
      trim: true,
    },
    paymentId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    paymentStatus: {
      type: String,
      default: "",
      trim: true,
    },
    paymentMethod: {
      type: String,
      default: "",
      trim: true,
    },
    razorpaySignature: {
      type: String,
      default: "",
      trim: true,
    },
    razorpayReceipt: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    receiptNumber: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    receiptIssuedAt: {
      type: Date,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
      index: true,
    },
    verificationSource: {
      type: String,
      enum: ["checkout", "webhook", "manual"],
      default: "checkout",
    },
    notes: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

donationSchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    return ret;
  },
});

donationSchema.index({ status: 1, paidAt: -1 });
donationSchema.index({ user: 1, createdAt: -1 });
donationSchema.index({ campaignKey: 1, status: 1, paidAt: -1 });

module.exports = mongoose.model("Donation", donationSchema);
