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

function buildOtpTemplate({ title, previewText, name, otpCode, otpExpiryMinutes, introCopy }) {
  const safeName = name || "there";

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
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6efe8;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fffaf4;border-radius:30px;overflow:hidden;border:1px solid #ead9cb;box-shadow:0 18px 42px rgba(74,46,42,0.1);">
                <tr>
                  <td style="padding:18px 36px;background:#20110f;color:#fff7ef;text-align:center;">
                    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:#f3c9a5;">Tirth Sutra</div>
                    <div style="margin-top:8px;font-size:13px;line-height:1.7;color:rgba(255,247,239,0.82);">
                      Mandir Community · Sacred stories · Spiritual discovery
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:42px 36px 30px;background:radial-gradient(circle at top right, rgba(255,255,255,0.2), transparent 38%),linear-gradient(135deg,#4a2e2a 0%,#81554e 55%,#a78479 100%);color:#ffffff;">
                    <div style="display:inline-block;padding:8px 14px;border-radius:999px;background:rgba(255,255,255,0.14);font-size:12px;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;">
                      Sign up securely
                    </div>
                    <h1 style="margin:18px 0 12px;font-size:32px;line-height:1.18;font-weight:700;">
                      ${title}
                    </h1>
                    <p style="margin:0;max-width:540px;font-size:16px;line-height:1.85;color:rgba(255,255,255,0.92);">
                      ${introCopy}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:36px;">
                    <p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:#4d4036;">Namaste ${safeName},</p>
                    <p style="margin:0 0 16px;font-size:16px;line-height:1.85;color:#4d4036;">
                      Your Tirth Sutra one-time password is ready. Enter this OTP in the app to activate your account and begin your spiritual journey.
                    </p>

                    <div style="margin:26px 0;padding:24px;border-radius:24px;background:linear-gradient(135deg,#fff7ef,#f5eadf);border:1px solid #ead9cb;text-align:center;">
                      <div style="font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:#8d5a34;font-weight:700;">
                        One-Time Password
                      </div>
                      <div style="margin-top:14px;font-size:38px;letter-spacing:12px;font-weight:800;color:#4a2e2a;">
                        ${otpCode}
                      </div>
                      <div style="margin-top:12px;font-size:13px;line-height:1.7;color:#6d5b4d;">
                        Valid for ${otpExpiryMinutes} minutes. For your security, never share this code with anyone.
                      </div>
                    </div>

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background:#fff4e8;border:1px solid #efdcca;border-radius:20px;">
                      <tr>
                        <td style="padding:18px 20px;">
                          <div style="font-size:15px;font-weight:700;color:#4a2e2a;margin-bottom:10px;">
                            What opens up after verification?
                          </div>
                          <div style="font-size:14px;line-height:1.85;color:#5d5046;">
                            • Join a sacred digital sangha built for devotees and seekers<br/>
                            • Discover mandirs, verified sants, and spiritual content in one place<br/>
                            • Watch Tirth Tube, share your dharmic journey, and stay connected across every device
                          </div>
                        </td>
                      </tr>
                    </table>

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0;background:#20110f;border-radius:20px;">
                      <tr>
                        <td style="padding:18px 20px;">
                          <div style="font-size:14px;font-weight:700;color:#f6d1b2;margin-bottom:8px;">
                            A note from Tirth Sutra
                          </div>
                          <div style="font-size:14px;line-height:1.8;color:rgba(255,247,239,0.88);">
                            We are building a trusted spiritual home online where faith, learning, and community feel respectful, beautiful, and deeply rooted in Sanatan Dharma.
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:22px 36px;background:#f5eadf;border-top:1px solid #ead9cb;text-align:center;">
                    <div style="font-size:12px;line-height:1.8;color:#6c5d50;">
                      Sent by Tirth Sutra • This OTP works for one signup session and expires shortly for your security.
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

function signupOtpEmailTemplate({ name, otpCode, otpExpiryMinutes }) {
  return {
    subject: "Your Tirth Sutra signup OTP",
    html: buildOtpTemplate({
      title: "Verify your email with OTP",
      previewText: "Use this OTP to finish creating your Tirth Sutra account.",
      name,
      otpCode,
      otpExpiryMinutes,
      introCopy:
        "Confirm your email in a few seconds and unlock a smoother first step into the Tirth Sutra experience.",
    }),
  };
}

function resendSignupOtpEmailTemplate({ name, otpCode, otpExpiryMinutes }) {
  return {
    subject: "Your fresh Tirth Sutra OTP is here",
    html: buildOtpTemplate({
      title: "Here is your fresh OTP",
      previewText: "Use this new OTP to complete your Tirth Sutra signup.",
      name,
      otpCode,
      otpExpiryMinutes,
      introCopy:
        "We generated a fresh OTP for your signup so you can continue joining the Tirth Sutra community without delay.",
    }),
  };
}

module.exports = {
  verificationEmailTemplate,
  resendVerificationEmailTemplate,
  signupOtpEmailTemplate,
  resendSignupOtpEmailTemplate,
};
