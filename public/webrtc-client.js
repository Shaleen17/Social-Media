/**
 * WebRTC Client for Voice & Video Calling
 * Handles peer connections, media streams, and Socket.io signaling
 */
const WebRTCClient = (() => {
  let peerConnection = null;
  let localStream = null;
  let remoteStream = null;
  let pendingIceCandidates = [];
  let boundSocket = null;
  let removeSocketReadyListener = null;

  // Call State
  let isInCall = false;
  let isCaller = false;
  let isVideoEnabled = false;
  let currentCallUser = null; // { id, name, avatar }
  let callTimeout = null; // 30s auto-cancel timer

  // DOM Elements (will be set after init)
  let els = {};

  const config = {
    iceCandidatePoolSize: 10,
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
    ],
  };

  // Ensure DOM is ready and attach listeners
  function init() {
    els = {
      overlay: document.getElementById("callOverlay"),
      statusTxt: document.getElementById("callStatusText"),
      callerName: document.getElementById("callOverlayName"),
      callerAv: document.getElementById("callOverlayAv"),
      remoteVideo: document.getElementById("remoteVideo"),
      localVideo: document.getElementById("localVideo"),
      btnAccept: document.getElementById("callAcceptBtn"),
      btnReject: document.getElementById("callRejectBtn"),
      btnEnd: document.getElementById("callEndBtn"),
      btnMute: document.getElementById("callMuteBtn"),
      btnCam: document.getElementById("callCamBtn"),
      incomingControls: document.getElementById("callIncomingControls"),
      activeControls: document.getElementById("callActiveControls"),
      audioRing: new Audio(
        "data:audio/mp3;base64,//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" // placeholder, browser will ignore empty ringtone
      )
    };

    els.audioRing.loop = true;

    // Attach UI button listeners
    els.btnAccept?.addEventListener("click", answerCall);
    els.btnReject?.addEventListener("click", rejectCall);
    els.btnEnd?.addEventListener("click", endCallLocally);
    els.btnMute?.addEventListener("click", toggleMute);
    els.btnCam?.addEventListener("click", toggleCamera);

    if (
      typeof SocketClient !== "undefined" &&
      typeof SocketClient.onSocketReady === "function"
    ) {
      if (removeSocketReadyListener) removeSocketReadyListener();
      removeSocketReadyListener = SocketClient.onSocketReady(bindSocketListeners);
    } else {
      setupSocketListeners();
    }
  }

  // Bind Socket.io events
  function setupSocketListeners() {
    const socket = typeof SocketClient !== "undefined" ? SocketClient.getSocket() : null;
    if (!socket) {
      setTimeout(setupSocketListeners, 1000); // Retry if socket not ready
      return;
    }
    bindSocketListeners(socket);
  }

  function bindSocketListeners(socket) {
    if (!socket) return;
    // Rebind if Socket.io recreated the socket instance after reconnect/login
    if (boundSocket === socket) return;
    if (boundSocket) {
      boundSocket.off("callUser", handleIncomingCall);
      boundSocket.off("callAccepted", handleCallAccepted);
      boundSocket.off("iceCandidate", handleIceCandidate);
      boundSocket.off("callRejected", handleCallRejected);
      boundSocket.off("callEnded", handleCallEnded);
      boundSocket.off("callRinging", handleCallRinging);
    }

    boundSocket = socket;

    socket.on("callUser", handleIncomingCall);
    socket.on("callAccepted", handleCallAccepted);
    socket.on("iceCandidate", handleIceCandidate);
    socket.on("callRejected", handleCallRejected);
    socket.on("callEnded", handleCallEnded);
    socket.on("callRinging", handleCallRinging);
    
    console.log("WebRTC Client: Socket listeners attached successfully.");
  }

  async function waitForConnectedSocket(timeoutMs = 7000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const socket = typeof SocketClient !== "undefined" ? SocketClient.getSocket() : null;
      if (socket && socket.connected) {
        bindSocketListeners(socket);
        return socket;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    throw new Error("Real-time connection is not ready");
  }

  async function emitWithAck(eventName, payload, options = {}) {
    const {
      timeoutMs = 5000,
      requireAck = true,
      fallbackResolveMs = 1200,
    } = typeof options === "number" ? { timeoutMs: options } : options;

    const socket = await waitForConnectedSocket(timeoutMs);

    return new Promise((resolve, reject) => {
      let settled = false;
      let fallbackTimer = null;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        reject(new Error(`${eventName} timed out`));
      }, timeoutMs);

      const resolveOptimistically = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        console.warn(`WebRTC signaling ack missing for ${eventName}; continuing with compatibility fallback.`);
        resolve({ ok: true, fallback: true });
      };

      try {
        socket.emit(eventName, payload, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (fallbackTimer) clearTimeout(fallbackTimer);

          if (response && response.ok === false) {
            reject(new Error(response.error || `${eventName} failed`));
            return;
          }

          resolve(response || { ok: true });
        });

        if (!requireAck) {
          fallbackTimer = setTimeout(resolveOptimistically, Math.min(fallbackResolveMs, timeoutMs));
        }
      } catch (err) {
        clearTimeout(timer);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        if (settled) return;
        settled = true;
        reject(err);
      }
    });
  }

  function serializeSessionDescription(desc) {
    if (!desc) return null;
    return {
      type: desc.type,
      sdp: desc.sdp,
    };
  }

  function serializeIceCandidate(candidate) {
    if (!candidate) return null;
    return {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      usernameFragment: candidate.usernameFragment,
    };
  }

  // 1. Initializer: Start a call (from UI)
  async function startCall(userToCallUid, userName, userAvatar, withVideo) {
    if (isInCall) return MC?.info("You are already in a call");
    
    currentCallUser = { id: userToCallUid, name: userName, avatar: userAvatar };
    isVideoEnabled = withVideo;
    isCaller = true;
    
    showOverlay("Calling...", currentCallUser, true);
    
    try {
      await setupMedia(withVideo);
      createPeerConnection(userToCallUid);
      
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      await emitWithAck("callUser", {
        userToCall: userToCallUid,
        signalData: serializeSessionDescription(offer),
        from: SocketClient.getUserId(),
        name: (typeof CU !== "undefined" && CU) ? CU.name : "Someone",
        isVideo: withVideo,
      }, { requireAck: false, timeoutMs: 5000, fallbackResolveMs: 1200 });
      if (els.statusTxt) els.statusTxt.textContent = "Ringing...";

      // Start 30-second call timeout
      callTimeout = setTimeout(() => {
        if (isInCall && isCaller && els.statusTxt.textContent !== "Connected 🟢") {
          els.statusTxt.textContent = "No Answer";
          if (typeof MC !== "undefined") MC.warn("No answer. Call timed out.");
          setTimeout(resetCallUI, 1500);
        }
      }, 30000);
      
    } catch (err) {
      console.error("Failed to start call", err);
      resetCallUI();
      MC?.error(getCallErrorMessage(err, withVideo));
    }
  }

  // 2. Incoming Call Handler
  let pendingOffer = null;
  function handleIncomingCall(data) {
    console.log("WebRTC: Received incoming call from", data.name);
    // Add visual toast debug
    if (typeof MC !== "undefined") MC.info("Signaling: Incoming call from " + (data.name || "Someone"));
    
    // data: { signal, from, name, isVideo }
    if (isInCall) {
      console.log("WebRTC: Busy, rejecting call");
      emitWithAck("rejectCall", { to: data.from }, { requireAck: false, timeoutMs: 3000, fallbackResolveMs: 800 }).catch(() => {});
      return;
    }
    
    currentCallUser = { id: data.from, name: data.name, avatar: "" };
    isVideoEnabled = data.isVideo;
    isCaller = false;
    pendingOffer = data.signal;
    pendingIceCandidates = [];
    
    showOverlay("Incoming Call...", currentCallUser, false);
    // Try to play ringtone
    els.audioRing?.play().catch(() => {});
  }

  // 3. Answer Call
  async function answerCall() {
    els.audioRing?.pause();
    showActiveUi();
    
    try {
      await setupMedia(isVideoEnabled);
      createPeerConnection(currentCallUser.id);
      
      await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer));
      await flushPendingIceCandidates();
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      await emitWithAck("answerCall", {
        to: currentCallUser.id,
        signal: serializeSessionDescription(answer)
      }, { requireAck: false, timeoutMs: 4000, fallbackResolveMs: 1000 });
      
    } catch (err) {
      console.error("Failed to answer call", err);
      endCallLocally();
      MC?.error(getCallErrorMessage(err, isVideoEnabled));
    }
  }

  // 4. Reject Call
  function rejectCall() {
    emitWithAck("rejectCall", { to: currentCallUser.id }, { requireAck: false, timeoutMs: 3000, fallbackResolveMs: 800 }).catch(() => {});
    resetCallUI();
  }

  // 5. Caller handles accepted call
  async function handleCallAccepted(signal) {
    clearTimeout(callTimeout);
    showActiveUi();
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
    await flushPendingIceCandidates();
  }

  // 6. Handle ICE Candidates
  async function handleIceCandidate(candidate) {
    if (!candidate) return;

    // ICE often arrives before the peer connection or remote description is ready.
    if (!peerConnection || !peerConnection.remoteDescription) {
      pendingIceCandidates.push(candidate);
      return;
    }

    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error("Error adding received ICE candidate", e);
      pendingIceCandidates.push(candidate);
    }
  }

  async function flushPendingIceCandidates() {
    if (!peerConnection || !peerConnection.remoteDescription || !pendingIceCandidates.length) {
      return;
    }

    const queued = pendingIceCandidates.splice(0, pendingIceCandidates.length);
    for (const candidate of queued) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error("Error flushing ICE candidate", e);
      }
    }
  }

  // 7. Handle Call Rejection
  function handleCallRejected(data) {
    clearTimeout(callTimeout);
    const reason = (data && data.reason) ? data.reason : "Call Rejected";
    els.statusTxt.textContent = reason;
    if (typeof MC !== "undefined") MC.warn(reason);
    setTimeout(resetCallUI, 2000);
  }

  // 7b. Handle Call Ringing confirmation
  function handleCallRinging(data) {
    console.log("WebRTC: Call is ringing on", data?.to);
    if (els.statusTxt) els.statusTxt.textContent = "Ringing...";
  }

  // 8. Handle Remote End Call
  function handleCallEnded() {
    clearTimeout(callTimeout);
    resetCallUI();
    MC?.info("Call ended");
  }

  // 9. End Call Locally
  function endCallLocally() {
    if (currentCallUser) {
      emitWithAck("endCall", { to: currentCallUser.id }, { requireAck: false, timeoutMs: 3000, fallbackResolveMs: 800 }).catch(() => {});
    }
    resetCallUI();
  }

  // --- WebRTC Setup Helpers ---
  async function setupMedia(video) {
    // Stop old streams if any
    stopMedia();

    if (
      !window.isSecureContext &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      throw new Error("Calling works only on HTTPS or localhost");
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Media devices are not available");
    }
    
    localStream = await navigator.mediaDevices.getUserMedia({
      video: video,
      audio: true,
    });
    
    if (els.localVideo) {
      els.localVideo.srcObject = localStream;
      els.localVideo.style.display = video ? "block" : "none";
      els.localVideo.play?.().catch(() => {});
    }
    
    // Set UI states for buttons
    if (els.btnMute) els.btnMute.classList.remove("off");
    if (els.btnCam) {
      if (video) {
        els.btnCam.classList.remove("off");
        els.btnCam.style.display = "flex";
      } else {
        els.btnCam.style.display = "none";
      }
    }
  }

  function createPeerConnection(targetUserId) {
    peerConnection = new RTCPeerConnection(config);
    remoteStream = new MediaStream();
    
    if (els.remoteVideo) {
      els.remoteVideo.srcObject = remoteStream;
      els.remoteVideo.style.display = isVideoEnabled ? "block" : "none"; // Show video if enabled, otherwise play audio hidden
    }

    // Add local tracks to peer connection
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // Listen for remote tracks
    peerConnection.ontrack = (event) => {
      els.statusTxt.textContent = "Connected 🟢";
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
      // Ensure audio plays even if video is hidden
      if (!isVideoEnabled && els.remoteVideo) {
        els.remoteVideo.style.display = "none";
        // remoteVideo acts as audio element
      } else if (els.remoteVideo) {
        els.remoteVideo.style.display = "block";
      }
      els.remoteVideo?.play?.().catch(() => {});
    };

    // Send ICE candidates to remote peer
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        emitWithAck("iceCandidate", {
          to: targetUserId,
          candidate: serializeIceCandidate(event.candidate),
        }, { requireAck: false, timeoutMs: 3000, fallbackResolveMs: 700 }).catch((err) => {
          console.warn("ICE candidate signaling failed:", err.message);
        });
      }
    };
    
    peerConnection.onconnectionstatechange = () => {
      if (!peerConnection) return;
      if (peerConnection.connectionState === "connected" && els.statusTxt) {
        els.statusTxt.textContent = "Connected 🟢";
      }
      if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
        els.statusTxt.textContent = "Reconnecting...";
        try {
          peerConnection.restartIce();
        } catch {}
      }
      if (peerConnection.connectionState === "closed") {
        resetCallUI();
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      if (!peerConnection) return;
      if (peerConnection.iceConnectionState === "connected" || peerConnection.iceConnectionState === "completed") {
        els.statusTxt.textContent = "Connected 🟢";
      }
      if (peerConnection.iceConnectionState === "failed") {
        els.statusTxt.textContent = "Reconnecting...";
        try {
          peerConnection.restartIce();
        } catch {}
      }
    };
  }

  // --- UI Helpers ---
  function showOverlay(status, user, isOutgoing) {
    isInCall = true;
    els.overlay.classList.add("show");
    els.statusTxt.textContent = status;
    els.callerName.textContent = user.name || "Unknown";
    els.callerAv.innerHTML = user.avatar ? `<img src="${user.avatar}">` : getIni(user.name);
    
    if (isOutgoing) {
      els.incomingControls.style.display = "none";
      els.activeControls.style.display = "flex";
      els.btnAccept.style.display = "none"; // Since we are the caller
      els.btnReject.style.display = "none";
    } else {
      els.incomingControls.style.display = "flex";
      els.activeControls.style.display = "none";
      els.btnAccept.style.display = "flex";
      els.btnReject.style.display = "flex";
    }
  }

  function showActiveUi() {
    els.statusTxt.textContent = "Connecting...";
    els.incomingControls.style.display = "none";
    els.activeControls.style.display = "flex";
  }

  function resetCallUI() {
    isInCall = false;
    currentCallUser = null;
    isCaller = false;
    pendingOffer = null;
    pendingIceCandidates = [];
    clearTimeout(callTimeout);
    callTimeout = null;
    
    els.audioRing?.pause();
    els.overlay?.classList.remove("show");
    
    stopMedia();
    
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
  }

  function stopMedia() {
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach(t => t.stop());
      remoteStream = null;
    }
    if (els.localVideo) els.localVideo.srcObject = null;
    if (els.remoteVideo) els.remoteVideo.srcObject = null;
  }

  // --- Media Toggles ---
  function toggleMute() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      if (audioTrack.enabled) {
        els.btnMute.classList.remove("off");
      } else {
        els.btnMute.classList.add("off");
      }
    }
  }

  function toggleCamera() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      if (videoTrack.enabled) {
        els.btnCam.classList.remove("off");
      } else {
        els.btnCam.classList.add("off");
      }
    }
  }

  // Util
  function getIni(name) {
    if (!name) return "U";
    return name.charAt(0).toUpperCase();
  }

  function getMediaErrorMessage(err, wantsVideo) {
    if (!err) return wantsVideo ? "Could not access camera or microphone" : "Could not access microphone";
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return wantsVideo
        ? "Allow camera and microphone access to start the call"
        : "Allow microphone access to start the call";
    }
    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      return wantsVideo
        ? "Camera or microphone not found on this device"
        : "Microphone not found on this device";
    }
    return wantsVideo ? "Could not access camera or microphone" : "Could not access microphone";
  }

  function getCallErrorMessage(err, wantsVideo) {
    const msg = err?.message || "";
    if (
      msg.includes("timed out") ||
      msg.includes("Real-time connection is not ready") ||
      msg.includes("User is offline") ||
      msg.includes("Invalid")
    ) {
      return msg;
    }
    return getMediaErrorMessage(err, wantsVideo);
  }

  return {
    init,
    startCall
  };
})();

window.addEventListener("DOMContentLoaded", () => {
  WebRTCClient.init();
});
