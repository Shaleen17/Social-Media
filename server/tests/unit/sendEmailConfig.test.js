const assert = require("node:assert/strict");
const { test } = require("../helpers/harness");

const SEND_EMAIL_MODULE_PATH = require.resolve("../../utils/sendEmail");
const EMAIL_ENV_KEYS = [
  "EMAIL_DELIVERY_PROVIDER",
  "BREVO_API_KEY",
  "BREVO_API_BASE",
  "EMAIL_FROM",
  "EMAIL_FROM_NAME",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "EMAIL_USER",
  "EMAIL_PASS",
  "SMTP_FROM",
];

function withEmailEnv(overrides, fn) {
  const previous = new Map();

  for (const key of EMAIL_ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  delete require.cache[SEND_EMAIL_MODULE_PATH];

  try {
    return fn(require("../../utils/sendEmail"));
  } finally {
    delete require.cache[SEND_EMAIL_MODULE_PATH];
    for (const key of EMAIL_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("brevo diagnostics require BREVO_API_KEY, EMAIL_FROM, and EMAIL_FROM_NAME", () => {
  withEmailEnv(
    {
      EMAIL_DELIVERY_PROVIDER: "brevo",
      BREVO_API_KEY: "brevo-key",
      EMAIL_FROM: "sender@example.com",
    },
    ({ getEmailConfigurationDiagnostics }) => {
      const diagnostics = getEmailConfigurationDiagnostics("brevo");

      assert.equal(diagnostics.provider, "brevo");
      assert.equal(diagnostics.configured, false);
      assert.deepEqual(diagnostics.missing, ["EMAIL_FROM_NAME"]);
      assert.deepEqual(diagnostics.requiredEnvVars, [
        "BREVO_API_KEY",
        "EMAIL_FROM",
        "EMAIL_FROM_NAME",
      ]);
    },
  );
});

test("smtp diagnostics report every required SMTP env var", () => {
  withEmailEnv(
    {
      EMAIL_DELIVERY_PROVIDER: "smtp",
      SMTP_USER: "mailer@example.com",
      SMTP_PASS: "smtp-pass",
      EMAIL_FROM: "mailer@example.com",
    },
    ({ getEmailConfigurationDiagnostics }) => {
      const diagnostics = getEmailConfigurationDiagnostics("smtp");

      assert.equal(diagnostics.provider, "smtp");
      assert.equal(diagnostics.configured, false);
      assert.deepEqual(diagnostics.missing, ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE"]);
    },
  );
});

test("auto mode prefers brevo when a Brevo API key is present", () => {
  withEmailEnv(
    {
      BREVO_API_KEY: "brevo-key",
      EMAIL_FROM: "sender@example.com",
      EMAIL_FROM_NAME: "Tirth Sutra",
    },
    ({ getEmailDeliveryProvider, getEmailConfigurationDiagnostics }) => {
      assert.equal(getEmailDeliveryProvider(), "brevo");
      assert.equal(getEmailConfigurationDiagnostics().configured, true);
    },
  );
});

test("brevo smtp unauthorized ip detection stays specific to Brevo relay errors", () => {
  withEmailEnv({}, ({ isBrevoSmtpUnauthorizedIpError }) => {
    assert.equal(
      isBrevoSmtpUnauthorizedIpError(
        { message: "554 rejected: unauthorized ip address" },
        "smtp-relay.brevo.com",
      ),
      true,
    );
    assert.equal(
      isBrevoSmtpUnauthorizedIpError(
        { message: "535 Authentication failed" },
        "smtp.gmail.com",
      ),
      false,
    );
  });
});
