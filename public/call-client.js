/**
 * Daily-backed real-time voice/video calls.
 * Socket.IO is used only for call lifecycle signaling; Daily carries media.
 */
const CallClient = (() => {
  let callObject = null;
  let boundSocket = null;
  let removeSocketReadyListener = null;
  let currentCall = null;
  let incomingCall = null;
  let isCaller = false;
  let callTimeout = null;
  let isCleaningUp = false;
  let remoteAudio = null;
  let els = {};

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
    };

    remoteAudio = document.getElementById("callRemoteAudio");
    if (!remoteAudio) {
      remoteAudio = document.createElement("audio");
      remoteAudio.id = "callRemoteAudio";
      remoteAudio.autoplay = true;
      remoteAudio.playsInline = true;
      remoteAudio.style.display = "none";
      document.body.appendChild(remoteAudio);
    }

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

  function setupSocketListeners() {
    const socket =
      typeof SocketClient !== "undefined" ? SocketClient.getSocket() : null;
    if (!socket) {
      setTimeout(setupSocketListeners, 1000);
      return;
    }
    bindSocketListeners(socket);
  }

  function bindSocketListeners(socket) {
    if (!socket || boundSocket === socket) return;

    if (boundSocket) {
      boundSocket.off?.("daily:call:incoming", handleIncomingCall);
      boundSocket.off?.("daily:call:accepted", handleCallAccepted);
      boundSocket.off?.("daily:call:rejected", handleCallRejected);
      boundSocket.off?.("daily:call:ended", handleCallEnded);
    }

    boundSocket = socket;
    socket.on("daily:call:incoming", handleIncomingCall);
    socket.on("daily:call:accepted", handleCallAccepted);
    socket.on("daily:call:rejected", handleCallRejected);
    socket.on("daily:call:ended", handleCallEnded);
  }

  function notifyUser(type, message) {
    if (typeof MC !== "undefined" && MC && typeof MC[type] === "function") {
      MC[type](message);
    }
  }

  function getSelfId() {
    return (
      typeof SocketClient !== "undefined" && SocketClient.getUserId?.()
        ? SocketClient.getUserId()
        : (typeof CU !== "undefined" && CU ? CU.id || CU._id : "")
    ).toString();
  }

  function isLocalSecureContext() {
    return (
      window.isSecureContext ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    );
  }

  function getMediaErrorMessage(err, wantsVideo) {
    if (!err) return wantsVideo ? "Could not access camera or microphone" : "Could not access microphone";
    if (err.message === "Calling works only on HTTPS or localhost") return err.message;
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return wantsVideo
        ? "Allow camera and microphone access to start the video call"
        : "Allow microphone access to start the voice call";
    }
    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      return "Camera or microphone not found on this device";
    }
    return wantsVideo ? "Could not access camera or microphone" : "Could not access microphone";
  }

  async function preflightMedia(withVideo) {
    if (!isLocalSecureContext()) {
      throw new Error("Calling works only on HTTPS or localhost");
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const error = new Error("Camera or microphone not found on this device");
      error.name = "NotFoundError";
      throw error;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: withVideo ? { facingMode: "user" } : false,
    });
    stream.getTracks().forEach((track) => track.stop());
  }

  function ensureDailyReady() {
    if (!window.DailyIframe?.createCallObject) {
      throw new Error("Calling library could not load. Please refresh and try again.");
    }
  }

  function setStatus(text) {
    if (els.statusTxt) els.statusTxt.textContent = text;
  }

  function setAvatar(user = {}) {
    if (!els.callerAv) return;
    els.callerAv.textContent = "";
    els.callerAv.innerHTML = "";
    if (user.avatar) {
      const img = document.createElement("img");
      img.src = user.avatar;
      img.alt = "";
      els.callerAv.appendChild(img);
    } else {
      els.callerAv.textContent = getInitial(user.name);
    }
  }

  function showOverlay(status, user, outgoing) {
    els.overlay?.classList.add("show");
    setStatus(status);
    if (els.callerName) els.callerName.textContent = user?.name || "Unknown";
    setAvatar(user);
    if (els.incomingControls) els.incomingControls.style.display = outgoing ? "none" : "flex";
    if (els.activeControls) els.activeControls.style.display = outgoing ? "flex" : "none";
    if (els.btnAccept) els.btnAccept.style.display = outgoing ? "none" : "flex";
    if (els.btnReject) els.btnReject.style.display = outgoing ? "none" : "flex";
    if (els.btnCam) els.btnCam.style.display = "none";
    updateControlButtons();
  }

  function showActiveControls() {
    if (els.incomingControls) els.incomingControls.style.display = "none";
    if (els.activeControls) els.activeControls.style.display = "flex";
    if (els.btnCam) {
      els.btnCam.style.display = currentCall?.withVideo ? "flex" : "none";
    }
  }

  async function startCall(targetUserId, targetName, targetAvatar, withVideo) {
    if (currentCall || incomingCall) {
      notifyUser("info", "You are already in a call");
      return;
    }

    isCaller = true;
    const target = {
      id: targetUserId,
      name: targetName || "User",
      avatar: targetAvatar || "",
    };
    showOverlay("Preparing call...", target, true);

    try {
      ensureDailyReady();
      await preflightMedia(!!withVideo);
      setStatus("Calling...");

      const data = await API.startDailyCall(targetUserId, !!withVideo);
      currentCall = {
        ...data,
        peerId: targetUserId,
        peer: target,
        withVideo: !!withVideo,
      };

      await joinDailyRoom(currentCall);
      setStatus("Ringing...");

      callTimeout = setTimeout(() => {
        if (isCaller && currentCall) {
          setStatus("Call timed out. No answer.");
          notifyUser("warn", "Call timed out. No answer.");
          endCallLocally("Call timed out. No answer.");
        }
      }, 30000);
    } catch (err) {
      console.error("Failed to start Daily call", err);
      notifyUser("error", getCallErrorMessage(err, !!withVideo));
      await cleanupCall({ notifyPeer: false });
    }
  }

  function handleIncomingCall(data) {
    if (!data?.callId || !data?.roomUrl || !data?.from?.id) return;

    if (currentCall || incomingCall) {
      emitSocket("daily:call:reject", {
        to: data.from.id,
        callId: data.callId,
        reason: "User is busy",
      });
      return;
    }

    incomingCall = {
      callId: data.callId,
      roomName: data.roomName,
      roomUrl: data.roomUrl,
      withVideo: !!data.withVideo,
      peerId: data.from.id,
      peer: data.from,
      expiresAt: data.expiresAt,
    };
    isCaller = false;
    showOverlay("Incoming Call...", incomingCall.peer, false);
  }

  async function answerCall() {
    if (!incomingCall) return;

    try {
      ensureDailyReady();
      currentCall = incomingCall;
      incomingCall = null;
      showActiveControls();
      setStatus("Checking permissions...");
      await preflightMedia(!!currentCall.withVideo);

      setStatus("Joining...");
      const tokenData = await API.getDailyCallToken(currentCall.callId);
      currentCall = {
        ...currentCall,
        ...tokenData,
      };
      await joinDailyRoom(currentCall);
    } catch (err) {
      console.error("Failed to answer Daily call", err);
      notifyUser("error", getCallErrorMessage(err, !!currentCall?.withVideo));
      await endCallLocally("Could not join call");
    }
  }

  async function rejectCall() {
    const call = incomingCall || currentCall;
    if (call?.peerId) {
      emitSocket("daily:call:reject", {
        to: call.peerId,
        callId: call.callId,
        reason: "Call rejected",
      });
    }
    if (call?.callId) {
      API.endDailyCall(call.callId, "Call rejected").catch(() => {});
    }
    await cleanupCall({ notifyPeer: false });
  }

  function handleCallAccepted(data) {
    if (!currentCall || data?.callId !== currentCall.callId) return;
    clearTimeout(callTimeout);
    setStatus("Connecting...");
  }

  function handleCallRejected(data) {
    const reason = data?.reason || "Call rejected";
    setStatus(reason);
    notifyUser("warn", reason);
    setTimeout(() => cleanupCall({ notifyPeer: false }), 1200);
  }

  function handleCallEnded(data) {
    if (currentCall && data?.callId && data.callId !== currentCall.callId) return;
    notifyUser("info", data?.reason || "Call ended");
    cleanupCall({ notifyPeer: false });
  }

  async function joinDailyRoom(call) {
    destroyCallObject();
    callObject = DailyIframe.createCallObject({
      subscribeToTracksAutomatically: true,
    });

    bindDailyEvents(callObject);
    await callObject.join({
      url: call.roomUrl,
      token: call.token,
      userName: typeof CU !== "undefined" && CU ? CU.name : "User",
      startVideoOff: !call.withVideo,
      startAudioOff: false,
    });
    showActiveControls();
    updateControlButtons();
    renderParticipants();
  }

  function bindDailyEvents(daily) {
    const rerender = () => {
      renderParticipants();
      updateControlButtons();
    };

    daily.on("joining-meeting", () => setStatus("Connecting..."));
    daily.on("joined-meeting", () => {
      setStatus("Connected");
      showActiveControls();
      rerender();
    });
    daily.on("participant-joined", rerender);
    daily.on("participant-updated", rerender);
    daily.on("participant-left", rerender);
    daily.on("track-started", rerender);
    daily.on("track-stopped", rerender);
    daily.on("network-connection", (event) => {
      if (event?.event === "interrupted") setStatus("Reconnecting...");
      if (event?.event === "connected") setStatus("Connected");
    });
    daily.on("camera-error", (event) => {
      notifyUser("error", getCallErrorMessage(event?.errorMsg || event, !!currentCall?.withVideo));
    });
    daily.on("error", (event) => {
      console.error("Daily call error", event);
      notifyUser("error", "Network issue. Please try the call again.");
    });
    daily.on("left-meeting", () => {
      if (!isCleaningUp) cleanupCall({ notifyPeer: false });
    });
  }

  function renderParticipants() {
    if (!callObject) return;

    const participants = callObject.participants();
    const list = Object.values(participants || {});
    const local = participants?.local || list.find((participant) => participant.local);
    const remote = list.find((participant) => !participant.local);

    attachVideoTrack(els.localVideo, getTrack(local, "video"), !!currentCall?.withVideo, true);
    attachVideoTrack(els.remoteVideo, getTrack(remote, "video"), !!currentCall?.withVideo, false);
    attachAudioTrack(remoteAudio, getTrack(remote, "audio"));

    if (remote && els.callerName) {
      els.callerName.textContent = currentCall?.peer?.name || remote.user_name || "Connected";
    }

    if (remote) {
      setStatus("Connected");
    }
  }

  function getTrack(participant, kind) {
    const trackInfo = participant?.tracks?.[kind];
    return trackInfo?.persistentTrack || trackInfo?.track || null;
  }

  function attachVideoTrack(videoEl, track, shouldShow, muted) {
    if (!videoEl) return;
    if (!track || !shouldShow) {
      videoEl.srcObject = null;
      videoEl.style.display = "none";
      return;
    }

    const currentTrack = videoEl.srcObject?.getTracks?.()[0];
    if (currentTrack?.id !== track.id) {
      videoEl.srcObject = new MediaStream([track]);
    }
    videoEl.muted = !!muted;
    videoEl.style.display = "block";
    videoEl.play?.().catch(() => {});
  }

  function attachAudioTrack(audioEl, track) {
    if (!audioEl) return;
    if (!track) {
      audioEl.srcObject = null;
      return;
    }
    const currentTrack = audioEl.srcObject?.getTracks?.()[0];
    if (currentTrack?.id !== track.id) {
      audioEl.srcObject = new MediaStream([track]);
    }
    audioEl.play?.().catch(() => {});
  }

  function toggleMute() {
    if (!callObject) return;
    callObject.setLocalAudio(!callObject.localAudio());
    updateControlButtons();
  }

  function toggleCamera() {
    if (!callObject || !currentCall?.withVideo) return;
    callObject.setLocalVideo(!callObject.localVideo());
    updateControlButtons();
  }

  function updateControlButtons() {
    if (els.btnMute && callObject?.localAudio) {
      els.btnMute.classList.toggle("off", !callObject.localAudio());
    }
    if (els.btnCam && callObject?.localVideo) {
      els.btnCam.classList.toggle("off", !callObject.localVideo());
    }
  }

  async function endCallLocally(reason = "Call ended") {
    const call = currentCall || incomingCall;
    if (call?.peerId) {
      emitSocket("daily:call:end", {
        to: call.peerId,
        callId: call.callId,
        reason,
      });
    }
    if (call?.callId) {
      API.endDailyCall(call.callId, reason).catch(() => {});
    }
    await cleanupCall({ notifyPeer: false });
  }

  async function cleanupCall() {
    isCleaningUp = true;
    clearTimeout(callTimeout);
    callTimeout = null;
    incomingCall = null;
    currentCall = null;
    isCaller = false;

    if (els.overlay) els.overlay.classList.remove("show");
    if (els.localVideo) els.localVideo.srcObject = null;
    if (els.remoteVideo) els.remoteVideo.srcObject = null;
    if (remoteAudio) remoteAudio.srcObject = null;

    if (els.localVideo) els.localVideo.style.display = "none";
    if (els.remoteVideo) els.remoteVideo.style.display = "none";

    await leaveAndDestroyCallObject();
    isCleaningUp = false;
  }

  async function leaveAndDestroyCallObject() {
    if (!callObject) return;
    const daily = callObject;
    callObject = null;
    try {
      await daily.leave();
    } catch {}
    try {
      daily.destroy();
    } catch {}
  }

  function destroyCallObject() {
    if (!callObject) return;
    try {
      callObject.destroy();
    } catch {}
    callObject = null;
  }

  function emitSocket(eventName, payload) {
    const socket =
      typeof SocketClient !== "undefined" ? SocketClient.getSocket() : null;
    if (socket?.connected) {
      socket.emit(eventName, payload);
    }
  }

  function getCallErrorMessage(err, wantsVideo) {
    const message =
      typeof err === "string"
        ? err
        : err?.message || err?.errorMsg || err?.error || "";

    if (
      /offline|not configured|not found|expired|invalid|network|library|provider|server/i.test(message)
    ) {
      return message;
    }

    return getMediaErrorMessage(err, wantsVideo);
  }

  function getInitial(name) {
    return (name || "U").charAt(0).toUpperCase();
  }

  return {
    init,
    startCall,
    endCall: endCallLocally,
  };
})();

window.debugCallStatus = function() {
  return {
    backend: typeof getBackendBaseUrl === "function" ? getBackendBaseUrl() : null,
    socketConnected: typeof SocketClient !== "undefined" ? SocketClient.isConnected() : false,
    socketId: typeof SocketClient !== "undefined" ? SocketClient.getSocket()?.id : null,
    userId: typeof SocketClient !== "undefined" ? SocketClient.getUserId() : null,
    secureContext: window.isSecureContext,
    hasMediaDevices: !!navigator.mediaDevices?.getUserMedia,
    callingLibraryLoaded: !!window.DailyIframe,
  };
};

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => {
    CallClient.init();
  });
} else {
  CallClient.init();
}
