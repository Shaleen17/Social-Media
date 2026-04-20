const nodemailer = require("nodemailer");
const AppError = require("./appError");

// Singleton transporter — reset on failure so bad credentials don't stay cached
let transporter = null;
let verifyPromise = null;

function shouldVerifyBeforeSend() {
  return String(process.env.SMTP_VERIFY_BEFORE_SEND || "false").toLowerCase() === "true";
}

function getEmailTransportSettings() {
  const authUser = process.env.SMTP_USER || process.env.EMAIL_USER;
  const authPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
  const fromAddress =
    process.env.EMAIL_FROM ||
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    process.env.EMAIL_USER;
  const parsedPort = Number(process.env.SMTP_PORT || 0);
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : parsedPort === 465;
  const port = parsedPort || (secure ? 465 : 587);

  return {
    authUser,
    authPass,
    fromAddress,
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure,
  };
}

function isEmailDeliveryConfigured() {
  const { authUser, authPass, fromAddress } = getEmailTransportSettings();
  return !!(authUser && authPass && fromAddress);
}

function assertEmailDeliveryConfigured() {
  if (isEmailDeliveryConfigured()) {
    return;
  }

  // Log exactly which variables are missing to help with debugging on Render
  const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"];
  const missing = keys.filter((k) => !process.env[k]);
  console.error("❌ SMTP not configured. Missing env vars:", missing.join(", "));

  throw new AppError(
    "OTP email delivery is not configured on the server. Add SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, and EMAIL_FROM in your Render environment variables.",
    503
  );
}

// BUG FIX: Reset transporter on failure so stale broken transport is never reused.
// Previously, a failed transport was cached and all future emails also failed silently.
function resetTransporter() {
  transporter = null;
  verifyPromise = null;
}

function createTransporter() {
  if (transporter) {
    return transporter;
  }

  const { authUser, authPass, host, port, secure } = getEmailTransportSettings();

  assertEmailDeliveryConfigured();

  console.log(`📧 Creating SMTP transporter — host:${host} port:${port} secure:${secure} user:${authUser}`);

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: {
      user: authUser,
      pass: authPass,
    },
    tls: {
      minVersion: "TLSv1.2",
      // BUG FIX: Do not reject self-signed certs in staging, but enforce in prod
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
    // BUG FIX: Add connection timeout so email never hangs the request indefinitely
    connectionTimeout: 10000,  // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  return transporter;
}

async function sendEmail({ email, subject, html, text, replyTo, headers }) {
  const { fromAddress } = getEmailTransportSettings();

  assertEmailDeliveryConfigured();

  try {
    const transport = createTransporter();
    if (shouldVerifyBeforeSend()) {
      await verifyEmailTransport();
    }
    const info = await transport.sendMail({
      from: `Tirth Sutra <${fromAddress}>`,
      to: email,
      ...(replyTo ? { replyTo } : {}),
      ...(headers ? { headers } : {}),
      subject,
      html,
      text,
    });

    console.log(`✅ Email sent to ${email} — messageId: ${info.messageId}`);
    return info;
  } catch (error) {
    // BUG FIX: Reset transporter on ANY failure.
    // Previously a failed/stale transporter was cached and ALL future OTP emails also failed.
    console.error("❌ Email delivery failed:", error.message, "| code:", error.code || "N/A");
    resetTransporter();

    // Give a helpful message based on error type
    let userMessage = "Unable to send the OTP email right now. Please try again shortly.";
    if (error.code === "EAUTH") {
      userMessage = "Email authentication failed. Check SMTP_USER and SMTP_PASS environment variables on the server.";
    } else if (error.code === "ECONNECTION" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND") {
      userMessage = "Could not connect to the email server. Check SMTP_HOST and SMTP_PORT environment variables.";
    }

    throw new AppError(userMessage, 502);
  }
}

async function verifyEmailTransport() {
  if (verifyPromise) {
    return verifyPromise;
  }

  verifyPromise = createTransporter()
    .verify()
    .then(() => {
      console.log("✅ SMTP transporter verified successfully.");
      return true;
    })
    .catch((error) => {
      // BUG FIX: Reset both transporter AND verifyPromise on failure
      // Previously only verifyPromise was reset, leaving broken transporter cached
      console.error("❌ SMTP verification failed:", error.message, "| code:", error.code || "N/A");
      resetTransporter();
      throw new AppError(
        "Email delivery is configured incorrectly on the server. Check SMTP credentials in Render environment variables.",
        500
      );
    });

  return verifyPromise;
}

module.exports = {
  sendEmail,
  verifyEmailTransport,
  isEmailDeliveryConfigured,
  assertEmailDeliveryConfigured,
  shouldVerifyBeforeSend,
};
