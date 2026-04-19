const express = require("express");
const { optionalAuth } = require("../middleware/auth");
const { sendEmail } = require("../utils/sendEmail");
const AppError = require("../utils/appError");

const router = express.Router();
const SUPPORT_EMAIL = String(
  process.env.SUPPORT_EMAIL || "tirthsutra@gmail.com"
).trim();
const SUPPORT_KIND_META = {
  issue: {
    badge: "Issue Report",
    detailLabel: "Issue Details",
  },
  support: {
    badge: "Support Request",
    detailLabel: "Support Details",
  },
  feedback: {
    badge: "Feedback",
    detailLabel: "Feedback Details",
  },
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

router.post("/report", optionalAuth, async (req, res, next) => {
  try {
    const {
      kind = "issue",
      subject = "",
      body = "",
      category = "General",
      currentPage = "",
      preferredLanguage = "",
      theme = "",
      accountPrivacy = "",
      notificationSummary = "",
      detail = "",
      userLabel = "",
    } = req.body || {};

    const safeSubject = String(subject || "").trim();
    const safeBody = String(body || "").trim();
    const safeKind = SUPPORT_KIND_META[kind] ? kind : "issue";
    const kindMeta = SUPPORT_KIND_META[safeKind];
    const safeCategory = String(category || "General").trim();
    const safeDetail = String(detail || "").trim();

    if (!safeSubject) {
      throw new AppError("Report subject is required", 400);
    }
    if (!safeBody) {
      throw new AppError("Report details are required", 400);
    }
    if (safeSubject.length > 200) {
      throw new AppError("Report subject is too long", 400);
    }
    if (safeBody.length > 12000) {
      throw new AppError("Report details are too long", 400);
    }

    const authenticatedUser = req.user || null;
    const reporterName = authenticatedUser?.name || "Guest user";
    const reporterHandle = authenticatedUser?.handle
      ? `@${authenticatedUser.handle}`
      : "";
    const reporterEmail = authenticatedUser?.email || "";
    const resolvedUserLabel =
      String(userLabel || "").trim() ||
      [reporterName, reporterHandle].filter(Boolean).join(" ").trim() ||
      "Guest user";

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f7f4f1;padding:24px;color:#1f1614;">
        <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #eadfd3;border-radius:18px;overflow:hidden;">
          <div style="padding:20px 24px;background:#2f1c18;color:#fff8f1;">
            <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.75;">Tirth Sutra ${kindMeta.badge}</div>
            <div style="margin-top:8px;font-size:24px;font-weight:700;line-height:1.25;">${escapeHtml(safeSubject)}</div>
          </div>
          <div style="padding:24px;">
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:20px;">
              <div style="padding:14px;border:1px solid #eadfd3;border-radius:14px;background:#fbf7f3;">
                <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8c675b;">Category</div>
                <div style="margin-top:6px;font-size:14px;font-weight:600;color:#241714;">${escapeHtml(safeCategory)}</div>
              </div>
              <div style="padding:14px;border:1px solid #eadfd3;border-radius:14px;background:#fbf7f3;">
                <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8c675b;">Reporter</div>
                <div style="margin-top:6px;font-size:14px;font-weight:600;color:#241714;">${escapeHtml(resolvedUserLabel)}</div>
              </div>
              <div style="padding:14px;border:1px solid #eadfd3;border-radius:14px;background:#fbf7f3;">
                <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8c675b;">Current Page</div>
                <div style="margin-top:6px;font-size:14px;font-weight:600;color:#241714;">${escapeHtml(currentPage || "Unknown")}</div>
              </div>
              <div style="padding:14px;border:1px solid #eadfd3;border-radius:14px;background:#fbf7f3;">
                <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8c675b;">Submitted At</div>
                <div style="margin-top:6px;font-size:14px;font-weight:600;color:#241714;">${escapeHtml(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}</div>
              </div>
            </div>
            <div style="margin-bottom:16px;padding:18px;border:1px solid #eadfd3;border-radius:16px;background:#ffffff;">
              <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8c675b;">${kindMeta.detailLabel}</div>
              <div style="margin-top:10px;font-size:14px;line-height:1.7;color:#241714;white-space:pre-wrap;">${escapeHtml(safeDetail || safeBody)}</div>
            </div>
            <div style="padding:18px;border:1px solid #eadfd3;border-radius:16px;background:#fbf7f3;">
              <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8c675b;">App Context</div>
              <div style="margin-top:10px;font-size:14px;line-height:1.7;color:#241714;white-space:pre-wrap;">${escapeHtml(safeBody)}</div>
            </div>
            ${
              reporterEmail
                ? `<div style="margin-top:18px;font-size:13px;color:#6a4f46;">Reply contact: <strong>${escapeHtml(reporterEmail)}</strong></div>`
                : ""
            }
          </div>
        </div>
      </div>
    `;

    await sendEmail({
      email: SUPPORT_EMAIL,
      replyTo: reporterEmail || undefined,
      subject: safeSubject,
      html,
      text: safeBody,
    });

    res.json({
      success: true,
      message: "Report sent successfully",
      recipient: SUPPORT_EMAIL,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
