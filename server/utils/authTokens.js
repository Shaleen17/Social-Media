const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const EMAIL_TOKEN_BYTES = 32;
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function createEmailVerificationToken() {
  const rawToken = crypto.randomBytes(EMAIL_TOKEN_BYTES).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

  return {
    rawToken,
    hashedToken,
    expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
  };
}

function hashVerificationToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signAuthToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
}

module.exports = {
  createEmailVerificationToken,
  hashVerificationToken,
  signAuthToken,
};
