const crypto = require("crypto");
const User = require("../models/User");

function sanitizeReferralCode(code = "") {
  return String(code)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 18);
}

function createReferralSeed(seed = "") {
  const normalized = String(seed)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return normalized || "TIRTH";
}

function createReferralCandidate(seed = "", attempt = 0) {
  const prefix = createReferralSeed(seed);
  const suffix = crypto
    .randomBytes(attempt > 4 ? 4 : 3)
    .toString("hex")
    .toUpperCase();
  return `${prefix}${suffix}`.slice(0, 18);
}

async function generateUniqueReferralCode(seed = "") {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = createReferralCandidate(seed, attempt);
    const exists = await User.exists({ referralCode: candidate });
    if (!exists) return candidate;
  }

  return `${createReferralSeed(seed)}${crypto
    .randomBytes(5)
    .toString("hex")
    .toUpperCase()}`.slice(0, 18);
}

async function ensureUserReferralCode(user) {
  if (!user) return null;
  if (user.referralCode) return user;

  user.referralCode = await generateUniqueReferralCode(
    user.handle || user.name || user.email || "TIRTH",
  );
  await user.save({ validateBeforeSave: false });
  return user;
}

async function resolveReferrer(referralCode) {
  const normalizedCode = sanitizeReferralCode(referralCode);
  if (!normalizedCode) return null;
  return User.findOne({ referralCode: normalizedCode });
}

async function attachReferralRelationship(user, referralCode) {
  if (!user) return null;

  const inviter = await resolveReferrer(referralCode);
  if (!inviter) return null;

  await ensureUserReferralCode(inviter);
  if (String(inviter._id) === String(user._id)) {
    return null;
  }

  const referredUsers = Array.isArray(inviter.referredUsers)
    ? inviter.referredUsers
    : [];
  const alreadyLinked = referredUsers.some(
    (entry) => String(entry) === String(user._id),
  );

  if (!alreadyLinked) {
    inviter.referredUsers = [...referredUsers, user._id];
    await inviter.save({ validateBeforeSave: false });
  }

  return inviter;
}

module.exports = {
  sanitizeReferralCode,
  generateUniqueReferralCode,
  ensureUserReferralCode,
  resolveReferrer,
  attachReferralRelationship,
};
