const nodemailer = require("nodemailer");
const AppError = require("./appError");

let transporter;
let verifyPromise;

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

  throw new AppError(
    "OTP email delivery is not configured on the server. Add SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, and EMAIL_FROM in production.",
    503
  );
}

function createTransporter() {
  if (transporter) {
    return transporter;
  }

  const { authUser, authPass, host, port, secure } = getEmailTransportSettings();

  assertEmailDeliveryConfigured();

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
    },
  });

  return transporter;
}

async function sendEmail({ email, subject, html, text }) {
  const { fromAddress } = getEmailTransportSettings();

  assertEmailDeliveryConfigured();

  try {
    if (process.env.SMTP_VERIFY_BEFORE_SEND === "true") {
      await verifyEmailTransport();
    }

    const info = await createTransporter().sendMail({
      from: `Tirth Sutra <${fromAddress}>`,
      to: email,
      subject,
      html,
      text,
    });

    console.log("Email sent:", info.messageId);
    return info;
  } catch (error) {
    console.error("Email delivery failed:", error.message);
    throw new AppError(
      "Unable to send the email right now. Please try again shortly.",
      502
    );
  }
}

async function verifyEmailTransport() {
  if (!verifyPromise) {
    verifyPromise = createTransporter()
      .verify()
      .then(() => {
        console.log("SMTP transporter verified successfully.");
        return true;
      })
      .catch((error) => {
        verifyPromise = null;
        console.error("SMTP transporter verification failed:", error.message);
        throw new AppError(
          "Email delivery is configured incorrectly on the server.",
          500
        );
      });
  }

  return verifyPromise;
}

module.exports = {
  sendEmail,
  verifyEmailTransport,
  isEmailDeliveryConfigured,
  assertEmailDeliveryConfigured,
};
