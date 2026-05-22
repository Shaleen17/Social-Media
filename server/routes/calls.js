const express = require("express");
const crypto = require("crypto");
const User = require("../models/User");
const { auth } = require("../middleware/auth");
const AppError = require("../utils/appError");
const {
  assertObjectId,
  cleanString,
} = require("../utils/validation");
const {
  CALL_TTL_SECONDS,
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
  markCallAccepted,
  markCallEnded,
} = require("../services/dailyCallService");

const router = express.Router();

function getSocketState(req) {
  return req.app.get("socketState");
}

async function isUserOnline(req, userId) {
  const socketState = getSocketState(req);
  if (!socketState?.isOnline) return false;
  try {
    return await socketState.isOnline(userId);
  } catch {
    return false;
  }
}

function emitToUser(req, userId, eventName, payload) {
  const io = req.app.get("io");
  if (!io || !userId) return;
  io.to(userId.toString()).emit(eventName, payload);
}

function safeCallPayload(session, user) {
  return {
    callId: session.callId,
    roomName: session.roomName,
    roomUrl: session.roomUrl,
    withVideo: !!session.withVideo,
    expiresAt: session.expiresAt,
    ttlSeconds: CALL_TTL_SECONDS,
    from: {
      id: getParticipantId(user),
      name: getParticipantName(user),
      avatar: getParticipantAvatar(user),
    },
  };
}

router.get("/daily/health", (req, res) => {
  res.json({
    status: "ok",
    ...getDailyPublicConfig(),
  });
});

router.post("/daily/start", auth, async (req, res, next) => {
  try {
    const caller = req.user;
    const targetUserId = cleanString(req.body?.targetUserId, {
      field: "Target user id",
      max: 80,
      required: true,
    });
    assertObjectId(targetUserId, "Target user id");

    const callerId = getParticipantId(caller);
    if (targetUserId === callerId) {
      throw new AppError("You cannot call yourself.", 400);
    }

    const target = await User.findById(targetUserId).select(
      "name avatar profilePic accountStatus"
    );
    if (!target || target.accountStatus === "deleted") {
      throw new AppError("User is not available.", 404);
    }

    const targetOnline = await isUserOnline(req, targetUserId);

    const withVideo = req.body?.withVideo !== false;
    const roomName = `ts-call-${crypto.randomUUID()}`;
    const room = await createDailyRoom(roomName, withVideo);
    const createdRoomName = room.name || roomName;
    const token = await createDailyMeetingToken({
      roomName: createdRoomName,
      user: caller,
      withVideo,
    });
    const session = await createCallSession({
      caller,
      target,
      room: { ...room, name: createdRoomName },
      withVideo,
    });

    emitToUser(req, targetUserId, "daily:call:incoming", safeCallPayload(session, caller));

    res.json({
      callId: session.callId,
      roomName: session.roomName,
      roomUrl: session.roomUrl,
      token,
      withVideo: session.withVideo,
      expiresAt: session.expiresAt,
      targetOnline,
      target: {
        id: getParticipantId(target),
        name: getParticipantName(target),
        avatar: getParticipantAvatar(target),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/daily/token", auth, async (req, res, next) => {
  try {
    const callId = cleanString(req.body?.callId, {
      field: "Call id",
      max: 80,
      required: true,
    });
    const session = await getCallSession(callId);
    assertCallParticipant(session, getParticipantId(req.user));

    const token = await createDailyMeetingToken({
      roomName: session.roomName,
      user: req.user,
      withVideo: session.withVideo,
    });

    await markCallAccepted(callId);
    const otherUserId = getOtherParticipantId(session, getParticipantId(req.user));
    emitToUser(req, otherUserId, "daily:call:accepted", {
      callId: session.callId,
      by: getParticipantId(req.user),
    });

    res.json({
      callId: session.callId,
      roomName: session.roomName,
      roomUrl: session.roomUrl,
      token,
      withVideo: session.withVideo,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/daily/end", auth, async (req, res, next) => {
  try {
    const callId = cleanString(req.body?.callId, {
      field: "Call id",
      max: 80,
      required: true,
    });
    const reason = cleanString(req.body?.reason || "Call ended", {
      field: "Reason",
      max: 120,
    });
    const session = await getCallSession(callId);
    assertCallParticipant(session, getParticipantId(req.user));

    await markCallEnded(callId);
    const otherUserId = getOtherParticipantId(session, getParticipantId(req.user));
    emitToUser(req, otherUserId, "daily:call:ended", {
      callId: session.callId,
      reason,
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
