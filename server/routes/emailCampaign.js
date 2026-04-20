const express = require("express");
const { auth } = require("../middleware/auth");
const {
  TRANSPARENT_GIF,
  processDueEmailCampaignDeliveries,
  unsubscribeByToken,
  unsubscribeByUserId,
  getSubscriptionForToken,
  getSubscriptionForUser,
  trackOpen,
  trackClick,
  normalizeRedirectTarget,
  getCampaignStats,
} = require("../services/emailCampaignService");

const router = express.Router();

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isAuthorizedCronRequest(req) {
  const secret = process.env.EMAIL_CAMPAIGN_CRON_SECRET;
  if (!secret) {
    return false;
  }

  return (
    req.get("x-campaign-secret") === secret ||
    req.get("authorization") === `Bearer ${secret}` ||
    req.query.secret === secret
  );
}

function isAuthorizedAdminRequest(req) {
  const key = process.env.EMAIL_CAMPAIGN_ADMIN_KEY;
  if (!key) {
    return false;
  }

  return (
    req.get("x-campaign-admin-key") === key ||
    req.get("authorization") === `Bearer ${key}` ||
    req.query.key === key
  );
}

function renderMessagePage({ title, message, actionHref, actionLabel }) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const action = actionHref
    ? `<a href="${escapeHtml(actionHref)}" style="display:inline-block;margin-top:18px;background:#4a2e2a;color:#fff;text-decoration:none;padding:12px 16px;border-radius:8px;font-weight:700;">${escapeHtml(actionLabel || "Continue")}</a>`
    : "";

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${safeTitle}</title>
    </head>
    <body style="margin:0;background:#f7f1ea;font-family:Arial,Helvetica,sans-serif;color:#2f251e;">
      <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
        <section style="max-width:560px;background:#fffdf9;border:1px solid #eadbcf;border-radius:18px;padding:34px;box-shadow:0 16px 40px rgba(68,46,36,0.10);">
          <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:#9a6748;">Tirth Sutra</div>
          <h1 style="margin:12px 0 10px;font-size:30px;line-height:1.2;">${safeTitle}</h1>
          <p style="margin:0;font-size:16px;line-height:1.8;color:#5b4d43;">${safeMessage}</p>
          ${action}
        </section>
      </main>
    </body>
  </html>`;
}

router.get("/unsubscribe/:token", async (req, res, next) => {
  try {
    const result = await unsubscribeByToken(req.params.token);
    res
      .status(result.unsubscribed ? 200 : 404)
      .type("html")
      .send(
        renderMessagePage({
          title: result.unsubscribed ? "You are unsubscribed" : "Link not found",
          message: result.unsubscribed
            ? "You will no longer receive Tirth Sutra weekly marketing emails. Account and security emails can still be sent when needed."
            : "This unsubscribe link is invalid or expired.",
          actionHref: process.env.CLIENT_URL || process.env.FRONTEND_URL || "/",
          actionLabel: "Return to Tirth Sutra",
        })
      );
  } catch (error) {
    next(error);
  }
});

router.post("/unsubscribe/:token", async (req, res, next) => {
  try {
    const result = await unsubscribeByToken(req.params.token);
    res.status(result.unsubscribed ? 200 : 404).json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/preferences/:token", async (req, res, next) => {
  try {
    const subscription = await getSubscriptionForToken(req.params.token);
    if (!subscription) {
      return res
        .status(404)
        .type("html")
        .send(
          renderMessagePage({
            title: "Preferences not found",
            message: "This preference link is invalid or expired.",
          })
        );
    }

    const unsubscribeHref = `/api/email-campaign/unsubscribe/${subscription.unsubscribeToken || req.params.token}`;
    return res.type("html").send(
      renderMessagePage({
        title:
          subscription.status === "active"
            ? "Your email journey is active"
            : "Your email journey is not active",
        message:
          subscription.status === "active"
            ? `You are subscribed as ${subscription.email}. Tirth Sutra will send three emails per week on varied days.`
            : `Current status for ${subscription.email}: ${subscription.status}.`,
        actionHref: unsubscribeHref,
        actionLabel: "Unsubscribe",
      })
    );
  } catch (error) {
    next(error);
  }
});

router.get("/open/:deliveryId/:token.gif", async (req, res) => {
  await trackOpen(req.params.deliveryId, req.params.token).catch(() => false);
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.end(TRANSPARENT_GIF);
});

router.get("/click/:deliveryId/:token", async (req, res) => {
  const tracked = await trackClick(req.params.deliveryId, req.params.token).catch(
    () => false
  );
  res.redirect(
    tracked
      ? normalizeRedirectTarget(req.query.to)
      : process.env.CLIENT_URL || process.env.FRONTEND_URL || "/"
  );
});

router.post("/run-due", async (req, res) => {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(403).json({ error: "Not authorized" });
  }

  const summary = await processDueEmailCampaignDeliveries({
    limit: Number(req.body?.limit || req.query.limit || 0) || undefined,
  });
  res.json(summary);
});

router.get("/admin/stats", async (req, res) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(403).json({ error: "Not authorized" });
  }

  res.json(await getCampaignStats());
});

router.get("/me", auth, async (req, res) => {
  const subscription = await getSubscriptionForUser(req.user._id);
  res.json({
    subscribed: subscription?.status === "active",
    subscription: subscription || null,
  });
});

router.post("/me/unsubscribe", auth, async (req, res) => {
  res.json(await unsubscribeByUserId(req.user._id));
});

module.exports = router;
