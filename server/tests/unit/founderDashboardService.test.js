const assert = require("node:assert/strict");
const { test } = require("../helpers/harness");

const {
  __testables: {
    buildAnomalies,
    buildFounderBadge,
    buildFunnelSnapshot,
    buildSessionEventMap,
    normalizeFunnelSteps,
  },
} = require("../../services/founderDashboardService");

function makeEvent({
  type = "interaction",
  name = "virtual_page_view",
  page = "home",
  createdAt,
  meta = {},
  sessionId = "sess-1",
} = {}) {
  return {
    type,
    name,
    page,
    createdAt,
    meta,
    sessionId,
  };
}

test("founder dashboard normalizes funnel steps and computes completion", () => {
  const events = [
    makeEvent({
      type: "page_view",
      name: "initial_page_view",
      page: "home",
      createdAt: "2026-04-29T08:00:00.000Z",
      sessionId: "a",
    }),
    makeEvent({
      type: "page_view",
      name: "virtual_page_view",
      page: "video",
      createdAt: "2026-04-29T08:01:00.000Z",
      sessionId: "a",
    }),
    makeEvent({
      name: "video_started",
      page: "video",
      createdAt: "2026-04-29T08:02:00.000Z",
      sessionId: "a",
    }),
    makeEvent({
      name: "video_completed",
      page: "video",
      createdAt: "2026-04-29T08:06:00.000Z",
      sessionId: "a",
    }),
  ];

  const steps = normalizeFunnelSteps(["home", "tirth_tube", "video_started", "video_completed"]);
  const funnel = buildFunnelSnapshot({
    sessionEventMap: buildSessionEventMap(events),
    steps,
    label: "Watch funnel",
  });

  assert.equal(funnel.totalSessions, 1);
  assert.equal(funnel.completionCount, 1);
  assert.equal(funnel.steps[0].label, "Home");
});

test("founder dashboard raises anomalies from recent error and exit spikes", () => {
  const now = Date.now();
  const recentEvents = [
    makeEvent({
      type: "error",
      name: "client_error",
      createdAt: new Date(now - 2 * 60 * 1000).toISOString(),
      sessionId: "e1",
    }),
    makeEvent({
      type: "error",
      name: "client_error",
      createdAt: new Date(now - 3 * 60 * 1000).toISOString(),
      sessionId: "e2",
    }),
    makeEvent({
      name: "session_exit",
      createdAt: new Date(now - 4 * 60 * 1000).toISOString(),
      sessionId: "e3",
    }),
    makeEvent({
      name: "session_exit",
      createdAt: new Date(now - 5 * 60 * 1000).toISOString(),
      sessionId: "e4",
    }),
    makeEvent({
      name: "session_exit",
      createdAt: new Date(now - 6 * 60 * 1000).toISOString(),
      sessionId: "e5",
    }),
  ];

  const anomalies = buildAnomalies({
    recentEvents,
    live: { activeSessions: 1, activePeople: 1, visitorsToday: 2 },
    health: { avgLcpMs: 2800 },
    pageAnalytics: {},
    journey: {},
  });

  assert.ok(anomalies.length >= 1);
});

test("founder dashboard badge reflects alert pressure", () => {
  const badge = buildFounderBadge({
    live: { activePeople: 12 },
    anomalies: [
      { severity: "high", title: "Error pulse" },
      { severity: "watch", title: "Drop-off spike" },
    ],
    trending: { hashtags: [{ tag: "#GangaAarti", count: 8 }] },
    decisionEngine: [],
  });

  assert.equal(badge.activeUsers, 12);
  assert.equal(badge.highAlertCount, 1);
  assert.equal(badge.status, "alert");
});
