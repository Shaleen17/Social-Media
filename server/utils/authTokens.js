const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const EMAIL_TOKEN_BYTES = 32;
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_OTP_TTL_MS = 10 * 60 * 1000;

function hashTokenValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function createEmailVerificationToken() {
  const rawToken = crypto.randomBytes(EMAIL_TOKEN_BYTES).toString("hex");
  const hashedToken = hashTokenValue(rawToken);

  return {
    rawToken,
    hashedToken,
    expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
  };
}

function createEmailOtpCode() {
  const rawOtp = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
  const hashedOtp = hashTokenValue(rawOtp);

  return {
    rawOtp,
    hashedOtp,
    expiresAt: new Date(Date.now() + EMAIL_OTP_TTL_MS),
  };
}

function hashVerificationToken(token) {
  return hashTokenValue(token);
}

function hashOtpCode(otp) {
  return hashTokenValue(otp);
}

function signAuthToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
}

module.exports = {
  createEmailVerificationToken,
  createEmailOtpCode,
  hashVerificationToken,
  hashOtpCode,
  signAuthToken,
  EMAIL_OTP_TTL_MS,
};
