const assert = require("node:assert/strict");
const { test } = require("../helpers/harness");

const {
  activeCallSessions,
  createCallSession,
  getCallSession,
  markCallAccepted,
  markCallEnded,
} = require("../../services/dailyCallService");

test("daily call sessions remain available through the async session API", async () => {
  activeCallSessions.clear();

  const session = await createCallSession({
    caller: { _id: "caller1", name: "Caller" },
    target: { _id: "target1", name: "Target" },
    room: {
      name: "test-room",
      url: "https://example.daily.co/test-room",
    },
    withVideo: true,
  });

  const fetched = await getCallSession(session.callId);
  assert.equal(fetched.callId, session.callId);
  assert.equal(fetched.callerId, "caller1");
  assert.equal(fetched.targetId, "target1");
  assert.equal(fetched.withVideo, true);
  assert.equal(fetched.status, "ringing");

  await markCallAccepted(session.callId);
  assert.equal((await getCallSession(session.callId)).status, "accepted");

  const ended = await markCallEnded(session.callId);
  assert.equal(ended.status, "ended");
  assert.equal(await getCallSession(session.callId), null);

  activeCallSessions.clear();
});
