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
  },
  { timestamps: true }
);

postSchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    return ret;
  },
});

module.exports = mongoose.model("Post", postSchema);
