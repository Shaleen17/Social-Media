// Socket.io real-time chat and notification handler
const Conversation = require("../models/Message");
const User = require("../models/User");

module.exports = function setupSocket(io) {
  // Track online users: userId -> Set of socketIds (supports multiple devices)
  const onlineUsers = new Map();

  function hasId(list = [], userId) {
    const uid = userId ? userId.toString() : "";
    return list.some((item) => item && item.toString() === uid);
  }

  async function rememberLastSeen(userId, seenAt = new Date()) {
    if (!userId) return;
    try {
      await User.findByIdAndUpdate(userId, { lastSeen: seenAt });
    } catch (err) {
      console.warn("Socket lastSeen update failed:", err.message);
    }
  }

  async function markMessageDelivered(convId, messageId, userId) {
    if (!convId || !messageId || !userId) return null;

    const conv = await Conversation.findOne({
      _id: convId,
      participants: userId,
      "messages._id": messageId,
    });
    if (!conv) return null;

    const msg = conv.messages.id(messageId);
    if (
      !msg ||
      msg.deletedForEveryone ||
      msg.sender.toString() === userId.toString() ||
      hasId(msg.deletedFor, userId)
    ) {
      return null;
    }

    if (!hasId(msg.deliveredTo, userId)) {
      msg.deliveredTo.push(userId);
      await conv.save();
    }

    return {
      convId: conv._id.toString(),
      messageId: msg._id.toString(),
      userId: userId.toString(),
      senderId: msg.sender.toString(),
    };
  }

  async function markConversationRead(convId, userId) {
    if (!convId || !userId) return null;

    const conv = await Conversation.findOne({
      _id: convId,
      participants: userId,
    });
    if (!conv) return null;

    const changedMessageIds = [];
    const senderIds = new Set();

    conv.messages.forEach((msg) => {
      if (
        msg.sender.toString() !== userId.toString() &&
        !msg.deletedForEveryone &&
        !hasId(msg.deletedFor, userId)
      ) {
        let changed = false;

        if (!hasId(msg.deliveredTo, userId)) {
          msg.deliveredTo.push(userId);
          changed = true;
        }
        if (!hasId(msg.readBy, userId)) {
          msg.readBy.push(userId);
          changed = true;
        }
        if (!msg.read) {
          msg.read = true;
          changed = true;
        }

        if (changed) {
          changedMessageIds.push(msg._id.toString());
          senderIds.add(msg.sender.toString());
        }
      }
    });

    if (!changedMessageIds.length) return null;

    await conv.save();

    return {
      convId: conv._id.toString(),
      userId: userId.toString(),
      messageIds: changedMessageIds,
      senderIds: Array.from(senderIds),
    };
  }

  function addOnlineUser(userId, socketId) {
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socketId);
  }

  function removeOnlineUser(userId, socketId) {
    if (onlineUsers.has(userId)) {
      onlineUsers.get(userId).delete(socketId);
      if (onlineUsers.get(userId).size === 0) {
        onlineUsers.delete(userId);
        return true;
      }
    }
    return false;
  }

  function isOnline(userId) {
    return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
  }

  function getOnlineUserIds() {
    return Array.from(onlineUsers.keys());
  }

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.on("join", (userId) => {
      if (!userId) return;

      socket.userId = userId;
      addOnlineUser(userId, socket.id);
      socket.join(userId);
      rememberLastSeen(userId).catch(() => {});

      io.emit("userOnline", { userId, online: true });
      socket.emit("onlineUsers", getOnlineUserIds());
      console.log(
        `User ${userId} is online (${onlineUsers.get(userId).size} device(s))`
      );
    });

    socket.on("getOnlineUsers", () => {
      socket.emit("onlineUsers", getOnlineUserIds());
    });

    socket.on("joinConversation", (convId) => {
      if (!convId) return;
      socket.join("conv_" + convId);
      console.log(`Chat join: ${socket.userId || "?"} -> conv_${convId}`);
    });

    socket.on("leaveConversation", (convId) => {
      if (convId) socket.leave("conv_" + convId);
    });

    socket.on("chatMessage", (data) => {
      if (!data?.convId || !data?.message) return;

      socket.to("conv_" + data.convId).emit("newMessage", {
        convId: data.convId,
        message: data.message,
      });

      if (data.recipients) {
        data.recipients.forEach((uid) => {
          if (uid !== socket.userId) {
            socket.to(uid).emit("newMessage", {
              convId: data.convId,
              message: data.message,
            });
            socket.to(uid).emit("messageNotification", {
              convId: data.convId,
              from: data.message.sender,
              text: data.message.txt,
            });
          }
        });
      }
    });

    socket.on("typing", (data) => {
      if (!data?.convId) return;
      socket.to("conv_" + data.convId).emit("userTyping", {
        convId: data.convId,
        userId: data.userId,
        userName: data.userName,
      });
    });

    socket.on("stopTyping", (data) => {
      if (!data?.convId) return;
      socket.to("conv_" + data.convId).emit("userStopTyping", {
        convId: data.convId,
        userId: data.userId,
      });
    });

    socket.on("messageRead", (data) => {
      if (!data?.convId || !socket.userId) return;

      markConversationRead(data.convId, socket.userId)
        .then((result) => {
          if (!result) return;

          result.senderIds.forEach((senderId) => {
            io.to(senderId).emit("messagesRead", {
              convId: result.convId,
              userId: result.userId,
              messageIds: result.messageIds,
            });
          });

          socket.to("conv_" + data.convId).emit("messagesRead", {
            convId: result.convId,
            userId: result.userId,
            messageIds: result.messageIds,
          });
        })
        .catch((err) => {
          console.warn("Socket read receipt failed:", err.message);
        });
    });

    socket.on("messageDelivered", (data) => {
      if (!data?.convId || !data?.messageId || !socket.userId) return;

      markMessageDelivered(data.convId, data.messageId, socket.userId)
        .then((result) => {
          if (!result) return;

          io.to(result.senderId).emit("messageDelivered", {
            convId: result.convId,
            messageId: result.messageId,
            userId: result.userId,
          });
        })
        .catch((err) => {
          console.warn("Socket delivered receipt failed:", err.message);
        });
    });

    // WebRTC signaling
    socket.on("callUser", (data, ack) => {
      if (!data?.userToCall || !data?.from || !data?.signalData) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "Invalid call payload" });
        }
        return;
      }

      console.log(
        `callUser: ${data.from} -> ${data.userToCall} (online: ${isOnline(data.userToCall)})`
      );

      if (!isOnline(data.userToCall)) {
        socket.emit("callRejected", { reason: "User is offline" });
        if (typeof ack === "function") {
          ack({ ok: false, error: "User is offline" });
        }
        return;
      }

      io.to(data.userToCall).emit("callUser", {
        signal: data.signalData,
        from: data.from,
        name: data.name,
        isVideo: data.isVideo,
      });

      socket.emit("callRinging", { to: data.userToCall });
      if (typeof ack === "function") {
        ack({ ok: true, ringing: true, to: data.userToCall });
      }
    });

    socket.on("answerCall", (data, ack) => {
      if (!data?.to || !data?.signal) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "Invalid answer payload" });
        }
        return;
      }

      io.to(data.to).emit("callAccepted", data.signal);
      if (typeof ack === "function") {
        ack({ ok: true });
      }
    });

    socket.on("iceCandidate", (data, ack) => {
      if (!data?.to || !data?.candidate) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "Invalid ICE payload" });
        }
        return;
      }

      io.to(data.to).emit("iceCandidate", data.candidate);
      if (typeof ack === "function") {
        ack({ ok: true });
      }
    });

    socket.on("rejectCall", (data, ack) => {
      if (!data?.to) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "Invalid reject payload" });
        }
        return;
      }

      io.to(data.to).emit("callRejected");
      if (typeof ack === "function") {
        ack({ ok: true });
      }
    });

    socket.on("endCall", (data, ack) => {
      if (data.to) {
        io.to(data.to).emit("callEnded");
      }
      if (typeof ack === "function") {
        ack({ ok: true });
      }
    });

    socket.on("disconnect", () => {
      const userId = socket.userId;
      if (!userId) return;

      const fullyOffline = removeOnlineUser(userId, socket.id);
      if (fullyOffline) {
        const lastSeen = new Date();
        rememberLastSeen(userId, lastSeen).catch(() => {});
        io.emit("userOnline", {
          userId,
          online: false,
          lastSeen: lastSeen.toISOString(),
        });
        console.log(`User ${userId} went offline`);
      } else {
        console.log(
          `User ${userId} disconnected one device (still online on ${onlineUsers.get(userId)?.size || 0} device(s))`
        );
      }
    });
  });

  return { onlineUsers, isOnline, getOnlineUserIds };
};
