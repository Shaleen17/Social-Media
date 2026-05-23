const crypto = require("crypto");
const mongoose = require("mongoose");
const CallSession = require("../models/CallSession");
const AppError = require("../utils/appError");
const { log } = require("../utils/logger");

const DAILY_API_BASE = "https://api.daily.co/v1";
const CALL_TTL_SECONDS = Math.max(
  300,
  Number(process.env.DAILY_CALL_TTL_SECONDS || 3600)
);
const SESSION_RETENTION_MS = Math.max(5 * 60 * 1000, CALL_TTL_SECONDS * 1000);
const activeCallSessions = new Map();

function normalizeDailyDomain(value = "") {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function getDailyConfig() {
  return {
    apiKey: process.env.DAILY_API_KEY || "",
    domain: normalizeDailyDomain(process.env.DAILY_DOMAIN || ""),
  };
}

function isDailyConfigured() {
  const config = getDailyConfig();
  return !!(config.apiKey && config.domain);
}

function getDailyPublicConfig() {
  const config = getDailyConfig();
  return {
    configured: isDailyConfigured(),
    domain: config.domain || null,
    provider: "daily",
    sessionStore: isCallSessionStoreReady() ? "mongodb" : "memory",
  };
}

function assertDailyConfigured() {
  if (!isDailyConfigured()) {
    throw new AppError("Calling is not configured on the server.", 503);
  }
}

async function dailyRequest(path, body) {
  assertDailyConfigured();
  const { apiKey } = getDailyConfig();

  let response;
  try {
    response = await fetch(`${DAILY_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
    });
  } catch (networkErr) {
    log("error", "Daily API network error", {
      path,
      error: networkErr.message,
    });
    throw new AppError("Calling provider is unreachable.", 502, {
      providerError: networkErr.message,
    });
  }

  let data = {};
  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    log("error", "Daily API error response", {
      path,
      providerStatus: response.status,
      providerError: data?.error || data?.info || JSON.stringify(data),
    });
    throw new AppError("Calling provider request failed.", 502, {
      providerStatus: response.status,
      providerError: data?.error || data?.info || null,
    });
  }

  return data;
}

function getParticipantId(user) {
  return (user?._id || user?.id || user || "").toString();
}

function getParticipantName(user) {
  return user?.name || "User";
}

function getParticipantAvatar(user) {
  return user?.avatar || user?.profilePic || "";
}

function isCallSessionStoreReady() {
  return mongoose.connection.readyState === 1;
}

function rememberCallSession(session) {
  if (!session?.callId) return session;
  activeCallSessions.set(session.callId, session);
  return session;
}

function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function hydrateCallSession(rawSession) {
  if (!rawSession) return null;
  const session =
    typeof rawSession.toObject === "function"
      ? rawSession.toObject()
      : rawSession;
  const expiresAt = session.expiresAt instanceof Date
    ? session.expiresAt
    : new Date(session.expiresAt);
  if (!Number.isFinite(expiresAt.getTime())) return null;

  return {
    callId: String(session.callId || ""),
    roomName: String(session.roomName || ""),
    roomUrl: String(session.roomUrl || ""),
    callerId: String(session.callerId || ""),
    targetId: String(session.targetId || ""),
    withVideo: !!session.withVideo,
    status: session.status || "ringing",
    createdAt: toIsoString(session.createdAt || new Date()),
    expiresAt: expiresAt.toISOString(),
    expiresAtMs: expiresAt.getTime(),
  };
}

function serializeCallSession(session) {
  return {
    callId: session.callId,
    roomName: session.roomName,
    roomUrl: session.roomUrl,
    callerId: session.callerId,
    targetId: session.targetId,
    withVideo: !!session.withVideo,
    status: session.status || "ringing",
    createdAt: new Date(session.createdAt),
    expiresAt: new Date(session.expiresAt),
  };
}

async function persistCallSession(session) {
  if (!isCallSessionStoreReady()) return false;

  try {
    await CallSession.findOneAndUpdate(
      { callId: session.callId },
      { $set: serializeCallSession(session) },
      { upsert: true, setDefaultsOnInsert: true }
    );
    return true;
  } catch (error) {
    log("warn", "Call session persistence failed", {
      callId: session.callId,
      error: error.message,
    });
    return false;
  }
}

async function updatePersistedCallStatus(callId, status) {
  if (!isCallSessionStoreReady()) return false;

  try {
    await CallSession.updateOne(
      { callId: String(callId || "") },
      { $set: { status } }
    );
    return true;
  } catch (error) {
    log("warn", "Call session status update failed", {
      callId: String(callId || ""),
      status,
      error: error.message,
    });
    return false;
  }
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [callId, session] of activeCallSessions) {
    if (
      session.status === "ended" ||
      now > session.expiresAtMs + SESSION_RETENTION_MS
    ) {
      activeCallSessions.delete(callId);
    }
  }
}

async function createCallSession({ caller, target, room, withVideo }) {
  pruneExpiredSessions();

  const callId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CALL_TTL_SECONDS * 1000);
  const session = {
    callId,
    roomName: room.name || room.roomName,
    roomUrl: room.url,
    callerId: getParticipantId(caller),
    targetId: getParticipantId(target),
    withVideo: !!withVideo,
    status: "ringing",
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    expiresAtMs: expiresAt.getTime(),
  };

  rememberCallSession(session);
  await persistCallSession(session);
  return session;
}

async function getCallSession(callId) {
  pruneExpiredSessions();
  const safeCallId = String(callId || "");
  const session = activeCallSessions.get(safeCallId);
  if (session && Date.now() <= session.expiresAtMs) {
    return session;
  }

  if (!isCallSessionStoreReady()) {
    return null;
  }

  try {
    const persistedSession = await CallSession.findOne({
      callId: safeCallId,
      expiresAt: { $gt: new Date() },
      status: { $ne: "ended" },
    }).lean();
    const hydratedSession = hydrateCallSession(persistedSession);
    if (!hydratedSession) return null;
    rememberCallSession(hydratedSession);
    return hydratedSession;
  } catch (error) {
    log("warn", "Call session lookup failed", {
      callId: safeCallId,
      error: error.message,
    });
    return null;
  }
}

function assertCallParticipant(session, userId) {
  const uid = String(userId || "");
  if (!session || (session.callerId !== uid && session.targetId !== uid)) {
    throw new AppError("Call session not found.", 404);
  }
}

function getOtherParticipantId(session, userId) {
  const uid = String(userId || "");
  return uid === session.callerId ? session.targetId : session.callerId;
}

async function createDailyRoom(roomName, withVideo) {
  const roomExp = Math.floor(Date.now() / 1000) + CALL_TTL_SECONDS;
  return dailyRequest("/rooms", {
    name: roomName,
    privacy: "private",
    properties: {
      exp: roomExp,
      eject_at_room_exp: true,
      enable_prejoin_ui: false,
      enable_network_ui: false,
      enable_chat: false,
      start_video_off: !withVideo,
      start_audio_off: false,
    },
  });
}

async function createDailyMeetingToken({ roomName, user, withVideo }) {
  const tokenExp = Math.floor(Date.now() / 1000) + CALL_TTL_SECONDS;
  const userId = getParticipantId(user);
  const token = await dailyRequest("/meeting-tokens", {
    properties: {
      room_name: roomName,
      user_id: userId,
      user_name: getParticipantName(user),
      exp: tokenExp,
      is_owner: false,
      enable_screenshare: false,
      start_video_off: !withVideo,
      start_audio_off: false,
    },
  });

  return token.token;
}

async function markCallAccepted(callId) {
  const session = await getCallSession(callId);
  if (session) session.status = "accepted";
  if (session) {
    rememberCallSession(session);
    await updatePersistedCallStatus(callId, "accepted");
  }
  return session;
}

async function markCallEnded(callId) {
  const session = await getCallSession(callId);
  if (session) session.status = "ended";
  if (session) {
    rememberCallSession(session);
    await updatePersistedCallStatus(callId, "ended");
  }
  return session;
}

module.exports = {
  CALL_TTL_SECONDS,
  activeCallSessions,
  assertCallParticipant,
  createCallSession,
  createDailyMeetingToken,
  createDailyRoom,
  getCallSession,
  getDailyPublicConfig,
  getOtherParticipantId,
  getParticipantAvatar,
  getParticipantId,
  getParticipantName,
  isCallSessionStoreReady,
  isDailyConfigured,
  markCallAccepted,
  markCallEnded,
};
