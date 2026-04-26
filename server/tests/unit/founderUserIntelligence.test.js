const assert = require("node:assert/strict");
const { test } = require("../helpers/harness");

const {
  __testables: {
    buildInterestProfile,
    buildPredictions,
    buildSegmentTags,
    computeEngagementScore,
    detectFriction,
    detectPatterns,
  },
} = require("../../services/founderUserIntelligenceService");

function makeEvent({
  name = "virtual_page_view",
  type = "interaction",
  page = "home",
  createdAt = "2026-04-26T06:00:00.000Z",
  meta = {},
} = {}) {
  return {
    name,
    type,
    page,
    createdAt,
    meta,
  };
}

test("founder user intelligence scores engaged users higher", () => {
  const engaged = computeEngagementScore({
    sessions: [{ durationMinutes: 18 }, { durationMinutes: 24 }],
    events: [
      makeEvent({ name: "post_created", createdAt: "2026-04-25T06:00:00.000Z" }),
      makeEvent({ name: "video_completed", createdAt: "2026-04-25T06:10:00.000Z" }),
      makeEvent({ name: "chat_message_sent", createdAt: "2026-04-26T06:12:00.000Z" }),
      makeEvent({ name: "post_commented", createdAt: "2026-04-26T06:16:00.000Z" }),
    ],
    messageCount: 4,
    authoredPosts: 2,
    authoredVideos: 1,
  });

  const passive = computeEngagementScore({
    sessions: [{ durationMinutes: 2 }],
    events: [makeEvent({ type: "page_view", createdAt: "2026-04-26T06:00:00.000Z" })],
  });

  assert.ok(engaged.score > passive.score);
  assert.match(engaged.label, /high devotion user|steady seeker/i);
});

test("founder user intelligence infers content interests and behavior", () => {
  const profile = buildInterestProfile({
    events: [
      makeEvent({
        name: "video_started",
        page: "video",
        meta: { videoCategory: "Bhajan", videoTitle: "Morning Bhajan" },
      }),
      makeEvent({ name: "chat_message_sent", page: "chats" }),
      makeEvent({ name: "video_completed", page: "video", meta: { videoCategory: "Bhajan" } }),
    ],
    authoredPosts: [{ hashtags: ["#temple", "#dharma"], text: "Temple darshan" }],
    authoredVideos: [],
  });

  assert.equal(profile.topInterests[0].key, "bhajan");
  assert.match(profile.behaviorType, /social engager|spiritual explorer/i);
});

test("founder user intelligence detects friction and patterns", () => {
  const events = [
    makeEvent({ name: "video_started", page: "video", createdAt: "2026-04-26T06:00:00.000Z" }),
    makeEvent({ name: "video_started", page: "video", createdAt: "2026-04-26T06:10:00.000Z" }),
    makeEvent({ name: "chat_opened", page: "chats", createdAt: "2026-04-26T06:12:00.000Z" }),
    makeEvent({ name: "chat_opened", page: "chats", createdAt: "2026-04-26T06:14:00.000Z" }),
    makeEvent({ name: "chat_opened", page: "chats", createdAt: "2026-04-26T06:16:00.000Z" }),
  ];
  const sessions = [
    {
      startedAt: "2026-04-26T06:00:00.000Z",
      durationMinutes: 6,
      steps: [
        { page: "home", enteredAt: "2026-04-26T06:00:00.000Z", endedAt: "2026-04-26T06:00:05.000Z" },
        { page: "video", enteredAt: "2026-04-26T06:00:05.000Z", endedAt: "2026-04-26T06:00:10.000Z" },
      ],
    },
    {
      startedAt: "2026-04-26T18:00:00.000Z",
      durationMinutes: 8,
      steps: [
        { page: "home", enteredAt: "2026-04-26T18:00:00.000Z", endedAt: "2026-04-26T18:00:30.000Z" },
        { page: "video", enteredAt: "2026-04-26T18:00:30.000Z", endedAt: "2026-04-26T18:01:00.000Z" },
      ],
    },
  ];

  const friction = detectFriction({ events, sessions });
  const patterns = detectPatterns({ events, sessions });

  assert.ok(friction.length >= 1);
  assert.match(friction.join(" "), /video|chat|home/i);
  assert.match(patterns.peakUsageLabel, /:00 habit|no clear habit/i);
});

test("founder user intelligence builds tags and predictions from live state", () => {
  const segmentTags = buildSegmentTags({
    interestProfile: {
      topInterests: [{ key: "bhajan", label: "Bhajan Oriented", score: 8 }],
      behaviorType: "Silent observer",
    },
    engagement: { score: 78 },
    friction: [],
    messageCount: 4,
    authoredPosts: 2,
  });

  const predictions = buildPredictions({
    liveState: { currentPage: "home", currentPageLabel: "Home" },
    interestProfile: { topInterests: [{ label: "Bhajan Oriented" }] },
    friction: [],
    patterns: { repeatTransition: { label: "Home -> Tirth Tube", count: 3 } },
    engagement: { score: 78 },
  });

  assert.ok(segmentTags.includes("Devotional User"));
  assert.ok(segmentTags.includes("Social Engager"));
  assert.ok(predictions.length >= 2);
  assert.match(predictions.join(" "), /bhajan|home -> tirth tube/i);
});
