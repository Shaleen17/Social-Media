const crypto = require("crypto");
const AppError = require("../utils/appError");

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
  const response = await fetch(`${DAILY_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    throw new AppError("Calling provider request failed.", 502, {
      providerStatus: response.status,
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

function createCallSession({ caller, target, room, withVideo }) {
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

  activeCallSessions.set(callId, session);
  return session;
}

function getCallSession(callId) {
  pruneExpiredSessions();
  const session = activeCallSessions.get(String(callId || ""));
  if (!session || Date.now() > session.expiresAtMs) {
    return null;
  }
  return session;
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

function markCallAccepted(callId) {
  const session = getCallSession(callId);
  if (session) session.status = "accepted";
  return session;
}

function markCallEnded(callId) {
  const session = getCallSession(callId);
  if (session) session.status = "ended";
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
  isDailyConfigured,
  markCallAccepted,
  markCallEnded,
};
