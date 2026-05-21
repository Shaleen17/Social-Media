const crypto = require("crypto");
const User = require("../models/User");
const EmailCampaignSubscription = require("../models/EmailCampaignSubscription");
const EmailCampaignDelivery = require("../models/EmailCampaignDelivery");
const {
  CAMPAIGN_KEY,
  getEmailJourneyContent,
} = require("../data/emailJourneyContent");
const {
  sendEmail,
  isEmailDeliveryConfigured,
  getEffectiveEmailDeliveryProvider,
  getEmailConfigurationDiagnostics,
} = require("../utils/sendEmail");
const { buildMarketingEmailTemplate } = require("../utils/marketingEmailTemplate");
const { log } = require("../utils/logger");

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MAX_SEND_ATTEMPTS = 3;
const RETRY_DELAY_MS = 30 * 60 * 1000;
const DEFAULT_SENDING_TIMEOUT_MS = 15 * 60 * 1000;
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64"
);

let workerTimer = null;
let workerInFlight = false;
let immediateProcessingTimer = null;
let lastEmailConfigWarningAt = 0;

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function maskEmail(email = "") {
  const normalized = normalizeEmail(email);
  const [localPart, domain] = normalized.split("@");
  if (!localPart || !domain) return normalized ? "[invalid-email]" : "";
  const visible = localPart.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, localPart.length - 2))}@${domain}`;
}

function logCampaign(level, message, meta = {}) {
  log(level, `Email campaign ${message}`, meta);
}

function normalizeBaseUrl(value, fallback) {
  const raw = String(value || fallback || "").trim().replace(/\/+$/, "");
  return raw || fallback || "http://localhost:5000";
}

function getServerBaseUrl() {
  return normalizeBaseUrl(
    process.env.EMAIL_CAMPAIGN_PUBLIC_URL ||
      process.env.SERVER_URL ||
      process.env.RENDER_EXTERNAL_URL,
    "http://localhost:5000"
  );
}

function getClientBaseUrl() {
  return normalizeBaseUrl(
    process.env.EMAIL_CAMPAIGN_CLIENT_URL ||
      process.env.CLIENT_URL ||
      process.env.FRONTEND_URL ||
      process.env.EMAIL_CAMPAIGN_PUBLIC_URL ||
      process.env.SERVER_URL ||
      process.env.RENDER_EXTERNAL_URL,
    "https://shaleen17.github.io/Tirth-Sutra"
  );
}

function isCampaignEnabled() {
  return String(process.env.EMAIL_CAMPAIGN_ENABLED || "true").toLowerCase() !== "false";
}

function getBatchSize() {
  const parsed = Number(process.env.EMAIL_CAMPAIGN_BATCH_SIZE || 25);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 25;
}

function getWorkerIntervalMs() {
  const parsed = Number(process.env.EMAIL_CAMPAIGN_WORKER_INTERVAL_MS || 5 * 60 * 1000);
  return Number.isFinite(parsed) && parsed >= 60 * 1000 ? parsed : 5 * 60 * 1000;
}

function isWorkerEnabled() {
  return String(process.env.EMAIL_CAMPAIGN_WORKER_ENABLED || "true").toLowerCase() !== "false";
}

function getStartDelayHours() {
  const parsed = Number(process.env.EMAIL_CAMPAIGN_START_DELAY_HOURS || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function isFirstCampaignEmailImmediate() {
  return String(process.env.EMAIL_CAMPAIGN_FIRST_EMAIL_IMMEDIATE || "true").toLowerCase() !== "false";
}

function getSendingTimeoutMs() {
  const parsed = Number(
    process.env.EMAIL_CAMPAIGN_SENDING_TIMEOUT_MS || DEFAULT_SENDING_TIMEOUT_MS
  );
  return Number.isFinite(parsed) && parsed >= 60 * 1000
    ? parsed
    : DEFAULT_SENDING_TIMEOUT_MS;
}

function getSendWindow() {
  const start = Number(process.env.EMAIL_CAMPAIGN_SEND_WINDOW_START || 9);
  const end = Number(process.env.EMAIL_CAMPAIGN_SEND_WINDOW_END || 18);
  return {
    start: Number.isFinite(start) ? Math.max(0, Math.min(23, start)) : 9,
    end: Number.isFinite(end) ? Math.max(1, Math.min(24, end)) : 18,
  };
}

function createToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

function randomInt(maxExclusive) {
  return crypto.randomInt(0, maxExclusive);
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function chooseWeekdays(previousKey = "") {
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  let selected = [];
  let key = "";

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const remaining = [...allDays];
    selected = [];
    while (selected.length < 3) {
      const index = randomInt(remaining.length);
      selected.push(remaining.splice(index, 1)[0]);
    }
    selected.sort((a, b) => a - b);
    key = selected.join("-");
    if (key !== previousKey) break;
  }

  return { days: selected, key };
}

function createSendDate(weekStart, dayOffset) {
  const { start, end } = getSendWindow();
  const date = addDays(weekStart, dayOffset);
  const hourRange = Math.max(1, end - start);
  date.setHours(start + randomInt(hourRange), randomInt(60), 0, 0);
  return date;
}

function groupContentByWeek(content) {
  return content.reduce((weeks, item) => {
    const key = item.weekNumber;
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key).push(item);
    return weeks;
  }, new Map());
}

function buildSchedule(startDate = new Date(), options = {}) {
  const campaignContent = getEmailJourneyContent();
  const contentByWeek = groupContentByWeek(campaignContent);
  const firstWeekStart = startOfDay(startDate);
  const firstContentKey = campaignContent
    .slice()
    .sort((a, b) => a.contentIndex - b.contentIndex)[0]?.contentKey;
  const forceFirstEmailAtStart =
    options.firstEmailImmediate !== false && isFirstCampaignEmailImmediate();
  let previousKey = "";
  const schedule = [];

  [...contentByWeek.keys()].sort((a, b) => a - b).forEach((weekNumber) => {
    const weekContent = contentByWeek
      .get(weekNumber)
      .sort((a, b) => a.sequenceInWeek - b.sequenceInWeek);
    const { days, key } = chooseWeekdays(previousKey);
    previousKey = key;
    const weekStart = addDays(firstWeekStart, (weekNumber - 1) * 7);

    weekContent.forEach((contentItem, index) => {
      const candidateDate = createSendDate(weekStart, days[index]);
      const scheduledFor =
        forceFirstEmailAtStart && contentItem.contentKey === firstContentKey
          ? new Date(startDate)
          : candidateDate.getTime() >= startDate.getTime()
            ? candidateDate
            : new Date(startDate.getTime() + randomInt(120) * 60 * 1000);

      schedule.push({
        contentItem,
        scheduledFor,
      });
    });
  });

  return schedule.sort((a, b) => a.scheduledFor - b.scheduledFor);
}

function resolveTimezone(timezone) {
  const safe = String(timezone || "").trim();
  return safe && safe.length <= 64 ? safe : "Asia/Kolkata";
}

function resolveConsentDate(consentAt) {
  const date = consentAt ? new Date(consentAt) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function createDeliveriesForSubscription(subscription, startDate) {
  const schedule = buildSchedule(startDate);
  const operations = schedule.map(({ contentItem, scheduledFor }) => ({
    updateOne: {
      filter: {
        subscription: subscription._id,
        contentKey: contentItem.contentKey,
      },
      update: {
        $setOnInsert: {
          subscription: subscription._id,
          user: subscription.user,
          email: subscription.email,
          name: subscription.name,
          campaignKey: contentItem.campaignKey,
          contentKey: contentItem.contentKey,
          contentIndex: contentItem.contentIndex,
          weekNumber: contentItem.weekNumber,
          weekTitle: contentItem.weekTitle,
          sequenceInWeek: contentItem.sequenceInWeek,
          journeyStage: contentItem.stage,
          category: contentItem.category,
          subject: contentItem.subject,
          previewText: contentItem.previewText,
          paragraphs: contentItem.paragraphs,
          bullets: contentItem.bullets,
          ctaLabel: contentItem.ctaLabel,
          ctaUrl: contentItem.ctaUrl,
          scheduledFor,
          trackingToken: createToken(18),
          status: "scheduled",
        },
      },
      upsert: true,
    },
  }));

  if (operations.length > 0) {
    await EmailCampaignDelivery.bulkWrite(operations, { ordered: false });
  }

  const emailsScheduledCount = await EmailCampaignDelivery.countDocuments({
    subscription: subscription._id,
  });
  const lastDelivery = await EmailCampaignDelivery.findOne({
    subscription: subscription._id,
  })
    .sort({ scheduledFor: -1 })
    .lean();
  const firstDelivery = await EmailCampaignDelivery.findOne({
    subscription: subscription._id,
  })
    .sort({ scheduledFor: 1 })
    .lean();

  subscription.emailsScheduledCount = emailsScheduledCount;
  subscription.endsAt = lastDelivery ? addDays(lastDelivery.scheduledFor, 7) : null;
  await subscription.save();

  logCampaign("info", "subscription scheduled", {
    subscriptionId: subscription._id?.toString(),
    userId: subscription.user?.toString(),
    email: maskEmail(subscription.email),
    scheduledCount: emailsScheduledCount,
    firstScheduledFor: firstDelivery?.scheduledFor || null,
    startDate,
  });

  return emailsScheduledCount;
}

async function activateImmediateFirstDelivery(subscriptionId, now = new Date()) {
  if (!isFirstCampaignEmailImmediate()) return false;

  const firstDelivery = await EmailCampaignDelivery.findOne({
    subscription: subscriptionId,
    contentIndex: 1,
    status: "scheduled",
    scheduledFor: { $gt: now },
  });

  if (!firstDelivery) return false;

  firstDelivery.scheduledFor = now;
  firstDelivery.error = null;
  await firstDelivery.save({ validateBeforeSave: false });

  logCampaign("info", "first delivery activated immediately", {
    subscriptionId: subscriptionId?.toString(),
    deliveryId: firstDelivery._id?.toString(),
    email: maskEmail(firstDelivery.email),
    scheduledFor: now,
  });

  return true;
}

async function activateDueFirstDeliveries(now = new Date(), limit = 50) {
  if (!isFirstCampaignEmailImmediate()) return 0;

  const candidates = await EmailCampaignDelivery.find({
    contentIndex: 1,
    status: "scheduled",
    scheduledFor: { $gt: now },
  })
    .sort({ scheduledFor: 1 })
    .limit(limit);

  let activated = 0;
  for (const delivery of candidates) {
    const subscription = await EmailCampaignSubscription.findOne({
      _id: delivery.subscription,
      status: "active",
      "consent.given": true,
      emailsSentCount: 0,
    }).select("_id");

    if (!subscription) continue;

    delivery.scheduledFor = now;
    delivery.error = null;
    await delivery.save({ validateBeforeSave: false });
    activated += 1;
  }

  if (activated > 0) {
    logCampaign("info", "activated delayed first deliveries", { activated });
  }

  return activated;
}

async function enrollUserInEmailCampaign(user, options = {}) {
  const consentGiven =
    options.marketingConsent === true ||
    user?.marketing?.emailConsent === true ||
    user?.marketingEmailConsent === true;

  if (!user || !user.email || !consentGiven) {
    return { enrolled: false, reason: "no-consent" };
  }

  const now = new Date();
  const startDate = new Date(now.getTime() + getStartDelayHours() * MS_PER_HOUR);
  const existing = await EmailCampaignSubscription.findOne({ user: user._id });
  const unsubscribeToken = existing?.unsubscribeToken || createToken();
  const preferencesToken = existing?.preferencesToken || createToken();
  const consentAt = resolveConsentDate(options.consentAt || user.marketing?.emailConsentAt);

  const subscription = await EmailCampaignSubscription.findOneAndUpdate(
    { user: user._id },
    {
      $set: {
        email: normalizeEmail(user.email),
        name: user.name || "",
        campaignKey: CAMPAIGN_KEY,
        status: "active",
        timezone: resolveTimezone(options.timezone || user.marketing?.timezone),
        consent: {
          given: true,
          givenAt: consentAt,
          source: options.source || user.marketing?.emailConsentSource || "signup",
          ip: options.ip || null,
          userAgent: options.userAgent || null,
        },
        startedAt: existing?.startedAt || startDate,
        unsubscribedAt: null,
        completedAt: null,
      },
      $setOnInsert: {
        unsubscribeToken,
        preferencesToken,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  if (!subscription.unsubscribeToken || !subscription.preferencesToken) {
    subscription.unsubscribeToken = subscription.unsubscribeToken || unsubscribeToken;
    subscription.preferencesToken = subscription.preferencesToken || preferencesToken;
    await subscription.save();
  }

  await createDeliveriesForSubscription(subscription, subscription.startedAt || startDate);
  await activateImmediateFirstDelivery(subscription._id, new Date());
  triggerImmediateCampaignProcessing("enrollment");

  return { enrolled: true, subscription };
}

function buildPublicUrls(delivery, subscription) {
  const base = getServerBaseUrl();
  const unsubscribeUrl = `${base}/api/email-campaign/unsubscribe/${subscription.unsubscribeToken}`;
  const preferencesUrl = `${base}/api/email-campaign/preferences/${subscription.preferencesToken}`;
  const openPixelUrl = `${base}/api/email-campaign/open/${delivery._id}/${delivery.trackingToken}.gif`;
  const ctaUrl = buildUtmUrl(delivery);
  const clickUrl = `${base}/api/email-campaign/click/${delivery._id}/${delivery.trackingToken}?to=${encodeURIComponent(ctaUrl)}`;

  return {
    unsubscribeUrl,
    preferencesUrl,
    openPixelUrl,
    clickUrl,
  };
}

function buildUtmUrl(delivery) {
  const fallback = getClientBaseUrl();
  let url;
  try {
    url = new URL(delivery.ctaUrl || fallback, fallback);
  } catch {
    url = new URL(fallback);
  }

  url.searchParams.set("utm_source", "tirth_sutra_email");
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", CAMPAIGN_KEY);
  url.searchParams.set(
    "utm_content",
    `week-${delivery.weekNumber}-email-${delivery.sequenceInWeek}`
  );

  return url.toString();
}

async function markDeliverySkipped(delivery, reason) {
  delivery.status = "skipped";
  delivery.error = reason;
  await delivery.save();
}

async function maybeCompleteSubscription(subscriptionId) {
  const pendingCount = await EmailCampaignDelivery.countDocuments({
    subscription: subscriptionId,
    status: { $in: ["scheduled", "sending", "failed"] },
  });

  if (pendingCount > 0) {
    return;
  }

  await EmailCampaignSubscription.updateOne(
    { _id: subscriptionId, status: "active" },
    { $set: { status: "completed", completedAt: new Date() } }
  );
}

async function sendDelivery(delivery) {
  const subscription = await EmailCampaignSubscription.findById(delivery.subscription);
  if (!subscription) {
    await markDeliverySkipped(delivery, "Subscription not found.");
    return { status: "skipped" };
  }

  if (subscription.status !== "active" || !subscription.consent?.given) {
    await markDeliverySkipped(delivery, "Subscriber is not active or has no consent.");
    return { status: "skipped" };
  }

  const publicUrls = buildPublicUrls(delivery, subscription);
  const template = buildMarketingEmailTemplate({
    subscriber: subscription,
    delivery,
    ...publicUrls,
  });

  const info = await sendEmail({
    email: delivery.email,
    subject: delivery.subject,
    html: template.html,
    text: template.text,
    headers: {
      "List-Unsubscribe": `<${publicUrls.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  delivery.status = "sent";
  delivery.sentAt = new Date();
  delivery.messageId = info?.messageId || null;
  delivery.error = null;
  await delivery.save();

  await EmailCampaignSubscription.updateOne(
    { _id: subscription._id },
    {
      $inc: { emailsSentCount: 1 },
      $set: { lastEmailSentAt: delivery.sentAt },
    }
  );

  await maybeCompleteSubscription(subscription._id);
  logCampaign("info", "delivery sent", {
    deliveryId: delivery._id?.toString(),
    subscriptionId: subscription._id?.toString(),
    email: maskEmail(delivery.email),
    messageId: delivery.messageId,
  });
  return { status: "sent" };
}

async function processDueEmailCampaignDeliveries(options = {}) {
  if (!isCampaignEnabled()) {
    logCampaign("info", "processing skipped because campaign is disabled");
    return { processed: 0, sent: 0, skipped: 0, failed: 0, disabled: true };
  }

  if (!isEmailDeliveryConfigured()) {
    const now = Date.now();
    if (now - lastEmailConfigWarningAt > 5 * 60 * 1000) {
      lastEmailConfigWarningAt = now;
      const provider = getEffectiveEmailDeliveryProvider();
      const diagnostics = getEmailConfigurationDiagnostics(provider);
      logCampaign("warn", "processing skipped because email delivery is not configured", {
        provider,
        missing: diagnostics.missing,
      });
    }

    return {
      processed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      emailConfigured: false,
    };
  }

  const limit = Number(options.limit || getBatchSize());
  const now = new Date();
  const sendingCutoff = new Date(now.getTime() - getSendingTimeoutMs());
  const activated = await activateDueFirstDeliveries(now, limit);
  const dueDeliveries = await EmailCampaignDelivery.find({
    scheduledFor: { $lte: now },
    $or: [
      { status: "scheduled" },
      {
        status: "sending",
        $or: [
          { lastAttemptAt: { $lte: sendingCutoff } },
          { lastAttemptAt: null },
        ],
      },
    ],
  })
    .sort({ scheduledFor: 1 })
    .limit(limit);

  const summary = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    emailConfigured: true,
    activated,
    recoveredStaleSending: 0,
  };

  for (const dueDelivery of dueDeliveries) {
    const delivery = await EmailCampaignDelivery.findOneAndUpdate(
      {
        _id: dueDelivery._id,
        scheduledFor: { $lte: now },
        $or: [
          { status: "scheduled" },
          {
            status: "sending",
            $or: [
              { lastAttemptAt: { $lte: sendingCutoff } },
              { lastAttemptAt: null },
            ],
          },
        ],
      },
      {
        $set: { status: "sending", lastAttemptAt: new Date() },
        $inc: { attempts: 1 },
      },
      { new: true }
    );

    if (!delivery) {
      continue;
    }

    summary.processed += 1;
    if (dueDelivery.status === "sending") {
      summary.recoveredStaleSending += 1;
    }

    try {
      const result = await sendDelivery(delivery);
      summary[result.status] = (summary[result.status] || 0) + 1;
    } catch (error) {
      const attempts = delivery.attempts || 1;
      const shouldRetry = attempts < MAX_SEND_ATTEMPTS;
      delivery.status = shouldRetry ? "scheduled" : "failed";
      delivery.scheduledFor = shouldRetry
        ? new Date(Date.now() + RETRY_DELAY_MS)
        : delivery.scheduledFor;
      delivery.error = error.message || "Email delivery failed.";
      await delivery.save({ validateBeforeSave: false });
      summary.failed += 1;
      logCampaign(shouldRetry ? "warn" : "error", "delivery failed", {
        deliveryId: delivery._id?.toString(),
        subscriptionId: delivery.subscription?.toString(),
        email: maskEmail(delivery.email),
        attempts,
        willRetry: shouldRetry,
        nextRetryAt: shouldRetry ? delivery.scheduledFor : null,
        error: error.message || "Email delivery failed.",
      });
    }
  }

  if (summary.processed > 0 || summary.activated > 0) {
    logCampaign("info", "processing completed", summary);
  }

  return summary;
}

function triggerImmediateCampaignProcessing(reason = "manual") {
  if (
    !isCampaignEnabled() ||
    !isWorkerEnabled() ||
    process.env.VERCEL ||
    immediateProcessingTimer
  ) {
    return false;
  }

  immediateProcessingTimer = setTimeout(async () => {
    immediateProcessingTimer = null;
    try {
      const summary = await processDueEmailCampaignDeliveries({
        limit: Math.min(getBatchSize(), 10),
      });
      if (summary.processed > 0 || summary.activated > 0) {
        logCampaign("info", "immediate processing finished", {
          reason,
          ...summary,
        });
      }
    } catch (error) {
      logCampaign("error", "immediate processing failed", {
        reason,
        error: error.message || "Unknown error",
      });
    }
  }, 1000);

  if (typeof immediateProcessingTimer.unref === "function") {
    immediateProcessingTimer.unref();
  }

  return true;
}

function startEmailCampaignWorker() {
  if (
    !isCampaignEnabled() ||
    !isWorkerEnabled() ||
    process.env.VERCEL ||
    workerTimer
  ) {
    logCampaign("info", "worker not started", {
      campaignEnabled: isCampaignEnabled(),
      workerEnabled: isWorkerEnabled(),
      vercel: !!process.env.VERCEL,
      alreadyStarted: !!workerTimer,
    });
    return false;
  }

  const run = async () => {
    if (workerInFlight) return;
    workerInFlight = true;
    try {
      const summary = await processDueEmailCampaignDeliveries();
      if (summary.processed > 0) {
        logCampaign("info", "worker processed due deliveries", summary);
      }
    } catch (error) {
      logCampaign("error", "worker failed", {
        error: error.message || "Unknown error",
      });
    } finally {
      workerInFlight = false;
    }
  };

  setTimeout(run, 15000);
  workerTimer = setInterval(run, getWorkerIntervalMs());
  logCampaign("info", "worker started", {
    intervalMs: getWorkerIntervalMs(),
    batchSize: getBatchSize(),
    firstEmailImmediate: isFirstCampaignEmailImmediate(),
  });
  return true;
}

function stopEmailCampaignWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

async function cancelFutureDeliveries(subscriptionId, reason = "Subscriber unsubscribed.") {
  await EmailCampaignDelivery.updateMany(
    {
      subscription: subscriptionId,
      status: { $in: ["scheduled", "sending"] },
    },
    {
      $set: {
        status: "cancelled",
        error: reason,
      },
    }
  );
}

async function unsubscribeSubscription(subscription, reason = "Unsubscribed by email link.") {
  if (!subscription) {
    return { unsubscribed: false, reason: "not-found" };
  }

  const now = new Date();
  subscription.status = "unsubscribed";
  subscription.unsubscribedAt = subscription.unsubscribedAt || now;
  subscription.consent = {
    ...(subscription.consent || {}),
    given: false,
  };
  await subscription.save();

  await cancelFutureDeliveries(subscription._id, reason);
  await User.updateOne(
    { _id: subscription.user },
    {
      $set: {
        "marketing.emailConsent": false,
        "marketing.emailUnsubscribedAt": now,
      },
    }
  ).catch(() => {});

  return {
    unsubscribed: true,
    email: subscription.email,
    name: subscription.name,
  };
}

async function unsubscribeByToken(token) {
  const safeToken = String(token || "").trim();
  if (!safeToken) {
    return { unsubscribed: false, reason: "missing-token" };
  }

  const subscription = await EmailCampaignSubscription.findOne({
    $or: [{ unsubscribeToken: safeToken }, { preferencesToken: safeToken }],
  });

  return unsubscribeSubscription(subscription);
}

async function unsubscribeByUserId(userId) {
  const subscription = await EmailCampaignSubscription.findOne({ user: userId });
  return unsubscribeSubscription(subscription, "Unsubscribed from account settings.");
}

async function getSubscriptionForToken(token) {
  const safeToken = String(token || "").trim();
  if (!safeToken) return null;
  return EmailCampaignSubscription.findOne({
    $or: [{ unsubscribeToken: safeToken }, { preferencesToken: safeToken }],
  }).lean();
}

async function getSubscriptionForUser(userId) {
  if (!userId) return null;
  return EmailCampaignSubscription.findOne({ user: userId }).lean();
}

async function trackOpen(deliveryId, token) {
  const delivery = await EmailCampaignDelivery.findOne({
    _id: deliveryId,
    trackingToken: token,
  }).catch(() => null);

  if (!delivery) return false;

  const firstOpen = !delivery.openedAt;
  delivery.openedAt = delivery.openedAt || new Date();
  delivery.openCount = (delivery.openCount || 0) + 1;
  await delivery.save({ validateBeforeSave: false });

  await EmailCampaignSubscription.updateOne(
    { _id: delivery.subscription },
    { $inc: { openCount: 1 } }
  );

  return firstOpen;
}

async function trackClick(deliveryId, token) {
  const delivery = await EmailCampaignDelivery.findOne({
    _id: deliveryId,
    trackingToken: token,
  }).catch(() => null);

  if (!delivery) return false;

  const firstClick = !delivery.clickedAt;
  delivery.clickedAt = delivery.clickedAt || new Date();
  delivery.clickCount = (delivery.clickCount || 0) + 1;
  await delivery.save({ validateBeforeSave: false });

  await EmailCampaignSubscription.updateOne(
    { _id: delivery.subscription },
    { $inc: { clickCount: 1 } }
  );

  return firstClick;
}

function normalizeRedirectTarget(target) {
  try {
    const url = new URL(String(target || ""), getClientBaseUrl());
    if (!["http:", "https:"].includes(url.protocol)) {
      return getClientBaseUrl();
    }
    return url.toString();
  } catch {
    return getClientBaseUrl();
  }
}

async function getCampaignStats() {
  const [subscriptionStats, deliveryStats, totals] = await Promise.all([
    EmailCampaignSubscription.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    EmailCampaignDelivery.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    EmailCampaignSubscription.aggregate([
      {
        $group: {
          _id: null,
          sent: { $sum: "$emailsSentCount" },
          opens: { $sum: "$openCount" },
          clicks: { $sum: "$clickCount" },
        },
      },
    ]),
  ]);

  return {
    campaignKey: CAMPAIGN_KEY,
    subscriptions: subscriptionStats.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    deliveries: deliveryStats.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    totals: totals[0] || { sent: 0, opens: 0, clicks: 0 },
  };
}

module.exports = {
  TRANSPARENT_GIF,
  buildSchedule,
  enrollUserInEmailCampaign,
  processDueEmailCampaignDeliveries,
  startEmailCampaignWorker,
  stopEmailCampaignWorker,
  triggerImmediateCampaignProcessing,
  unsubscribeByToken,
  unsubscribeByUserId,
  getSubscriptionForToken,
  getSubscriptionForUser,
  trackOpen,
  trackClick,
  normalizeRedirectTarget,
  getCampaignStats,
  isCampaignEnabled,
  isWorkerEnabled,
};
