const nodemailer = require("nodemailer");
const AppError = require("./appError");

let transporter;

function createTransporter() {
  if (transporter) {
    return transporter;
  }

  const secure = process.env.SMTP_SECURE === "true";
  const port = Number(process.env.SMTP_PORT || (secure ? 465 : 587));

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER || process.env.EMAIL_USER,
      pass: process.env.SMTP_PASS || process.env.EMAIL_PASS,
    },
  });

  return transporter;
}

async function sendEmail({ email, subject, html, text }) {
  const fromAddress =
    process.env.EMAIL_FROM ||
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    process.env.EMAIL_USER;

  if (!fromAddress) {
    throw new AppError("Email delivery is not configured on the server.", 500);
  }

  try {
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
      "Unable to send the verification email right now. Please try again shortly.",
      502
    );
  }
}

module.exports = sendEmail;
