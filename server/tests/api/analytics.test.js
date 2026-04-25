const assert = require("node:assert/strict");
const express = require("express");
const { test } = require("../helpers/harness");

const AnalyticsEvent = require("../../models/AnalyticsEvent");
const analyticsRouter = require("../../routes/analytics");
const { close, listen, request } = require("../helpers/http");

test("analytics api accepts sanitized events", async (t) => {
  const originalCreate = AnalyticsEvent.create;
  const created = [];
  AnalyticsEvent.create = async (payload) => {
    created.push(payload);
    return payload;
  };
  t.after(() => {
    AnalyticsEvent.create = originalCreate;
  });

  const app = express();
  app.use(express.json());
  app.use("/analytics", analyticsRouter);
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({ error: err.message, details: err.details });
  });

  const { server, baseUrl } = await listen(app);
  t.after(() => close(server));

  const response = await request(baseUrl, {
    path: "/analytics/events",
    method: "POST",
    body: {
      type: "interaction",
      name: "cta_clicked",
      page: "home",
      path: "/",
      sessionId: "sess_123",
      anonymousId: "anon_456",
      meta: {
        label: "<b>Join now</b>",
        nested: {
          detail: "<script>bad()</script>clean",
        },
      },
    },
  });

  assert.equal(response.status, 202);
  assert.equal(created.length, 1);
  assert.equal(created[0].type, "interaction");
  assert.equal(created[0].name, "cta_clicked");
  assert.equal(created[0].meta.label, "Join now");
  assert.equal(created[0].meta.nested.detail, "clean");
});

test("analytics api rejects unsupported event types", async (t) => {
  const app = express();
  app.use(express.json());
  app.use("/analytics", analyticsRouter);
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });

  const { server, baseUrl } = await listen(app);
  t.after(() => close(server));

  const response = await request(baseUrl, {
    path: "/analytics/events",
    method: "POST",
    body: {
      type: "debug",
      name: "invalid_event",
    },
  });

  assert.equal(response.status, 400);
  assert.match(response.text, /unsupported analytics event type/i);
});
