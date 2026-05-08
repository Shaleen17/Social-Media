const https = require("https");
const nodemailer = require("nodemailer");
const AppError = require("./appError");

let transporter = null;
let verifyPromise = null;
const DEFAULT_EMAIL_FROM_NAME = "Tirth Sutra";
const SMTP_REQUIRED_ENV_VARS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "EMAIL_FROM",
];
const BREVO_REQUIRED_ENV_VARS = ["BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME"];

function shouldVerifyBeforeSend() {
  return String(process.env.SMTP_VERIFY_BEFORE_SEND || "false").toLowerCase() === "true";
}

function hasConfiguredEnvValue(name) {
  return String(process.env[name] || "").trim() !== "";
}

function getEmailTransportSettings() {
  const authUser = String(process.env.SMTP_USER || process.env.EMAIL_USER || "").trim();
  const authPass = String(process.env.SMTP_PASS || process.env.EMAIL_PASS || "").trim();
  const fromAddress =
    String(
      process.env.EMAIL_FROM ||
      process.env.SMTP_FROM ||
      process.env.SMTP_USER ||
      process.env.EMAIL_USER ||
      ""
    ).trim();
  const parsedPort = Number(process.env.SMTP_PORT || 0);
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : parsedPort === 465;
  const port = parsedPort || (secure ? 465 : 587);
  const parsedFamily = Number(process.env.SMTP_FAMILY || 4);
  const family = [0, 4, 6].includes(parsedFamily) ? parsedFamily : 4;

  return {
    authUser,
    authPass,
    family,
    fromAddress,
    host: String(process.env.SMTP_HOST || "smtp.gmail.com").trim(),
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

function hasBrevoApiKey() {
  return !!String(process.env.BREVO_API_KEY || "").trim();
}

function getRequiredEmailEnvVars(provider = getEmailDeliveryProvider()) {
  return provider === "brevo" ? BREVO_REQUIRED_ENV_VARS : SMTP_REQUIRED_ENV_VARS;
}

function getEmailConfigurationFixMessage(provider = getEmailDeliveryProvider()) {
  return provider === "brevo"
    ? "Set EMAIL_DELIVERY_PROVIDER=brevo and configure BREVO_API_KEY, EMAIL_FROM, and EMAIL_FROM_NAME."
    : "Set EMAIL_DELIVERY_PROVIDER=smtp and configure SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, and EMAIL_FROM.";
}

function getEmailProviderSelectionSummary() {
  const preferred = getConfiguredEmailProviderPreference();
  if (preferred === "brevo") {
    return "EMAIL_DELIVERY_PROVIDER=brevo";
  }
  if (preferred === "smtp") {
    return "EMAIL_DELIVERY_PROVIDER=smtp";
  }
  return hasBrevoApiKey()
    ? "EMAIL_DELIVERY_PROVIDER=auto with BREVO_API_KEY present"
    : "EMAIL_DELIVERY_PROVIDER=auto without BREVO_API_KEY";
}

function getEmailDeliveryProvider() {
  const preferred = getConfiguredEmailProviderPreference();
  if (preferred === "smtp" || preferred === "brevo") {
    return preferred;
  }

  return hasBrevoApiKey() ? "brevo" : "smtp";
}

function getEffectiveEmailDeliveryProvider() {
  const provider = getEmailDeliveryProvider();
  if (
    provider === "brevo" &&
    getConfiguredEmailProviderPreference() === "auto" &&
    !getEmailConfigurationDiagnostics("brevo").configured &&
    getEmailConfigurationDiagnostics("smtp").configured
  ) {
    return "smtp";
  }

  return provider;
}

function getEmailConfigurationDiagnostics(provider = getEmailDeliveryProvider()) {
  const requiredEnvVars = getRequiredEmailEnvVars(provider);
  const missing = requiredEnvVars.filter((name) => !hasConfiguredEnvValue(name));

  return {
    provider,
    requiredEnvVars,
    configured: missing.length === 0,
    missing,
    selection: getEmailProviderSelectionSummary(),
  };
}

function isEmailDeliveryConfigured() {
  return getEmailConfigurationDiagnostics(getEffectiveEmailDeliveryProvider()).configured;
}

function assertEmailDeliveryConfigured(provider = getEmailDeliveryProvider()) {
  const diagnostics = getEmailConfigurationDiagnostics(provider);
  if (diagnostics.configured) return;

  const missingText = diagnostics.missing.join(", ");
  console.error(
    `Email delivery is not configured for ${diagnostics.provider}.`,
    `Selection: ${diagnostics.selection}.`,
    `Missing: ${missingText}`,
  );

  throw new AppError(
    diagnostics.provider === "brevo"
      ? `OTP email delivery is set to Brevo, but ${missingText} ${diagnostics.missing.length === 1 ? "is" : "are"} missing. ${getEmailConfigurationFixMessage("brevo")}`
      : `OTP email delivery is set to SMTP, but ${missingText} ${diagnostics.missing.length === 1 ? "is" : "are"} missing. ${getEmailConfigurationFixMessage("smtp")}`,
    503,
    diagnostics,
  );
}

function resetTransporter() {
  transporter = null;
  verifyPromise = null;
}

function buildEmailSender() {
  const { fromAddress } = getEmailTransportSettings();
  return {
    name: String(process.env.EMAIL_FROM_NAME || DEFAULT_EMAIL_FROM_NAME).trim() || DEFAULT_EMAIL_FROM_NAME,
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

  const { authUser, authPass, family, host, port, secure } = getEmailTransportSettings();
  assertEmailDeliveryConfigured("smtp");

  console.log(
    `Creating SMTP transporter - host:${host} port:${port} secure:${secure} family:${family || "auto"} user:${authUser}`,
  );

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    ...(family ? { family } : {}),
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

function canFallbackToSmtpFromBrevo(error) {
  if (!getEmailConfigurationDiagnostics("smtp").configured) {
    return false;
  }

  if (!["EAUTH", "EBREVO", "ENOCONFIG"].includes(error?.code)) {
    return false;
  }

  return getEmailConfigurationDiagnostics("smtp").configured;
}

async function sendViaSmtp({ email, subject, html, text, replyTo, headers }) {
  const transport = createTransporter();
  if (shouldVerifyBeforeSend()) {
    await verifySmtpTransport();
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

  console.log(`Email sent to ${email} via SMTP - messageId: ${info.messageId}`);
  return info;
}

async function sendEmail({ email, subject, html, text, replyTo, headers }) {
  const { host } = getEmailTransportSettings();
  const selectedProvider = getEffectiveEmailDeliveryProvider();
  let handlingProvider = selectedProvider;
  assertEmailDeliveryConfigured(selectedProvider);

  try {
    if (selectedProvider === "brevo") {
      return await sendViaBrevo({ email, subject, html, text, replyTo, headers });
    }

    return await sendViaSmtp({ email, subject, html, text, replyTo, headers });
  } catch (error) {
    if (selectedProvider === "brevo" && canFallbackToSmtpFromBrevo(error)) {
      console.error(
        "Brevo email delivery failed; trying configured SMTP fallback:",
        error.message,
        "| code:",
        error.code || "N/A",
      );

      try {
        handlingProvider = "smtp";
        return await sendViaSmtp({ email, subject, html, text, replyTo, headers });
      } catch (fallbackError) {
        fallbackError.primaryEmailError = error;
        error = fallbackError;
      }
    }

    console.error("Email delivery failed:", error.message, "| code:", error.code || "N/A");
    resetTransporter();

    let userMessage = "Unable to send the OTP email right now. Please try again shortly.";
    if (error.code === "EAUTH") {
      userMessage =
        handlingProvider === "brevo"
          ? "Email API authentication failed. Check BREVO_API_KEY on the server."
          : isBrevoSmtpUnauthorizedIpError(error, host)
            ? "Brevo SMTP blocked this local IP address. Authorize this IP in Brevo Security > Authorized IPs, or switch the backend to a valid BREVO_API_KEY."
          : "Email authentication failed. Check SMTP_USER and SMTP_PASS environment variables on the server.";
    } else if (error.code === "ECONNECTION" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND") {
      userMessage =
        handlingProvider === "brevo"
          ? "Could not connect to the Brevo email API. Check network access from the backend and the Brevo API settings."
          : "Could not connect to the email server. Check SMTP_HOST and SMTP_PORT environment variables.";
    } else if (error.code === "EBREVO") {
      userMessage = "Brevo rejected the email request. Check EMAIL_FROM and confirm the sender is verified in Brevo.";
    }

    throw new AppError(userMessage, 502);
  }
}

function verifySmtpTransport() {
  return createTransporter().verify().then(() => {
    console.log("SMTP transporter verified successfully.");
    return { provider: "smtp", fallback: false };
  });
}

async function verifyEmailTransport() {
  if (verifyPromise) return verifyPromise;
  const { host } = getEmailTransportSettings();
  const selectedProvider = getEffectiveEmailDeliveryProvider();

  verifyPromise = (
    selectedProvider === "brevo"
      ? verifyBrevoApi().then(() => ({ provider: "brevo", fallback: false }))
      : verifySmtpTransport()
  ).catch((error) => {
    if (selectedProvider === "brevo" && canFallbackToSmtpFromBrevo(error)) {
      console.error(
        "Brevo verification failed; trying configured SMTP fallback:",
        error.message,
        "| code:",
        error.code || "N/A",
      );

      return verifySmtpTransport().then((result) => ({
        ...result,
        fallback: true,
        failedProvider: "brevo",
        primaryErrorCode: error.code || "UNKNOWN",
        primaryErrorMessage: error.message || "",
      }));
    }

    console.error(
      `${selectedProvider === "brevo" ? "Brevo" : "SMTP"} verification failed:`,
      error.message,
      "| code:",
      error.code || "N/A",
    );
    resetTransporter();
    const wrappedError = new AppError(
      selectedProvider === "brevo"
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
  getEffectiveEmailDeliveryProvider,
  getEmailConfigurationDiagnostics,
  getEmailConfigurationFixMessage,
  getEmailTransportSettings,
  getBrevoSettings,
  getRequiredEmailEnvVars,
  isBrevoSmtpUnauthorizedIpError,
};
