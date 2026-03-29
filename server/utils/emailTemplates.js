function buildBaseTemplate({ title, previewText, bodyHtml, ctaText, ctaUrl }) {
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${title}</title>
      </head>
      <body style="margin:0;padding:0;background:#f6efe8;font-family:Arial,sans-serif;color:#2f251e;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${previewText}</div>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6efe8;padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fffaf4;border-radius:28px;overflow:hidden;border:1px solid #ead9cb;box-shadow:0 10px 30px rgba(74,46,42,0.08);">

                <!-- Header -->
                <tr>
                  <td style="padding:18px 40px;background:#fff7ef;border-bottom:1px solid #ecdccf;text-align:center;">
                    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8d5a34;font-weight:700;">
                      Tirth Sutra
                    </div>
                    <div style="margin-top:8px;font-size:13px;line-height:1.6;color:#7b6554;">
                      Rooted in Sanatan Dharma, qualified by our spiritual leaders
                    </div>
                  </td>
                </tr>

                <!-- Hero -->
                <tr>
                  <td style="padding:44px 40px 28px;background:linear-gradient(135deg,#4a2e2a 0%,#8d4d22 52%,#c9742c 100%);color:#ffffff;text-align:center;">
                    <div style="display:inline-block;padding:8px 14px;border-radius:999px;background:rgba(255,255,255,0.12);font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;">
                      Sacred Journey Begins Here
                    </div>
                    <h1 style="margin:18px 0 12px;font-size:32px;line-height:1.2;font-weight:700;">
                      ${title}
                    </h1>
                    <p style="margin:0 auto;max-width:520px;font-size:16px;line-height:1.8;color:rgba(255,255,255,0.92);">
                      Secure your access to the Tirth Sutra experience and continue your journey with confidence.
                    </p>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding:40px;">
                    ${bodyHtml}

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:28px 0 10px;background:#fff4e8;border:1px solid #efdcca;border-radius:18px;">
                      <tr>
                        <td style="padding:18px 20px;">
                          <div style="font-size:15px;font-weight:700;color:#4a2e2a;margin-bottom:8px;">
                            Why verify your email?
                          </div>
                          <div style="font-size:14px;line-height:1.8;color:#5d5046;">
                            • Protect your account and keep access secure<br/>
                            • Receive important updates and sign-in support<br/>
                            • Continue exploring Tirth Sutra without interruption
                          </div>
                        </td>
                      </tr>
                    </table>

                    <div style="margin:34px 0 24px;text-align:center;">
                      <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#8d4d22,#b85c1c);color:#ffffff;text-decoration:none;padding:16px 30px;border-radius:999px;font-weight:700;font-size:15px;box-shadow:0 8px 18px rgba(184,92,28,0.24);">
                        ${ctaText}
                      </a>
                    </div>

                    <p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#5d5046;">
                      If the button does not work, copy and paste this secure link into your browser:
                    </p>
                    <p style="margin:0;font-size:14px;line-height:1.8;word-break:break-word;">
                      <a href="${ctaUrl}" style="color:#8d4d22;text-decoration:underline;">${ctaUrl}</a>
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding:24px 40px;background:#f5eadf;border-top:1px solid #ead9cb;">
                    <div style="font-size:12px;line-height:1.8;color:#6c5d50;text-align:center;">
                      This link expires in 24 hours for your security.<br/>
                      Tirth Sutra — Authentic spiritual journeys, sacred learning, and trusted access.
                    </div>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function verificationEmailTemplate({ name, verificationUrl }) {
  const safeName = name || "there";

  return {
    subject: "Verify your Tirth Sutra account",
    html: buildBaseTemplate({
      title: "Confirm your email",
      previewText: "Verify your email to activate your Tirth Sutra account.",
      ctaText: "Verify Email",
      ctaUrl: verificationUrl,
      bodyHtml: `
        <p style="margin:0 0 16px;font-size:16px;line-height:1.8;">Namaste ${safeName},</p>

        <p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:#4d4036;">
          Welcome to <strong>Tirth Sutra</strong> — a platform inspired by authenticity, devotion, and the timeless spirit of Sanatan Dharma.
        </p>

        <p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:#4d4036;">
          Please verify your email address to activate your account and securely begin exploring a more meaningful spiritual experience.
        </p>

        <p style="margin:0;font-size:16px;line-height:1.8;color:#4d4036;">
          Once verified, you can sign in smoothly, stay connected to your account, and continue your journey without interruption.
        </p>
      `,
    }),
  };
}

function resendVerificationEmailTemplate({ name, verificationUrl }) {
  const safeName = name || "there";

  return {
    subject: "Your new Tirth Sutra verification link",
    html: buildBaseTemplate({
      title: "Here is your new verification link",
      previewText: "Use this new verification link to activate your Tirth Sutra account.",
      ctaText: "Verify Account",
      ctaUrl: verificationUrl,
      bodyHtml: `
        <p style="margin:0 0 16px;font-size:16px;line-height:1.8;">Namaste ${safeName},</p>

        <p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:#4d4036;">
          We received a request to send you a fresh verification link for your <strong>Tirth Sutra</strong> account.
        </p>

        <p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:#4d4036;">
          Please use the secure button below to verify your email address and continue signing in safely.
        </p>

        <p style="margin:0;font-size:16px;line-height:1.8;color:#4d4036;">
          Verifying your email helps protect your account and ensures uninterrupted access to the Tirth Sutra experience.
        </p>
      `,
    }),
  };
}

module.exports = {
  verificationEmailTemplate,
  resendVerificationEmailTemplate,
};