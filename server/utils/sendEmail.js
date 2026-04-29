const https = require("https");
const nodemailer = require("nodemailer");
const AppError = require("./appError");

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

function getBrevoSettings() {
  return {
    apiKey: String(process.env.BREVO_API_KEY || "").trim(),
    baseUrl: String(process.env.BREVO_API_BASE || "https://api.brevo.com").trim(),
  };
}

function getConfiguredEmailProviderPreference() {
  const preferred = String(process.env.EMAIL_DELIVERY_PROVIDER || "auto")
    .trim()
    .toLowerCase();

  if (preferred === "smtp" || preferred === "brevo") {
    return preferred;
  }

  return "auto";
}

function getEmailDeliveryProvider() {
  const preferred = getConfiguredEmailProviderPreference();
  const { apiKey } = getBrevoSettings();
  const { authUser, authPass } = getEmailTransportSettings();
  const hasBrevo = !!apiKey;
  const hasSmtp = !!(authUser && authPass);

  if (preferred === "brevo") {
    return hasBrevo ? "brevo" : "smtp";
  }

  if (preferred === "smtp") {
    return hasSmtp ? "smtp" : "brevo";
  }

  return hasBrevo ? "brevo" : "smtp";
}

function isEmailDeliveryConfigured() {
  const { authUser, authPass, fromAddress } = getEmailTransportSettings();
  const { apiKey } = getBrevoSettings();
  return !!(fromAddress && (apiKey || (authUser && authPass)));
}

function assertEmailDeliveryConfigured() {
  if (isEmailDeliveryConfigured()) return;

  const missing = [];
  const { fromAddress } = getEmailTransportSettings();
  const { apiKey } = getBrevoSettings();
  const hasSmtpCreds = !!(process.env.SMTP_USER || process.env.EMAIL_USER) &&
    !!(process.env.SMTP_PASS || process.env.EMAIL_PASS);

  if (!fromAddress) missing.push("EMAIL_FROM");
  if (!apiKey && !hasSmtpCreds) missing.push("BREVO_API_KEY or SMTP_USER + SMTP_PASS");

  console.error("Email delivery is not configured. Missing:", missing.join(", "));

  throw new AppError(
    "OTP email delivery is not configured on the server. Add BREVO_API_KEY and EMAIL_FROM, or configure SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, and EMAIL_FROM.",
    503,
  );
}

function resetTransporter() {
  transporter = null;
  verifyPromise = null;
}

function buildEmailSender() {
  const { fromAddress } = getEmailTransportSettings();
  return {
    name: process.env.EMAIL_FROM_NAME || "Tirth Sutra",
    email: fromAddress,
  };
}

function createRequestError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) Object.assign(error, details);
  return error;
}

function isBrevoSmtpUnauthorizedIpError(error, host = "") {
  return /smtp-relay\.brevo\.com/i.test(String(host || "")) &&
    /unauthorized ip address/i.test(String(error?.message || ""));
}

function requestBrevo(pathname, { method = "GET", body = null, timeoutMs = 15000 } = {}) {
  const { apiKey, baseUrl } = getBrevoSettings();
  if (!apiKey) {
    throw createRequestError("BREVO_API_KEY is missing.", "ENOCONFIG");
  }

  const url = new URL(pathname, baseUrl);
  const payload = body ? JSON.stringify(body) : "";

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "api-key": apiKey,
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          let parsed = null;
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = raw;
            }
          }

          const statusCode = response.statusCode || 500;
          if (statusCode >= 200 && statusCode < 300) {
            resolve({ statusCode, data: parsed });
            return;
          }

          const message =
            parsed?.message ||
            parsed?.error ||
            parsed?.code ||
            `Brevo API request failed with status ${statusCode}.`;

          reject(
            createRequestError(message, statusCode === 401 || statusCode === 403 ? "EAUTH" : "EBREVO", {
              responseStatus: statusCode,
              responseBody: parsed,
            }),
          );
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(createRequestError("Brevo API connection timeout", "ETIMEDOUT"));
    });
    request.on("error", (error) => reject(error));
    if (payload) request.write(payload);
    request.end();
  });
}

async function sendViaBrevo({ email, subject, html, text, replyTo, headers }) {
  const payload = {
    sender: buildEmailSender(),
    to: [{ email }],
    subject,
    ...(html ? { htmlContent: html } : {}),
    ...(text ? { textContent: text } : {}),
    ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    ...(headers ? { headers } : {}),
  };

  const result = await requestBrevo("/v3/smtp/email", {
    method: "POST",
    body: payload,
    timeoutMs: 15000,
  });

  const messageId = result?.data?.messageId || result?.data?.messageIds?.[0] || "Brevo";
  console.log(`Email sent to ${email} via Brevo - messageId: ${messageId}`);
  return result?.data || { messageId };
}

async function verifyBrevoApi() {
  await requestBrevo("/v3/account", { method: "GET", timeoutMs: 12000 });
  console.log("Brevo API verified successfully.");
  return true;
}

function createTransporter() {
  if (transporter) return transporter;

  const { authUser, authPass, host, port, secure } = getEmailTransportSettings();
  assertEmailDeliveryConfigured();

  console.log(`Creating SMTP transporter - host:${host} port:${port} secure:${secure} user:${authUser}`);

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
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  return transporter;
}

async function sendEmail({ email, subject, html, text, replyTo, headers }) {
  assertEmailDeliveryConfigured();
  const { host } = getEmailTransportSettings();

  try {
    if (getEmailDeliveryProvider() === "brevo") {
      return await sendViaBrevo({ email, subject, html, text, replyTo, headers });
    }

    const transport = createTransporter();
    if (shouldVerifyBeforeSend()) {
      await verifyEmailTransport();
    }

    const sender = buildEmailSender();
    const info = await transport.sendMail({
      from: `${sender.name} <${sender.email}>`,
      to: email,
      ...(replyTo ? { replyTo } : {}),
      ...(headers ? { headers } : {}),
      subject,
      html,
      text,
    });

    console.log(`Email sent to ${email} - messageId: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error("Email delivery failed:", error.message, "| code:", error.code || "N/A");
    resetTransporter();

    let userMessage = "Unable to send the OTP email right now. Please try again shortly.";
    if (error.code === "EAUTH") {
      userMessage =
        getEmailDeliveryProvider() === "brevo"
          ? "Email API authentication failed. Check BREVO_API_KEY on the server."
          : isBrevoSmtpUnauthorizedIpError(error, host)
            ? "Brevo SMTP blocked this local IP address. Authorize this IP in Brevo Security > Authorized IPs, or switch the backend to a valid BREVO_API_KEY."
          : "Email authentication failed. Check SMTP_USER and SMTP_PASS environment variables on the server.";
    } else if (error.code === "ECONNECTION" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND") {
      userMessage =
        getEmailDeliveryProvider() === "brevo"
          ? "Could not connect to the Brevo email API. Check network access from the backend and the Brevo API settings."
          : "Could not connect to the email server. Check SMTP_HOST and SMTP_PORT environment variables.";
    } else if (error.code === "EBREVO") {
      userMessage = "Brevo rejected the email request. Check EMAIL_FROM and confirm the sender is verified in Brevo.";
    }

    throw new AppError(userMessage, 502);
  }
}

async function verifyEmailTransport() {
  if (verifyPromise) return verifyPromise;
  const { host } = getEmailTransportSettings();

  verifyPromise = (
    getEmailDeliveryProvider() === "brevo"
      ? verifyBrevoApi()
      : createTransporter().verify().then(() => {
          console.log("SMTP transporter verified successfully.");
          return true;
        })
  ).catch((error) => {
    console.error(
      `${getEmailDeliveryProvider() === "brevo" ? "Brevo" : "SMTP"} verification failed:`,
      error.message,
      "| code:",
      error.code || "N/A",
    );
    resetTransporter();
    const wrappedError = new AppError(
      getEmailDeliveryProvider() === "brevo"
        ? "Email delivery is configured incorrectly on the server. Check BREVO_API_KEY and the verified sender in Brevo."
        : isBrevoSmtpUnauthorizedIpError(error, host)
          ? "Brevo SMTP blocked this server IP address. Authorize the IP in Brevo Security > Authorized IPs, or use a valid BREVO_API_KEY instead."
        : "Email delivery is configured incorrectly on the server. Check SMTP credentials in the backend environment variables.",
      500,
      {
        code: error.code || "UNKNOWN",
        responseStatus: error.responseStatus || null,
        responseBody: error.responseBody || null,
        providerMessage: error.message || "",
      },
    );
    wrappedError.code = error.code || "UNKNOWN";
    throw wrappedError;
  });

  return verifyPromise;
}

module.exports = {
  sendEmail,
  verifyEmailTransport,
  isEmailDeliveryConfigured,
  assertEmailDeliveryConfigured,
  shouldVerifyBeforeSend,
  getEmailDeliveryProvider,
  getEmailTransportSettings,
  getBrevoSettings,
};
