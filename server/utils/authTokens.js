const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const EMAIL_OTP_LENGTH = 6;
const EMAIL_OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 5;
const OTP_MAX_SENDS_PER_SESSION = 5;
const PENDING_SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;
const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/;

function hashTokenValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function createEmailOtpCode() {
  const rawOtp = crypto
    .randomInt(0, 10 ** EMAIL_OTP_LENGTH)
    .toString()
    .padStart(EMAIL_OTP_LENGTH, "0");
  const hashedOtp = hashTokenValue(rawOtp);

  return {
    rawOtp,
    hashedOtp,
    expiresAt: new Date(Date.now() + EMAIL_OTP_TTL_MS),
  };
}

function hashOtpCode(otp) {
  return hashTokenValue(otp);
}

function compareHashedValues(storedHash, candidateHash) {
  if (!storedHash || !candidateHash) {
    return false;
  }

  const storedBuffer = Buffer.from(String(storedHash));
  const candidateBuffer = Buffer.from(String(candidateHash));

  if (storedBuffer.length !== candidateBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(storedBuffer, candidateBuffer);
}

function createPendingSignupExpiryDate() {
  return new Date(Date.now() + PENDING_SIGNUP_TTL_MS);
}

function isBcryptHash(value) {
  return BCRYPT_HASH_RE.test(String(value || ""));
}

function signAuthToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
}

module.exports = {
  EMAIL_OTP_LENGTH,
  createEmailOtpCode,
  hashOtpCode,
  compareHashedValues,
  createPendingSignupExpiryDate,
  isBcryptHash,
  signAuthToken,
  EMAIL_OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_MAX_SENDS_PER_SESSION,
  PENDING_SIGNUP_TTL_MS,
};
