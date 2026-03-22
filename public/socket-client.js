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
    const backendUrl = typeof CONFIG !== "undefined" ? CONFIG.BACKEND_URL : "";
    if (!backendUrl) {
      console.error("SocketClient: CONFIG.BACKEND_URL is not defined. Cannot connect.");
      return;
    }

    // If socket already exists and is connected, no need to re-initialize
    if (socket && socket.connected) {
      console.log("Socket already connected.");
      socket.emit("join", uid);
      return;
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

    socket.on("connect", () => {
      console.log("🔌 Socket connected:", socket.id);
      if (userId) {
        socket.emit("join", userId);
      }
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
        updateChatHeaderOnline(data.userId, data.online);
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

    socket.on("disconnect", () => {
      console.log("🔌 Socket disconnected — will reconnect...");
    });

    socket.on("reconnect", () => {
      console.log("🔌 Socket reconnected");
      if (userId) socket.emit("join", userId);
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
    isUserOnline,
    getOnlineUsers,
    getSocket: () => socket,
    getUserId: () => userId,
  };
})();

// Global handlers — will be overridden by backend-adapter.js
function handleIncomingMessage(data) {}
function handleNewNotification(data) {}
function handleRemoteTyping(data) {}
function handleRemoteStopTyping(data) {}
function handleRemoteRead(data) {}
function updateChatHeaderOnline(userId, online) {}
