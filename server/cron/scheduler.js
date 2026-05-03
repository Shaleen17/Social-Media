const crypto = require("crypto");
const CronJobState = require("../models/CronJobState");
const { log } = require("../utils/logger");

const jobs = [
  require("./jobs/refreshDiscoverySnapshots"),
  require("./jobs/notificationMaintenance"),
  require("./jobs/cleanupAuthAndMessages"),
  require("./jobs/reconcileDonations"),
  require("./jobs/processEmailCampaignQueue"),
];

const jobsByName = new Map(jobs.map((job) => [job.name, job]));
let inlineSchedulerTimer = null;
let inlineSchedulerLastRun = new Map();

function isCronGloballyEnabled() {
  return String(process.env.CRON_JOBS_ENABLED || "true").toLowerCase() !== "false";
}

function isJobEnabled(job) {
  if (!isCronGloballyEnabled()) return false;
  if (!job?.enabledEnvVar) return true;
  return String(process.env[job.enabledEnvVar] || "true").toLowerCase() !== "false";
}

function normalizeSummary(summary) {
  if (!summary || typeof summary !== "object") return summary;
  try {
    return JSON.parse(JSON.stringify(summary));
  } catch {
    return { note: "summary_not_serializable" };
  }
}

async function ensureStateDocument(jobName) {
  await CronJobState.updateOne(
    { name: jobName },
    { $setOnInsert: { name: jobName } },
    { upsert: true }
  );
}

async function acquireJobLock(job, trigger = "manual") {
  await ensureStateDocument(job.name);

  const now = new Date();
  const lockToken = crypto.randomUUID();
  const lockedUntil = new Date(
    now.getTime() + Math.max(30 * 1000, Number(job.lockTtlMs) || 5 * 60 * 1000)
  );

  const state = await CronJobState.findOneAndUpdate(
    {
      name: job.name,
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
    },
    {
      $set: {
        running: true,
        lockToken,
        lockedAt: now,
        lockedUntil,
        lastStatus: "running",
        lastTrigger: trigger,
        lastStartedAt: now,
        lastFinishedAt: null,
        lastDurationMs: 0,
        lastError: "",
        lastSummary: {},
      },
      $inc: { runCount: 1 },
    },
    { new: true }
  );

  return state ? { lockToken, state } : null;
}

async function finishJobLock(job, lockToken, payload = {}) {
  const now = new Date();
  const durationMs = Math.max(
    0,
    payload.startedAt ? now.getTime() - new Date(payload.startedAt).getTime() : 0
  );

  const update = {
    $set: {
      running: false,
      lockToken: null,
      lockedAt: null,
      lockedUntil: null,
      lastStatus: payload.status || "success",
      lastFinishedAt: now,
      lastDurationMs: durationMs,
      lastSummary: normalizeSummary(payload.summary) || {},
      lastError: payload.error || "",
    },
  };

  if (payload.status === "success") {
    update.$inc = { successCount: 1 };
  } else if (payload.status === "error") {
    update.$inc = { failureCount: 1 };
  }

  await CronJobState.updateOne(
    { name: job.name, lockToken },
    update
  );
}

function getCronJobsCatalog() {
  return jobs.map((job) => ({
    name: job.name,
    description: job.description,
    scheduleHint: job.scheduleHint || "",
    enabled: isJobEnabled(job),
    enabledEnvVar: job.enabledEnvVar || "",
    lockTtlMs: Math.max(30 * 1000, Number(job.lockTtlMs) || 5 * 60 * 1000),
    retryCount: Math.max(0, Number(job.retryCount) || 0),
  }));
}

async function getCronJobsOverview() {
  const states = await CronJobState.find({
    name: { $in: jobs.map((job) => job.name) },
  }).lean();
  const stateMap = new Map(states.map((state) => [state.name, state]));

  return getCronJobsCatalog().map((job) => ({
    ...job,
    state: stateMap.get(job.name) || null,
  }));
}

async function runCronJob(name, options = {}) {
  const job = jobsByName.get(name);
  if (!job) {
    return {
      name,
      status: "error",
      error: `Unknown cron job "${name}"`,
    };
  }

  if (!isJobEnabled(job)) {
    return {
      name,
      status: "skipped",
      reason: "job_disabled",
    };
  }

  const trigger = options.trigger || "manual";
  const lock = await acquireJobLock(job, trigger);
  if (!lock) {
    return {
      name,
      status: "skipped",
      reason: "job_locked",
    };
  }

  const startedAt = new Date();
  const maxAttempts = Math.max(1, Number(job.retryCount) || 0) + 1;
  let lastError = null;

  log("info", "Cron job started", {
    job: job.name,
    trigger,
    attempts: maxAttempts,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const summary = await job.run({
        attempt,
        trigger,
        startedAt,
      });

      await finishJobLock(job, lock.lockToken, {
        status: "success",
        summary,
        startedAt,
      });

      log("info", "Cron job completed", {
        job: job.name,
        trigger,
        attempt,
      });

      return {
        name: job.name,
        status: "success",
        summary,
      };
    } catch (error) {
      lastError = error;
      log("warn", "Cron job attempt failed", {
        job: job.name,
        trigger,
        attempt,
        error: error.message,
      });
    }
  }

  await finishJobLock(job, lock.lockToken, {
    status: "error",
    error: lastError?.message || "Cron job failed",
    startedAt,
  });

  return {
    name: job.name,
    status: "error",
    error: lastError?.message || "Cron job failed",
  };
}

async function runCronJobs(names = [], options = {}) {
  const requestedNames = Array.isArray(names) && names.length
    ? names
    : jobs.map((job) => job.name);
  const results = [];

  for (const jobName of requestedNames) {
    // Sequential execution keeps background load predictable.
    results.push(await runCronJob(jobName, options));
  }

  return {
    results,
    ok: results.every((item) => item.status !== "error"),
  };
}

function startInlineCronScheduler() {
  const enabled =
    !process.env.VERCEL &&
    String(process.env.CRON_INLINE_SCHEDULER_ENABLED || "false").toLowerCase() ===
      "true";

  if (!enabled || inlineSchedulerTimer) {
    return false;
  }

  const pollMs = Math.max(
    60 * 1000,
    Number(process.env.CRON_INLINE_SCHEDULER_POLL_MS) || 60 * 1000
  );

  inlineSchedulerTimer = setInterval(() => {
    jobs.forEach((job) => {
      if (!isJobEnabled(job)) return;
      const scheduleMs = Math.max(
        pollMs,
        Number(job.inlineIntervalMs || pollMs)
      );
      const lastRunAt = inlineSchedulerLastRun.get(job.name) || 0;
      if (Date.now() - lastRunAt < scheduleMs) {
        return;
      }

      inlineSchedulerLastRun.set(job.name, Date.now());
      runCronJob(job.name, {
        trigger: "inline-scheduler",
      }).catch(() => {});
    });
  }, pollMs);

  if (typeof inlineSchedulerTimer.unref === "function") {
    inlineSchedulerTimer.unref();
  }

  return true;
}

function stopInlineCronScheduler() {
  if (inlineSchedulerTimer) {
    clearInterval(inlineSchedulerTimer);
    inlineSchedulerTimer = null;
    inlineSchedulerLastRun = new Map();
  }
}

module.exports = {
  getCronJobsCatalog,
  getCronJobsOverview,
  runCronJob,
  runCronJobs,
  startInlineCronScheduler,
  stopInlineCronScheduler,
};
