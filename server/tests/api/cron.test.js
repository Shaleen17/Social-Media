const assert = require("node:assert/strict");
const express = require("express");
const { test } = require("../helpers/harness");
const { close, listen, request } = require("../helpers/http");

const cronScheduler = require("../../cron/scheduler");
const cronRouter = require("../../routes/cron");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/cron", cronRouter);
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({
      error: err.message,
      details: err.details,
    });
  });
  return app;
}

test("cron api rejects requests without the cron secret", async (t) => {
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-cron-secret";
  t.after(() => {
    process.env.CRON_SECRET = previousSecret;
  });

  const { server, baseUrl } = await listen(createApp());
  t.after(() => close(server));

  const response = await request(baseUrl, {
    path: "/cron/status",
  });

  assert.equal(response.status, 403);
  assert.match(response.text, /not authorized/i);
});

test("cron api returns job overview for authorized requests", async (t) => {
  const previousSecret = process.env.CRON_SECRET;
  const originalGetCronJobsOverview = cronScheduler.getCronJobsOverview;
  process.env.CRON_SECRET = "test-cron-secret";
  cronScheduler.getCronJobsOverview = async () => [
    {
      name: "refresh-discovery-snapshots",
      enabled: true,
      scheduleHint: "*/5 * * * *",
    },
  ];

  t.after(() => {
    process.env.CRON_SECRET = previousSecret;
    cronScheduler.getCronJobsOverview = originalGetCronJobsOverview;
  });

  const { server, baseUrl } = await listen(createApp());
  t.after(() => close(server));

  const response = await request(baseUrl, {
    path: "/cron/status",
    headers: {
      "x-cron-secret": "test-cron-secret",
    },
  });

  assert.equal(response.status, 200);
  const payload = response.json();
  assert.equal(payload.jobs.length, 1);
  assert.equal(payload.jobs[0].name, "refresh-discovery-snapshots");
});

test("cron api dispatches requested jobs with the protected trigger context", async (t) => {
  const previousSecret = process.env.CRON_SECRET;
  const originalRunCronJobs = cronScheduler.runCronJobs;
  let capturedNames = null;
  let capturedOptions = null;

  process.env.CRON_SECRET = "test-cron-secret";
  cronScheduler.runCronJobs = async (names, options) => {
    capturedNames = names;
    capturedOptions = options;
    return {
      ok: true,
      results: [{ name: names[0], status: "success" }],
    };
  };

  t.after(() => {
    process.env.CRON_SECRET = previousSecret;
    cronScheduler.runCronJobs = originalRunCronJobs;
  });

  const { server, baseUrl } = await listen(createApp());
  t.after(() => close(server));

  const response = await request(baseUrl, {
    path: "/cron/run/refresh-discovery-snapshots",
    method: "POST",
    headers: {
      "x-cron-secret": "test-cron-secret",
      "x-cron-trigger": "render-cron",
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(capturedNames, ["refresh-discovery-snapshots"]);
  assert.deepEqual(capturedOptions, { trigger: "render-cron" });
});

test("cron api surfaces job failures with a 500 response", async (t) => {
  const previousSecret = process.env.CRON_SECRET;
  const originalRunCronJobs = cronScheduler.runCronJobs;

  process.env.CRON_SECRET = "test-cron-secret";
  cronScheduler.runCronJobs = async () => ({
    ok: false,
    results: [{ name: "reconcile-donations", status: "error", error: "boom" }],
  });

  t.after(() => {
    process.env.CRON_SECRET = previousSecret;
    cronScheduler.runCronJobs = originalRunCronJobs;
  });

  const { server, baseUrl } = await listen(createApp());
  t.after(() => close(server));

  const response = await request(baseUrl, {
    path: "/cron/run/reconcile-donations",
    method: "POST",
    headers: {
      authorization: "Bearer test-cron-secret",
    },
  });

  assert.equal(response.status, 500);
  const payload = response.json();
  assert.equal(payload.results[0].status, "error");
});
