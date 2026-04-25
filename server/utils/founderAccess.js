const AppError = require("./appError");

const DEFAULT_FOUNDER_OWNER_EMAILS = [
  "tirthsutra@gmail.com",
  "tirthsutra@gemail.com",
];

function getFounderOwnerEmails() {
  const configured = String(
    process.env.FOUNDER_OWNER_EMAILS || process.env.FOUNDER_OWNER_EMAIL || ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_FOUNDER_OWNER_EMAILS;
}

function isFounderUser(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) return false;
  return getFounderOwnerEmails().includes(email);
}

function requireFounder(req, res, next) {
  if (!isFounderUser(req.user)) {
    return next(new AppError("Founder access only", 403));
  }
  next();
}

module.exports = {
  getFounderOwnerEmails,
  isFounderUser,
  requireFounder,
};
