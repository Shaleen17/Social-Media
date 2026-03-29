const express = require("express");
const Conversation = require("../models/Message");
const Notification = require("../models/Notification");
const { auth } = require("../middleware/auth");
const { sendPushToUsers } = require("../utils/push");

const router = express.Router();

// GET /api/messages — list all conversations for current user
router.get("/", auth, async (req, res) => {
  try {
    const convs = await Conversation.find({
      participants: req.user._id,
    })
      .populate("participants", "name handle avatar")
      .sort({ lastMessageAt: -1 })
      .lean();

    const result = convs.map((c) => {
      const other = c.participants.find(
        (p) => p._id.toString() !== req.user._id.toString()
      );
      const lastMsg = c.messages[c.messages.length - 1];
      return {
        id: c._id,
        uid: other?._id,
        user: other,
        isGroup: c.isGroup,
        groupName: c.groupName,
        groupAvatar: c.groupAvatar,
        lastMessage: lastMsg?.text || "",
        lastMessageTime: lastMsg?.createdAt
          ? timeAgo(lastMsg.createdAt)
          : "",
        unreadCount: c.messages.filter(
          (m) =>
            !m.read && m.sender.toString() !== req.user._id.toString()
        ).length,
        participants: c.participants,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("Get conversations error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/messages/:convId — get messages in a conversation
router.get("/:convId", auth, async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.convId)
      .populate("participants", "name handle avatar")
      .populate("messages.sender", "name handle avatar");

    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    // Mark messages as read
    let changed = false;
    conv.messages.forEach((m) => {
      if (
        !m.read &&
        m.sender._id.toString() !== req.user._id.toString()
      ) {
        m.read = true;
        changed = true;
      }
    });
    if (changed) await conv.save();

    res.json({
      id: conv._id,
      participants: conv.participants,
      isGroup: conv.isGroup,
      groupName: conv.groupName,
      messages: conv.messages.map((m) => ({
        id: m._id,
        from: m.sender._id || m.sender,
        sender: m.sender,
        txt: m.text,
        t: timeAgo(m.createdAt),
        read: m.read,
        isMe: m.sender._id
          ? m.sender._id.toString() === req.user._id.toString()
          : m.sender.toString() === req.user._id.toString(),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/messages/:convId — send message to existing conversation
router.post("/:convId", auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Message text required" });

    const message = {
      sender: req.user._id,
      text,
      read: false,
    };

    // Use findOneAndUpdate with $push and $slice to cap at 50 messages
    const conv = await Conversation.findOneAndUpdate(
      { _id: req.params.convId },
      {
        $push: {
          messages: {
            $each: [message],
            $slice: -50, // Keep only the last 50 messages to save DB space
          },
        },
        $set: {
          lastMessage: text,
          lastMessageAt: new Date(),
        },
      },
      { new: true } // Return updated document
    );

    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const newMsg = conv.messages[conv.messages.length - 1];
    const recipientIds = conv.participants
      .filter((pid) => pid.toString() !== req.user._id.toString())
      .map((pid) => pid.toString());

    if (recipientIds.length) {
      await Notification.insertMany(
        recipientIds.map((recipientId) => ({
          recipient: recipientId,
          sender: req.user._id,
          type: "message",
          text: conv.isGroup
            ? `${req.user.name} sent a message in ${conv.groupName || "your group"}`
            : "sent you a message",
        }))
      );
    }

    // Emit via Socket.io
    const io = req.app.get("io");
    if (io) {
      recipientIds.forEach((pid) => {
        io.to(pid).emit("newMessage", {
          convId: conv._id,
          message: {
            id: newMsg._id,
            from: req.user._id,
            sender: {
              _id: req.user._id,
              name: req.user.name,
              handle: req.user.handle,
              avatar: req.user.avatar,
            },
            txt: text,
            t: "Just now",
            read: false,
            isMe: false,
          },
        });
        io.to(pid).emit("messageNotification", {
          convId: conv._id.toString(),
          from: {
            _id: req.user._id,
            name: req.user.name,
            handle: req.user.handle,
            avatar: req.user.avatar,
          },
          text,
        });
        io.to(pid).emit("notification", {
          type: "message",
          from: req.user._id,
          sender: {
            _id: req.user._id,
            name: req.user.name,
            handle: req.user.handle,
            avatar: req.user.avatar,
          },
          txt: conv.isGroup
            ? `${req.user.name} sent a message in ${conv.groupName || "your group"}`
            : "sent you a message",
          t: "Just now",
          unread: true,
        });
      });
    }

    await sendPushToUsers(recipientIds, {
      title: conv.isGroup ? conv.groupName || "New group message" : req.user.name,
      body: text.length > 120 ? text.slice(0, 117) + "..." : text,
      icon: req.user.avatar || "/Brand_Logo.jpg",
      badge: "/Brand_Logo.jpg",
      tag: `chat-${conv._id}`,
      data: {
        type: "chat-message",
        convId: conv._id.toString(),
        senderId: req.user._id.toString(),
        url: `/?openChat=${encodeURIComponent(conv._id.toString())}`,
      },
    });

    res.json({
      id: newMsg._id,
      from: req.user._id,
      sender: {
        _id: req.user._id,
        name: req.user.name,
        handle: req.user.handle,
        avatar: req.user.avatar,
      },
      txt: text,
      t: "Just now",
      read: false,
      isMe: true,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/messages/new/:userId — start new conversation
router.post("/new/:userId", auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (targetId === req.user._id.toString()) {
      return res.status(400).json({ error: "Cannot message yourself" });
    }

    // Check if conversation already exists
    let conv = await Conversation.findOne({
      participants: { $all: [req.user._id, targetId] },
      isGroup: false,
    });

    if (conv) {
      return res.json({ id: conv._id, existing: true });
    }

    conv = await Conversation.create({
      participants: [req.user._id, targetId],
      messages: [],
      isGroup: false,
    });

    res.status(201).json({ id: conv._id, existing: false });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/messages/group — create group chat
router.post("/group", auth, async (req, res) => {
  try {
    const { name, participants } = req.body;
    if (!name || !participants || participants.length < 1) {
      return res
        .status(400)
        .json({ error: "Group name and participants required" });
    }

    const allParticipants = [
      req.user._id,
      ...participants.filter((p) => p !== req.user._id.toString()),
    ];

    const conv = await Conversation.create({
      participants: allParticipants,
      isGroup: true,
      groupName: name,
      messages: [],
    });

    res.status(201).json({ id: conv._id });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

function timeAgo(date) {
  if (!date) return "";
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return new Date(date).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  });
}

module.exports = router;
