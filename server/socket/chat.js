// Socket.io real-time chat and notification handler
module.exports = function setupSocket(io) {
  // Track online users: userId -> Set of socketIds (supports multiple devices)
  const onlineUsers = new Map();

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
        return true; // truly offline now
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
    console.log("🔌 Socket connected:", socket.id);

    // User joins — register their userId
    socket.on("join", (userId) => {
      if (userId) {
        socket.userId = userId;
        addOnlineUser(userId, socket.id);
        socket.join(userId); // Join a room named after userId
        // Broadcast online status to everyone
        io.emit("userOnline", { userId, online: true });
        // Send the full online users list to this socket
        socket.emit("onlineUsers", getOnlineUserIds());
        console.log(
          `👤 User ${userId} is online (${onlineUsers.get(userId).size} device(s))`
        );
      }
    });

    // Request online users list
    socket.on("getOnlineUsers", () => {
      socket.emit("onlineUsers", getOnlineUserIds());
    });

    // Join a chat conversation room
    socket.on("joinConversation", (convId) => {
      if (convId) {
        socket.join("conv_" + convId);
        console.log(
          `💬 ${socket.userId || "?"} joined conv_${convId}`
        );
      }
    });

    // Leave conversation room
    socket.on("leaveConversation", (convId) => {
      if (convId) {
        socket.leave("conv_" + convId);
      }
    });

    // Send chat message (real-time relay)
    socket.on("chatMessage", (data) => {
      // data: { convId, message, recipients[] }
      if (data.convId && data.message) {
        // Broadcast to conversation room (excluding sender)
        socket.to("conv_" + data.convId).emit("newMessage", {
          convId: data.convId,
          message: data.message,
        });

        // Also notify recipients who aren't in the conversation room
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
      }
    });

    // Typing indicator
    socket.on("typing", (data) => {
      // data: { convId, userId, userName }
      if (data.convId) {
        socket.to("conv_" + data.convId).emit("userTyping", {
          convId: data.convId,
          userId: data.userId,
          userName: data.userName,
        });
      }
    });

    // Stop typing
    socket.on("stopTyping", (data) => {
      if (data.convId) {
        socket.to("conv_" + data.convId).emit("userStopTyping", {
          convId: data.convId,
          userId: data.userId,
        });
      }
    });

    // Message read receipt
    socket.on("messageRead", (data) => {
      // data: { convId, userId }
      if (data.convId) {
        socket.to("conv_" + data.convId).emit("messagesRead", {
          convId: data.convId,
          userId: data.userId,
        });
      }
    });

    // Disconnect
    socket.on("disconnect", () => {
      const userId = socket.userId;
      if (userId) {
        const fullyOffline = removeOnlineUser(userId, socket.id);
        if (fullyOffline) {
          io.emit("userOnline", { userId, online: false });
          console.log(`👤 User ${userId} went offline`);
        } else {
          console.log(
            `👤 User ${userId} disconnected one device (still online on ${onlineUsers.get(userId)?.size || 0} device(s))`
          );
        }
      }
    });
  });

  return { onlineUsers, isOnline, getOnlineUserIds };
};
