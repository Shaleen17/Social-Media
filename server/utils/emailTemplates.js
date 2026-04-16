function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildOtpTemplate({
  title,
  previewText,
  name,
  otpCode,
  otpExpiryMinutes,
  introCopy,
}) {
  const safeName = escapeHtml(name || "there");
  const safeTitle = escapeHtml(title);
  const safePreview = escapeHtml(previewText);
  const safeIntro = escapeHtml(introCopy);
  const safeOtp = escapeHtml(otpCode);

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${safeTitle}</title>
      </head>
      <body style="margin:0;padding:0;background:#f6efe8;font-family:Arial,sans-serif;color:#2f251e;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreview}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6efe8;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fffaf4;border-radius:30px;overflow:hidden;border:1px solid #ead9cb;box-shadow:0 18px 42px rgba(74,46,42,0.10);">
                <tr>
                  <td style="padding:18px 36px;background:#20110f;color:#fff7ef;text-align:center;">
                    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:#f3c9a5;">Tirth Sutra</div>
                    <div style="margin-top:8px;font-size:13px;line-height:1.7;color:rgba(255,247,239,0.82);">
                      OTP signup for the Mandir Community
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:42px 36px 30px;background:linear-gradient(135deg,#4a2e2a 0%,#81554e 55%,#a78479 100%);color:#ffffff;">
                    <div style="display:inline-block;padding:8px 14px;border-radius:999px;background:rgba(255,255,255,0.14);font-size:12px;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;">
                      Email OTP
                    </div>
                    <h1 style="margin:18px 0 12px;font-size:32px;line-height:1.18;font-weight:700;">
                      ${safeTitle}
                    </h1>
                    <p style="margin:0;max-width:540px;font-size:16px;line-height:1.8;color:rgba(255,255,255,0.92);">
                      ${safeIntro}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:36px;">
                    <p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:#4d4036;">Namaste ${safeName},</p>
                    <p style="margin:0 0 16px;font-size:16px;line-height:1.85;color:#4d4036;">
                      Enter this one-time password in the app to verify your email. Your account is created only after this code is verified.
                    </p>

                    <div style="margin:26px 0;padding:24px;border-radius:24px;background:linear-gradient(135deg,#fff7ef,#f5eadf);border:1px solid #ead9cb;text-align:center;">
                      <div style="font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:#8d5a34;font-weight:700;">
                        One-Time Password
                      </div>
                      <div style="margin-top:14px;font-size:38px;letter-spacing:12px;font-weight:800;color:#4a2e2a;">
                        ${safeOtp}
                      </div>
                      <div style="margin-top:12px;font-size:13px;line-height:1.7;color:#6d5b4d;">
                        Valid for ${otpExpiryMinutes} minutes. Never share this code with anyone.
                      </div>
                    </div>

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0;background:#fff4e8;border:1px solid #efdcca;border-radius:20px;">
                      <tr>
                        <td style="padding:18px 20px;">
                          <div style="font-size:15px;font-weight:700;color:#4a2e2a;margin-bottom:10px;">
                            What happens next?
                          </div>
                          <div style="font-size:14px;line-height:1.85;color:#5d5046;">
                            1. Enter the OTP in the signup screen.<br />
                            2. We verify the code and expiry.<br />
                            3. Your real user account is created only after successful verification.
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:22px 36px;background:#f5eadf;border-top:1px solid #ead9cb;text-align:center;">
                    <div style="font-size:12px;line-height:1.8;color:#6c5d50;">
                      Sent by Tirth Sutra. This OTP is short-lived for your security.
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
        "Confirm your email in a few seconds and complete your Tirth Sutra signup securely.",
    }),
  };
}

function resendSignupOtpEmailTemplate({ name, otpCode, otpExpiryMinutes }) {
  return {
    subject: "Your new Tirth Sutra OTP",
    html: buildOtpTemplate({
      title: "Here is your fresh OTP",
      previewText: "Use this new OTP to continue your Tirth Sutra signup.",
      name,
      otpCode,
      otpExpiryMinutes,
      introCopy:
        "We generated a new OTP for your signup. Enter it in the app to continue.",
    }),
  };
}

module.exports = {
  signupOtpEmailTemplate,
  resendSignupOtpEmailTemplate,
};
