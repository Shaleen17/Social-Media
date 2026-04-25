// Socket.io real-time chat and notification handler
const Conversation = require("../models/Message");
const User = require("../models/User");
const { log } = require("../utils/logger");

const PRESENCE_TTL_SECONDS = Math.max(
  30,
  Number(process.env.REDIS_PRESENCE_TTL_SECONDS || 90)
);
const PRESENCE_HEARTBEAT_MS = Math.max(
  15000,
  Number(process.env.REDIS_PRESENCE_HEARTBEAT_MS) ||
    Math.floor((PRESENCE_TTL_SECONDS * 1000) / 3)
);

module.exports = function setupSocket(io) {
  // Track online users locally: userId -> Set of socketIds (supports multiple devices)
  const onlineUsers = new Map();
  const presenceHeartbeats = new Map();
  let redisPresence = null;

  function attachRedisPresence(store) {
    redisPresence = store || null;
  }

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

  function addOnlineUserLocal(userId, socketId) {
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socketId);
    return onlineUsers.get(userId).size;
  }

  function removeOnlineUserLocal(userId, socketId) {
    if (!onlineUsers.has(userId)) {
      return {
        fullyOffline: true,
        deviceCount: 0,
      };
    }

    const socketIds = onlineUsers.get(userId);
    socketIds.delete(socketId);
    const deviceCount = socketIds.size;
    if (deviceCount === 0) {
      onlineUsers.delete(userId);
      return {
        fullyOffline: true,
        deviceCount: 0,
      };
    }

    return {
      fullyOffline: false,
      deviceCount,
    };
  }

  function getLocalOnlineUserIds() {
    return Array.from(onlineUsers.keys());
  }

  function getLocalDeviceCount(userId) {
    return onlineUsers.get(userId)?.size || 0;
  }

  async function addOnlineUser(userId, socketId) {
    const uid = userId ? userId.toString() : "";
    const sid = socketId ? socketId.toString() : "";
    if (!uid || !sid) {
      return {
        becameOnline: false,
        deviceCount: 0,
      };
    }

    const wasOnline = await isOnline(uid);
    const deviceCount = addOnlineUserLocal(uid, sid);

    if (redisPresence) {
      try {
        await redisPresence.addSocket(uid, sid);
      } catch (err) {
        log("warn", "Redis presence add failed", {
          userId: uid,
          socketId: sid,
          error: err.message,
        });
      }
    }

    return {
      becameOnline: !wasOnline,
      deviceCount,
    };
  }

  async function touchOnlineUser(userId, socketId) {
    const uid = userId ? userId.toString() : "";
    const sid = socketId ? socketId.toString() : "";
    if (!uid || !sid || !redisPresence) return;

    try {
      await redisPresence.touchSocket(uid, sid);
    } catch (err) {
      log("warn", "Redis presence heartbeat failed", {
        userId: uid,
        socketId: sid,
        error: err.message,
      });
    }
  }

  async function removeOnlineUser(userId, socketId) {
    const uid = userId ? userId.toString() : "";
    const sid = socketId ? socketId.toString() : "";
    if (!uid || !sid) {
      return {
        fullyOffline: true,
        localDeviceCount: 0,
      };
    }

    const localState = removeOnlineUserLocal(uid, sid);

    if (redisPresence) {
      try {
        await redisPresence.removeSocket(uid, sid);
      } catch (err) {
        log("warn", "Redis presence remove failed", {
          userId: uid,
          socketId: sid,
          error: err.message,
        });
      }
    }

    const stillOnline = await isOnline(uid);
    return {
      fullyOffline: !stillOnline,
      localDeviceCount: localState.deviceCount,
    };
  }

  async function isOnline(userId) {
    const uid = userId ? userId.toString() : "";
    if (!uid) return false;

    if (onlineUsers.has(uid) && onlineUsers.get(uid).size > 0) {
      return true;
    }

    if (!redisPresence) return false;

    try {
      return await redisPresence.isOnline(uid);
    } catch (err) {
      log("warn", "Redis presence lookup failed", {
        userId: uid,
        error: err.message,
      });
      return false;
    }
  }

  async function getOnlineUserIds() {
    const mergedUserIds = new Set(getLocalOnlineUserIds());
    if (!redisPresence) {
      return Array.from(mergedUserIds);
    }

    try {
      const redisUserIds = await redisPresence.getOnlineUserIds();
      redisUserIds.forEach((userId) => mergedUserIds.add(userId));
    } catch (err) {
      log("warn", "Redis online user list failed", {
        error: err.message,
      });
    }

    return Array.from(mergedUserIds);
  }

  function stopPresenceHeartbeat(socketId) {
    const timer = presenceHeartbeats.get(socketId);
    if (!timer) return;
    clearInterval(timer);
    presenceHeartbeats.delete(socketId);
  }

  function startPresenceHeartbeat(socket) {
    stopPresenceHeartbeat(socket.id);
    if (!socket.userId) return;

    const timer = setInterval(() => {
      touchOnlineUser(socket.userId, socket.id).catch(() => {});
    }, PRESENCE_HEARTBEAT_MS);

    if (typeof timer.unref === "function") {
      timer.unref();
    }

    presenceHeartbeats.set(socket.id, timer);
    touchOnlineUser(socket.userId, socket.id).catch(() => {});
  }

  const WEBRTC_EVENTS = {
    START: "webrtc:call:start",
    INCOMING: "webrtc:call:incoming",
    ACCEPT: "webrtc:call:accept",
    ACCEPTED: "webrtc:call:accepted",
    REJECT: "webrtc:call:reject",
    REJECTED: "webrtc:call:rejected",
    END: "webrtc:call:end",
    ENDED: "webrtc:call:ended",
    ICE: "webrtc:ice-candidate",
    RINGING: "webrtc:call:ringing",
  };

  const LEGACY_WEBRTC_EVENTS = {
    START: "callUser",
    ACCEPT: "answerCall",
    ACCEPTED: "callAccepted",
    REJECT: "rejectCall",
    REJECTED: "callRejected",
    END: "endCall",
    ENDED: "callEnded",
    ICE: "iceCandidate",
    RINGING: "callRinging",
  };

  function ack(ackFn, payload) {
    if (typeof ackFn === "function") ackFn(payload);
  }

  function emitSignal(
    targetUserId,
    canonicalEvent,
    legacyEvent,
    canonicalPayload,
    legacyPayload = canonicalPayload
  ) {
    if (!targetUserId) return;
    const room = targetUserId.toString();
    io.to(room).emit(canonicalEvent, canonicalPayload);
    io.to(room).emit(legacyEvent, legacyPayload);
  }

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.on("join", async (userId) => {
      if (!userId) return;

      const nextUserId = userId.toString();
      if (socket.userId && socket.userId !== nextUserId) {
        stopPresenceHeartbeat(socket.id);
        await removeOnlineUser(socket.userId, socket.id).catch(() => {});
      }

      socket.userId = nextUserId;
      socket.join(nextUserId);

      const joinState = await addOnlineUser(nextUserId, socket.id);
      startPresenceHeartbeat(socket);
      rememberLastSeen(nextUserId).catch(() => {});

      if (joinState.becameOnline) {
        io.emit("userOnline", { userId: nextUserId, online: true });
      }

      socket.emit("onlineUsers", await getOnlineUserIds());
      console.log(
        `User ${nextUserId} is online (${joinState.deviceCount} local device(s))`
      );
    });

    socket.on("getOnlineUsers", async () => {
      socket.emit("onlineUsers", await getOnlineUserIds());
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

    // WebRTC signaling. New explicit events are used by the current client,
    // while legacy event names stay registered for cached/older browsers.
    async function handleCallStart(data, ackFn) {
      const targetUserId = data?.to || data?.userToCall;
      const callerId = data?.from || socket.userId;
      const signal = data?.signal || data?.signalData;

      if (!targetUserId || !callerId || !signal) {
        ack(ackFn, { ok: false, error: "Invalid call payload" });
        return;
      }

      const targetOnline = await isOnline(targetUserId);
      console.log(
        `webrtc:call:start ${callerId} -> ${targetUserId} (online: ${targetOnline})`
      );

      if (!targetOnline) {
        const rejectedPayload = {
          callId: data.callId || "",
          reason: "User is offline",
        };
        socket.emit(WEBRTC_EVENTS.REJECTED, rejectedPayload);
        socket.emit(LEGACY_WEBRTC_EVENTS.REJECTED, rejectedPayload);
        ack(ackFn, { ok: false, error: "User is offline" });
        return;
      }

      const incomingPayload = {
        callId: data.callId || "",
        signal,
        signalData: signal,
        from: callerId,
        name: data.name || "Someone",
        avatar: data.avatar || "",
        isVideo: !!data.isVideo,
      };

      emitSignal(
        targetUserId,
        WEBRTC_EVENTS.INCOMING,
        LEGACY_WEBRTC_EVENTS.START,
        incomingPayload,
        incomingPayload
      );

      const ringingPayload = { callId: data.callId || "", to: targetUserId };
      socket.emit(WEBRTC_EVENTS.RINGING, ringingPayload);
      socket.emit(LEGACY_WEBRTC_EVENTS.RINGING, ringingPayload);
      ack(ackFn, { ok: true, ringing: true, to: targetUserId });
    }

    function handleCallAccept(data, ackFn) {
      const targetUserId = data?.to || data?.userToCall;
      const signal = data?.signal || data?.signalData;

      if (!targetUserId || !signal) {
        ack(ackFn, { ok: false, error: "Invalid answer payload" });
        return;
      }

      const acceptedPayload = {
        callId: data.callId || "",
        signal,
      };
      emitSignal(
        targetUserId,
        WEBRTC_EVENTS.ACCEPTED,
        LEGACY_WEBRTC_EVENTS.ACCEPTED,
        acceptedPayload,
        signal
      );
      ack(ackFn, { ok: true });
    }

    function handleIceCandidate(data, ackFn) {
      const targetUserId = data?.to || data?.userToCall;
      const candidate = data?.candidate;

      if (!targetUserId || !candidate) {
        ack(ackFn, { ok: false, error: "Invalid ICE payload" });
        return;
      }

      const icePayload = {
        callId: data.callId || "",
        candidate,
      };
      emitSignal(
        targetUserId,
        WEBRTC_EVENTS.ICE,
        LEGACY_WEBRTC_EVENTS.ICE,
        icePayload,
        candidate
      );
      ack(ackFn, { ok: true });
    }

    function handleCallReject(data, ackFn) {
      const targetUserId = data?.to || data?.userToCall;

      if (!targetUserId) {
        ack(ackFn, { ok: false, error: "Invalid reject payload" });
        return;
      }

      const rejectedPayload = {
        callId: data.callId || "",
        reason: data.reason || "Call Rejected",
      };
      emitSignal(
        targetUserId,
        WEBRTC_EVENTS.REJECTED,
        LEGACY_WEBRTC_EVENTS.REJECTED,
        rejectedPayload,
        rejectedPayload
      );
      ack(ackFn, { ok: true });
    }

    function handleCallEnd(data, ackFn) {
      const targetUserId = data?.to || data?.userToCall;

      if (targetUserId) {
        const endedPayload = {
          callId: data.callId || "",
          reason: data.reason || "Call Ended",
        };
        emitSignal(
          targetUserId,
          WEBRTC_EVENTS.ENDED,
          LEGACY_WEBRTC_EVENTS.ENDED,
          endedPayload,
          endedPayload
        );
      }
      ack(ackFn, { ok: true });
    }

    socket.on(WEBRTC_EVENTS.START, handleCallStart);
    socket.on(LEGACY_WEBRTC_EVENTS.START, handleCallStart);
    socket.on(WEBRTC_EVENTS.ACCEPT, handleCallAccept);
    socket.on(LEGACY_WEBRTC_EVENTS.ACCEPT, handleCallAccept);
    socket.on(WEBRTC_EVENTS.ICE, handleIceCandidate);
    socket.on(LEGACY_WEBRTC_EVENTS.ICE, handleIceCandidate);
    socket.on(WEBRTC_EVENTS.REJECT, handleCallReject);
    socket.on(LEGACY_WEBRTC_EVENTS.REJECT, handleCallReject);
    socket.on(WEBRTC_EVENTS.END, handleCallEnd);
    socket.on(LEGACY_WEBRTC_EVENTS.END, handleCallEnd);

    socket.on("disconnect", async () => {
      stopPresenceHeartbeat(socket.id);

      const userId = socket.userId;
      if (!userId) return;

      const disconnectState = await removeOnlineUser(userId, socket.id);
      if (disconnectState.fullyOffline) {
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
          `User ${userId} disconnected one device (still online locally on ${disconnectState.localDeviceCount} device(s))`
        );
      }
    });
  });

  return {
    onlineUsers,
    attachRedisPresence,
    isOnline,
    getOnlineUserIds,
  };
};
