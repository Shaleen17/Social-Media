/**
 * Socket.io Client — real-time chat, notifications, typing indicators
 * Enhanced for full WhatsApp-like real-time messaging
 */
const SocketClient = (() => {
  let socket = null;
  let userId = null;
  let _onlineUsers = new Set();
  let _typingTimers = {};
  let reconnectTimer = null; // Added reconnectTimer
  const _socketReadyListeners = new Set();

  function notifySocketReady(activeSocket) {
    _socketReadyListeners.forEach((listener) => {
      try {
        listener(activeSocket);
      } catch (err) {
        console.error("SocketClient listener error:", err);
      }
    });
  }

  function onSocketReady(listener) {
    if (typeof listener !== "function") return () => {};
    _socketReadyListeners.add(listener);
    if (socket) {
      try {
        listener(socket);
      } catch (err) {
        console.error("SocketClient listener error:", err);
      }
    }
    return () => {
      _socketReadyListeners.delete(listener);
    };
  }

  function connect(uid) {
    const token = typeof API !== "undefined" ? API.getToken() : null; // Safely get token
    if (!token) {
      console.warn("SocketClient: No authentication token found. Cannot connect.");
      // Optionally, set a timer to retry connection after some delay
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect(uid); // Retry connection
        }, 5000); // Retry after 5 seconds
      }
      return;
    }

    // Use the dynamically configured backend URL
    const backendUrl =
      typeof window.getBackendBaseUrl === "function"
        ? window.getBackendBaseUrl()
        : typeof CONFIG !== "undefined" && CONFIG && CONFIG.BACKEND_URL
          ? String(CONFIG.BACKEND_URL).replace(/\/+$/, "")
          : "";
    if (!backendUrl) {
      console.error("SocketClient: CONFIG.BACKEND_URL is not defined. Cannot connect.");
      return;
    }

    // If socket already exists and is connected, no need to re-initialize
    if (socket && socket.connected) {
      console.log("Socket already connected.");
      socket.emit("join", uid);
      notifySocketReady(socket);
      return;
    }

    if (socket && !socket.connected) {
      userId = uid;
      try {
        socket.auth = { token };
      } catch {}
      if (typeof socket.connect === "function") {
        socket.connect();
        return;
      }
    }
    
    userId = uid;

    // Clear any existing reconnect timer if we are attempting to connect now
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    socket = io(backendUrl, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10, // Changed from Infinity
      reconnectionDelay: 2000, // Changed from 1000
    });
    notifySocketReady(socket);

    socket.on("connect", () => {
      console.log("🔌 Socket connected:", socket.id);
      if (userId) {
        socket.emit("join", userId);
      }
      notifySocketReady(socket);
    });

    // Receive full online users list
    socket.on("onlineUsers", (userIds) => {
      _onlineUsers = new Set(userIds);
      updateOnlineIndicators();
    });

    // User online/offline status change
    socket.on("userOnline", (data) => {
      if (data.online) {
        _onlineUsers.add(data.userId);
      } else {
        _onlineUsers.delete(data.userId);
      }
      updateOnlineIndicators();
      // Update chat header if viewing that user's chat
      if (typeof updateChatHeaderOnline === "function") {
        updateChatHeaderOnline(data.userId, data.online, data.lastSeen || null);
      }
    });

    // New chat message (real-time)
    socket.on("newMessage", (data) => {
      console.log("💬 New message:", data.convId);
      if (typeof handleIncomingMessage === "function") {
        handleIncomingMessage(data);
      }
    });

    // Message notification (when not in chat view)
    socket.on("messageNotification", (data) => {
      const name = data.from?.name || "Someone";
      if (typeof MC !== "undefined") {
        MC.info("💬 " + name + ": " + (data.text || "").substring(0, 50));
      }
    });

    // Real-time notification (likes, comments, follows)
    socket.on("notification", (data) => {
      if (typeof handleNewNotification === "function") {
        handleNewNotification(data);
      }
      const ndot = document.getElementById("ndot");
      if (ndot) ndot.style.display = "block";
      const bnDot = document.querySelector("#bnNotifs .bnb-badge");
      if (bnDot) bnDot.style.display = "block";
    });

    // Typing indicators
    socket.on("userTyping", (data) => {
      if (typeof handleRemoteTyping === "function") {
        handleRemoteTyping(data);
      }
    });

    socket.on("userStopTyping", (data) => {
      if (typeof handleRemoteStopTyping === "function") {
        handleRemoteStopTyping(data);
      }
    });

    // Read receipts
    socket.on("messagesRead", (data) => {
      if (typeof handleRemoteRead === "function") {
        handleRemoteRead(data);
      }
    });

    socket.on("messageDelivered", (data) => {
      if (typeof handleMessageDelivered === "function") {
        handleMessageDelivered(data);
      }
    });

    socket.on("messageUpdated", (data) => {
      if (typeof handleMessageUpdated === "function") {
        handleMessageUpdated(data);
      }
    });

    socket.on("disconnect", () => {
      console.log("🔌 Socket disconnected — will reconnect...");
    });

    socket.on("reconnect", () => {
      console.log("🔌 Socket reconnected");
      if (userId) socket.emit("join", userId);
      notifySocketReady(socket);
    });

    socket.on("connect_error", (err) => {
      console.error("Socket connect error:", err?.message || err);
    });
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    _onlineUsers.clear();
  }

  function joinConversation(convId) {
    if (socket) socket.emit("joinConversation", convId);
  }

  function leaveConversation(convId) {
    if (socket) socket.emit("leaveConversation", convId);
  }

  function sendMessage(convId, message, recipients) {
    if (socket) {
      socket.emit("chatMessage", { convId, message, recipients });
    }
  }

  function emitTyping(convId) {
    if (socket && userId) {
      // Debounce: only emit once per 2 seconds
      const key = "typing_" + convId;
      if (_typingTimers[key]) return;
      socket.emit("typing", {
        convId,
        userId,
        userName: (typeof CU !== "undefined" && CU) ? CU.name : "",
      });
      _typingTimers[key] = setTimeout(() => {
        delete _typingTimers[key];
      }, 2000);
    }
  }

  function emitStopTyping(convId) {
    if (socket && userId) {
      const key = "typing_" + convId;
      if (_typingTimers[key]) {
        clearTimeout(_typingTimers[key]);
        delete _typingTimers[key];
      }
      socket.emit("stopTyping", { convId, userId });
    }
  }

  function emitMessageRead(convId) {
    if (socket && userId) {
      socket.emit("messageRead", { convId, userId });
    }
  }

  function emitMessageDelivered(convId, messageId) {
    if (socket && userId && convId && messageId) {
      socket.emit("messageDelivered", { convId, messageId, userId });
    }
  }

  function isUserOnline(uid) {
    return _onlineUsers.has(uid);
  }

  function getOnlineUsers() {
    return _onlineUsers;
  }

  // Update all visible online indicators in the chat list
  function updateOnlineIndicators() {
    document.querySelectorAll("[data-online-uid]").forEach((el) => {
      const uid = el.getAttribute("data-online-uid");
      if (_onlineUsers.has(uid)) {
        el.classList.add("is-online");
        el.style.display = "";
      } else {
        el.classList.remove("is-online");
        el.style.display = "none";
      }
    });
  }

  return {
    connect,
    disconnect,
    joinConversation,
    leaveConversation,
    sendMessage,
    emitTyping,
    emitStopTyping,
    emitMessageRead,
    emitMessageDelivered,
    isUserOnline,
    getOnlineUsers,
    getSocket: () => socket,
    getUserId: () => userId,
    isConnected: () => !!(socket && socket.connected),
    onSocketReady,
  };
})();

// Global handlers — will be overridden by backend-adapter.js
function handleIncomingMessage(data) {}
function handleNewNotification(data) {}
function handleRemoteTyping(data) {}
function handleRemoteStopTyping(data) {}
function handleRemoteRead(data) {}
function handleMessageDelivered(data) {}
function handleMessageUpdated(data) {}
function updateChatHeaderOnline(userId, online, lastSeen) {}
