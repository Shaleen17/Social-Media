function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderParagraphs(paragraphs = []) {
  return paragraphs
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.85;color:#4b4038;">${escapeHtml(paragraph)}</p>`
    )
    .join("");
}

function renderBullets(bullets = []) {
  if (!Array.isArray(bullets) || bullets.length === 0) {
    return "";
  }

  const items = bullets
    .filter(Boolean)
    .map(
      (item) =>
        `<li style="margin:0 0 8px;font-size:15px;line-height:1.65;color:#4b4038;">${escapeHtml(item)}</li>`
    )
    .join("");

  return `
    <ul style="margin:0 0 20px 20px;padding:0;">
      ${items}
    </ul>
  `;
}

function toPlainText({ name, delivery, clickUrl, unsubscribeUrl, preferencesUrl }) {
  const lines = [
    `Namaste ${name || "there"},`,
    "",
    delivery.subject,
    "",
    ...(delivery.paragraphs || []),
  ];

  if (Array.isArray(delivery.bullets) && delivery.bullets.length) {
    lines.push("", ...delivery.bullets.map((bullet) => `- ${bullet}`));
  }

  lines.push(
    "",
    `${delivery.ctaLabel}: ${clickUrl}`,
    "",
    "You are receiving this because you subscribed to Tirth Sutra weekly blogs, tips, and updates.",
    `Manage preferences: ${preferencesUrl}`,
    `Unsubscribe: ${unsubscribeUrl}`
  );

  return lines.join("\n");
}

function buildMarketingEmailTemplate({
  subscriber,
  delivery,
  clickUrl,
  openPixelUrl,
  unsubscribeUrl,
  preferencesUrl,
}) {
  const safeName = escapeHtml(subscriber.name || "there");
  const safeSubject = escapeHtml(delivery.subject);
  const safePreview = escapeHtml(delivery.previewText || delivery.subject);
  const safeStage = escapeHtml(delivery.journeyStage || "Inspiration");
  const safeWeek = escapeHtml(`Week ${delivery.weekNumber}`);
  const safeWeekTitle = escapeHtml(delivery.weekTitle || "Tirth Sutra Journey");
  const safeCta = escapeHtml(delivery.ctaLabel || "Explore Tirth Sutra");
  const safeClickUrl = escapeHtml(clickUrl);
  const safeOpenPixelUrl = escapeHtml(openPixelUrl);
  const safeUnsubscribeUrl = escapeHtml(unsubscribeUrl);
  const safePreferencesUrl = escapeHtml(preferencesUrl);

  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${safeSubject}</title>
      </head>
      <body style="margin:0;padding:0;background:#f7f1ea;font-family:Arial,Helvetica,sans-serif;color:#2f251e;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreview}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f1ea;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fffdf9;border:1px solid #eadbcf;border-radius:18px;overflow:hidden;box-shadow:0 16px 40px rgba(68,46,36,0.10);">
                <tr>
                  <td style="padding:18px 34px;background:#251612;color:#fff7ef;text-align:center;">
                    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:#e8b88d;">Tirth Sutra</div>
                    <div style="margin-top:7px;font-size:13px;line-height:1.7;color:rgba(255,247,239,0.84);">${safeWeek} - ${safeWeekTitle}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:36px 34px 30px;background:#805846;color:#ffffff;">
                    <div style="display:inline-block;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,0.14);font-size:12px;letter-spacing:1px;text-transform:uppercase;font-weight:700;">${safeStage}</div>
                    <h1 style="margin:18px 0 10px;font-size:31px;line-height:1.2;font-weight:800;letter-spacing:0;">${safeSubject}</h1>
                    <p style="margin:0;max-width:540px;font-size:16px;line-height:1.75;color:rgba(255,255,255,0.92);">${safePreview}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:34px;">
                    <p style="margin:0 0 16px;font-size:16px;line-height:1.85;color:#4b4038;">Namaste ${safeName},</p>
                    ${renderParagraphs(delivery.paragraphs)}
                    ${renderBullets(delivery.bullets)}
                    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 8px;">
                      <tr>
                        <td>
                          <a href="${safeClickUrl}" style="display:inline-block;background:#4a2e2a;color:#ffffff;text-decoration:none;padding:13px 20px;border-radius:8px;font-size:15px;font-weight:700;">${safeCta}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:22px 34px;background:#f3e8dc;border-top:1px solid #eadbcf;text-align:center;">
                    <p style="margin:0 0 8px;font-size:12px;line-height:1.7;color:#6d5f54;">
                      You are receiving this because you subscribed to Tirth Sutra weekly blogs, tips, and updates.
                    </p>
                    <p style="margin:0;font-size:12px;line-height:1.7;color:#6d5f54;">
                      <a href="${safePreferencesUrl}" style="color:#4a2e2a;text-decoration:underline;">Manage Preferences</a>
                      &nbsp;|&nbsp;
                      <a href="${safeUnsubscribeUrl}" style="color:#4a2e2a;text-decoration:underline;">Unsubscribe</a>
                    </p>
                    <p style="margin:10px 0 0;font-size:11px;line-height:1.6;color:#84766b;">
                      Tirth Sutra, India
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <img src="${safeOpenPixelUrl}" width="1" height="1" alt="" style="display:none;border:0;outline:none;" />
      </body>
    </html>
  `;

  return {
    html,
    text: toPlainText({
      name: subscriber.name,
      delivery,
      clickUrl,
      unsubscribeUrl,
      preferencesUrl,
    }),
  };
}

module.exports = {
  buildMarketingEmailTemplate,
};
