/**
 * Daily-backed real-time voice/video calls.
 * Socket.IO is used for call lifecycle signaling; Daily carries media.
 */
const CallClient = (() => {
  const OUTGOING_TIMEOUT_MS = 30000;
  const INCOMING_TIMEOUT_MS = 45000;
  const CALL_PERMISSION_COOKIE = "ts_call_media_permission";
  const CALL_PERMISSION_STORAGE_KEY = "ts_call_media_permission";
  const CALL_PERMISSION_MAX_AGE = 60 * 60 * 24 * 45;

  let initialized = false;
  let callObject = null;
  let boundSocket = null;
  let removeSocketReadyListener = null;
  let currentCall = null;
  let incomingCall = null;
  let isCaller = false;
  let callTimeout = null;
  let isCleaningUp = false;
  let remoteAudio = null;
  let callStartedAt = 0;
  let timerInterval = null;
  let ringInterval = null;
  let ringContext = null;
  let lastMediaErrorAt = 0;
  let dailyJoinStartedAt = 0;
  let lastCallNotice = { message: "", at: 0 };
  let selectedOutputDeviceId = "default";
  let els = {};

  function init() {
    if (initialized) return;
    initialized = true;

    els = {
      overlay: document.getElementById("callOverlay"),
      stage: document.getElementById("callStage"),
      incomingCard: document.getElementById("callIncomingCard"),
      incomingType: document.getElementById("callIncomingType"),
      permissionNote: document.getElementById("callPermissionNote"),
      statusTxt: document.getElementById("callStatusText"),
      stageStatus: document.getElementById("callStageStatus"),
      statePill: document.getElementById("callStatePill"),
      callerName: document.getElementById("callOverlayName"),
      callerAv: document.getElementById("callOverlayAv"),
      remoteAv: document.getElementById("callRemoteAv"),
      remoteName: document.getElementById("callRemoteName"),
      remoteVideo: document.getElementById("remoteVideo"),
      localVideo: document.getElementById("localVideo"),
      topAvatar: document.getElementById("callTopAvatar"),
      topName: document.getElementById("callTopName"),
      typeLabel: document.getElementById("callTypeLabel"),
      timer: document.getElementById("callTimer"),
      btnAccept: document.getElementById("callAcceptBtn"),
      btnReject: document.getElementById("callRejectBtn"),
      btnEnd: document.getElementById("callEndBtn"),
      btnMute: document.getElementById("callMuteBtn"),
      btnCam: document.getElementById("callCamBtn"),
      btnSwitchCam: document.getElementById("callSwitchCamBtn"),
      btnSpeaker: document.getElementById("callSpeakerBtn"),
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
    els.btnEnd?.addEventListener("click", () => endCallLocally("Call ended"));
    els.btnMute?.addEventListener("click", toggleMute);
    els.btnCam?.addEventListener("click", toggleCamera);
    els.btnSwitchCam?.addEventListener("click", switchCamera);
    els.btnSpeaker?.addEventListener("click", toggleSpeaker);

    if (
      typeof SocketClient !== "undefined" &&
      typeof SocketClient.onSocketReady === "function"
    ) {
      removeSocketReadyListener = SocketClient.onSocketReady(bindSocketListeners);
    } else {
      setupSocketListeners();
    }

    updateDeviceSupport();
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

  function notifyCallIssue(type, message) {
    const safeMessage = message || "Could not access camera or microphone";
    const now = Date.now();
    if (
      lastCallNotice.message === safeMessage &&
      now - lastCallNotice.at < 3500
    ) {
      return;
    }
    lastCallNotice = { message: safeMessage, at: now };
    notifyUser(type, safeMessage);
  }

  function getCookie(name) {
    try {
      const prefix = `${encodeURIComponent(name)}=`;
      const item = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(prefix));
      return item ? decodeURIComponent(item.slice(prefix.length)) : "";
    } catch {
      return "";
    }
  }

  function setCookie(name, value, maxAgeSeconds) {
    try {
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
        value
      )}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
    } catch {}
  }

  function getCurrentUserId() {
    const socketUserId =
      typeof SocketClient !== "undefined" && SocketClient
        ? SocketClient.getUserId?.()
        : "";
    const currentUser =
      typeof CU !== "undefined" && CU
        ? CU
        : typeof API !== "undefined" && API?.getStoredUser
          ? API.getStoredUser()
          : null;
    return String(socketUserId || currentUser?.id || currentUser?._id || "guest")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 80) || "guest";
  }

  function getPermissionStoreKeys() {
    const suffix = getCurrentUserId();
    return {
      cookie: `${CALL_PERMISSION_COOKIE}_${suffix}`,
      storage: `${CALL_PERMISSION_STORAGE_KEY}_${suffix}`,
    };
  }

  function getStoredMediaPermission() {
    const keys = getPermissionStoreKeys();
    try {
      return (
        localStorage.getItem(keys.storage) ||
        getCookie(keys.cookie) ||
        localStorage.getItem(CALL_PERMISSION_STORAGE_KEY) ||
        getCookie(CALL_PERMISSION_COOKIE)
      );
    } catch {
      return getCookie(keys.cookie) || getCookie(CALL_PERMISSION_COOKIE);
    }
  }

  function rememberMediaPermission(value) {
    const keys = getPermissionStoreKeys();
    const safeValue = String(value || "asked").slice(0, 40);
    setCookie(keys.cookie, safeValue, CALL_PERMISSION_MAX_AGE);
    setCookie(CALL_PERMISSION_COOKIE, safeValue, CALL_PERMISSION_MAX_AGE);
    try {
      localStorage.setItem(keys.storage, safeValue);
      localStorage.setItem(CALL_PERMISSION_STORAGE_KEY, safeValue);
    } catch {}
  }

  function isLocalSecureContext() {
    return (
      window.isSecureContext ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    );
  }

  function getMediaErrorMessage(err, wantsVideo) {
    if (!err) {
      return wantsVideo
        ? "Could not access camera or microphone"
        : "Could not access microphone";
    }
    const rawMessage =
      typeof err === "string"
        ? err
        : err.message || err.errorMsg || err.error || "";
    if (err.message === "Calling works only on HTTPS or localhost") {
      return err.message;
    }
    if (/permission|denied|notallowed/i.test(rawMessage)) {
      return wantsVideo
        ? "Allow camera and microphone access to start the video call"
        : "Allow microphone access to start the voice call";
    }
    if (/notfound|not found|device|camera|microphone|audio input|video input/i.test(rawMessage)) {
      return wantsVideo
        ? "Camera or microphone not found on this device"
        : "Microphone not found on this device";
    }
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return wantsVideo
        ? "Allow camera and microphone access to start the video call"
        : "Allow microphone access to start the voice call";
    }
    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      return "Camera or microphone not found on this device";
    }
    return wantsVideo
      ? "Could not access camera or microphone"
      : "Could not access microphone";
  }

  function isPermissionDeniedError(err) {
    const rawMessage =
      typeof err === "string"
        ? err
        : err?.message || err?.errorMsg || err?.error || "";
    return (
      err?.name === "NotAllowedError" ||
      err?.name === "PermissionDeniedError" ||
      /permission|denied|notallowed/i.test(rawMessage)
    );
  }

  function showPermissionNote(message, force = false) {
    if (!els.permissionNote) return;
    const cached = getStoredMediaPermission();
    const shouldShow = force || !cached || cached === "denied" || cached === "failed";
    els.permissionNote.textContent = shouldShow ? message || "" : "";
    els.permissionNote.classList.toggle("show", !!(shouldShow && message));
  }

  function getPermissionPromptText(withVideo, action = "start") {
    const cached = getStoredMediaPermission();
    if (cached === "denied" || cached === "failed") {
      return withVideo
        ? "Camera or microphone may be blocked. If the browser does not ask, allow both from site settings."
        : "Microphone may be blocked. If the browser does not ask, allow it from site settings.";
    }
    const actionText = action === "answer" ? "answer the call" : "start the call";
    return withVideo
      ? `Allow camera and microphone when your browser asks to ${actionText}. Your browser will remember this for future calls.`
      : `Allow microphone when your browser asks to ${actionText}. Your browser will remember this for future calls.`;
  }

  function getPermissionStatusText(withVideo, action = "start") {
    const actionText = action === "answer" ? "answer the call" : "start the call";
    return withVideo
      ? `Allow camera and microphone to ${actionText}...`
      : `Allow microphone to ${actionText}...`;
  }

  function createPermissionBlockedError(message) {
    const error = new Error(message || "Camera or microphone is blocked");
    error.name = "NotAllowedError";
    return error;
  }

  function createMutedMediaFallback(withVideo, err, message) {
    const issue =
      message ||
      getMediaErrorMessage(err, withVideo) ||
      (withVideo
        ? "Camera or microphone is unavailable. Joining with camera and microphone off."
        : "Microphone is unavailable. Joining muted.");
    return {
      startVideoOff: true,
      startAudioOff: true,
      audioFallback: true,
      mediaIssue: issue,
      mediaError: err || null,
    };
  }

  async function queryBrowserMediaPermission(name) {
    if (!navigator.permissions?.query) return "unknown";
    try {
      const status = await navigator.permissions.query({ name });
      return status?.state || "unknown";
    } catch {
      return "unknown";
    }
  }

  async function getBrowserMediaPermissionSnapshot(withVideo) {
    const [microphone, camera] = await Promise.all([
      queryBrowserMediaPermission("microphone"),
      withVideo ? queryBrowserMediaPermission("camera") : Promise.resolve("unused"),
    ]);
    return { microphone, camera };
  }

  async function preflightMedia(withVideo, options = {}) {
    const allowVideoFallback = options.allowVideoFallback !== false;
    const purpose = options.purpose || "start";

    if (!isLocalSecureContext()) {
      return createMutedMediaFallback(
        withVideo,
        null,
        "Camera and microphone need HTTPS or localhost. Joining with media off."
      );
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const error = new Error("Camera or microphone not found on this device");
      error.name = "NotFoundError";
      rememberMediaPermission("failed");
      return createMutedMediaFallback(withVideo, error);
    }

    showPermissionNote(getPermissionPromptText(withVideo, purpose), true);
    setStatus(getPermissionStatusText(withVideo, purpose));

    const permissionState = await getBrowserMediaPermissionSnapshot(withVideo);
    if (permissionState.microphone === "denied") {
      rememberMediaPermission("denied");
      return createMutedMediaFallback(
        withVideo,
        createPermissionBlockedError(
          "Microphone is blocked. Allow microphone access from browser site settings and try again."
        ),
        "Microphone is blocked. Allow microphone access from browser site settings and try again."
      );
    }

    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
    };

    if (withVideo) {
      if (permissionState.camera === "denied") {
        notifyCallIssue("warn", "Camera is blocked. Continuing with microphone only.");
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: { facingMode: "user" },
        });
        stream.getTracks().forEach((track) => track.stop());
        rememberMediaPermission("audio-video");
        showPermissionNote("");
        return { startVideoOff: false };
      } catch (videoBundleError) {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false,
          });
          audioStream.getTracks().forEach((track) => track.stop());
          rememberMediaPermission("audio");
          showPermissionNote("");
          if (!allowVideoFallback) throw videoBundleError;
          return {
            startVideoOff: true,
            videoFallback: true,
            videoError: videoBundleError,
          };
        } catch (audioError) {
          rememberMediaPermission(
            isPermissionDeniedError(audioError) ? "denied" : "failed"
          );
          return createMutedMediaFallback(!!withVideo, audioError);
        }
      }
    }

    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
      audioStream.getTracks().forEach((track) => track.stop());
      rememberMediaPermission("audio");
      showPermissionNote("");
      return { startVideoOff: true };
    } catch (err) {
      rememberMediaPermission(isPermissionDeniedError(err) ? "denied" : "failed");
      return createMutedMediaFallback(false, err);
    }
  }

  function ensureDailyReady() {
    if (!window.DailyIframe?.createCallObject) {
      throw new Error("Calling library could not load. Please refresh and try again.");
    }
  }

  function setStatus(text) {
    const status = text || "";
    if (els.statusTxt) els.statusTxt.textContent = status;
    if (els.stageStatus) els.stageStatus.textContent = status;
    if (els.statePill) els.statePill.textContent = status;
  }

  function setOverlayMode(mode) {
    if (!els.overlay) return;
    ["mode-incoming", "mode-outgoing", "mode-active", "mode-ended"].forEach((cls) =>
      els.overlay.classList.remove(cls)
    );
    els.overlay.classList.add("show", `mode-${mode}`);
    els.overlay.setAttribute("aria-hidden", "false");

    const incomingVisible = mode === "incoming";
    const controlsVisible = mode === "outgoing" || mode === "active";
    if (els.incomingControls) {
      els.incomingControls.style.display = incomingVisible ? "flex" : "none";
    }
    if (els.activeControls) {
      els.activeControls.style.display = controlsVisible ? "flex" : "none";
    }
  }

  function hideOverlay() {
    if (!els.overlay) return;
    els.overlay.classList.remove(
      "show",
      "mode-incoming",
      "mode-outgoing",
      "mode-active",
      "mode-ended",
      "audio-only",
      "video-call",
      "is-ringing",
      "is-reconnecting",
      "has-local-video",
      "has-remote-video",
      "has-remote-participant"
    );
    els.overlay.setAttribute("aria-hidden", "true");
    if (els.activeControls) els.activeControls.style.display = "none";
    if (els.incomingControls) els.incomingControls.style.display = "none";
    showPermissionNote("");
  }

  function updateCallType(withVideo, incoming = false) {
    const isVideo = !!withVideo;
    els.overlay?.classList.toggle("audio-only", !isVideo);
    els.overlay?.classList.toggle("video-call", isVideo);
    if (els.typeLabel) els.typeLabel.textContent = isVideo ? "Video call" : "Voice call";
    if (els.incomingType) {
      els.incomingType.textContent = incoming
        ? `Incoming ${isVideo ? "video" : "voice"} call`
        : `${isVideo ? "Video" : "Voice"} call`;
    }
  }

  function setPeer(user = {}) {
    const safeUser = {
      name: user.name || "Unknown User",
      avatar: user.avatar || "",
    };
    if (els.callerName) els.callerName.textContent = safeUser.name;
    if (els.remoteName) els.remoteName.textContent = safeUser.name;
    if (els.topName) els.topName.textContent = safeUser.name;
    renderAvatar(els.callerAv, safeUser);
    renderAvatar(els.remoteAv, safeUser);
    renderAvatar(els.topAvatar, safeUser);
  }

  function renderAvatar(el, user = {}) {
    if (!el) return;
    el.textContent = "";
    el.innerHTML = "";
    if (user.avatar) {
      const img = document.createElement("img");
      img.src = user.avatar;
      img.alt = "";
      el.appendChild(img);
    } else {
      el.textContent = getInitial(user.name);
    }
  }

  function showOverlay(status, user, mode, withVideo) {
    setPeer(user);
    updateCallType(withVideo, mode === "incoming");
    setOverlayMode(mode);
    setStatus(status);
    updateControlButtons();
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
    showOverlay("Preparing call...", target, "outgoing", !!withVideo);

    try {
      ensureDailyReady();
      showPermissionNote(getPermissionPromptText(!!withVideo, "start"));
      setStatus("Checking permissions...");
      const media = await preflightMedia(!!withVideo, { purpose: "start" });
      if (media.videoFallback) {
        notifyCallIssue("warn", "Camera is unavailable. Starting with camera off.");
      }
      if (media.audioFallback) {
        notifyCallIssue(
          "warn",
          media.mediaIssue ||
            "Microphone is unavailable. Starting the call muted."
        );
      }
      setStatus("Calling...");

      const data = await API.startDailyCall(targetUserId, !!withVideo);
      currentCall = {
        ...data,
        peerId: targetUserId,
        peer: target,
        withVideo: !!withVideo,
        startVideoOff: !!media.startVideoOff,
        startAudioOff: !!media.startAudioOff,
      };

      await joinDailyRoom(currentCall);
      setStatus("Ringing...");

      callTimeout = setTimeout(() => {
        if (isCaller && currentCall) {
          setStatus("Call timed out. No answer.");
          notifyUser("warn", "Call timed out. No answer.");
          endCallLocally("Call timed out. No answer.");
        }
      }, OUTGOING_TIMEOUT_MS);
    } catch (err) {
      console.error("Failed to start Daily call", err);
      notifyCallIssue("error", getCallErrorMessage(err, !!withVideo));
      await cleanupCall();
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
    showOverlay("is calling you", incomingCall.peer, "incoming", incomingCall.withVideo);
    showPermissionNote(getPermissionPromptText(incomingCall.withVideo, "answer"));
    startRingtone();

    clearTimeout(callTimeout);
    callTimeout = setTimeout(() => {
      if (!incomingCall) return;
      emitSocket("daily:call:reject", {
        to: incomingCall.peerId,
        callId: incomingCall.callId,
        reason: "Missed call",
      });
      API.endDailyCall(incomingCall.callId, "Missed call").catch(() => {});
      setStatus("Missed call");
      stopRingtone();
      setTimeout(() => cleanupCall(), 900);
    }, INCOMING_TIMEOUT_MS);
  }

  async function answerCall() {
    if (!incomingCall) return;

    try {
      ensureDailyReady();
      clearTimeout(callTimeout);
      stopRingtone();
      currentCall = incomingCall;
      incomingCall = null;
      showOverlay(
        "Checking permissions...",
        currentCall.peer,
        "active",
        currentCall.withVideo
      );
      showPermissionNote(getPermissionPromptText(!!currentCall.withVideo, "answer"), true);
      const media = await preflightMedia(!!currentCall.withVideo, { purpose: "answer" });
      if (media.videoFallback) {
        notifyCallIssue("warn", "Camera is unavailable. Joining with camera off.");
      }
      if (media.audioFallback) {
        notifyCallIssue(
          "warn",
          media.mediaIssue ||
            "Microphone is unavailable. Joining the call muted."
        );
      }

      setStatus("Joining...");
      const tokenData = await API.getDailyCallToken(currentCall.callId);
      currentCall = {
        ...currentCall,
        ...tokenData,
        startVideoOff: !!media.startVideoOff,
        startAudioOff: !!media.startAudioOff,
      };
      await joinDailyRoom(currentCall);
    } catch (err) {
      console.error("Failed to answer Daily call", err);
      const reason = getCallErrorMessage(err, !!currentCall?.withVideo);
      notifyCallIssue("error", reason);
      await endCallLocally(getPeerJoinFailureMessage(reason));
    }
  }

  async function rejectCall() {
    const call = incomingCall || currentCall;
    stopRingtone();
    clearTimeout(callTimeout);
    callTimeout = null;

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
    setStatus("Call rejected");
    setTimeout(() => cleanupCall(), 300);
  }

  function handleCallAccepted(data) {
    if (!currentCall || data?.callId !== currentCall.callId) return;
    clearTimeout(callTimeout);
    callTimeout = null;
    setStatus("Connecting...");
  }

  function handleCallRejected(data) {
    const call = currentCall || incomingCall;
    if (call?.callId && data?.callId && data.callId !== call.callId) return;
    const reason = data?.reason || "Call rejected";
    stopRingtone();
    setStatus(reason);
    notifyUser("warn", reason);
    setTimeout(() => cleanupCall(), 1000);
  }

  function handleCallEnded(data) {
    const call = currentCall || incomingCall;
    if (call?.callId && data?.callId && data.callId !== call.callId) return;
    stopRingtone();
    setStatus(data?.reason || "Call ended");
    notifyUser("info", data?.reason || "Call ended");
    setTimeout(() => cleanupCall(), 800);
  }

  async function joinDailyRoom(call) {
    destroyCallObject();
    selectedOutputDeviceId = "default";
    callObject = DailyIframe.createCallObject({
      subscribeToTracksAutomatically: true,
    });

    bindDailyEvents(callObject);
    updateDeviceSupport();
    dailyJoinStartedAt = Date.now();
    await callObject.join({
      url: call.roomUrl,
      token: call.token,
      userName: typeof CU !== "undefined" && CU ? CU.name : "User",
      startVideoOff: !!call.startVideoOff || !call.withVideo,
      startAudioOff: !!call.startAudioOff,
    });
    setOverlayMode("active");
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
      dailyJoinStartedAt = 0;
      setStatus(isCaller ? "Ringing..." : "Connected");
      setOverlayMode("active");
      rerender();
    });
    daily.on("participant-joined", rerender);
    daily.on("participant-updated", rerender);
    daily.on("participant-left", (event) => {
      rerender();
      if (event?.participant && !event.participant.local && currentCall) {
        setStatus("Call ended");
        setTimeout(() => cleanupCall(), 900);
      }
    });
    daily.on("track-started", rerender);
    daily.on("track-stopped", rerender);
    daily.on("network-connection", (event) => {
      const interrupted = event?.event === "interrupted";
      els.overlay?.classList.toggle("is-reconnecting", interrupted);
      if (interrupted) setStatus("Reconnecting...");
      if (event?.event === "connected") setStatus("Connected");
    });
    daily.on("camera-error", (event) => {
      lastMediaErrorAt = Date.now();
      currentCall = currentCall
        ? { ...currentCall, startVideoOff: true }
        : currentCall;
      updateControlButtons();
      notifyCallIssue(
        "warn",
        getCallErrorMessage(event?.errorMsg || event, !!currentCall?.withVideo)
      );
    });
    daily.on("error", (event) => {
      console.error("Daily call error", event);
      if (Date.now() - lastMediaErrorAt < 1800) return;
      if (dailyJoinStartedAt && Date.now() - dailyJoinStartedAt < 7000 && !callStartedAt) {
        lastMediaErrorAt = Date.now();
        notifyCallIssue("warn", getCallErrorMessage(event, !!currentCall?.withVideo));
        return;
      }
      if (isMediaDailyError(event)) {
        lastMediaErrorAt = Date.now();
        notifyCallIssue("warn", getCallErrorMessage(event, !!currentCall?.withVideo));
        return;
      }
      notifyCallIssue("error", "Network issue. Please try the call again.");
    });
    daily.on("left-meeting", () => {
      if (!isCleaningUp) cleanupCall();
    });
  }

  function renderParticipants() {
    if (!callObject) return;

    const participants = callObject.participants();
    const list = Object.values(participants || {});
    const local = participants?.local || list.find((participant) => participant.local);
    const remote = list.find((participant) => !participant.local);
    const localVideoTrack = getTrack(local, "video");
    const remoteVideoTrack = getTrack(remote, "video");

    attachVideoTrack(els.localVideo, localVideoTrack, !!currentCall?.withVideo, true);
    attachVideoTrack(els.remoteVideo, remoteVideoTrack, !!currentCall?.withVideo, false);
    attachAudioTrack(remoteAudio, getTrack(remote, "audio"));

    els.overlay?.classList.toggle(
      "has-local-video",
      !!(localVideoTrack && currentCall?.withVideo)
    );
    els.overlay?.classList.toggle(
      "has-remote-video",
      !!(remoteVideoTrack && currentCall?.withVideo)
    );
    els.overlay?.classList.toggle("has-remote-participant", !!remote);

    if (remote) {
      clearTimeout(callTimeout);
      callTimeout = null;
      if (!callStartedAt) startCallTimer();
      const remoteName = currentCall?.peer?.name || remote.user_name || "Connected";
      if (els.callerName) els.callerName.textContent = remoteName;
      if (els.remoteName) els.remoteName.textContent = remoteName;
      if (els.topName) els.topName.textContent = remoteName;
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
    const nextAudioOn = !callObject.localAudio();
    Promise.resolve(callObject.setLocalAudio(nextAudioOn))
      .catch((err) => {
        rememberMediaPermission(
          isPermissionDeniedError(err) ? "denied" : "failed"
        );
        showPermissionNote(getPermissionPromptText(!!currentCall?.withVideo), true);
        notifyCallIssue("error", getMediaErrorMessage(err, false));
      })
      .finally(updateControlButtons);
  }

  function toggleCamera() {
    if (!callObject || !currentCall?.withVideo) return;
    Promise.resolve(callObject.setLocalVideo(!callObject.localVideo()))
      .catch((err) => notifyUser("error", getMediaErrorMessage(err, true)))
      .finally(updateControlButtons);
  }

  async function switchCamera() {
    if (!callObject || !currentCall?.withVideo) return;

    try {
      if (typeof callObject.cycleCamera === "function") {
        await callObject.cycleCamera();
        renderParticipants();
        return;
      }

      const result = await callObject.enumerateDevices?.();
      const devices = Array.isArray(result?.devices) ? result.devices : [];
      const cameras = devices.filter((device) => device.kind === "videoinput");
      if (cameras.length < 2) {
        notifyUser("info", "No other camera is available.");
        return;
      }

      const current = await callObject.getInputDevices?.();
      const currentId = current?.camera?.deviceId || cameras[0].deviceId;
      const currentIndex = cameras.findIndex((device) => device.deviceId === currentId);
      const next = cameras[(currentIndex + 1 + cameras.length) % cameras.length];
      await callObject.setInputDevicesAsync?.({ videoDeviceId: next.deviceId });
      renderParticipants();
    } catch (err) {
      console.warn("Could not switch camera", err);
      notifyUser("info", "Camera switching is not supported on this device.");
    }
  }

  async function toggleSpeaker() {
    if (!callObject) return;

    try {
      if (typeof callObject.setOutputDeviceAsync !== "function") {
        notifyUser("info", "Speaker selection is not supported in this browser.");
        updateDeviceSupport();
        return;
      }

      const result = await callObject.enumerateDevices?.();
      const devices = Array.isArray(result?.devices) ? result.devices : [];
      const outputs = devices.filter((device) => device.kind === "audiooutput");
      if (!outputs.length) {
        notifyUser("info", "Speaker selection is not supported in this browser.");
        updateDeviceSupport();
        return;
      }

      const current = await callObject.getInputDevices?.();
      const currentId = current?.speaker?.deviceId || selectedOutputDeviceId || "default";
      const nonDefault = outputs.find((device) => device.deviceId && device.deviceId !== "default");
      const nextId =
        currentId !== "default" || selectedOutputDeviceId !== "default"
          ? "default"
          : nonDefault?.deviceId || "default";

      await callObject.setOutputDeviceAsync({ outputDeviceId: nextId });
      selectedOutputDeviceId = nextId;
      updateControlButtons();
    } catch (err) {
      console.warn("Could not change speaker", err);
      notifyUser("info", "Speaker selection is not supported in this browser.");
    }
  }

  function updateDeviceSupport() {
    const speakerSupported =
      !!callObject?.setOutputDeviceAsync || typeof remoteAudio?.setSinkId === "function";
    els.btnSpeaker?.classList.toggle("unsupported", !speakerSupported);
    if (els.btnSpeaker) {
      els.btnSpeaker.disabled = false;
      els.btnSpeaker.setAttribute(
        "aria-label",
        speakerSupported ? "Speaker" : "Speaker unavailable"
      );
      els.btnSpeaker.title = speakerSupported ? "Speaker" : "Speaker unavailable";
    }
  }

  function updateControlButtons() {
    updateDeviceSupport();

    if (els.btnMute && callObject?.localAudio) {
      const audioOn = !!callObject.localAudio();
      els.btnMute.classList.toggle("off", !audioOn);
      els.btnMute.setAttribute("aria-pressed", String(!audioOn));
      els.btnMute.setAttribute(
        "aria-label",
        audioOn ? "Mute microphone" : "Unmute microphone"
      );
      els.btnMute.title = audioOn ? "Mute microphone" : "Unmute microphone";
    }

    if (els.btnCam && callObject?.localVideo) {
      const videoOn = !!callObject.localVideo();
      els.btnCam.classList.toggle("off", !videoOn);
      els.btnCam.setAttribute("aria-pressed", String(!videoOn));
      els.btnCam.setAttribute(
        "aria-label",
        videoOn ? "Turn camera off" : "Turn camera on"
      );
      els.btnCam.title = videoOn ? "Turn camera off" : "Turn camera on";
    }

    if (els.btnSpeaker) {
      const speakerAlt = selectedOutputDeviceId !== "default";
      els.btnSpeaker.classList.toggle("off", speakerAlt);
      els.btnSpeaker.setAttribute("aria-pressed", String(speakerAlt));
    }
  }

  async function endCallLocally(reason = "Call ended") {
    const call = currentCall || incomingCall;
    stopRingtone();
    clearTimeout(callTimeout);
    callTimeout = null;

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
    setStatus(reason);
    await cleanupCall();
  }

  async function cleanupCall() {
    isCleaningUp = true;
    stopRingtone();
    stopCallTimer();
    clearTimeout(callTimeout);
    callTimeout = null;
    incomingCall = null;
    currentCall = null;
    isCaller = false;
    selectedOutputDeviceId = "default";

    if (els.localVideo) els.localVideo.srcObject = null;
    if (els.remoteVideo) els.remoteVideo.srcObject = null;
    if (remoteAudio) remoteAudio.srcObject = null;

    if (els.localVideo) els.localVideo.style.display = "none";
    if (els.remoteVideo) els.remoteVideo.style.display = "none";

    await leaveAndDestroyCallObject();
    hideOverlay();
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

  function startCallTimer() {
    stopCallTimer();
    callStartedAt = Date.now();
    updateTimerText();
    timerInterval = setInterval(updateTimerText, 1000);
  }

  function stopCallTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    callStartedAt = 0;
    if (els.timer) els.timer.textContent = "00:00";
  }

  function updateTimerText() {
    if (!els.timer || !callStartedAt) return;
    const seconds = Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000));
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    els.timer.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function startRingtone() {
    stopRingtone();
    els.overlay?.classList.add("is-ringing");

    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;

    try {
      ringContext = new AudioCtor();
      const playPulse = () => {
        if (!ringContext) return;
        ringContext.resume?.().catch(() => {});
        const now = ringContext.currentTime;
        const osc = ringContext.createOscillator();
        const gain = ringContext.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(660, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.045, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
        osc.connect(gain);
        gain.connect(ringContext.destination);
        osc.start(now);
        osc.stop(now + 0.45);
      };
      playPulse();
      ringInterval = setInterval(playPulse, 1500);
    } catch {
      ringContext = null;
    }
  }

  function stopRingtone() {
    els.overlay?.classList.remove("is-ringing");
    if (ringInterval) clearInterval(ringInterval);
    ringInterval = null;
    if (ringContext) {
      ringContext.close?.().catch(() => {});
      ringContext = null;
    }
  }

  function getCallErrorMessage(err, wantsVideo) {
    const message =
      typeof err === "string"
        ? err
        : err?.message || err?.errorMsg || err?.error || "";

    if (/no token|invalid token|session expired|unauthori[sz]ed|forbidden|not logged in|login/i.test(message)) {
      return "Your login session is not active. Please sign in again and retry the call.";
    }

    if (
      /offline|not configured|not found|expired|invalid|network|library|provider|server|token|auth|session/i.test(message)
    ) {
      return message;
    }

    return getMediaErrorMessage(err, wantsVideo);
  }

  function getPeerJoinFailureMessage(reason) {
    const safeReason = String(reason || "").trim();
    return safeReason
      ? `Receiver could not join: ${safeReason}`
      : "Receiver could not join the call.";
  }

  function isMediaDailyError(event) {
    const text =
      typeof event === "string"
        ? event
        : [
            event?.action,
            event?.error,
            event?.errorMsg,
            event?.message,
            event?.type,
          ]
            .filter(Boolean)
            .join(" ");

    return /camera|microphone|permission|notallowed|notfound|device|getusermedia|media/i.test(
      text
    );
  }

  function getInitial(name) {
    return (name || "U").charAt(0).toUpperCase();
  }

  return {
    init,
    startCall,
    endCall: endCallLocally,
    getStoredMediaPermission,
  };
})();

window.CallClient = CallClient;

window.debugCallStatus = function() {
  return {
    backend: typeof getBackendBaseUrl === "function" ? getBackendBaseUrl() : null,
    socketConnected: typeof SocketClient !== "undefined" ? SocketClient.isConnected() : false,
    socketId: typeof SocketClient !== "undefined" ? SocketClient.getSocket()?.id : null,
    userId: typeof SocketClient !== "undefined" ? SocketClient.getUserId() : null,
    secureContext: window.isSecureContext,
    hasMediaDevices: !!navigator.mediaDevices?.getUserMedia,
    callingLibraryLoaded: !!window.DailyIframe,
    storedMediaPermission: CallClient.getStoredMediaPermission?.(),
    dailySupported:
      typeof window.DailyIframe?.supportedBrowser === "function"
        ? window.DailyIframe.supportedBrowser()
        : null,
  };
};

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => {
    CallClient.init();
  });
} else {
  CallClient.init();
}
