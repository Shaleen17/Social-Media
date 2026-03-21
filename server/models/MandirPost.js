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

module.exports = mongoose.model("MandirPost", mandirPostSchema);
